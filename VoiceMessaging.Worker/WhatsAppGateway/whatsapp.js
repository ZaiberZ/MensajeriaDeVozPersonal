const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const dns = require("dns");
const { getChromePath } = require("./chrome-path");
const logger = require("./logger");
const whatsappWebJsVersion = require("whatsapp-web.js/package.json").version;

const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const authPath = path.join(dataDirectory, "whatsapp-auth");
const legacyAuthPath = path.join(__dirname, "data", "auth");

function migrateLegacyAuth() {
    if (fs.existsSync(authPath) || !fs.existsSync(legacyAuthPath))
        return;

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.cpSync(legacyAuthPath, authPath, { recursive: true });
}

migrateLegacyAuth();

const sessionPath = path.join(authPath, "session-personal");
const readyFilePath = path.join(authPath, "personal.ready");
const hasReadySession = fs.existsSync(readyFilePath);
const userFilePath = path.join(dataDirectory, "user-data.json");
const healthFilePath = path.join(dataDirectory, "whatsapp-health.json");

const hasSession = fs.existsSync(sessionPath);

let initialized = false;
let connected = false;
let clientReady = false;
let connectionState = "INITIALIZING";
let conflictDetectedAt = null;
let manualTakeoverRunning = false;
let manualTakeoverRequestedAt = null;
let lastTakeoverError = null;
let logoutInProgress = false;
let restartScheduled = false;
const takeoverTimeoutMs = 5 * 1000;
const manualTakeoverDelayMs = takeoverTimeoutMs + 3 * 1000;
const initializationRetryDelayMs = 15 * 1000;
const initializationMaxAttempts = 5;
const sendRetryDelayMs = 5 * 1000;
const sendMaxAttempts = 3;
const functionalFailureThreshold = 3;
const automaticFunctionalRestartsEnabled = false;
const recoveryWindowMs = 30 * 60 * 1000;
const maxRecoveryRestarts = 3;
const healthProbeIntervalMs = 60 * 1000;
const extendedRecoveryDelayMs = 5 * 60 * 1000;
const networkRetryDelayMs = 30 * 1000;
const diagnosticLogIntervalMs = 5 * 60 * 1000;
let lastQr = null;
let pendingMessages = [];
const pendingMessageIds = new Set();
let healthProbeTimer = null;
let healthProbeRunning = false;
let extendedRecoveryTimer = null;
let lastDiagnosticLogAt = 0;
const diagnosticCycleId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let diagnosticAttempt = 0;
let lastSkippedChatModelsSignature = null;
let readyAt = null;
let diagnosticsPage = null;
const recentPageErrors = [];
const recentConsoleErrors = [];
const recentFailedRequests = [];
const recentNavigations = [];
const maxDiagnosticEvents = 20;
const User = { "Phone": "", "FullName": "", "Email": "", "SupportPhone": "", "SupportEmail": "", "SecondAribnbPhone": "", IsRegistered: false };
let health = loadHealth();

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "personal", dataPath: authPath }),
    takeoverOnConflict: true,
    takeoverTimeoutMs,

    puppeteer: {
        headless: hasReadySession,
        executablePath: getChromePath(),
        protocolTimeout: 180000,
        timeout: 180000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions'
        ]
    }
});

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function defaultHealth() {
    return {
        consecutiveFailures: 0,
        lastSuccessfulReadAt: null,
        lastFailureAt: null,
        lastFailure: null,
        degraded: false,
        relinkRequired: false,
        relinkReason: null,
        recoveryExhausted: false,
        recoveryRestarts: []
    };
}

function loadHealth() {
    try {
        if (!fs.existsSync(healthFilePath))
            return defaultHealth();

        const savedHealth = { ...defaultHealth(), ...readJsonFile(healthFilePath) };

        // Older versions treated exhausted recovery attempts as an invalid session.
        // Only an authentication failure should require pairing again.
        if (savedHealth.relinkRequired && !savedHealth.relinkReason) {
            const authenticationFailure = /auth|autentic|logout|desvinc/i.test(savedHealth.lastFailure || "");
            savedHealth.relinkReason = authenticationFailure ? "AUTH_FAILURE" : null;
            savedHealth.relinkRequired = authenticationFailure;
            savedHealth.recoveryExhausted = !authenticationFailure;
        }

        if (!automaticFunctionalRestartsEnabled) {
            savedHealth.recoveryExhausted = false;
            savedHealth.recoveryRestarts = [];
        }

        return savedHealth;
    } catch (error) {
        console.warn("No se pudo leer el estado de salud de WhatsApp; se creará uno nuevo:", error);
        return defaultHealth();
    }
}

