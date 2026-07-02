const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

let connected = false;

const client = new Client({

    authStrategy: new LocalAuth({ clientId: "personal", dataPath: "./data/auth" }),

    puppeteer: {
        headless: false,    // Actualmente muestra el navegador
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
});

client.on("qr", async (qr) => {
    console.clear();

    console.log("---------------------------------------");
    console.log("Escanea este QR con WhatsApp");
    console.log("---------------------------------------");

    const qrTerminal = await qrcode.toString(qr, {
        type: "terminal",
        small: true
    });

    console.log(qrTerminal);

});

client.on("ready", () => {

    connected = true;

    console.log("");
    console.log("---------------------------------------");
    console.log("WhatsApp conectado.");
    console.log("---------------------------------------");

});

client.on("authenticated", () => {

    console.log("Sesión autenticada.");

});

client.on("auth_failure", message => {

    console.log("Error de autenticación.");

    console.log(message);

});

client.on("disconnected", reason => {

    connected = false;

    console.log("WhatsApp desconectado.");

    console.log(reason);

});

module.exports = {
    initialize() { client.initialize(); },
    isConnected() { return connected; },
    getClient() { return client; }
};