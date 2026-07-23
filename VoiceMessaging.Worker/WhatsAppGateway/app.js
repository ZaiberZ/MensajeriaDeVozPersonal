const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cors = require("cors");
const { firebaseBaseUrl, firebaseFetch } = require("./firebase-client");

const logger = require("./logger");
logger.installConsoleCapture();

const whatsapp = require("./whatsapp");
const gmail = require("./gmail");

const app = express();
const workerStatus = {
    lastHeartbeat: null,
    hasPendingMessages: false
};
let favoriteMessagesSyncRequested = false;
const workerHeartbeatTimeoutMs = 2 * 60 * 1000;
const airbnbEmailNotificationIntervalMs = 60 * 60 * 1000; // 1 hr
const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const pendingAirbnbNotificationPath = path.join(dataDirectory, "pending-airbnb-notification.json");
let airbnbEmailNotificationRunning = false;
let pendingAirbnbNotification = readPendingAirbnbNotification();

function isWorkerRunning() {
    return workerStatus.lastHeartbeat !== null &&
        Date.now() - workerStatus.lastHeartbeat.getTime() <= workerHeartbeatTimeoutMs;
}

app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

gmail.configure({ getUser: () => whatsapp.isConnected().User });

whatsapp.initialize()
    .catch(error => {
        console.error("No se pudo completar la inicialización del Gateway:");
        console.error(error);
    });

app.get("/", (req, res) => {
    res.send("Voice Messaging Gateway funcionando.");
});

app.get("/whatsapp/status", async (req, res) => {
    res.json(await whatsapp.getStatus());
});

app.post("/worker-status", (req, res) => {
    workerStatus.lastHeartbeat = new Date();
    workerStatus.hasPendingMessages = req.body?.hasPendingMessages === true;

    res.json({ success: true });
});

app.post("/worker-actions/favorite-sync", async (req, res) => {
    if (!isWorkerRunning())
        return res.status(503).json({ success: false, error: "El Worker no está disponible." });

    if (!(await whatsapp.getStatus()).connected)
        return res.status(409).json({ success: false, error: "WhatsApp todavía no está conectado." });

    favoriteMessagesSyncRequested = true;
    res.status(202).json({ success: true });
});

app.post("/worker-actions/favorite-sync/consume", (req, res) => {
    const requested = favoriteMessagesSyncRequested;
    favoriteMessagesSyncRequested = false;
    res.json({ requested });
});

