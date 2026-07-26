const { Client, LocalAuth } = require("whatsapp-web.js");
const fs = require("fs");
const os = require("os");
const path = require("path");
const qrcode = require("qrcode");
const { getChromePath } = require("./chrome-path");
const logger = require("./logger");
const { createWhatsAppDiagnostics } = require("./whatsapp-diagnostics");
const { createWhatsAppMessages } = require("./whatsapp-messages");
const { createWhatsAppRecovery } = require("./whatsapp-recovery");

/**
 * @typedef {Object} WhatsAppUser
 * @property {string} Phone
 * @property {string} FullName
 * @property {string} Email
 * @property {string} SupportPhone
 * @property {string} SupportEmail
 * @property {string} SecondAribnbPhone
 * @property {boolean} IsRegistered
 */

/**
 * @typedef {Object} WhatsAppRuntime
 * @property {boolean} clientReady Indica que se ejecutó el evento ready y terminó la preparación adicional.
 * @property {boolean} connected Estado de transporte calculado a partir de clientReady y getState.
 * @property {string} connectionState Último estado normalizado informado por WhatsApp.
 * @property {Date|null} conflictDetectedAt
 * @property {Date|null} initializationStartedAt
 * @property {string|null} lastTakeoverError
 * @property {string|null} lastQr QR serializado como data URL.
 * @property {boolean} logoutInProgress
 * @property {Date|null} manualTakeoverRequestedAt
 * @property {boolean} manualTakeoverRunning
 * @property {Date|null} readyAt
 * @property {boolean} restartScheduled
 * @property {(message: string, detail?: string|null) => void} logLifecycleInfo
 */

/**
 * @typedef {Object} WhatsAppConnectionSummary
 * @property {boolean} connected Conexión funcional, incluyendo el estado de salud.
 * @property {boolean} transportConnected Conexión de transporte aunque la lectura esté degradada.
 * @property {WhatsAppUser} User
 */

/**
 * @typedef {WhatsAppConnectionSummary & {
 *   state: string,
 *   degraded: boolean,
 *   relinkRequired: boolean,
 *   relinkReason: string|null,
 *   recoveryExhausted: boolean,
 *   consecutiveReadFailures: number,
 *   lastSuccessfulReadAt: string|null,
 *   lastReadFailureAt: string|null,
 *   lastReadFailure: string|null,
 *   initializationStartedAt: string|null,
 *   initializationElapsedSeconds: number|null,
 *   initializationTimeoutSeconds: number,
 *   recoveryRestartCount: number,
 *   conflict: boolean,
 *   takeoverInProgress: boolean,
 *   canTakeover: boolean,
 *   conflictDetectedAt: string|null,
 *   lastTakeoverError: string|null
 * }} WhatsAppStatus
 */

/*
 * Fachada pública de WhatsApp.
 *
 * app.js sólo debe depender de este archivo. Los detalles de lectura, diagnóstico
 * y recuperación se inyectan como módulos internos para mantener una sola
 * instancia de Client y una sola fuente de verdad para el estado de conexión.
 */
const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const authPath = path.join(dataDirectory, "whatsapp-auth");
const legacyAuthPath = path.join(__dirname, "data", "auth");
const sessionPath = path.join(authPath, "session-personal");
const readyFilePath = path.join(authPath, "personal.ready");
const userFilePath = path.join(dataDirectory, "user-data.json");
const healthFilePath = path.join(dataDirectory, "whatsapp-health.json");
const takeoverTimeoutMs = 5 * 1000;
const manualTakeoverDelayMs = takeoverTimeoutMs + 3 * 1000;

function migrateLegacyAuth() {
    if (fs.existsSync(authPath) || !fs.existsSync(legacyAuthPath))
        return;

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.cpSync(legacyAuthPath, authPath, { recursive: true });
}

migrateLegacyAuth();

const hasSession = fs.existsSync(sessionPath);
const hasReadySession = fs.existsSync(readyFilePath);
const User = {
    Phone: "",
    FullName: "",
    Email: "",
    SupportPhone: "",
    SupportEmail: "",
    SecondAribnbPhone: "",
    IsRegistered: false
};

/**
 * Objeto compartido por referencia entre módulos. Sólo contiene estado efímero;
 * la salud persistente pertenece a whatsapp-recovery.js.
 */
