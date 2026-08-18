const whatsappWebJsVersion = require("whatsapp-web.js/package.json").version;
const logger = require("./logger");

/**
 * @typedef {Object} DiagnosticRuntime
 * @property {boolean} connected
 * @property {string} connectionState
 * @property {Date|null} readyAt
 */

/**
 * @typedef {Object} WhatsAppDiagnosticsApi
 * @property {() => void} attachBrowserDiagnostics
 * @property {(targets: FavoriteDiagnosticTarget[]) => Promise<void>} diagnoseFavoriteChats
 * @property {() => Promise<boolean>} installSafeGetChatsWrapper
 * @property {(context: string, error: unknown) => Promise<void>} logFunctionalDiagnostics
 * @property {(context: string) => Promise<void>} logSkippedChatModelsIfAny
 * @property {(value: unknown, maxLength?: number) => string} sanitizeDiagnosticText
 */

/**
 * @typedef {Object} FavoriteDiagnosticTarget
 * @property {number} favoriteIndex Posición del favorito, sin nombre ni teléfono.
 * @property {boolean} hasStoredChatId
 * @property {boolean} hasPhone
 * @property {string[]} candidateChatIds Se usan dentro del navegador y nunca se incluyen en el resultado.
 * @property {string|null} phoneResolutionError
 */

/**
 * Centraliza la observabilidad del navegador. Este módulo nunca decide si se
 * reinicia WhatsApp: solamente recopila evidencia y protege la lectura de chats
 * defectuosos para que el resto del sistema pueda tomar esa decisión.
 * @param {{client: import("whatsapp-web.js").Client, runtime: DiagnosticRuntime}} dependencies
 * @returns {WhatsAppDiagnosticsApi}
 */
