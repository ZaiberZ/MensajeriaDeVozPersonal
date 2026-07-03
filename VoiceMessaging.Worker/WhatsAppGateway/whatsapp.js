const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const path = require("path");

const authPath = path.join(__dirname, "data", "auth");
const sessionPath = path.join(authPath, "session-personal");
const readyFilePath = path.join(authPath, "personal.ready");
const hasReadySession = fs.existsSync(readyFilePath);

process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, ".cache");

const hasSession = fs.existsSync(sessionPath);

let initialized = false;
let connected = false;
let lastQr = null;
let pendingMessages = [];
const User = { "Phone": "", "FullName": "", "Email": "", IsRegistered: false };

function getBundledChromePath() {
    const cachePath = path.join(__dirname, ".cache", "chrome");

    const versions = fs.readdirSync(cachePath);

    for (const version of versions) {
        const chromePath = path.join(cachePath, version, "chrome-win64", "chrome.exe");

        if (fs.existsSync(chromePath))
            return chromePath;
    }

    throw new Error("No se encontró chrome.exe dentro de .cache.");
}


const client = new Client({
    authStrategy: new LocalAuth({ clientId: "personal", dataPath: authPath }),

    puppeteer: {
        headless: hasReadySession,
        executablePath: getBundledChromePath(),
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage"
        ]
    }
});
function getQr() {
    return lastQr;
}

client.on("qr", async (qr) => {
    lastQr = await qrcode.toDataURL(qr);

    console.log("QR generado. Abre http://localhost:3000/qr para escanearlo.");
});

client.on("ready", async () => {
    connected = true;
    lastQr = null;
    fs.writeFileSync(readyFilePath, new Date().toISOString(), "utf8");

    console.log("WhatsApp conectado.");

    if (!hasSession) {
        console.log("Primera autenticación completada. Reiniciando Gateway...");

        setTimeout(() => { process.exit(0); }, 3000);
    }
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

function saveUser(user) {
    const appSettingsPath = path.join(__dirname, "..", "appsettings.json");

    if (!fs.existsSync(appSettingsPath)) {
        throw new Error("No se encontró appsettings.json");
    }

    const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, "utf8"));

    appSettings.User = {
        Phone: user.phone,
        FullName: user.fullName,
        Email: user.email
    };

    User.Phone = user.phone;
    User.FullName = user.fullName;
    User.Email = user.email;
    User.IsRegistered = true;

    fs.writeFileSync(appSettingsPath, JSON.stringify(appSettings, null, 2), "utf8");
}

async function initialize() {

    if (initialized) {
        console.log("WhatsApp ya fue inicializado.");
        return;
    }

    initialized = true;

    console.log("Inicializando WhatsApp...");

    try {
        await client.initialize();
    } catch (error) {
        initialized = false;
        connected = false;

        console.error("Error inicializando WhatsApp:");
        console.error(error);
    }
}

function isConnected() {
    const appSettingsPath = path.join(__dirname, "..", "appsettings.json");

    if (!User.IsRegistered && fs.existsSync(appSettingsPath)) {
        const appSettings = JSON.parse(fs.readFileSync(appSettingsPath, "utf8"));
        const savedUser = appSettings.User;

        if (savedUser?.Phone) {
            User.Phone = savedUser.Phone;
            User.FullName = savedUser.FullName;
            User.Email = savedUser.Email;
            User.IsRegistered = true;
        }
    }

    return { connected, User };
}

module.exports = {
    initialize,
    getClient() { return client; },
    sendMessage,
    getPendingMessages,
    getQr,
    saveUser,
    isConnected
};
