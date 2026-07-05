const setStatus = (id, kind, text) => {
    const element = document.getElementById(id);
    element.className = "value " + kind;
    element.querySelector("span:last-child").textContent = text;
};

async function refreshStatus() {
    try {
        const response = await fetch("/app-status-data", { cache: "no-store" });
        if (!response.ok)
            throw new Error("HTTP " + response.status);

        const status = await response.json();

        setStatus("gateway", status.gatewayRunning ? "ok" : "bad", status.gatewayRunning ? "Ejecutándose" : "Sin respuesta");
        setStatus("worker", status.workerRunning ? "ok" : "bad", status.workerRunning ? "Ejecutándose" : "Detenido o sin respuesta");
        setStatus("whatsapp", status.whatsappConnected ? "ok" : "bad", status.whatsappConnected ? "Conectado" : "Desconectado");

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
    } catch (error) {
        setStatus("gateway", "bad", "Sin respuesta");
        document.getElementById("detail").textContent = "No fue posible actualizar el estado: " + error.message;
    }
}

document.getElementById("logoutButton").addEventListener("click", async () => {
    if (!window.confirm("¿Deseas cerrar la sesión actual de WhatsApp? Será necesario escanear un nuevo código QR."))
        return;

    const button = document.getElementById("logoutButton");
    button.disabled = true;

    try {
        const response = await fetch("/logout", { method: "POST" });
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
