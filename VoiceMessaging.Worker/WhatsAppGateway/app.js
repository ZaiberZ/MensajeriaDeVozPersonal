const express = require("express");
const path = require("path");
const cors = require("cors");

const logger = require("./logger");
logger.installConsoleCapture();

const whatsapp = require("./whatsapp");

const app = express();

app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

whatsapp.initialize().catch(error => {
    console.error("No se pudo inicializar WhatsApp:");
    console.error(error);
});

app.get("/", (req, res) => {
    res.send("WhatsApp Gateway funcionando.");
});

app.get("/status", (req, res) => {
    res.json(whatsapp.isConnected());
});

app.get("/logs", (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 1000) : 200;
    const level = typeof req.query.level === "string" ? req.query.level : undefined;
    const logs = logger.getLogs(level, limit);

    res.json({ file: logger.logFilePath, count: logs.length, logs });
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

const PORT = 3000;

app.listen(PORT, () => {
    console.log("---------------------------------------");
    console.log(" WhatsApp Gateway");
    console.log("---------------------------------------");
    console.log(`Servidor iniciado en puerto ${PORT}`);
    console.log("");
});

app.post("/send", async (req, res) => {
    try {
        const { chatId, phone, text } = req.body;

        await whatsapp.sendMessage(chatId, phone, text);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/messages", async (req, res) => {
    try {
        const messages = await whatsapp.getPendingMessages();
        res.json(messages);
    } catch (error) {
        console.error("Error al entregar mensajes pendientes:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/unread-messages", async (req, res) => {
    try {
        const messages = await whatsapp.getUnreadMessages();
        res.json(messages);
    } catch (error) {
        console.error("Error al consultar mensajes no leídos:");
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/mark-read", async (req, res) => {
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

app.get("/qr", (req, res) => {
    res.sendFile(path.join(__dirname, "qr.html"));
});

app.get("/qr-data", (req, res) => {
    const qr = whatsapp.getQr();

    if (!qr) {
        return res.status(404).json({
            qr: null,
            message: "No hay un código QR disponible."
        });
    }

    res.json({ qr });
});

app.get("/userdata", (req, res) => {
    res.sendFile(path.join(__dirname, "userdata.html"));
});

app.post("/setup-user", (req, res) => {
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

app.delete("/setup-user", (req, res) => {
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