function saveHealth() {
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(healthFilePath, JSON.stringify(health, null, 2), "utf8");
}

function recordSuccessfulRead() {
    if (extendedRecoveryTimer) {
        clearTimeout(extendedRecoveryTimer);
        extendedRecoveryTimer = null;
    }

    health = { ...defaultHealth(), lastSuccessfulReadAt: new Date().toISOString() };
    saveHealth();
}

async function isWhatsAppNetworkReachable() {
    try {
        await dns.promises.lookup("web.whatsapp.com");
        const response = await fetch("https://web.whatsapp.com/", {
            method: "HEAD",
            redirect: "manual",
            signal: AbortSignal.timeout(10000)
        });
        return response.status > 0;
    } catch {
        return false;
    }
}

async function waitForWhatsAppNetwork() {
    let warningLogged = false;

    while (!await isWhatsAppNetworkReachable()) {
        updateConnectionState("WAITING_FOR_NETWORK");

        if (!warningLogged) {
            console.warn("No se puede resolver web.whatsapp.com. La recuperación esperará a que vuelva Internet sin consumir intentos.");
            warningLogged = true;
        }

        await new Promise(resolve => setTimeout(resolve, networkRetryDelayMs));
    }

    if (warningLogged)
        console.log("Internet y DNS volvieron a responder. Reanudando automáticamente la conexión con WhatsApp.");
}

function recentRecoveryRestarts() {
    const cutoff = Date.now() - recoveryWindowMs;
    return (health.recoveryRestarts || []).filter(value => {
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) && timestamp >= cutoff;
    });
}

function restartGatewayPreservingSession(message, exitDelayMs = 250) {
    if (restartScheduled || logoutInProgress)
        return false;

    restartScheduled = true;
    updateConnectionState("RESTARTING");
    console.warn(message);

    setTimeout(async () => {
        try {
            await client.destroy();
        } catch (cleanupError) {
            console.error("No fue posible cerrar Chromium durante la recuperación:");
            console.error(cleanupError);
        }

        process.exit(1);
    }, exitDelayMs);

    return true;
}

function scheduleFunctionalRecovery() {
    if (restartScheduled || logoutInProgress || health.relinkRequired)
        return;

    const recoveryRestarts = recentRecoveryRestarts();

    if (recoveryRestarts.length >= maxRecoveryRestarts) {
        const wasAlreadyExhausted = health.recoveryExhausted;
        health.degraded = true;
        health.recoveryExhausted = true;
        health.recoveryRestarts = recoveryRestarts;
        saveHealth();
        if (!wasAlreadyExhausted)
            console.error(`WhatsApp continuó sin poder leer chats después de ${maxRecoveryRestarts} reinicios. La recuperación seguirá automáticamente cada ${extendedRecoveryDelayMs / 60000} minutos; la sesión no se marcó como desvinculada.`);

        scheduleExtendedRecovery();
        return;
    }

    health.recoveryExhausted = false;
    health.recoveryRestarts = [...recoveryRestarts, new Date().toISOString()];
    saveHealth();
    restartGatewayPreservingSession(
        `WhatsApp acumuló ${health.consecutiveFailures} fallos funcionales. Reiniciando Chromium y el Gateway sin eliminar la sesión.`);
}

function scheduleExtendedRecovery() {
    if (extendedRecoveryTimer || restartScheduled || logoutInProgress || health.relinkRequired)
        return;

    extendedRecoveryTimer = setTimeout(async () => {
        extendedRecoveryTimer = null;

        if (!await isWhatsAppNetworkReachable()) {
            updateConnectionState("WAITING_FOR_NETWORK");
            console.warn("La recuperación extendida de WhatsApp esperará porque web.whatsapp.com todavía no se puede resolver.");
            scheduleExtendedRecovery();
            return;
        }

        health.recoveryExhausted = false;
        health.recoveryRestarts = [];
        saveHealth();
        restartGatewayPreservingSession("Internet está disponible. Ejecutando un nuevo ciclo automático de recuperación de WhatsApp sin eliminar la sesión.");
    }, extendedRecoveryDelayMs);
}