/** @type {WhatsAppRuntime} */
const runtime = {
    clientReady: false,
    connected: false,
    connectionState: "INITIALIZING",
    conflictDetectedAt: null,
    initializationStartedAt: null,
    lastTakeoverError: null,
    lastQr: null,
    logoutInProgress: false,
    manualTakeoverRequestedAt: null,
    manualTakeoverRunning: false,
    readyAt: null,
    restartScheduled: false,
    logLifecycleInfo(message, detail = null) {
        console.log(message);
        logger.addLog("info", message, "WhatsAppGateway", detail);
    }
};

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
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions"
        ]
    }
});

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function updateConnectionState(state) {
    const normalizedState = String(state || "UNKNOWN").toUpperCase();
    const previousState = runtime.connectionState;
    runtime.connectionState = normalizedState;
    runtime.connected = normalizedState === "CONNECTED" && runtime.clientReady;

    if (normalizedState === "CONFLICT") {
        if (!runtime.conflictDetectedAt) {
            runtime.conflictDetectedAt = new Date();
            console.warn("WhatsApp está abierto en otro navegador. Se intentará usar la sesión en este equipo.");
        }
    } else if (runtime.connected) {
        if (runtime.conflictDetectedAt)
            console.log("El conflicto de sesión terminó. WhatsApp continuará en este equipo.");

        runtime.conflictDetectedAt = null;
        runtime.manualTakeoverRunning = false;
        runtime.manualTakeoverRequestedAt = null;
        runtime.lastTakeoverError = null;
    } else if (previousState === "CONFLICT" && normalizedState !== "OPENING") {
        runtime.conflictDetectedAt = null;
        runtime.manualTakeoverRunning = false;
        runtime.manualTakeoverRequestedAt = null;
    }
}

