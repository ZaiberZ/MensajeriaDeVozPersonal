const whatsappWebJsVersion = require("whatsapp-web.js/package.json").version;

/**
 * Centraliza la observabilidad del navegador. Este módulo nunca decide si se
 * reinicia WhatsApp: solamente recopila evidencia y protege la lectura de chats
 * defectuosos para que el resto del sistema pueda tomar esa decisión.
 */
function createWhatsAppDiagnostics({ client, runtime }) {
    const diagnosticLogIntervalMs = 5 * 60 * 1000;
    const diagnosticCycleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maxDiagnosticEvents = 20;
    let diagnosticAttempt = 0;
    let diagnosticsPage = null;
    let lastDiagnosticLogAt = 0;
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
        console.error("Diagnóstico funcional de WhatsApp (no contiene mensajes ni contactos):", JSON.stringify(diagnostics, null, 2));
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
                    try {
                        return { model: await window.WWebJS.getChatModel(chat), error: null };
                    } catch (error) {
                        return {
                            model: null,
                            error: {
                                name: String(error?.name || error?.constructor?.name || "Error").slice(0, 100),
                                message: String(error?.message || error || "Error desconocido").slice(0, 500)
                            }
                        };
                    }
                }));
                const failures = results.filter(result => result.error).map(result => result.error);
                window.WWebJS.__voiceMessagingLastGetChatsFailures = {
                    count: failures.length,
                    errors: failures.slice(0, 5)
                };

                return results.map(result => result.model).filter(Boolean);
            };
            window.WWebJS.__voiceMessagingSafeGetChats = true;
            window.WWebJS.__voiceMessagingLastGetChatsFailures = { count: 0, errors: [] };
            return true;
        });
    }

    async function logSkippedChatModelsIfAny(context) {
        if (!client.pupPage || client.pupPage.isClosed())
            return;

        const failures = await client.pupPage.evaluate(() =>
            window.WWebJS?.__voiceMessagingLastGetChatsFailures || null).catch(() => null);

        if (!failures?.count)
            return;

        const signature = JSON.stringify(failures);

        if (signature === lastSkippedChatModelsSignature)
            return;

        lastSkippedChatModelsSignature = signature;
        console.warn(
            `WhatsApp omitió ${failures.count} chat(s) que no pudo leer durante ${context}; los demás chats continuarán procesándose.`,
            signature);
    }

    return {
        attachBrowserDiagnostics,
        installSafeGetChatsWrapper,
        logFunctionalDiagnostics,
        logSkippedChatModelsIfAny,
        sanitizeDiagnosticText
    };
}

module.exports = { createWhatsAppDiagnostics };