function recordFunctionalFailure(error, failureCount = 1) {
    health.consecutiveFailures += Math.max(1, failureCount);
    health.lastFailureAt = new Date().toISOString();
    health.lastFailure = String(error?.message || error || "Error desconocido");
    health.degraded = health.consecutiveFailures >= functionalFailureThreshold;
    health.recoveryExhausted = false;
    health.recoveryRestarts = [];
    saveHealth();

    if (health.degraded && automaticFunctionalRestartsEnabled)
        scheduleFunctionalRecovery();
}

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
        readyAt: readyAt?.toISOString() || null,
        millisecondsSinceReady: readyAt ? Date.now() - readyAt.getTime() : null,
        nodeVersion: process.version,
        whatsappWebJsVersion,
        chromiumVersion: null,
        processUptimeSeconds: Math.round(process.uptime()),
        processMemoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        connectionState,
        transportConnected: connected,
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

async function probeFunctionalHealth() {
    if (healthProbeRunning || !connected || !health.degraded || health.relinkRequired || restartScheduled || logoutInProgress)
        return;

    healthProbeRunning = true;

    try {
        await client.getChats();
        await logSkippedChatModelsIfAny("la comprobación automática");
        recordSuccessfulRead();
        console.log("La comprobación automática de WhatsApp fue exitosa. El estado de conexión volvió a ser saludable.");
    } catch (error) {
        await logFunctionalDiagnostics("comprobacion-automatica", error);
        recordFunctionalFailure(error);
        console.warn("La comprobación automática de WhatsApp todavía no puede leer los chats:", error);
    } finally {
        healthProbeRunning = false;
    }
}

function startFunctionalHealthProbe() {
    if (healthProbeTimer)
        return;

    healthProbeTimer = setInterval(probeFunctionalHealth, healthProbeIntervalMs);
}

function getQr() {
    return lastQr;
}

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

function updateConnectionState(state) {
    const normalizedState = String(state || "UNKNOWN").toUpperCase();
    const previousState = connectionState;
    connectionState = normalizedState;
    connected = normalizedState === "CONNECTED" && clientReady;

    if (normalizedState === "CONFLICT") {
        if (!conflictDetectedAt) {
            conflictDetectedAt = new Date();
            console.warn("WhatsApp está abierto en otro navegador. Se intentará usar la sesión en este equipo.");
        }
    } else if (connected) {
        if (conflictDetectedAt)
            console.log("El conflicto de sesión terminó. WhatsApp continuará en este equipo.");

        conflictDetectedAt = null;
        manualTakeoverRunning = false;
        manualTakeoverRequestedAt = null;
        lastTakeoverError = null;
    } else if (previousState === "CONFLICT" && normalizedState !== "OPENING") {
        conflictDetectedAt = null;
        manualTakeoverRunning = false;
        manualTakeoverRequestedAt = null;
    }
}

client.on("qr", async (qr) => {
    lastQr = await qrcode.toDataURL(qr);

    console.log("QR generado. Abre http://localhost:3000/whatsapp/qr para escanearlo.");
});

client.on("ready", async () => {
    clientReady = false;
    updateConnectionState("CONNECTED");
    readyAt = new Date();
    lastQr = null;
    User.IsRegistered = true;
    fs.writeFileSync(readyFilePath, new Date().toISOString(), "utf8");

    const safeGetChatsInstalled = await installSafeGetChatsWrapper().catch(error => {
        console.error("No fue posible instalar el aislamiento de chats defectuosos:");
        console.error(error);
        return false;
    });

    clientReady = true;
    updateConnectionState("CONNECTED");
    console.log(`WhatsApp conectado. Aislamiento de chats defectuosos: ${safeGetChatsInstalled ? "activo" : "no disponible"}.`);
    attachBrowserDiagnostics();
    startFunctionalHealthProbe();

    try {
        await recoverUnreadMessages();
    } catch (error) {
        console.error("Error al recuperar mensajes no leídos:");
        console.error(error);
    }

    // if (!hasSession) {
    // console.log("Primera autenticación completada. Reiniciando Gateway...");
    // setTimeout(() => { process.exit(0); }, 3000);
    // }
});

client.on("authenticated", () => {
    console.log("Sesión autenticada.");
});

