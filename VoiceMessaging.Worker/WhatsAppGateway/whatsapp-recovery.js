const dns = require("dns");
const fs = require("fs");
const path = require("path");

/**
 * @typedef {Object} WhatsAppHealth
 * @property {number} consecutiveFailures
 * @property {string|null} lastSuccessfulReadAt
 * @property {string|null} lastFailureAt
 * @property {string|null} lastFailure
 * @property {boolean} degraded
 * @property {boolean} relinkRequired
 * @property {string|null} relinkReason
 * @property {boolean} recoveryExhausted
 * @property {string[]} recoveryRestarts
 */

/**
 * @typedef {Object} RecoveryStatusFields
 * @property {boolean} degraded
 * @property {boolean} relinkRequired
 * @property {string|null} relinkReason
 * @property {boolean} recoveryExhausted
 * @property {number} consecutiveReadFailures
 * @property {string|null} lastSuccessfulReadAt
 * @property {string|null} lastReadFailureAt
 * @property {string|null} lastReadFailure
 * @property {string|null} initializationStartedAt
 * @property {number|null} initializationElapsedSeconds
 * @property {number} initializationTimeoutSeconds
 * @property {number} recoveryRestartCount
 */

/**
 * @typedef {Object} WhatsAppRecoveryApi
 * @property {() => void} clearInitializationWatchdog
 * @property {() => WhatsAppHealth} getHealth
 * @property {() => RecoveryStatusFields} getStatusFields
 * @property {(message: unknown) => void} handleAuthenticationFailure
 * @property {() => Promise<void>} initialize
 * @property {(error: unknown, failureCount?: number) => void} recordFunctionalFailure
 * @property {() => void} recordSuccessfulRead
 * @property {() => void} resetHealth
 * @property {(message: string, exitDelayMs?: number) => boolean} restartGatewayPreservingSession
 * @property {() => void} startConnectionWatchdog
 * @property {() => void} startFunctionalHealthProbe
 */

/**
 * Administra el ciclo de vida recuperable de WhatsApp. La fachada conserva los
 * eventos del cliente; este módulo conserva tiempos, salud y decisiones de
 * reinicio para evitar que esas reglas se dispersen por el resto del código.
 * @param {{
 *   client: import("whatsapp-web.js").Client,
 *   diagnostics: {
 *     logFunctionalDiagnostics: (context: string, error: unknown) => Promise<void>,
 *     logSkippedChatModelsIfAny: (context: string) => Promise<void>
 *   },
 *   healthFilePath: string,
 *   hasReadySession: boolean,
 *   hasSession: boolean,
 *   loadUser: () => void,
 *   runtime: Object,
 *   updateConnectionState: (state: string) => void
 * }} dependencies
 * @returns {WhatsAppRecoveryApi}
 */
