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