client.on("change_state", state => {
    updateConnectionState(state);
    console.log(`Estado de WhatsApp: ${connectionState}.`);
});

client.on("auth_failure", message => {
    clientReady = false;
    health.degraded = true;
    health.relinkRequired = true;
    health.relinkReason = "AUTH_FAILURE";
    health.recoveryExhausted = false;
    health.lastFailureAt = new Date().toISOString();
    health.lastFailure = String(message || "Error de autenticación");
    saveHealth();
    console.log("Error de autenticación.");
    console.log(message);
});

client.on("disconnected", async reason => {
    clientReady = false;
    updateConnectionState(reason || "DISCONNECTED");
    User.IsRegistered = false;

    console.log("WhatsApp desconectado.");
    console.log(reason);

    if (reason === "LOGOUT" && fs.existsSync(readyFilePath))
        fs.unlinkSync(readyFilePath);

    if (!logoutInProgress && !restartScheduled) {
        restartScheduled = true;
        console.log("Reiniciando WhatsAppGateway para recuperar la conexión o generar un nuevo QR.");
        try {
            await client.destroy();
        } catch (cleanupError) {
            console.error("No fue posible cerrar Chromium antes de reiniciar WhatsAppGateway:");
            console.error(cleanupError);
        }

        setTimeout(() => process.exit(0), 1000);
    }

});

client.on("message", async (message) => {
    try {
        // Ignorar mensajes vacíos o de grupos por ahora, tambien de status
        if (!isSupportedIncomingMessage(message)) {
            return;
        }

        const incomingMessage = await createIncomingMessage(message);
        enqueuePendingMessage(incomingMessage);

        console.log("Mensaje recibido:");
        console.log(incomingMessage);

    } catch (error) {

        console.error("Error al procesar mensaje recibido:");
        console.error(error);
    }
});

function isSupportedIncomingMessage(message) {
    const chatId = message.from || "";

    return message.type === "chat" &&
        Boolean(message.body) &&
        !message.fromMe &&
        chatId !== "0@c.us" &&
        !chatId.includes("@g.us") &&
        !chatId.includes("status@broadcast") &&
        !isChannelChatId(chatId);
}

function isChannelChatId(chatId) {
    return /@\w*newsletter\b/.test(chatId);
}

async function createIncomingMessage(message, senderFallback = "") {
    let sender = senderFallback || message.from;

    try {
        const contact = await message.getContact();
        sender = contact.pushname || contact.name || sender;
    } catch (error) {
        console.warn(`No se pudo obtener el contacto de ${message.from}: ${error.message}`);
    }

    return {
        id: message.id.id,
        chatId: message.from,
        sender,
        phone: message.from.replace("@c.us", ""),
        text: message.body,
        source: "WhatsApp",
        account: "Personal",
        date: message.timestamp
            ? new Date(message.timestamp * 1000).toISOString()
            : new Date().toISOString()
    };
}

function enqueuePendingMessage(message) {
    const messageKey = `${message.chatId}:${message.id}`;

    if (pendingMessageIds.has(messageKey))
        return false;

    pendingMessageIds.add(messageKey);
    pendingMessages.push(message);
    return true;
}

async function recoverUnreadMessages() {
    const unreadMessages = await getUnreadMessages();
    let recoveredCount = 0;

    for (const message of unreadMessages) {
        if (enqueuePendingMessage(message))
            recoveredCount++;
    }

    const recoveryMessage = `${recoveredCount} mensaje(s) no leído(s) recuperado(s) correctamente.`;
    console.log(recoveryMessage);
    logger.addLog("info", recoveryMessage, "WhatsAppGateway");
}

async function getUnreadMessages() {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    let chats;

    try {
        chats = await client.getChats();
        await logSkippedChatModelsIfAny("la recuperación de mensajes no leídos");
        recordSuccessfulRead();
    } catch (error) {
        await logFunctionalDiagnostics("recuperacion-mensajes-no-leidos", error);
        recordFunctionalFailure(error);
        console.warn("WhatsApp no está disponible temporalmente para consultar los chats:", error);

        const unavailableError = new Error("WhatsApp no está disponible temporalmente.");
        unavailableError.statusCode = 503;
        throw unavailableError;
    }

    const unreadMessages = [];

    for (const chat of chats) {
        const chatId = chat.id?._serialized || "";

        if (chat.isGroup || chat.isChannel || chatId.includes("status@broadcast") || isChannelChatId(chatId) || chat.unreadCount <= 0)
            continue;

        try {
            const chatMessages = await chat.fetchMessages({
                limit: chat.unreadCount,
                fromMe: false
            });

            for (const message of chatMessages) {
                if (!isSupportedIncomingMessage(message))
                    continue;

                const incomingMessage = await createIncomingMessage(message, chat.name || chatId);
                unreadMessages.push(incomingMessage);
            }
        } catch (error) {
            console.error(`Error al recuperar mensajes no leídos de ${chatId}:`);
            console.error(error);
        }
    }

    return unreadMessages;
}

