const setStatus = (id, kind, text) => {
    const element = document.getElementById(id);
    if (!element)
        return;

    element.className = "value " + kind;
    const textElement = element.querySelector("span:last-child");

    if (textElement)
        textElement.textContent = text;
};

const setWhatsAppActions = status => {
    const connected = status?.connected === true;
    const transportConnected = status?.transportConnected === true;
    const conflict = status?.conflict === true;
    const takeoverButton = document.getElementById("whatsappTakeoverButton");
    const logTestButton = document.getElementById("whatsappLogTestButton");

    document.getElementById("qrLink").hidden = transportConnected || conflict;
    document.getElementById("logoutButton").hidden = !transportConnected && status?.relinkRequired !== true;
    takeoverButton.hidden = status?.canTakeover !== true;
    takeoverButton.disabled = takeoverButton.dataset.requesting === "true";
    logTestButton.disabled = !connected || logTestButton.dataset.requesting === "true";
};

const showActionMessage = (text, kind = "info") => {
    const element = document.getElementById("actionMessage");
    element.textContent = text;
    element.className = kind;
    element.hidden = false;
};

const expandedLogIds = new Set();
const pendingPanelLogKey = "voiceMessaging.pendingPanelLog";

async function reportPendingPanelLog() {
    const pendingLog = window.localStorage.getItem(pendingPanelLogKey);

    if (!pendingLog)
        return;

    try {
        const detail = JSON.parse(pendingLog);
        const response = await fetch("/logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                level: "warning",
                source: "AppStatus",
                message: "El panel perdió la respuesta HTTP mientras solicitaba reiniciar WhatsAppGateway.",
                detail: JSON.stringify(detail)
            })
        });

        if (response.ok)
            window.localStorage.removeItem(pendingPanelLogKey);
    } catch (error) {
        console.warn("El log pendiente del panel se conservará para el siguiente intento:", error);
    }
}

const renderWhatsAppStatus = status => {
    if (status?.relinkRequired === true) {
        setStatus("whatsapp", "bad", "Requiere volver a vincular");
        return;
    }

    if (status?.state === "WAITING_FOR_NETWORK") {
        setStatus("whatsapp", "warn", "Esperando Internet / DNS para reconectar");
        return;
    }

    if (status?.recoveryExhausted === true) {
        setStatus("whatsapp", "warn", "Recuperando WhatsApp automáticamente");
        return;
    }

    if (status?.degraded === true) {
        setStatus("whatsapp", "warn", `WhatsApp no responde; comprobando sin reiniciar (${status.consecutiveReadFailures || 0} fallos)`);
        return;
    }

    if (status?.connected === true) {
        setStatus("whatsapp", "ok", "Conectado");
        return;
    }

    if (status?.conflict === true) {
        const text = status.takeoverInProgress
            ? "En uso en otro navegador. Tomando control..."
            : "En uso en otro navegador";
        setStatus("whatsapp", "warn", text);
        return;
    }

    if (["INITIALIZING", "OPENING", "PAIRING"].includes(status?.state)) {
        setStatus("whatsapp", "warn", "Conectando...");
        return;
    }

    setStatus("whatsapp", "bad", "Desconectado");
};

const setAirbnbActions = (status, gmailStatus) => {
    const enabled = status?.enabled === true;
    const toggleButton = document.getElementById("airbnbToggleButton");
    const gmailCard = document.getElementById("gmailCard");
    const gmailLoginLink = document.getElementById("gmailLoginLink");
    const gmailConnectionTestButton = document.getElementById("gmailConnectionTestButton");
    const gmailTestButton = document.getElementById("gmailTestButton");
    const gmailSyncButton = document.getElementById("gmailSyncButton");

    toggleButton.hidden = false;
    toggleButton.dataset.enabled = enabled ? "true" : "false";
    toggleButton.textContent = enabled ? "Deshabilitar Airbnb" : "Habilitar Airbnb";
    gmailCard.hidden = !enabled;
    gmailLoginLink.hidden = !enabled || gmailStatus?.authenticated === true || gmailStatus?.configured === false
        || gmailStatus?.configurationError === true || gmailStatus?.temporarilyUnavailable === true;
    gmailConnectionTestButton.hidden = !enabled || gmailStatus?.configured === false;
    gmailTestButton.hidden = !enabled || gmailStatus?.authenticated !== true;
    gmailSyncButton.hidden = !enabled || gmailStatus?.authenticated !== true;

    if (!enabled)
        return;

    if (gmailStatus?.authenticated === true)
        setStatus("gmailSession", "ok", gmailStatus.email ? `Conectado: ${gmailStatus.email}` : "Conectado");
    else if (gmailStatus?.configured === false)
        setStatus("gmailSession", "warn", "Falta configurar OAuth");
    else if (gmailStatus?.configurationError === true)
        setStatus("gmailSession", "bad", "Client ID o Client Secret inválido");
    else if (gmailStatus?.reauthenticationRequired === true)
        setStatus("gmailSession", "warn", "Requiere volver a autenticar");
    else if (gmailStatus?.temporarilyUnavailable === true)
        setStatus("gmailSession", "warn", "No se pudo validar: revisar Internet / DNS");
    else if (gmailStatus?.authenticationRequired === true)
        setStatus("gmailSession", "warn", "Gmail no está conectado");
    else
        setStatus("gmailSession", "warn", "No se pudo validar Gmail");
};

