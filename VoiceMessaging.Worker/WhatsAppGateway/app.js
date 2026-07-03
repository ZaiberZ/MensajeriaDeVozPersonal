const express = require("express");
const path = require("path");
const cors = require("cors");
// const path = require("path");

const whatsapp = require("./whatsapp");

const app = express();

app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

// Inicializar WhatsApp
whatsapp.initialize().catch(error => {
    console.error("No se pudo inicializar WhatsApp:");
    console.error(error);
});

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

    const qr = whatsapp.getQr();

    if (!qr) {
        return res.send(`
            <html>
                <body>
                    <h2>No hay QR disponible</h2>
                    <p>Si WhatsApp ya está conectado, no necesitas escanear nada.</p>
                    <p>Revisa <a href="/status">/status</a></p>
                </body>
            </html>
        `);
    }

    res.send(`
        <html>
            <body style="font-family: Arial; text-align: center;">
                <h2>Escanea este QR con WhatsApp</h2>
                <img src="${qr}" style="width: 320px; height: 320px;" />
                <p>Después de escanear, puedes cerrar esta página.</p>

                <h3>Información del usuario</h3>
                <input id="fullName" type="text" placeholder="Nombre completo">
                <input id="phone" type="text" placeholder="Teléfono">
                <input id="email" type="email" placeholder="Correo electrónico">

                <button onclick="saveUser()"> Guardar </button>
                <script src="/script.js"></script>
            </body>
        </html>
    `);

});

app.post("/setup-user", (req, res) => {

    try {
        console.log("Guardando usuario...");
        whatsapp.saveUser(req.body);

        res.json({ success: true });
        console.log("Usuario guardado");
    }
    catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

