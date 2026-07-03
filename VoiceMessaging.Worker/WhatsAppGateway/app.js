const express = require("express");
const path = require("path");
const cors = require("cors");

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

app.get("/messages", (req, res) => {
    const messages = whatsapp.getPendingMessages();
    res.json(messages);
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
