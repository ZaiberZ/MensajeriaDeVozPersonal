const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

let connected = false;
let pendingMessages = [];

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "personal", dataPath: "./data/auth" }),
    puppeteer: {
        headless: true,    // Actualmente oculta el navegador
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

client.on("message", async (message) => {
    try {
        // Ignorar mensajes vacíos o de grupos por ahora
        if (!message.body || message.from.includes("@g.us") || message.from.includes("status@broadcast")) {
            return;
        }

        const contact = await message.getContact();

        const incomingMessage = {
            id: message.id.id,
            chatId: message.from,
            sender: contact.pushname || contact.name || message.from,
            phone: message.from.replace("@c.us", ""),
            text: message.body,
            source: "WhatsApp",
            account: "Personal",
            date: new Date().toISOString()
        };

        pendingMessages.push(incomingMessage);

        console.log("Mensaje recibido:");
        console.log(incomingMessage);

    } catch (error) {

        console.error("Error al procesar mensaje recibido:");
        console.error(error);
    }
});

function normalizePhone(phone) {

    return phone
        .replace(/\D/g, "")      // Elimina todo lo que no sea número
        .replace(/^52(?=1\d{10}$)/, "521"); // Si aplica, ajusta números de México

}

async function sendMessage(chatId, phone, text) {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    if (chatId) {
        await client.sendMessage(chatId, text);
        return;
    }

    phone = phone.replace(/\D/g, "");

    const numberId = await client.getNumberId(phone);

    if (!numberId)
        throw new Error(`El número ${phone} no existe en WhatsApp.`);

    await client.sendMessage(numberId._serialized, text);
}

function getPendingMessages() {
    const messages = [...pendingMessages];
    pendingMessages = [];

    return messages;

}

module.exports = {
    initialize() { client.initialize(); },
    isConnected() { return connected; },
    getClient() { return client; },
    sendMessage,
    getPendingMessages
};