function createWhatsAppRecovery({
    client,
    diagnostics,
    healthFilePath,
    hasReadySession,
    hasSession,
    loadUser,
    runtime,
    updateConnectionState
}) {
    const initializationRetryDelayMs = 15 * 1000;
    const initializationMaxAttempts = 5;
    const initializationReadyTimeoutMs = 3 * 60 * 1000;
    const functionalFailureThreshold = 3;
    // Los reinicios por lecturas defectuosas siguen desactivados: un error de
    // IndexedDB no debe provocar una tormenta de procesos Chromium.
    const automaticFunctionalRestartsEnabled = false;
    const recoveryWindowMs = 30 * 60 * 1000;
    const maxRecoveryRestarts = 3;
    const healthProbeIntervalMs = 60 * 1000;
    const connectionProbeIntervalMs = 30 * 1000;
    const postReadyRecoveryGraceMs = 3 * 60 * 1000;
    const extendedRecoveryDelayMs = 5 * 60 * 1000;
    const networkRetryDelayMs = 30 * 1000;
    let extendedRecoveryTimer = null;
    let healthProbeTimer = null;
    let healthProbeRunning = false;
    let connectionWatchdogTimer = null;
    let connectionWatchdogRunning = false;
    let initializationWatchdogTimer = null;
    let initialized = false;
    let health = loadHealth();

    function readJsonFile(filePath) {
        return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    }

    /**
     * @returns {WhatsAppHealth}
     */
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

    /**
     * Carga y migra formatos anteriores sin convertir errores funcionales en logout.
     * @returns {WhatsAppHealth}
     */
    function loadHealth() {
        try {
            if (!fs.existsSync(healthFilePath))
                return defaultHealth();

            const savedHealth = { ...defaultHealth(), ...readJsonFile(healthFilePath) };

            // Versiones anteriores confundían agotamiento de recuperación con
            // sesión inválida. Sólo AUTH_FAILURE obliga a volver a vincular.
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
        fs.mkdirSync(path.dirname(healthFilePath), { recursive: true });
        fs.writeFileSync(healthFilePath, JSON.stringify(health, null, 2), "utf8");
    }

    /**
     * @returns {WhatsAppHealth} Referencia vigente; no debe modificarse fuera del módulo.
     */
    function getHealth() {
        return health;
    }

    function clearInitializationWatchdog() {
        if (!initializationWatchdogTimer)
            return;

        clearTimeout(initializationWatchdogTimer);
        initializationWatchdogTimer = null;
    }

    /**
     * client.initialize puede quedar pendiente sin lanzar error. Para una sesión
     * ya vinculada, tres minutos sin ready se consideran un arranque estancado.
     */
    function startInitializationWatchdog() {
        clearInitializationWatchdog();

        if (!hasSession && !hasReadySession)
            return;

        initializationWatchdogTimer = setTimeout(() => {
            initializationWatchdogTimer = null;

            if (runtime.clientReady || runtime.connected || runtime.restartScheduled || runtime.logoutInProgress)
                return;

            const elapsedSeconds = runtime.initializationStartedAt
                ? Math.round((Date.now() - runtime.initializationStartedAt.getTime()) / 1000)
                : Math.round(initializationReadyTimeoutMs / 1000);

            restartGatewayPreservingSession(
                `WhatsApp no completó la conexión después de ${elapsedSeconds} segundos. Reiniciando el Gateway y conservando la sesión.`);
        }, initializationReadyTimeoutMs);
    }

    function recordSuccessfulRead() {
        if (extendedRecoveryTimer) {
            clearTimeout(extendedRecoveryTimer);
            extendedRecoveryTimer = null;
        }

        health = { ...defaultHealth(), lastSuccessfulReadAt: new Date().toISOString() };
        saveHealth();
    }

    function resetHealth() {
        health = defaultHealth();
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

    /**
     * Programa una única salida del proceso. LocalAuth no se elimina y el Worker
     * será responsable de volver a iniciar el gateway.
     * @param {string} message
     * @param {number} [exitDelayMs=250]
     * @returns {boolean} false cuando ya existe un reinicio o logout en curso.
     */
    function restartGatewayPreservingSession(message, exitDelayMs = 250) {
        if (runtime.restartScheduled || runtime.logoutInProgress)
            return false;

        runtime.restartScheduled = true;
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
        if (runtime.restartScheduled || runtime.logoutInProgress || health.relinkRequired)
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
        if (extendedRecoveryTimer || runtime.restartScheduled || runtime.logoutInProgress || health.relinkRequired)
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

    async function probeFunctionalHealth() {
        if (healthProbeRunning || !runtime.connected || !health.degraded || health.relinkRequired ||
            runtime.restartScheduled || runtime.logoutInProgress)
            return;

        healthProbeRunning = true;

        try {
            await client.getChats();
            await diagnostics.logSkippedChatModelsIfAny("la comprobación automática");
            recordSuccessfulRead();
            console.log("La comprobación automática de WhatsApp fue exitosa. El estado de conexión volvió a ser saludable.");
        } catch (error) {
            await diagnostics.logFunctionalDiagnostics("comprobacion-automatica", error);
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

    /**
     * Supervisa la conexión después de ready. Es independiente del watchdog de
     * inicialización porque la suspensión de Windows ocurre con el proceso ya
     * iniciado y no vuelve a ejecutar client.initialize().
     */
    async function probeConnectionAfterReady() {
        if (connectionWatchdogRunning || !runtime.readyAt || runtime.restartScheduled ||
            runtime.logoutInProgress || health.relinkRequired)
            return;

        connectionWatchdogRunning = true;

        try {
            if (!await isWhatsAppNetworkReachable()) {
                // El tiempo sin Internet no cuenta contra WhatsApp. Al regresar
                // la red comenzará un periodo de gracia completo.
                runtime.disconnectedSince = null;
                updateConnectionState("WAITING_FOR_NETWORK", "network");
                return;
            }

            let observedState = "UNKNOWN";

            try {
                observedState = await Promise.race([
                    client.getState(),
                    new Promise(resolve => setTimeout(() => resolve("UNKNOWN"), 10000))
                ]);
            } catch {
                observedState = "UNKNOWN";
            }

            const normalizedState = updateConnectionState(observedState, "watchdog");

            if (normalizedState === "CONNECTED")
                return;

            const disconnectedForMs = runtime.disconnectedSince
                ? Date.now() - runtime.disconnectedSince.getTime()
                : 0;

            if (disconnectedForMs < postReadyRecoveryGraceMs)
                return;

            restartGatewayPreservingSession(
                `WhatsApp no recuperó la conexión ${Math.round(disconnectedForMs / 1000)} segundos después de detectar la interrupción. Reiniciando el Gateway y conservando la sesión.`);
        } finally {
            connectionWatchdogRunning = false;
        }
    }

    function startConnectionWatchdog() {
        if (connectionWatchdogTimer)
            return;

        connectionWatchdogTimer = setInterval(probeConnectionAfterReady, connectionProbeIntervalMs);
    }

    function handleAuthenticationFailure(message) {
        clearInitializationWatchdog();
        health.degraded = true;
        health.relinkRequired = true;
        health.relinkReason = "AUTH_FAILURE";
        health.recoveryExhausted = false;
        health.lastFailureAt = new Date().toISOString();
        health.lastFailure = String(message || "Error de autenticación");
        saveHealth();
    }

    /**
     * Espera conectividad, inicia whatsapp-web.js y protege cada intento con el
     * watchdog de ready.
     * @returns {Promise<void>}
     */
    async function initialize() {
        if (initialized) {
            console.log("WhatsApp ya fue inicializado.");
            return;
        }

        initialized = true;
        loadUser();
        runtime.initializationStartedAt = new Date();
        runtime.logLifecycleInfo("Inicializando WhatsApp.");

        for (let attempt = 1; attempt <= initializationMaxAttempts; attempt++) {
            await waitForWhatsAppNetwork();
            runtime.initializationStartedAt = new Date();
            startInitializationWatchdog();

            try {
                console.log(`Intento de inicialización de WhatsApp ${attempt} de ${initializationMaxAttempts}.`);
                await client.initialize();
                return;
            } catch (error) {
                clearInitializationWatchdog();
                runtime.clientReady = false;
                runtime.connected = false;

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
        clearInitializationWatchdog();
        console.error(`No fue posible inicializar WhatsApp después de ${initializationMaxAttempts} intentos. Se reiniciará WhatsAppGateway.`);
        runtime.restartScheduled = true;
        setTimeout(() => process.exit(1), 1000);
    }

    /**
     * @returns {RecoveryStatusFields}
     */
    function getStatusFields() {
        return {
            degraded: health.degraded,
            relinkRequired: health.relinkRequired,
            relinkReason: health.relinkReason,
            recoveryExhausted: health.recoveryExhausted,
            consecutiveReadFailures: health.consecutiveFailures,
            lastSuccessfulReadAt: health.lastSuccessfulReadAt,
            lastReadFailureAt: health.lastFailureAt,
            lastReadFailure: health.lastFailure,
            initializationStartedAt: runtime.initializationStartedAt?.toISOString() ?? null,
            initializationElapsedSeconds: runtime.initializationStartedAt && !runtime.clientReady
                ? Math.round((Date.now() - runtime.initializationStartedAt.getTime()) / 1000)
                : null,
            initializationTimeoutSeconds: initializationReadyTimeoutMs / 1000,
            recoveryRestartCount: recentRecoveryRestarts().length
        };
    }

    return {
        clearInitializationWatchdog,
        getHealth,
        getStatusFields,
        handleAuthenticationFailure,
        initialize,
        recordFunctionalFailure,
        recordSuccessfulRead,
        resetHealth,
        restartGatewayPreservingSession,
        startConnectionWatchdog,
        startFunctionalHealthProbe
    };
}

module.exports = { createWhatsAppRecovery };