function loadUser() {
    User.IsRegistered = false;

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

const diagnostics = createWhatsAppDiagnostics({ client, runtime });
const recovery = createWhatsAppRecovery({
    client,
    diagnostics,
    healthFilePath,
    hasReadySession,
    hasSession,
    loadUser,
    runtime,
    updateConnectionState
});
const messages = createWhatsAppMessages({ client, diagnostics, recovery, runtime });

/*
 * Los eventos oficiales de whatsapp-web.js permanecen en la fachada. Así se
 * puede seguir la transición completa de estado sin saltar entre archivos.
 */
client.on("qr", async qr => {
    recovery.clearInitializationWatchdog();
    runtime.lastQr = await qrcode.toDataURL(qr);
    console.log("QR generado. Abre http://localhost:3000/whatsapp/qr para escanearlo.");
});

client.on("ready", async () => {
    recovery.clearInitializationWatchdog();
    runtime.clientReady = false;
    updateConnectionState("CONNECTED");
    runtime.readyAt = new Date();
    runtime.lastQr = null;
    User.IsRegistered = true;
    fs.writeFileSync(readyFilePath, new Date().toISOString(), "utf8");

    const safeGetChatsInstalled = await diagnostics.installSafeGetChatsWrapper().catch(error => {
        console.error("No fue posible instalar el aislamiento de chats defectuosos:");
        console.error(error);
        return false;
    });

    runtime.clientReady = true;
    updateConnectionState("CONNECTED");
    runtime.logLifecycleInfo(`WhatsApp conectado. Aislamiento de chats defectuosos: ${safeGetChatsInstalled ? "activo" : "no disponible"}.`);
    diagnostics.attachBrowserDiagnostics();
    recovery.startFunctionalHealthProbe();

    try {
        await messages.recoverUnreadMessages();
    } catch (error) {
        console.error("Error al recuperar mensajes no leídos:");
        console.error(error);
    }
});

client.on("authenticated", () => {
    runtime.logLifecycleInfo("Sesión autenticada.");
});

client.on("change_state", state => {
    updateConnectionState(state);
    runtime.logLifecycleInfo(`Estado de WhatsApp: ${runtime.connectionState}.`);
});

client.on("auth_failure", message => {
    runtime.clientReady = false;
    recovery.handleAuthenticationFailure(message);
    console.log("Error de autenticación.");
    console.log(message);
});

client.on("disconnected", async reason => {
    recovery.clearInitializationWatchdog();
    runtime.clientReady = false;
    updateConnectionState(reason || "DISCONNECTED");
    User.IsRegistered = false;
    console.log("WhatsApp desconectado.");
    console.log(reason);

    if (reason === "LOGOUT" && fs.existsSync(readyFilePath))
        fs.unlinkSync(readyFilePath);

    if (!runtime.logoutInProgress && !runtime.restartScheduled) {
        runtime.restartScheduled = true;
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

messages.attachMessageHandler();

function getQr() {
    return runtime.lastQr || null;
}

/**
 * Persiste los datos configurables del usuario y actualiza la instancia que se
 * expone en las respuestas de estado.
 * @param {{phone: string, fullName: string, email: string, supportPhone?: string, supportEmail?: string, secondAribnbPhone?: string}} user
 * @returns {void}
 */
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
    Object.assign(User, savedUser);
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

/**
 * Cierra la sesión remota cuando es posible y elimina la sesión local como
 * alternativa. Siempre limpia el indicador local de vinculación.
 * @returns {Promise<void>}
 */
async function logout() {
    runtime.logoutInProgress = true;

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
        runtime.clientReady = false;
        runtime.connected = false;
        runtime.lastQr = null;
        User.IsRegistered = false;
        recovery.resetHealth();

        if (fs.existsSync(readyFilePath))
            fs.unlinkSync(readyFilePath);
    }
}

/**
 * @returns {WhatsAppConnectionSummary} Resumen síncrono utilizado por app.js.
 */
function isConnected() {
    const health = recovery.getHealth();
    return {
        connected: runtime.connected && !health.degraded && !health.relinkRequired,
        transportConnected: runtime.connected,
        User
    };
}

/**
 * Programa un reinicio preservando la carpeta LocalAuth.
 * @returns {{accepted: boolean, message: string}}
 */
function restartConnection() {
    if (runtime.restartScheduled)
        return { accepted: false, message: "Ya hay un reinicio de WhatsApp en curso." };

    if (runtime.logoutInProgress)
        return { accepted: false, message: "No se puede reiniciar mientras se está cerrando la sesión." };

    const accepted = recovery.restartGatewayPreservingSession(
        "Reinicio manual solicitado desde el panel. Reiniciando Chromium y el Gateway sin eliminar la sesión.",
        1500);

    return {
        accepted,
        message: accepted
            ? "Reinicio solicitado. La sesión vinculada se conservará."
            : "No fue posible programar el reinicio."
    };
}

/**
 * Consulta el estado actual del cliente y combina transporte, salud y conflicto.
 * @returns {Promise<WhatsAppStatus>}
 */
async function getStatus() {
    try {
        updateConnectionState(await client.getState());
    } catch {
        if (runtime.connected)
            updateConnectionState("UNKNOWN");
    }

    const latestTakeoverAttemptAt = runtime.manualTakeoverRequestedAt || runtime.conflictDetectedAt;
    const takeoverAttemptAgeMs = latestTakeoverAttemptAt ? Date.now() - latestTakeoverAttemptAt.getTime() : 0;
    const conflict = runtime.connectionState === "CONFLICT";
    const health = recovery.getHealth();

    return {
        connected: runtime.connected && !health.degraded && !health.relinkRequired,
        transportConnected: runtime.connected,
        state: runtime.connectionState,
        ...recovery.getStatusFields(),
        conflict,
        takeoverInProgress: runtime.manualTakeoverRunning || (conflict && takeoverAttemptAgeMs < manualTakeoverDelayMs),
        canTakeover: conflict && !runtime.manualTakeoverRunning && takeoverAttemptAgeMs >= manualTakeoverDelayMs,
        conflictDetectedAt: runtime.conflictDetectedAt?.toISOString() ?? null,
        lastTakeoverError: runtime.lastTakeoverError,
        User
    };
}

/**
 * Solicita a WhatsApp Web tomar el control cuando otra pestaña usa la sesión.
 * @returns {Promise<WhatsAppStatus>}
 * @throws {Error} Cuando no existe conflicto o la solicitud ya está ejecutándose.
 */
async function requestTakeover() {
    const status = await getStatus();

    if (status.connected)
        return status;

    if (!status.conflict) {
        const error = new Error("WhatsApp no reporta un conflicto con otro navegador.");
        error.statusCode = 409;
        throw error;
    }

    if (runtime.manualTakeoverRunning) {
        const error = new Error("Ya hay una solicitud para usar WhatsApp en este equipo.");
        error.statusCode = 409;
        throw error;
    }

    runtime.manualTakeoverRunning = true;
    runtime.manualTakeoverRequestedAt = new Date();
    runtime.lastTakeoverError = null;
    console.log("Solicitando manualmente usar WhatsApp en este equipo.");

    try {
        await client.pupPage.evaluate(() => window.require("WAWebSocketModel").Socket.takeover());
        return await getStatus();
    } catch (error) {
        runtime.manualTakeoverRequestedAt = null;
        runtime.lastTakeoverError = error.message;
        console.error("No fue posible tomar el control manual de WhatsApp:");
        console.error(error);
        throw error;
    } finally {
        runtime.manualTakeoverRunning = false;
    }
}

/**
 * API estable consumida por app.js. Los módulos internos no deben importarse
 * directamente desde las rutas HTTP.
 */
module.exports = {
    initialize: recovery.initialize,
    getClient() { return client; },
    sendMessage: messages.sendMessage,
    getPendingMessages: messages.getPendingMessages,
    getUnreadMessages: messages.getUnreadMessages,
    getRecentMessages: messages.getRecentMessages,
    getContacts: messages.getContacts,
    markChatAsRead: messages.markChatAsRead,
    logout,
    getQr,
    getStatus,
    restartConnection,
    requestTakeover,
    saveUser,
    clearUser,
    isConnected
};