const formatLogDate = value => {
    if (!value)
        return "Fecha no disponible";

    const date = new Date(value);

    if (Number.isNaN(date.getTime()))
        return "Fecha no disponible";

    return date.toLocaleString();
};

const setFavoriteSyncAction = (workerRunning, whatsappConnected) => {
    const button = document.getElementById("favoriteSyncButton");
    button.disabled = !workerRunning || !whatsappConnected || button.dataset.requesting === "true";
    button.title = !workerRunning
        ? "El Worker no está disponible."
        : !whatsappConnected
            ? "WhatsApp debe estar conectado."
            : "Solicitar al Worker la sincronización inmediata.";
};

const copyLogDetail = async (detail, button) => {
    try {
        await navigator.clipboard.writeText(detail);
        button.textContent = "Copiado";
        setTimeout(() => { button.textContent = "Copiar detalle"; }, 1500);
    } catch (error) {
        showActionMessage("No fue posible copiar el detalle: " + error.message, "error");
    }
};

const createLogMessagePreview = message => {
    const normalized = String(message || "Log sin mensaje.").replace(/\s+/g, " ").trim();
    return normalized.length <= 240 ? normalized : normalized.slice(0, 240) + "...";
};

const renderErrorLogs = logs => {
    const section = document.getElementById("errorLogsSection");
    const list = document.getElementById("errorLogs");

    list.replaceChildren();
    section.hidden = logs.length === 0;

    for (const log of logs) {
        const entry = document.createElement("li");
        entry.className = "log-entry";

        const meta = document.createElement("div");
        meta.className = "log-meta";
        const date = log.lastAttemptAt || log.timestamp;
        const repeatedText = log.attemptCount > 1 ? ` - ${log.attemptCount} intentos` : "";
        const reportedText = log.reportedAt ? ` - Reportado: ${formatLogDate(log.reportedAt)}` : "";
        meta.textContent = `${formatLogDate(date)} - ${log.source || "Sin origen"}${repeatedText}${reportedText}`;

        const message = document.createElement("p");
        message.className = "log-message";
        message.textContent = createLogMessagePreview(log.message);

        entry.append(meta, message);

        const detail = log.detail || (String(log.message || "").length > 240 ? log.message : null);

        if (detail) {
            const detailContainer = document.createElement("div");
            detailContainer.className = "log-detail-container";
            detailContainer.hidden = !expandedLogIds.has(log.id);

            const detailText = document.createElement("pre");
            detailText.className = "log-detail";
            detailText.textContent = detail;

            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.className = "log-detail-copy";
            copyButton.textContent = "Copiar detalle";
            copyButton.addEventListener("click", () => copyLogDetail(detail, copyButton));

            const toggleButton = document.createElement("button");
            toggleButton.type = "button";
            toggleButton.className = "log-detail-toggle";
            toggleButton.textContent = detailContainer.hidden ? "Mostrar detalle" : "Ocultar detalle";
            toggleButton.addEventListener("click", () => {
                detailContainer.hidden = !detailContainer.hidden;
                toggleButton.textContent = detailContainer.hidden ? "Mostrar detalle" : "Ocultar detalle";

                if (detailContainer.hidden)
                    expandedLogIds.delete(log.id);
                else
                    expandedLogIds.add(log.id);
            });

            detailContainer.append(copyButton, detailText);
            entry.append(toggleButton, detailContainer);
        }

        list.append(entry);
    }
};

async function refreshErrorLogs() {
    try {
        const response = await fetch("/logs?level=error,warning&limit=10", { cache: "no-store" });
        if (!response.ok)
            throw new Error("HTTP " + response.status);

        const result = await response.json();
        renderErrorLogs(Array.isArray(result.logs) ? result.logs.slice(0, 10) : []);
    } catch (error) {
        console.error("No fue posible consultar los logs de error y advertencia:", error);
    }
}

