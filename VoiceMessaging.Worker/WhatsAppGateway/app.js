const express = require("express");
const path = require("path");
const cors = require("cors");

const logger = require("./logger");
logger.installConsoleCapture();

const whatsapp = require("./whatsapp");
const airbnb = require("./airbnb");

const app = express();
const workerStatus = {
    lastHeartbeat: null,
    hasPendingMessages: false
};
const workerHeartbeatTimeoutMs = 2 * 60 * 1000;
const firebaseBaseUrl = "https://voicemessaginghub-default-rtdb.firebaseio.com";

app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

airbnb.configure({ getUser: () => whatsapp.isConnected().User });

whatsapp.initialize()
    .catch(error => {
        console.error("No se pudo completar la inicialización del Gateway:");
        console.error(error);
    });

app.get("/", (req, res) => {
    res.send("Voice Messaging Gateway funcionando.");
});

app.get("/whatsapp/status", (req, res) => {
    res.json(whatsapp.isConnected());
});

app.post("/worker-status", (req, res) => {
    workerStatus.lastHeartbeat = new Date();
    workerStatus.hasPendingMessages = req.body?.hasPendingMessages === true;

    res.json({ success: true });
});

app.get("/app-status-data", async (req, res) => {
    const whatsappStatus = whatsapp.isConnected();
    const airbnbStatus = await airbnb.getAirbnbStatus();
    const workerRunning = workerStatus.lastHeartbeat !== null &&
        Date.now() - workerStatus.lastHeartbeat.getTime() <= workerHeartbeatTimeoutMs;

    res.json({
        gatewayRunning: true,
        workerRunning,
        whatsappConnected: whatsappStatus.connected === true,
        airbnb: airbnbStatus,
        userPhoneRegistered: Boolean(whatsappStatus.User?.Phone?.trim()),
        hasPendingMessages: workerRunning ? workerStatus.hasPendingMessages : null,
        lastWorkerHeartbeat: workerStatus.lastHeartbeat?.toISOString() ?? null
    });
});

app.get("/app-status", (req, res) => {
    res.sendFile(path.join(__dirname, "app-status.html"));
});

function cleanPhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function getCurrentUserPhone() {
    return cleanPhone(whatsapp.isConnected().User?.Phone);
}

function requireCurrentUserPhone() {
    const phone = getCurrentUserPhone();

    if (!phone)
        throw new Error("Primero registra el teléfono del usuario en el Gateway.");

    return phone;
}

function frequentContactsPath(phone) {
    return `${firebaseBaseUrl}/usuarios/${phone}/contactos_frecuentes`;
}

