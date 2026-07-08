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

const openAirbnbMessages = () => {
    window.location.href = "voicemessaging-airbnb://messages";
};

const setAirbnbActions = status => {
    const enabled = status?.enabled === true;
    document.getElementById("airbnbCard").hidden = !enabled;

    const toggleButton = document.getElementById("airbnbToggleButton");
    const messagesButton = document.getElementById("airbnbMessagesButton");
    toggleButton.hidden = !enabled;
    messagesButton.hidden = !enabled || status.authenticated !== true;
    document.getElementById("airbnbLoginLink").hidden = !enabled || status.authenticated === true;

    if (!enabled)
        return;

    toggleButton.dataset.enabled = "true";
    toggleButton.textContent = "Deshabilitar Airbnb";
};

const formatLogDate = value => {
    if (!value)
        return "Fecha no disponible";

    const date = new Date(value);

    if (Number.isNaN(date.getTime()))
        return "Fecha no disponible";

    return date.toLocaleString();
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
        message.textContent = log.message || "Error sin detalle.";

        entry.append(meta, message);
        list.append(entry);
    }
};

async function refreshErrorLogs() {
    try {
        const response = await fetch("/logs?level=error&limit=10", { cache: "no-store" });
        if (!response.ok)
            throw new Error("HTTP " + response.status);

        const result = await response.json();
        renderErrorLogs(Array.isArray(result.logs) ? result.logs.slice(0, 10) : []);
    } catch (error) {
        console.error("No fue posible consultar los logs de error:", error);
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
        setAirbnbActions(status.airbnb);
        if (status.airbnb?.enabled === true) {
            setStatus(
                "airbnbSession",
                status.airbnb.authenticated ? "ok" : "warn",
                status.airbnb.authenticated ? "Autenticada" : "Requiere login");
        }
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

document.getElementById("airbnbMessagesButton").addEventListener("click", async () => {
    document.getElementById("detail").textContent = "Abriendo mensajes de Airbnb...";
    openAirbnbMessages();
});

document.getElementById("airbnbLoginLink").addEventListener("click", async event => {
    event.preventDefault();
    document.getElementById("detail").textContent = "Abriendo Airbnb...";
    window.location.href = "voicemessaging-airbnb://login";
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