async function refreshStatus() {
    try {
        const response = await fetch("/app-status-data", { cache: "no-store" });
        if (!response.ok)
            throw new Error("HTTP " + response.status);

        const status = await response.json();

        document.getElementById("workerCard").hidden = status.workerRunning === true;
        document.getElementById("userPhoneCard").hidden = status.userPhoneRegistered === true;
        setStatus("worker", status.workerRunning ? "ok" : "bad", status.workerRunning ? "Ejecutándose" : "Detenido o sin respuesta");
        renderWhatsAppStatus(status.whatsapp);
        setWhatsAppActions(status.whatsapp);
        setFavoriteSyncAction(status.workerRunning, status.whatsappConnected);
        setAirbnbActions(status.airbnb, status.gmail);
        setStatus("userPhone", status.userPhoneRegistered ? "ok" : "warn", status.userPhoneRegistered ? "Registrado" : "Sin registrar");

        if (!status.workerRunning)
            setStatus("alexa", "warn", "No disponible");
        else if (status.hasPendingMessages)
            setStatus("alexa", "warn", "Sí hay mensajes pendientes");
        else
            setStatus("alexa", "ok", "Sin mensajes pendientes");

        const heartbeat = status.lastWorkerHeartbeat
            ? new Date(status.lastWorkerHeartbeat).toLocaleString()
            : "Nunca recibido";

        const lastRead = status.whatsapp?.lastSuccessfulReadAt
            ? new Date(status.whatsapp.lastSuccessfulReadAt).toLocaleString()
            : "Sin lecturas exitosas registradas";
        document.getElementById("detail").textContent = `Último reporte del Worker: ${heartbeat}. Última lectura de WhatsApp: ${lastRead}.`;
        document.getElementById("updated").textContent = "Actualizado: " + new Date().toLocaleTimeString();
        await refreshErrorLogs();
    } catch (error) {
        setWhatsAppActions({ connected: false });
        document.getElementById("detail").textContent = "No fue posible actualizar el estado: " + error.message;
    }
}

document.getElementById("viewAllLogsButton").addEventListener("click", () => {
    window.open("/logs?limit=1000", "_blank", "noopener");
});

document.getElementById("favoriteSyncButton").addEventListener("click", async () => {
    const button = document.getElementById("favoriteSyncButton");
    button.dataset.requesting = "true";
    button.disabled = true;
    showActionMessage("Solicitando la sincronización de mensajes favoritos...");

    try {
        const response = await fetch("/worker-actions/favorite-sync", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.error || "HTTP " + response.status);

        showActionMessage("Solicitud enviada. El Worker iniciará la sincronización en aproximadamente 30 segundos.", "success");
    } catch (error) {
        showActionMessage("No fue posible solicitar la sincronización: " + error.message, "error");
    } finally {
        button.dataset.requesting = "false";
        await refreshStatus();
    }
});

document.getElementById("whatsappTakeoverButton").addEventListener("click", async () => {
    const button = document.getElementById("whatsappTakeoverButton");
    button.dataset.requesting = "true";
    button.disabled = true;
    showActionMessage("Solicitando usar WhatsApp en este equipo...");

    try {
        const response = await fetch("/whatsapp/takeover", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.error || "HTTP " + response.status);

        showActionMessage("Solicitud enviada. Esperando que WhatsApp cambie la sesión a este equipo.", "success");
    } catch (error) {
        showActionMessage("No fue posible usar WhatsApp aquí: " + error.message, "error");
    } finally {
        button.dataset.requesting = "false";
        await refreshStatus();
    }
});

document.getElementById("whatsappRestartButton").addEventListener("click", async () => {
    if (!window.confirm("¿Deseas reiniciar Chromium y la conexión de WhatsApp? La sesión vinculada se conservará."))
        return;

    const button = document.getElementById("whatsappRestartButton");
    button.disabled = true;
    showActionMessage("Solicitando el reinicio de la conexión...");

    try {
        const response = await fetch("/whatsapp/restart-connection", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.message || "HTTP " + response.status);

        showActionMessage("Reinicio solicitado. El gateway volverá a estar disponible en unos segundos.", "success");
        setTimeout(() => window.location.reload(), 8000);
    } catch (error) {
        if (error instanceof TypeError) {
            window.localStorage.setItem(pendingPanelLogKey, JSON.stringify({
                occurredAt: new Date().toISOString(),
                action: "restart-whatsapp-connection",
                error: error.message
            }));
            showActionMessage("El Gateway cerró la conexión para reiniciarse. Esperando a que vuelva a estar disponible...", "success");
            setTimeout(() => window.location.reload(), 8000);
        } else {
            showActionMessage("No fue posible reiniciar la conexión: " + error.message, "error");
            button.disabled = false;
        }
    }
});

document.getElementById("whatsappLogTestButton").addEventListener("click", async () => {
    const button = document.getElementById("whatsappLogTestButton");
    button.dataset.requesting = "true";
    button.disabled = true;
    showActionMessage("Enviando una prueba de logs al teléfono de soporte...");

    try {
        const response = await fetch("/whatsapp/test-log-report", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.error || "HTTP " + response.status);

        showActionMessage(`Reporte de prueba enviado por WhatsApp. Logs incluidos: ${body.logCount}.`, "success");
    } catch (error) {
        showActionMessage("No fue posible enviar la prueba de logs: " + error.message, "error");
    } finally {
        button.dataset.requesting = "false";
        await refreshStatus();
    }
});

