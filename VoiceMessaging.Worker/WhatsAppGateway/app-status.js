const setStatus = (id, kind, text) => {
    const element = document.getElementById(id);
    if (!element)
        return;

    element.className = "value " + kind;
    const textElement = element.querySelector("span:last-child");

    if (textElement)
        textElement.textContent = text;
};

const setWhatsAppActions = connected => {
    document.getElementById("qrLink").hidden = connected;
    document.getElementById("logoutButton").hidden = !connected;
};

const setAirbnbActions = (status, gmailStatus) => {
    const enabled = status?.enabled === true;
    const toggleButton = document.getElementById("airbnbToggleButton");
    const gmailCard = document.getElementById("gmailCard");
    const gmailLoginLink = document.getElementById("gmailLoginLink");
    const gmailTestButton = document.getElementById("gmailTestButton");
    const gmailSyncButton = document.getElementById("gmailSyncButton");

    toggleButton.hidden = false;
    toggleButton.dataset.enabled = enabled ? "true" : "false";
    toggleButton.textContent = enabled ? "Deshabilitar Airbnb" : "Habilitar Airbnb";
    gmailCard.hidden = !enabled;
    gmailLoginLink.hidden = !enabled || gmailStatus?.authenticated === true;
    gmailTestButton.hidden = !enabled || gmailStatus?.authenticated !== true;
    gmailSyncButton.hidden = !enabled || gmailStatus?.authenticated !== true;

    if (!enabled)
        return;

    if (gmailStatus?.authenticated === true)
        setStatus("gmailSession", "ok", gmailStatus.email ? `Conectado: ${gmailStatus.email}` : "Conectado");
    else if (gmailStatus?.configured === false)
        setStatus("gmailSession", "warn", "Falta configurar OAuth");
    else
        setStatus("gmailSession", "warn", "Requiere conexión");
};

const formatLogDate = value => {
    if (!value)
        return "Fecha no disponible";

    const date = new Date(value);

    if (Number.isNaN(date.getTime()))
        return "Fecha no disponible";

    return date.toLocaleString();
};

const copyLogDetail = async (detail, button) => {
    try {
        await navigator.clipboard.writeText(detail);
        button.textContent = "Copiado";
        setTimeout(() => { button.textContent = "Copiar detalle"; }, 1500);
    } catch (error) {
        document.getElementById("detail").textContent = "No fue posible copiar el detalle: " + error.message;
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
            detailContainer.hidden = true;

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
            toggleButton.textContent = "Mostrar detalle";
            toggleButton.addEventListener("click", () => {
                detailContainer.hidden = !detailContainer.hidden;
                toggleButton.textContent = detailContainer.hidden ? "Mostrar detalle" : "Ocultar detalle";
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

        setStatus("worker", status.workerRunning ? "ok" : "bad", status.workerRunning ? "Ejecutándose" : "Detenido o sin respuesta");
        setStatus("whatsapp", status.whatsappConnected ? "ok" : "bad", status.whatsappConnected ? "Conectado" : "Desconectado");
        setWhatsAppActions(status.whatsappConnected);
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

        document.getElementById("detail").textContent = "Último reporte del Worker: " + heartbeat;
        document.getElementById("updated").textContent = "Actualizado: " + new Date().toLocaleTimeString();
        await refreshErrorLogs();
    } catch (error) {
        setWhatsAppActions(false);
        document.getElementById("detail").textContent = "No fue posible actualizar el estado: " + error.message;
    }
}

document.getElementById("viewAllLogsButton").addEventListener("click", () => {
    window.open("/logs?limit=1000", "_blank", "noopener");
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
        document.getElementById("detail").textContent = "Todos los logs fueron eliminados.";
    } catch (error) {
        document.getElementById("detail").textContent = "No fue posible limpiar los logs: " + error.message;
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

        document.getElementById("detail").textContent = enabled ? "Airbnb fue habilitado." : "Airbnb fue deshabilitado.";
        await refreshStatus();
    } catch (error) {
        document.getElementById("detail").textContent = "No fue posible actualizar Airbnb: " + error.message;
    } finally {
        button.disabled = false;
    }
});

document.getElementById("gmailTestButton").addEventListener("click", async () => {
    const button = document.getElementById("gmailTestButton");
    button.disabled = true;
    document.getElementById("detail").textContent = "Consultando correos recientes de Airbnb en Gmail...";

    try {
        const response = await fetch("/gmail/airbnb/messages", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.message || "HTTP " + response.status);

        document.getElementById("detail").textContent = `Gmail detectó ${body.length} correo(s) de Airbnb recientes.`;
    } catch (error) {
        document.getElementById("detail").textContent = "No fue posible leer correos Airbnb: " + error.message;
    } finally {
        button.disabled = false;
    }
});

document.getElementById("gmailSyncButton").addEventListener("click", async () => {
    const button = document.getElementById("gmailSyncButton");
    button.disabled = true;
    document.getElementById("detail").textContent = "Sincronizando mensajes Airbnb desde Gmail...";

    try {
        const response = await fetch("/gmail/airbnb/sync", { method: "POST" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok)
            throw new Error(body.message || "HTTP " + response.status);

        document.getElementById("detail").textContent = `Sincronización completada. Nuevos: ${body.savedCount}. Detectados: ${body.detectedCount}.`;
    } catch (error) {
        document.getElementById("detail").textContent = "No fue posible sincronizar Airbnb desde Gmail: " + error.message;
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

        document.getElementById("detail").textContent = "Sesión cerrada. El gateway se reiniciará para generar un nuevo QR.";
        setTimeout(() => window.location.reload(), 5000);
    } catch (error) {
        document.getElementById("detail").textContent = "No fue posible cerrar la sesión: " + error.message;
        button.disabled = false;
    }
});

refreshStatus();
setInterval(refreshStatus, 5000);