function sanitizeContactId(contact) {
    const phone = cleanPhone(contact.phone);

    if (phone)
        return phone;

    return String(contact.chatId || "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/^_+|_+$/g, "");
}

function normalizeFrequentContact(id, contact) {
    return {
        id,
        name: String(contact.name || "").trim(),
        phone: cleanPhone(contact.phone),
        chatId: String(contact.chatId || "").trim(),
        source: String(contact.source || "WhatsApp").trim() || "WhatsApp",
        createdAt: contact.createdAt || new Date().toISOString()
    };
}

app.get("/contacts", (req, res) => {
    res.sendFile(path.join(__dirname, "contacts.html"));
});

app.get("/contacts/whatsapp", async (req, res) => {
    try {
        res.json(await whatsapp.getContacts());
    } catch (error) {
        if (error.message === "WhatsApp no está conectado.")
            return res.status(503).json({ success: false, error: error.message });

        console.error("Error al consultar contactos de WhatsApp:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/contacts/frequent", async (req, res) => {
    try {
        const phone = requireCurrentUserPhone();
        const response = await fetch(`${frequentContactsPath(phone)}.json`);

        if (!response.ok)
            throw new Error(`Firebase respondió ${response.status}.`);

        const contacts = await response.json();
        const list = contacts
            ? Object.entries(contacts).map(([id, contact]) => normalizeFrequentContact(id, contact))
            : [];

        res.json(list.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })));
    } catch (error) {
        console.error("Error al consultar contactos frecuentes:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/contacts/frequent", async (req, res) => {
    try {
        const phone = requireCurrentUserPhone();
        const id = sanitizeContactId(req.body);

        if (!id)
            return res.status(400).json({ success: false, error: "El contacto necesita teléfono o chatId." });

        const contact = normalizeFrequentContact(id, req.body ?? {});

        if (!contact.name || !contact.chatId)
            return res.status(400).json({ success: false, error: "El contacto necesita nombre y chatId." });

        const response = await fetch(`${frequentContactsPath(phone)}/${id}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(contact)
        });

        if (!response.ok)
            throw new Error(`Firebase respondió ${response.status}.`);

        res.status(201).json({ success: true, contact });
    } catch (error) {
        console.error("Error al guardar contacto frecuente:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete("/contacts/frequent/:id", async (req, res) => {
    try {
        const phone = requireCurrentUserPhone();
        const id = String(req.params.id || "").replace(/[^a-zA-Z0-9_-]/g, "");

        if (!id)
            return res.status(400).json({ success: false, error: "El id del contacto es obligatorio." });

        const response = await fetch(`${frequentContactsPath(phone)}/${id}.json`, { method: "DELETE" });

        if (!response.ok)
            throw new Error(`Firebase respondió ${response.status}.`);

        res.json({ success: true });
    } catch (error) {
        console.error("Error al eliminar contacto frecuente:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/airbnb/status", async (req, res) => {
    try {
        res.json(await airbnb.getAirbnbStatus());
    } catch (error) {
        console.error("Error al consultar el estado de Airbnb:");
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/airbnb/login", async (req, res) => {
    try {
        await airbnb.openAirbnbLogin();
        res.json({ success: true, message: "Airbnb login opened" });
    } catch (error) {
        res.status(409).json({ success: false, message: error.message });
    }
});

app.get("/airbnb/messages", async (req, res) => {
    try {
        res.json(await airbnb.getAirbnbMessages());
    } catch (error) {
        console.error("Error al consultar mensajes de Airbnb:");
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post("/airbnb/send", async (req, res) => {
    try {
        const { chatId, text } = req.body ?? {};
        const result = await airbnb.sendAirbnbMessage(chatId, text);
        res.status(result.success ? 200 : 501).json(result);
    } catch (error) {
        console.error("Error al enviar mensaje de Airbnb:");
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.put("/airbnb/enabled", async (req, res) => {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (origin && origin !== expectedOrigin)
        return res.status(403).json({ success: false, message: "Origen no permitido." });

    try {
        const status = await airbnb.setAirbnbEnabled(req.body?.enabled === true);
        res.json({ success: true, status });
    } catch (error) {
        console.error("Error al actualizar la configuración de Airbnb:");
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/logs", (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
    const level = typeof req.query.level === "string" ? req.query.level : undefined;
    const logs = logger.getLogs(level, limit);

    res.json({ file: logger.logFilePath, count: logs.length, logs });
});

app.get("/logs/unreported-errors", (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 100;
    const result = logger.getUnreportedErrorLogs(limit);

    res.json({ file: logger.logFilePath, count: result.count, logs: result.logs });
});

app.post("/logs", (req, res) => {
    try {
        const { level, message, source = "VoiceMessaging.Worker" } = req.body ?? {};
        const log = logger.addLog(level, message, source);

        if (!log)
            return res.status(500).json({ success: false, message: "No fue posible guardar el log." });

        res.status(201).json({ success: true, log });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post("/logs/mark-reported", (req, res) => {
    try {
        const updatedCount = logger.markLogsReported(req.body?.ids);

        res.json({ success: true, updatedCount });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log("---------------------------------------");
    console.log(" WhatsApp Gateway");
    console.log("---------------------------------------");
    console.log(`Servidor iniciado en puerto ${PORT}`);
    console.log("");
});

app.post("/whatsapp/send", async (req, res) => {
    try {
        const { chatId, phone, text } = req.body;

        await whatsapp.sendMessage(chatId, phone, text);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/whatsapp/messages", async (req, res) => {
    try {
        const messages = await whatsapp.getPendingMessages();
        res.json(messages);
    } catch (error) {
        console.error("Error al entregar mensajes pendientes:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/whatsapp/unread-messages", async (req, res) => {
    try {
        const messages = await whatsapp.getUnreadMessages();
        res.json(messages);
    } catch (error) {
        if (error.statusCode === 503 || error.message === "WhatsApp no está conectado.")
            return res.status(503).json({ success: false, error: error.message });

        console.error("Error al consultar mensajes no leídos:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/whatsapp/mark-read", async (req, res) => {
    try {
        const { chatId } = req.body ?? {};

        await whatsapp.markChatAsRead(chatId);
        res.json({ success: true });
    } catch (error) {
        console.error("Error al marcar el chat como leído:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/whatsapp/logout", async (req, res) => {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (origin && origin !== expectedOrigin)
        return res.status(403).json({ success: false, error: "Origen no permitido." });

    try {
        await whatsapp.logout();
        res.json({ success: true, message: "Sesión de WhatsApp cerrada." });

        // El Worker volverá a iniciar el gateway sin la sesión anterior y mostrará un QR nuevo.
        setTimeout(() => process.exit(0), 1000);
    } catch (error) {
        console.error("Error al cerrar la sesión de WhatsApp:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete("/logs", (req, res) => {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (origin && origin !== expectedOrigin)
        return res.status(403).json({ success: false, error: "Origen no permitido." });

    try {
        logger.clearLogs();
        res.json({ success: true, message: "Logs eliminados." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/whatsapp/qr", (req, res) => {
    res.sendFile(path.join(__dirname, "qr.html"));
});

app.get("/whatsapp/qr-data", (req, res) => {
    const qr = whatsapp.getQr();

    if (!qr) {
        return res.status(404).json({
            qr: null,
            message: "No hay un código QR disponible."
        });
    }

    res.json({ qr });
});

app.get("/whatsapp/userdata", (req, res) => {
    res.sendFile(path.join(__dirname, "userdata.html"));
});

app.post("/whatsapp/setup-user", (req, res) => {
    try {
        console.log("Guardando usuario...");
        whatsapp.saveUser(req.body);

        res.json({ success: true });
        console.log("Usuario guardado");
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

app.delete("/whatsapp/setup-user", (req, res) => {
    try {
        console.log("Limpiando usuario...");
        whatsapp.clearUser();

        res.json({ success: true });
        console.log("Información del usuario eliminada");
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});