document.getElementById("clearLogsButton").addEventListener("click", async () => {
    if (!window.confirm("¿Deseas eliminar todos los logs del Gateway y del Worker?"))
        return;

    const button = document.getElementById("clearLogsButton");
    button.disabled = true;

    try {
        const response = await fetch("/logs", { method: "DELETE" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.error || "HTTP " + response.status);

        renderErrorLogs([]);
        expandedLogIds.clear();
        showActionMessage("Todos los logs fueron eliminados.", "success");
    } catch (error) {
        showActionMessage("No fue posible limpiar los logs: " + error.message, "error");
    } finally {
        button.disabled = false;
    }
});

document.getElementById("airbnbToggleButton").addEventListener("click", async () => {
    const button = document.getElementById("airbnbToggleButton");
    const enabled = button.dataset.enabled !== "true";
    button.disabled = true;

    try {
        const response = await fetch("/airbnb/enabled", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled })
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.message || "HTTP " + response.status);

        showActionMessage(enabled ? "Airbnb fue habilitado." : "Airbnb fue deshabilitado.", "success");
        await refreshStatus();
    } catch (error) {
        showActionMessage("No fue posible actualizar Airbnb: " + error.message, "error");
    } finally {
        button.disabled = false;
    }
});

document.getElementById("gmailTestButton").addEventListener("click", async () => {
    const button = document.getElementById("gmailTestButton");
    button.disabled = true;
    showActionMessage("Consultando correos recientes de Airbnb en Gmail...");

    try {
        const response = await fetch("/gmail/airbnb/messages", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.message || "HTTP " + response.status);

        showActionMessage(`Gmail detectó ${body.length} correo(s) de Airbnb recientes.`, "success");
    } catch (error) {
        showActionMessage("No fue posible leer correos Airbnb: " + error.message, "error");
    } finally {
        button.disabled = false;
    }
});

document.getElementById("gmailConnectionTestButton").addEventListener("click", async () => {
    const button = document.getElementById("gmailConnectionTestButton");
    button.disabled = true;
    showActionMessage("Validando la sesión OAuth y la conexión con Gmail...");

    try {
        const response = await fetch("/gmail/status", { cache: "no-store" });
        const status = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(status.message || "HTTP " + response.status);

        if (status.authenticated === true)
            showActionMessage(`Conexión con Gmail correcta${status.email ? `: ${status.email}` : ""}.`, "success");
        else if (status.configurationError === true)
            throw new Error("El Client ID o Client Secret no es válido.");
        else if (status.reauthenticationRequired === true || status.authenticationRequired === true)
            throw new Error("Gmail requiere volver a autenticar. Usa el botón Conectar Gmail.");
        else if (status.temporarilyUnavailable === true)
            throw new Error("No se pudo contactar Gmail. Revisa Internet y DNS.");
        else
            throw new Error(status.message || "No se pudo validar la sesión de Gmail.");

        await refreshStatus();
    } catch (error) {
        showActionMessage("Validación de Gmail fallida: " + error.message, "error");
        await refreshStatus();
    } finally {
        button.disabled = false;
    }
});

document.getElementById("gmailSyncButton").addEventListener("click", async () => {
    const button = document.getElementById("gmailSyncButton");
    button.disabled = true;
    showActionMessage("Sincronizando mensajes Airbnb desde Gmail...");

    try {
        const response = await fetch("/gmail/airbnb/sync", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.message || "HTTP " + response.status);

        showActionMessage(`Sincronización completada. Nuevos: ${body.savedCount}. Detectados: ${body.detectedCount}.`, "success");
    } catch (error) {
        showActionMessage("No fue posible sincronizar Airbnb desde Gmail: " + error.message, "error");
    } finally {
        button.disabled = false;
    }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
    if (!window.confirm("¿Deseas cerrar la sesión actual de WhatsApp? Será necesario escanear un nuevo código QR."))
        return;

    const button = document.getElementById("logoutButton");
    button.disabled = true;

    try {
        const response = await fetch("/whatsapp/logout", { method: "POST" });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || "HTTP " + response.status);
        }

        showActionMessage("Sesión cerrada. El gateway se reiniciará para generar un nuevo QR.", "success");
        setTimeout(() => window.location.reload(), 5000);
    } catch (error) {
        showActionMessage("No fue posible cerrar la sesión: " + error.message, "error");
        button.disabled = false;
    }
});

reportPendingPanelLog();
refreshStatus();
setInterval(refreshStatus, 5000);