function createWhatsAppDiagnostics({ client, runtime }) {
    const diagnosticLogIntervalMs = 30 * 60 * 1000;
    const skippedChatModelsLogIntervalMs = 6 * 60 * 60 * 1000;
    const diagnosticCycleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxDiagnosticEvents = 10;
    let diagnosticAttempt = 0;
    let diagnosticsPage = null;
    let lastDiagnosticLogAt = 0;
    let lastFavoriteDiagnosticLogAt = 0;
    let lastSkippedChatModelsLogAt = 0;
    let lastSkippedChatModelsSignature = null;
    const recentPageErrors = [];
    const recentConsoleErrors = [];
    const recentFailedRequests = [];
    const recentNavigations = [];

    function sanitizeDiagnosticText(value, maxLength = 1500) {
        return String(value || "")
            .replace(/https?:\/\/[^\s"'<>]+/gi, match => {
                try {
                    return `${new URL(match).origin}/[ruta-omitida]`;
                } catch {
                    return "[url-omitida]";
                }
            })
            .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[correo-omitido]")
            .replace(/\+?\d[\d\s().-]{5,}\d/g, "[numero-omitido]")
            .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[credencial-omitida]")
            .slice(0, maxLength);
    }

    function appendDiagnosticEvent(collection, event) {
        collection.push(event);

        if (collection.length > maxDiagnosticEvents)
            collection.splice(0, collection.length - maxDiagnosticEvents);
    }

    /**
     * Inspecciona por etapas la ruta usada por getChatById. El resultado excluye
     * identificadores, contactos y contenido. Se limita a 25 favoritos y cuatro
     * candidatos por favorito para cubrir instalaciones reales sin inflar el log.
     * @param {FavoriteDiagnosticTarget[]} targets
     * @returns {Promise<void>}
     */
    async function diagnoseFavoriteChats(targets) {
        if (!client.pupPage || client.pupPage.isClosed())
            return;

        if (Date.now() - lastFavoriteDiagnosticLogAt < diagnosticLogIntervalMs)
            return;

        lastFavoriteDiagnosticLogAt = Date.now();
        const safeTargets = (targets || []).slice(0, 25).map(target => ({
            favoriteIndex: Number(target.favoriteIndex),
            hasStoredChatId: target.hasStoredChatId === true,
            hasPhone: target.hasPhone === true,
            candidateChatIds: [...new Set(target.candidateChatIds || [])].filter(Boolean).slice(0, 4),
            phoneResolutionError: sanitizeDiagnosticText(target.phoneResolutionError, 300) || null
        }));

        try {
            const inspection = await Promise.race([
                client.pupPage.evaluate(async diagnosticTargets => {
                    const classifyId = chatId => {
                        if (chatId.endsWith("@lid"))
                            return "LID";
                        if (chatId.endsWith("@c.us") || chatId.endsWith("@s.whatsapp.net"))
                            return "PN";
                        if (chatId.endsWith("@g.us"))
                            return "GROUP";
                        return "OTHER";
                    };
                    const sanitize = value => String(value || "")
                        .replace(/\+?\d[\d\s().-]{5,}\d/g, "[numero-omitido]")
                        .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[identificador-omitido]");
                    const safeError = error => ({
                        name: sanitize(error?.name || error?.constructor?.name || "Error").slice(0, 100),
                        message: sanitize(error?.message || error || "Error desconocido").slice(0, 500)
                    });
                    const results = [];

                    for (const target of diagnosticTargets) {
                        const favoriteResult = {
                            favoriteIndex: target.favoriteIndex,
                            hasStoredChatId: target.hasStoredChatId,
                            hasPhone: target.hasPhone,
                            phoneResolutionError: target.phoneResolutionError,
                            candidateCount: target.candidateChatIds.length,
                            candidates: []
                        };

                        for (const chatId of target.candidateChatIds) {
                            const candidate = {
                                idKind: classifyId(chatId),
                                createWid: false,
                                rawChatFound: false,
                                hasMessagesCollection: false,
                                cachedMessageCount: null,
                                chatSerialization: false,
                                sampleMessageSerialization: null,
                                failedStage: null,
                                error: null
                            };
                            let chatWid;
                            let rawChat;

                            try {
                                chatWid = window.require("WAWebWidFactory").createWid(chatId);
                                candidate.createWid = Boolean(chatWid);
                            } catch (error) {
                                candidate.failedStage = "createWid";
                                candidate.error = safeError(error);
                                favoriteResult.candidates.push(candidate);
                                continue;
                            }

                            try {
                                rawChat = window.require("WAWebCollections").Chat.get(chatWid);
                                candidate.rawChatFound = Boolean(rawChat);
                            } catch (error) {
                                candidate.failedStage = "chatCollectionGet";
                                candidate.error = safeError(error);
                                favoriteResult.candidates.push(candidate);
                                continue;
                            }

                            if (!rawChat) {
                                candidate.failedStage = "chatNotCached";
                                favoriteResult.candidates.push(candidate);
                                continue;
                            }

                            try {
                                candidate.hasMessagesCollection = Boolean(rawChat.msgs);
                                const cachedMessages = rawChat.msgs?.getModelsArray?.() || [];
                                candidate.cachedMessageCount = cachedMessages.length;

                                if (cachedMessages.length > 0) {
                                    try {
                                        await window.WWebJS.getMessageModel(cachedMessages[cachedMessages.length - 1]);
                                        candidate.sampleMessageSerialization = true;
                                    } catch (error) {
                                        candidate.sampleMessageSerialization = false;
                                        candidate.sampleMessageError = safeError(error);
                                    }
                                }
                            } catch (error) {
                                candidate.messagesInspectionError = safeError(error);
                            }

                            try {
                                await window.WWebJS.getChatModel(rawChat);
                                candidate.chatSerialization = true;
                            } catch (error) {
                                candidate.failedStage = "getChatModel";
                                candidate.error = safeError(error);
                            }

                            favoriteResult.candidates.push(candidate);
                        }

                        results.push(favoriteResult);
                    }

                    return {
                        inspectedFavorites: results.length,
                        results
                    };
                }, safeTargets),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("El diagnóstico dirigido de favoritos excedió 20 segundos.")), 20000))
            ]);
            inspection.truncated = (targets || []).length > 25;

            logger.addLog(
                "info",
                "Diagnóstico dirigido de favoritos (no contiene nombres, teléfonos, ChatId ni mensajes).",
                "WhatsAppGateway",
                JSON.stringify(inspection, null, 2));
        } catch (error) {
            console.error("No fue posible completar el diagnóstico dirigido de favoritos:", error);
        }
    }

    /**
     * Los listeners se vinculan una sola vez por página de Puppeteer. Guardamos
     * únicamente metadatos técnicos sanitizados, nunca mensajes ni contactos.
     */
    function attachBrowserDiagnostics() {
        const page = client.pupPage;

        if (!page || page === diagnosticsPage)
            return;

        diagnosticsPage = page;
        page.on("pageerror", error => {
            appendDiagnosticEvent(recentPageErrors, {
                at: new Date().toISOString(),
                name: sanitizeDiagnosticText(error?.name, 100),
                message: sanitizeDiagnosticText(error?.message || error),
                stack: sanitizeDiagnosticText(error?.stack)
            });
        });
        page.on("console", message => {
            if (!["error", "warning", "warn"].includes(message.type()))
                return;

            const location = message.location();
            appendDiagnosticEvent(recentConsoleErrors, {
                at: new Date().toISOString(),
                type: message.type(),
                text: sanitizeDiagnosticText(message.text()),
                source: sanitizeDiagnosticText(location?.url, 300)
            });
        });
        page.on("requestfailed", request => {
            let host = "[host-no-disponible]";

            try {
                host = new URL(request.url()).host;
            } catch {
                // La URL completa se omite para evitar registrar datos privados.
            }

            appendDiagnosticEvent(recentFailedRequests, {
                at: new Date().toISOString(),
                host,
                resourceType: request.resourceType(),
                errorText: sanitizeDiagnosticText(request.failure()?.errorText, 300)
            });
        });
        page.on("framenavigated", frame => {
            if (frame !== page.mainFrame())
                return;

            let origin = "[origen-no-disponible]";

            try {
                origin = new URL(frame.url()).origin;
            } catch {
                // No se conserva la URL si no puede reducirse a un origen seguro.
            }

            appendDiagnosticEvent(recentNavigations, {
                at: new Date().toISOString(),
                origin
            });
        });
    }

    /**
     * Construye una instantánea técnica sanitizada y la registra como error.
     * Limita su frecuencia para no llenar el archivo durante un mismo incidente.
     * @param {string} context Nombre estable de la operación que falló.
     * @param {unknown} error Error original que disparó el diagnóstico.
     * @returns {Promise<void>}
     */
    async function logFunctionalDiagnostics(context, error) {
        if (Date.now() - lastDiagnosticLogAt < diagnosticLogIntervalMs)
            return;

        lastDiagnosticLogAt = Date.now();
        diagnosticAttempt++;
        const diagnostics = {
            recoveryCycleId: diagnosticCycleId,
            diagnosticAttempt,
            context,
            capturedAt: new Date().toISOString(),
            readyAt: runtime.readyAt?.toISOString() || null,
            millisecondsSinceReady: runtime.readyAt ? Date.now() - runtime.readyAt.getTime() : null,
            nodeVersion: process.version,
            whatsappWebJsVersion,
            chromiumVersion: null,
            processUptimeSeconds: Math.round(process.uptime()),
            processMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
            connectionState: runtime.connectionState,
            transportConnected: runtime.connected,
            navigatorOnline: null,
            clientState: null,
            pageUrl: null,
            pageClosed: null,
            browserConnected: null,
            documentReadyState: null,
            whatsappVersion: null,
            hasWWebJS: null,
            hasGetChatsFunction: null,
            safeGetChatsWrapperInstalled: null,
            skippedChatModels: null,
            hasWhatsAppStore: null,
            hasChatStore: null,
            hasWebSocketModel: null,
            socketState: null,
            socketHasSynced: null,
            socketReadyState: null,
            serviceWorkerControlled: null,
            indexedDbDatabaseCount: null,
            storageUsageBytes: null,
            storageQuotaBytes: null,
            browserSideGetChats: null,
            recentPageErrors: [...recentPageErrors],
            recentConsoleErrors: [...recentConsoleErrors],
            recentFailedRequests: [...recentFailedRequests],
            recentNavigations: [...recentNavigations],
            errorName: error?.name || null,
            errorMessage: sanitizeDiagnosticText(error?.message || error || "Error desconocido")
        };

        diagnostics.pageClosed = client.pupPage?.isClosed() ?? null;
        diagnostics.pageUrl = client.pupPage?.url() || null;
        diagnostics.browserConnected = client.pupBrowser?.isConnected() ?? null;

        const withTimeout = (promise, label) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} excedió 3 segundos.`)), 3000))
        ]);
        const inspections = [
            withTimeout(client.getState(), "La consulta del estado").then(
                value => { diagnostics.clientState = value; },
                stateError => { diagnostics.clientStateError = sanitizeDiagnosticText(stateError?.message || stateError); }),
            withTimeout(client.pupBrowser?.version() ?? Promise.resolve(null), "La consulta de Chromium").then(
                value => { diagnostics.chromiumVersion = value; },
                browserError => { diagnostics.chromiumVersionError = sanitizeDiagnosticText(browserError?.message || browserError); })
        ];

        if (client.pupPage && !diagnostics.pageClosed) {
            inspections.push(withTimeout(
                client.pupPage.evaluate(async () => {
                    const result = {
                        navigatorOnline: navigator.onLine,
                        documentReadyState: document.readyState,
                        whatsappVersion: window.Debug?.VERSION || null,
                        hasWWebJS: Boolean(window.WWebJS),
                        hasGetChatsFunction: typeof window.WWebJS?.getChats === "function",
                        safeGetChatsWrapperInstalled: window.WWebJS?.__voiceMessagingSafeGetChats === true,
                        skippedChatModels: window.WWebJS?.__voiceMessagingLastGetChatsFailures || null,
                        hasWhatsAppStore: Boolean(window.Store),
                        hasChatStore: Boolean(window.Store?.Chat),
                        hasWebSocketModel: false,
                        socketState: null,
                        socketHasSynced: null,
                        socketReadyState: null,
                        serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
                        indexedDbDatabaseCount: null,
                        storageUsageBytes: null,
                        storageQuotaBytes: null,
                        browserSideGetChats: null
                    };

                    try {
                        const socket = window.require?.("WAWebSocketModel")?.Socket;
                        result.hasWebSocketModel = Boolean(socket);
                        result.socketState = socket?.state ?? null;
                        result.socketHasSynced = socket?.hasSynced ?? null;
                        result.socketReadyState = socket?.socket?.readyState ?? socket?.ws?.readyState ?? null;
                    } catch (socketError) {
                        result.socketInspectionError = String(socketError?.message || socketError).slice(0, 500);
                    }

                    try {
                        const estimate = await navigator.storage?.estimate?.();
                        result.storageUsageBytes = estimate?.usage ?? null;
                        result.storageQuotaBytes = estimate?.quota ?? null;
                        const databases = await indexedDB.databases?.();
                        result.indexedDbDatabaseCount = Array.isArray(databases) ? databases.length : null;
                    } catch (storageError) {
                        result.storageInspectionError = String(storageError?.message || storageError).slice(0, 500);
                    }

                    try {
                        const chats = await window.WWebJS.getChats();
                        result.browserSideGetChats = {
                            succeeded: true,
                            resultCount: Array.isArray(chats) ? chats.length : null
                        };
                    } catch (getChatsError) {
                        const ownProperties = {};

                        for (const propertyName of Object.getOwnPropertyNames(getChatsError || {}).slice(0, 20)) {
                            try {
                                const propertyValue = getChatsError[propertyName];
                                ownProperties[propertyName] = typeof propertyValue === "object"
                                    ? Object.prototype.toString.call(propertyValue)
                                    : String(propertyValue).slice(0, 1000);
                            } catch {
                                ownProperties[propertyName] = "[no-legible]";
                            }
                        }

                        result.browserSideGetChats = {
                            succeeded: false,
                            constructorName: getChatsError?.constructor?.name || null,
                            name: getChatsError?.name || null,
                            message: String(getChatsError?.message || getChatsError || "").slice(0, 1000),
                            stack: String(getChatsError?.stack || "").slice(0, 4000),
                            ownProperties
                        };
                    }

                    return result;
                }),
                "La inspección de la página").then(
                    value => {
                        if (value?.browserSideGetChats?.message)
                            value.browserSideGetChats.message = sanitizeDiagnosticText(value.browserSideGetChats.message);

                        if (value?.browserSideGetChats?.stack)
                            value.browserSideGetChats.stack = sanitizeDiagnosticText(value.browserSideGetChats.stack, 4000);

                        if (value?.browserSideGetChats?.ownProperties) {
                            for (const propertyName of Object.keys(value.browserSideGetChats.ownProperties))
                                value.browserSideGetChats.ownProperties[propertyName] =
                                    sanitizeDiagnosticText(value.browserSideGetChats.ownProperties[propertyName], 1000);
                        }

                        Object.assign(diagnostics, value);
                    },
                    pageError => { diagnostics.pageInspectionError = sanitizeDiagnosticText(pageError?.message || pageError); }));
        }

        await Promise.all(inspections);
        logger.addLog(
            "info",
            "Diagnóstico funcional de WhatsApp (no contiene mensajes ni contactos).",
            "WhatsAppGateway",
            JSON.stringify(diagnostics, null, 2));
    }

    /**
     * WhatsApp Web puede contener un modelo corrupto en IndexedDB. Se reemplaza
     * getChats por una versión tolerante que omite sólo ese modelo, no toda la
     * recuperación de mensajes.
     */
    async function installSafeGetChatsWrapper() {
        if (!client.pupPage || client.pupPage.isClosed())
            return false;

        return await client.pupPage.evaluate(() => {
            if (!window.WWebJS || typeof window.WWebJS.getChatModel !== "function")
                return false;

            if (window.WWebJS.__voiceMessagingSafeGetChats)
                return true;

            window.WWebJS.getChats = async () => {
                const chats = window.require("WAWebCollections").Chat.getModelsArray();
                const results = await Promise.all(chats.map(async chat => {
                    const chatId = chat?.id?._serialized || chat?.id?.toString?.() || "";

                    try {
                        return { chatId, model: await window.WWebJS.getChatModel(chat), error: null };
                    } catch (error) {
                        return {
                            chatId,
                            model: null,
                            error: {
                                name: String(error?.name || error?.constructor?.name || "Error").slice(0, 100),
                                message: String(error?.message || error || "Error desconocido").slice(0, 500)
                            }
                        };
                    }
                }));
                const failures = results.filter(result => result.error).map(result => result.error);
                window.WWebJS.__voiceMessagingLastSkippedChatIds = results
                    .filter(result => result.error && result.chatId)
                    .map(result => result.chatId);
                window.WWebJS.__voiceMessagingLastGetChatsFailures = {
                    count: failures.length,
                    errors: failures.slice(0, 5)
                };

                return results.map(result => result.model).filter(Boolean);
            };
            window.WWebJS.__voiceMessagingSafeGetChats = true;
            window.WWebJS.__voiceMessagingLastSkippedChatIds = [];
            window.WWebJS.__voiceMessagingLastGetChatsFailures = { count: 0, errors: [] };
            return true;
        });
    }

    /**
     * Lee el resumen generado dentro del navegador sin extraer chats ni contactos.
     * @param {string} context Descripción de la lectura que toleró modelos dañados.
     * @returns {Promise<void>}
     */
    async function logSkippedChatModelsIfAny(context) {
        if (!client.pupPage || client.pupPage.isClosed())
            return;

        const failures = await client.pupPage.evaluate(() =>
            window.WWebJS?.__voiceMessagingLastGetChatsFailures || null).catch(() => null);

        if (!failures?.count)
            return;

        const signature = JSON.stringify(failures);

        const repeatedTooSoon = Date.now() - lastSkippedChatModelsLogAt < skippedChatModelsLogIntervalMs;

        if (signature === lastSkippedChatModelsSignature || repeatedTooSoon)
            return;

        lastSkippedChatModelsSignature = signature;
        lastSkippedChatModelsLogAt = Date.now();
        console.warn(
            `WhatsApp omitió ${failures.count} chat(s) que no pudo leer durante ${context}; los demás chats continuarán procesándose.`,
            signature);
    }

    return {
        attachBrowserDiagnostics,
        diagnoseFavoriteChats,
        installSafeGetChatsWrapper,
        logFunctionalDiagnostics,
        logSkippedChatModelsIfAny,
        sanitizeDiagnosticText
    };
}

module.exports = { createWhatsAppDiagnostics };