async function getRecentMessages(chatIds, count = 5) {
    if (!connected)
        throw createWhatsAppUnavailableError();

    try {
        const state = await client.getState();

        if (state !== "CONNECTED")
            throw createWhatsAppUnavailableError();
    } catch (error) {
        if (error.statusCode === 503)
            throw error;

        throw createWhatsAppUnavailableError();
    }

    const requestedChatIds = [...new Set((chatIds || []).filter(Boolean))];
    const messageLimit = Math.min(Math.max(Number(count) || 5, 1), 5);
    const recentMessages = [];
    let successfulChats = 0;
    let lastError = null;

    for (const chatId of requestedChatIds) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const chat = await client.getChatById(chatId);

                if (!chat)
                    throw new Error("El chat no está disponible en la sesión actual de WhatsApp.");

                const chatMessages = await chat.fetchMessages({ limit: messageLimit * 10 });
                const incomingMessages = chatMessages.filter(isSupportedIncomingMessage).slice(-messageLimit);

                for (const message of incomingMessages) {
                    recentMessages.push(await createIncomingMessage(message, chat.name || chatId));
                }

                successfulChats++;
                break;
            } catch (error) {
                lastError = error;

                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }

                console.warn("No fue posible recuperar los mensajes recientes de uno de los contactos favoritos después de 3 intentos:");
                console.warn(error);
            }
        }
    }

    if (requestedChatIds.length > 0 && successfulChats === 0) {
        recordFunctionalFailure(lastError);
        const error = createWhatsAppUnavailableError();
        error.cause = lastError;
        throw error;
    }

    if (successfulChats > 0)
        recordSuccessfulRead();

    if (successfulChats < requestedChatIds.length)
        console.warn(`La sincronización de favoritos continuó parcialmente. Chats consultados: ${successfulChats} de ${requestedChatIds.length}.`);

    return recentMessages;
}

async function fetchRecentMessagesFromChat(chatId, messageLimit, attempts) {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const chat = await client.getChatById(chatId);

            if (!chat)
                throw new Error("El chat no está disponible en la sesión actual de WhatsApp.");

            const chatMessages = await chat.fetchMessages({ limit: messageLimit * 10 });
            return {
                chat,
                messages: chatMessages.filter(isSupportedIncomingMessage).slice(-messageLimit)
            };
        } catch (error) {
            lastError = error;

            if (attempt < attempts)
                await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    throw lastError;
}

async function resolveChatIdsByPhone(phone) {
    const normalizedPhone = String(phone || "").replace(/\D/g, "");

    if (!normalizedPhone)
        return [];

    const numberId = await client.getNumberId(normalizedPhone);
    const phoneChatId = numberId?._serialized || `${normalizedPhone}@c.us`;
    let lidMapping = null;

    try {
        [lidMapping] = await client.getContactLidAndPhone([phoneChatId]);
    } catch (error) {
        console.warn(`No fue posible resolver el LID actual del teléfono ${normalizedPhone}: ${error.message}`);
    }

    return [...new Set([lidMapping?.lid, lidMapping?.pn, numberId?._serialized].filter(Boolean))];
}

