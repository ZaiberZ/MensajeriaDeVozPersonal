const express = require("express");
const cors = require("cors");

const whatsapp = require("./whatsapp");

const app = express();

app.use(cors());
app.use(express.json());

// Inicializar WhatsApp
whatsapp.initialize();

app.get("/", (req, res) => {
    res.send("WhatsApp Gateway funcionando.");
});

app.get("/status", (req, res) => {
    res.json({ connected: whatsapp.isConnected() });
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
        const { phone, text } = req.body;

        await whatsapp.sendMessage(phone, text);

        res.json({ success: true });
    }
    catch (error) {
        console.error(error);

        res.status(500).json({ success: false, error: error.message });
    }
});

app.get("/messages", (req, res) => {
    const messages = whatsapp.getPendingMessages();

    res.json(messages);
});