app.get("/app-status-data", async (req, res) => {
    const whatsappStatus = await whatsapp.getStatus();
    const airbnbStatus = await getAirbnbStatus();
    const gmailStatus = await gmail.getStatus().catch(error => ({
        enabled: true,
        authenticated: false,
        message: error.message
    }));
    const workerRunning = isWorkerRunning();

    res.json({
        gatewayRunning: true,
        workerRunning,
        whatsappConnected: whatsappStatus.connected === true,
        airbnb: airbnbStatus,
        gmail: gmailStatus,
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

function getSecondAribnbPhone() {
    return cleanPhone(whatsapp.isConnected().User?.SecondAribnbPhone);
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

function airbnbEnabledPath(phone) {
    return `${firebaseBaseUrl}/usuarios/${phone}/configuracion/airbnb/enabled.json`;
}

function disabledAirbnbPuppeteerResponse() {
    return {
        enabled: false,
        running: false,
        authenticated: false,
        loginRequired: false,
        message: "Airbnb Puppeteer integration disabled. Use Gmail integration."
    };
}

async function readAirbnbEnabled() {
    const phone = getCurrentUserPhone();

    if (!phone)
        return false;

    try {
        const response = await firebaseFetch(airbnbEnabledPath(phone), { signal: AbortSignal.timeout(5000) });

        if (!response.ok)
            throw new Error(`Firebase respondió HTTP ${response.status}.`);

        const value = await response.json();
        return value === true;
    } catch (error) {
        console.warn(`No se pudo leer la configuración de Airbnb en Firebase: ${error.message}`);
        return false;
    }
}

async function writeAirbnbEnabled(enabled) {
    const phone = requireCurrentUserPhone();
    const response = await firebaseFetch(airbnbEnabledPath(phone), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabled === true),
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok)
        throw new Error(`Firebase respondió HTTP ${response.status}.`);
}

async function getAirbnbStatus() {
    return {
        ...disabledAirbnbPuppeteerResponse(),
        enabled: await readAirbnbEnabled()
    };
}

/**
 * 
 * @param {[gmail.AirbnbEmail]} messages
 * @returns
 */
function buildAirbnbNotificationMessage(messages) {
    const lines = [
        `Se detectaron ${messages.length} mensaje(s) nuevo(s) de Airbnb.`
    ];

    for (const message of messages) {
        lines.push("");
        lines.push(`Huesped: ${message.sender || "Sin nombre"}`);
        lines.push(`Fecha: ${message.date.substring(0, 16).replace("T", " a las ")}`);
        lines.push(`Mensaje: ${String(message.text || "").trim().slice(0, 1000)}`);
    }

    // console.log(lines.join("\n").trim());

    return lines.join("\n").trim();
}

function readPendingAirbnbNotification() {
    if (!fs.existsSync(pendingAirbnbNotificationPath))
        return null;

    try {
        const notification = JSON.parse(fs.readFileSync(pendingAirbnbNotificationPath, "utf8").replace(/^\uFEFF/, ""));
        return Array.isArray(notification?.messages) && notification.messages.length > 0 ? notification : null;
    } catch (error) {
        console.warn(`No se pudo leer la notificación pendiente de Airbnb: ${error.message}`);
        return null;
    }
}

function savePendingAirbnbNotification(messages) {
    pendingAirbnbNotification = {
        messages,
        createdAt: new Date().toISOString()
    };

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(pendingAirbnbNotificationPath, JSON.stringify(pendingAirbnbNotification, null, 2), "utf8");
}

function clearPendingAirbnbNotification() {
    pendingAirbnbNotification = null;

    if (fs.existsSync(pendingAirbnbNotificationPath))
        fs.unlinkSync(pendingAirbnbNotificationPath);
}

async function syncAirbnbEmailAndNotifySecondPhone() {
    if (airbnbEmailNotificationRunning)
        return;

    airbnbEmailNotificationRunning = true;

    try {
        if (!await readAirbnbEnabled())
            return;

        const secondAribnbPhone = getSecondAribnbPhone();

        if (!secondAribnbPhone)
            return;

        if (whatsapp.isConnected().connected !== true) {
            console.warn("No se revisan mensajes Airbnb para SecondAribnbPhone porque WhatsApp no esta conectado.");
            return;
        }

        if (!pendingAirbnbNotification) {
            const result = await gmail.syncAirbnbMessages();
            const newMessages = Array.isArray(result.savedMessages) ? result.savedMessages : [];

            if (newMessages.length === 0)
                return;

            savePendingAirbnbNotification(newMessages);
        } else {
            console.log(`Reintentando notificación pendiente de Airbnb con ${pendingAirbnbNotification.messages.length} mensaje(s).`);
        }

        const messageCount = pendingAirbnbNotification.messages.length;
        await whatsapp.sendMessage(null, secondAribnbPhone, buildAirbnbNotificationMessage(pendingAirbnbNotification.messages));
        clearPendingAirbnbNotification();
        console.log(`Notificacion de Airbnb enviada a SecondAribnbPhone con ${messageCount} mensaje(s).`);
    } catch (error) {
        console.error("Error revisando o notificando mensajes Airbnb por Gmail:");
        console.error(error);
    } finally {
        airbnbEmailNotificationRunning = false;
    }
}

function sanitizeContactId(contact) {
    const phone = cleanPhone(contact.phone);

    if (phone) return phone;

    return String(contact.chatId || "").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
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
        const response = await firebaseFetch(`${frequentContactsPath(phone)}.json`);

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

        const response = await firebaseFetch(`${frequentContactsPath(phone)}/${id}.json`, {
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

        const response = await firebaseFetch(`${frequentContactsPath(phone)}/${id}.json`, { method: "DELETE" });

        if (!response.ok)
            throw new Error(`Firebase respondió ${response.status}.`);

        res.json({ success: true });
    } catch (error) {
        console.error("Error al eliminar contacto frecuente:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/airbnb/status", async (req, res) => { res.json(await getAirbnbStatus()); });

app.get("/airbnb/login", async (req, res) => { res.status(410).json(disabledAirbnbPuppeteerResponse()); });

app.get("/airbnb/messages", async (req, res) => { res.json([]); });

app.post("/airbnb/send", async (req, res) => {
    res.status(501).json({
        success: false,
        message: "Airbnb Puppeteer integration disabled. AirbnbEmail replies are not supported yet."
    });
});

app.put("/airbnb/enabled", async (req, res) => {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (origin && origin !== expectedOrigin)
        return res.status(403).json({ success: false, message: "Origen no permitido." });

    try {
        await writeAirbnbEnabled(req.body?.enabled === true);
        res.json({ success: true, status: await getAirbnbStatus() });
    } catch (error) {
        console.error("Error al actualizar la configuración de Airbnb:");
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get("/gmail/status", async (req, res) => {
    try {
        res.json(await gmail.getStatus());
    } catch (error) {
        res.status(500).json({ enabled: true, authenticated: false, message: error.message });
    }
});

app.get("/gmail/login", (req, res) => {
    try {
        res.redirect(gmail.getLoginUrl());
    } catch (error) {
        res.status(400).send(error.message);
    }
});

app.get("/gmail/callback", async (req, res) => {
    try {
        await gmail.handleOAuthCallback(req.query.code);
        res.send("<!doctype html><html lang=\"es\"><body><h1>Gmail conectado correctamente.</h1><p>Puedes cerrar esta ventana.</p></body></html>");
    } catch (error) {
        res.status(400).send(`No fue posible conectar Gmail: ${error.message}`);
    }
});

app.get("/gmail/airbnb/messages", async (req, res) => {
    try {
        res.json(await gmail.getAirbnbMessages({ includeProcessed: true }));
    } catch (error) {
        console.error("Error al consultar mensajes Airbnb desde Gmail:");
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post("/gmail/airbnb/sync", async (req, res) => {
    try {
        res.json(await gmail.syncAirbnbMessages());
    } catch (error) {
        console.error("Error al sincronizar mensajes Airbnb desde Gmail:");
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
        const { level, message, detail = null, source = "VoiceMessaging.Worker" } = req.body ?? {};
        const log = logger.addLog(level, message, source, detail);

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
    console.log("Revision horaria de Airbnb por Gmail configurada.");
    console.log("");
});

setTimeout(syncAirbnbEmailAndNotifySecondPhone, 15000);
setInterval(syncAirbnbEmailAndNotifySecondPhone, airbnbEmailNotificationIntervalMs);

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

app.post("/whatsapp/recent-messages", async (req, res) => {
    try {
        const { chatIds, count } = req.body ?? {};

        if (!Array.isArray(chatIds))
            return res.status(400).json({ success: false, error: "La lista de chats es obligatoria." });

        const messages = await whatsapp.getRecentMessages(chatIds, count);
        res.json(messages);
    } catch (error) {
        if (error.statusCode === 503 || error.message === "WhatsApp no está conectado.")
            return res.status(503).json({ success: false, error: error.message });

        console.error("Error al consultar mensajes recientes:");
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