async function getRecentMessagesResolvingContacts(contacts, count = 5) {
    if (!connected)
        throw createWhatsAppUnavailableError();

    try {
        if (await client.getState() !== "CONNECTED")
            throw createWhatsAppUnavailableError();
    } catch (error) {
        if (error.statusCode === 503)
            throw error;

        throw createWhatsAppUnavailableError();
    }

    const requestedContacts = (contacts || [])
        .map(contact => typeof contact === "string"
            ? { id: "", name: "", phone: "", chatId: contact }
            : {
                id: String(contact?.id || "").trim(),
                name: String(contact?.name || "").trim(),
                phone: String(contact?.phone || "").replace(/\D/g, ""),
                chatId: String(contact?.chatId || "").trim()
            })
        .filter(contact => contact.chatId || contact.phone);
    const messageLimit = Math.min(Math.max(Number(count) || 5, 1), 5);
    const recentMessages = [];
    const reconciledContacts = [];
    let successfulChats = 0;
    let lastError = null;

    for (const contact of requestedContacts) {
        let result = null;
        let resolvedChatId = null;

        if (contact.chatId) {
            try {
                result = await fetchRecentMessagesFromChat(contact.chatId, messageLimit, 1);
                resolvedChatId = contact.chatId;
            } catch (error) {
                lastError = error;
            }
        }

        if (!result && contact.phone) {
            try {
                const currentChatIds = await resolveChatIdsByPhone(contact.phone);

                for (const currentChatId of currentChatIds) {
                    if (result)
                        break;

                    try {
                        const attempts = currentChatId === contact.chatId ? 2 : 3;
                        result = await fetchRecentMessagesFromChat(currentChatId, messageLimit, attempts);
                        resolvedChatId = currentChatId;
                    } catch (error) {
                        lastError = error;
                    }
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (!result) {
            console.warn(`No fue posible recuperar los mensajes recientes del contacto favorito ${contact.name || contact.phone || contact.chatId}:`);
            console.warn(lastError);
            continue;
        }

        for (const message of result.messages)
            recentMessages.push(await createIncomingMessage(message, result.chat.name || contact.name || resolvedChatId));

        successfulChats++;

        if (contact.id && resolvedChatId && resolvedChatId !== contact.chatId)
            reconciledContacts.push({ id: contact.id, previousChatId: contact.chatId, chatId: resolvedChatId });
    }

    if (requestedContacts.length > 0 && successfulChats === 0) {
        recordFunctionalFailure(lastError);
        const error = createWhatsAppUnavailableError();
        error.cause = lastError;
        throw error;
    }

    if (successfulChats > 0)
        recordSuccessfulRead();

    if (successfulChats < requestedContacts.length)
        console.warn(`La sincronización de favoritos continuó parcialmente. Chats consultados: ${successfulChats} de ${requestedContacts.length}.`);

    const recoveryMessage = successfulChats === requestedContacts.length
        ? `Recuperación de favoritos completada correctamente. Chats consultados: ${successfulChats}. Mensajes recuperados: ${recentMessages.length}.`
        : `Recuperación parcial de favoritos completada. Chats consultados: ${successfulChats} de ${requestedContacts.length}. Mensajes recuperados: ${recentMessages.length}.`;
    logger.addLog("info", recoveryMessage, "WhatsAppGateway");

    return { messages: recentMessages, reconciledContacts, successfulChats, requestedChats: requestedContacts.length };
}

function createWhatsAppUnavailableError() {
    const error = new Error("WhatsApp no está disponible temporalmente.");
    error.statusCode = 503;
    return error;
}

async function markChatAsRead(chatId) {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    if (!chatId)
        throw new Error("El chat es obligatorio.");

    await client.sendSeen(chatId);
}

async function logout() {
    logoutInProgress = true;

    try {
        const canLogoutRemotely = client.pupPage && !client.pupPage.isClosed() && client.pupBrowser?.isConnected();

        if (canLogoutRemotely) {
            try {
                await client.logout();
            } catch (error) {
                console.warn("No se pudo cerrar la sesión desde WhatsApp Web; se eliminará la sesión local:");
                console.warn(error);
                await client.destroy();
                await fs.promises.rm(sessionPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
            }
        } else {
            await client.destroy();
            await fs.promises.rm(sessionPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
        }
    } finally {
        clientReady = false;
        connected = false;
        lastQr = null;
        User.IsRegistered = false;
        health = defaultHealth();
        saveHealth();

        if (fs.existsSync(readyFilePath))
            fs.unlinkSync(readyFilePath);
    }
}

function normalizePhone(phone) {

    return phone
        .replace(/\D/g, "")      // Elimina todo lo que no sea número
        .replace(/^52(?=1\d{10}$)/, "521"); // Si aplica, ajusta números de México

}

function isTransientBrowserError(error) {
    const message = String(error?.message || error || "").toLowerCase();

    return message.includes("detached frame") ||
        message.includes("execution context was destroyed") ||
        message.includes("target closed") ||
        message.includes("protocol error") ||
        message.includes("timed out") ||
        message.includes("timeout") ||
        message.includes("evaluation failed") ||
        message === "r" ||
        message.includes("whatsapp no está conectado");
}

async function sendMessageOnce(chatId, phone, text) {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    if (chatId) {
        await client.sendMessage(chatId, text);
        return;
    }

    phone = phone.replace(/\D/g, "");

    const numberId = await client.getNumberId(phone);

    if (!numberId)
        throw new Error(`El número ${phone} no existe en WhatsApp.`);

    await client.sendMessage(numberId._serialized, text);
}

async function sendMessage(chatId, phone, text) {
    for (let attempt = 1; attempt <= sendMaxAttempts; attempt++) {
        try {
            await sendMessageOnce(chatId, phone, text);
            return;
        } catch (error) {
            const transientError = isTransientBrowserError(error);

            if (!transientError)
                throw error;

            if (attempt === sendMaxAttempts) {
                recordFunctionalFailure(error, functionalFailureThreshold);
                throw error;
            }

            console.warn(`WhatsApp Web cambió de contexto durante el envío. Reintento ${attempt + 1} de ${sendMaxAttempts} en ${sendRetryDelayMs / 1000} segundos.`);
            await new Promise(resolve => setTimeout(resolve, sendRetryDelayMs));
        }
    }
}

async function getPendingMessages() {
    const messages = [...pendingMessages];
    pendingMessages = [];

    for (const message of messages)
        pendingMessageIds.delete(`${message.chatId}:${message.id}`);

    return messages;

}

async function getContacts() {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    const contacts = await client.getContacts();

    return contacts
        .filter(contact => contact.isMyContact && contact.id && contact.id.user)
        .map(contact => ({
            name: contact.name || contact.pushname || contact.number || contact.id.user,
            phone: contact.id.user,
            chatId: contact.id._serialized,
            source: "WhatsApp"
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

function saveUser(user) {
    const savedUser = {
        Phone: user.phone,
        FullName: user.fullName,
        Email: user.email,
        SupportPhone: user.supportPhone || "",
        SupportEmail: user.supportEmail || "",
        SecondAribnbPhone: user.secondAribnbPhone || ""
    };

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(userFilePath, JSON.stringify(savedUser, null, 2), "utf8");

    User.Phone = savedUser.Phone;
    User.FullName = savedUser.FullName;
    User.Email = savedUser.Email;
    User.SupportPhone = savedUser.SupportPhone;
    User.SupportEmail = savedUser.SupportEmail;
    User.SecondAribnbPhone = savedUser.SecondAribnbPhone;
}

function loadUser() {
    if (!fs.existsSync(userFilePath))
        return;

    const savedUser = readJsonFile(userFilePath);

    User.Phone = savedUser.Phone || "";
    User.FullName = savedUser.FullName || "";
    User.Email = savedUser.Email || "";
    User.SupportPhone = savedUser.SupportPhone || "";
    User.SupportEmail = savedUser.SupportEmail || "";
    User.SecondAribnbPhone = savedUser.SecondAribnbPhone || "";
}

function clearUser() {
    User.Phone = "";
    User.FullName = "";
    User.Email = "";
    User.SupportPhone = "";
    User.SupportEmail = "";
    User.SecondAribnbPhone = "";

    if (fs.existsSync(userFilePath))
        fs.unlinkSync(userFilePath);
}

async function initialize() {

    if (initialized) {
        console.log("WhatsApp ya fue inicializado.");
        return;
    }

    initialized = true;
    User.IsRegistered = false;
    loadUser();

    console.log("Inicializando WhatsApp...");

    for (let attempt = 1; attempt <= initializationMaxAttempts; attempt++) {
        await waitForWhatsAppNetwork();

        try {
            console.log(`Intento de inicialización de WhatsApp ${attempt} de ${initializationMaxAttempts}.`);
            await client.initialize();
            return;
        } catch (error) {
            clientReady = false;
            connected = false;

            console.error(`Error inicializando WhatsApp en el intento ${attempt} de ${initializationMaxAttempts}:`);
            console.error(error);

            try {
                await client.destroy();
            } catch (cleanupError) {
                console.error("No fue posible cerrar Chromium después del error de inicialización:");
                console.error(cleanupError);
            }

            if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(String(error?.message || error))) {
                attempt--;
                await waitForWhatsAppNetwork();
                continue;
            }

            if (attempt < initializationMaxAttempts) {
                console.log(`Se volverá a intentar en ${initializationRetryDelayMs / 1000} segundos.`);
                await new Promise(resolve => setTimeout(resolve, initializationRetryDelayMs));
            }
        }
    }

    initialized = false;
    console.error(`No fue posible inicializar WhatsApp después de ${initializationMaxAttempts} intentos. Se reiniciará WhatsAppGateway.`);
    restartScheduled = true;
    setTimeout(() => process.exit(1), 1000);
}

function isConnected() {
    return {
        connected: connected && !health.degraded && !health.relinkRequired,
        transportConnected: connected,
        User
    };
}

function restartConnection() {
    if (restartScheduled)
        return { accepted: false, message: "Ya hay un reinicio de WhatsApp en curso." };

    if (logoutInProgress)
        return { accepted: false, message: "No se puede reiniciar mientras se está cerrando la sesión." };

    const accepted = restartGatewayPreservingSession(
        "Reinicio manual solicitado desde el panel. Reiniciando Chromium y el Gateway sin eliminar la sesión.",
        1500);

    return {
        accepted,
        message: accepted
            ? "Reinicio solicitado. La sesión vinculada se conservará."
            : "No fue posible programar el reinicio."
    };
}

async function getStatus() {
    try {
        updateConnectionState(await client.getState());
    } catch {
        if (connected)
            updateConnectionState("UNKNOWN");
    }

    const latestTakeoverAttemptAt = manualTakeoverRequestedAt || conflictDetectedAt;
    const takeoverAttemptAgeMs = latestTakeoverAttemptAt ? Date.now() - latestTakeoverAttemptAt.getTime() : 0;
    const conflict = connectionState === "CONFLICT";

    return {
        connected: connected && !health.degraded && !health.relinkRequired,
        transportConnected: connected,
        state: connectionState,
        degraded: health.degraded,
        relinkRequired: health.relinkRequired,
        relinkReason: health.relinkReason,
        recoveryExhausted: health.recoveryExhausted,
        consecutiveReadFailures: health.consecutiveFailures,
        lastSuccessfulReadAt: health.lastSuccessfulReadAt,
        lastReadFailureAt: health.lastFailureAt,
        lastReadFailure: health.lastFailure,
        recoveryRestartCount: recentRecoveryRestarts().length,
        conflict,
        takeoverInProgress: manualTakeoverRunning || (conflict && takeoverAttemptAgeMs < manualTakeoverDelayMs),
        canTakeover: conflict && !manualTakeoverRunning && takeoverAttemptAgeMs >= manualTakeoverDelayMs,
        conflictDetectedAt: conflictDetectedAt?.toISOString() ?? null,
        lastTakeoverError,
        User
    };
}

async function requestTakeover() {
    const status = await getStatus();

    if (status.connected)
        return status;

    if (!status.conflict) {
        const error = new Error("WhatsApp no reporta un conflicto con otro navegador.");
        error.statusCode = 409;
        throw error;
    }

    if (manualTakeoverRunning) {
        const error = new Error("Ya hay una solicitud para usar WhatsApp en este equipo.");
        error.statusCode = 409;
        throw error;
    }

    manualTakeoverRunning = true;
    manualTakeoverRequestedAt = new Date();
    lastTakeoverError = null;
    console.log("Solicitando manualmente usar WhatsApp en este equipo.");

    try {
        await client.pupPage.evaluate(() => window.require("WAWebSocketModel").Socket.takeover());
        return await getStatus();
    } catch (error) {
        manualTakeoverRequestedAt = null;
        lastTakeoverError = error.message;
        console.error("No fue posible tomar el control manual de WhatsApp:");
        console.error(error);
        throw error;
    } finally {
        manualTakeoverRunning = false;
    }
}

module.exports = {
    initialize,
    getClient() { return client; },
    sendMessage,
    getPendingMessages,
    getUnreadMessages,
    getRecentMessages: getRecentMessagesResolvingContacts,
    getContacts,
    markChatAsRead,
    logout,
    getQr,
    getStatus,
    restartConnection,
    requestTakeover,
    saveUser,
    clearUser,
    isConnected
};
