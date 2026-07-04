const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const os = require("os");
const path = require("path");

const authPath = path.join(__dirname, "data", "auth");
const sessionPath = path.join(authPath, "session-personal");
const readyFilePath = path.join(authPath, "personal.ready");
const hasReadySession = fs.existsSync(readyFilePath);
const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const userFilePath = path.join(dataDirectory, "user-data.json");

process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, ".cache");

const hasSession = fs.existsSync(sessionPath);

let initialized = false;
let connected = false;
let lastQr = null;
let pendingMessages = [];
const pendingMessageIds = new Set();
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
    User.IsRegistered = true;
    fs.writeFileSync(readyFilePath, new Date().toISOString(), "utf8");

    console.log("WhatsApp conectado.");

    try {
        await recoverUnreadMessages();
    } catch (error) {
        console.error("Error al recuperar mensajes no leídos:");
        console.error(error);
    }

    // if (!hasSession) {
        // console.log("Primera autenticación completada. Reiniciando Gateway...");
        // setTimeout(() => { process.exit(0); }, 3000);
    // }
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
        // Ignorar mensajes vacíos o de grupos por ahora, tambien de status
        if (!isSupportedIncomingMessage(message)) {
            return;
        }

        const incomingMessage = await createIncomingMessage(message);
        enqueuePendingMessage(incomingMessage);

        console.log("Mensaje recibido:");
        console.log(incomingMessage);

    } catch (error) {

        console.error("Error al procesar mensaje recibido:");
        console.error(error);
    }
});

function isSupportedIncomingMessage(message) {
    const chatId = message.from || "";

    return Boolean(message.body) &&
        !message.fromMe &&
        !chatId.includes("@g.us") &&
        !chatId.includes("status@broadcast");
}

async function createIncomingMessage(message, senderFallback = "") {
    let sender = senderFallback || message.from;

    try {
        const contact = await message.getContact();
        sender = contact.pushname || contact.name || sender;
    } catch (error) {
        console.warn(`No se pudo obtener el contacto de ${message.from}: ${error.message}`);
    }

    return {
        id: message.id.id,
        chatId: message.from,
        sender,
        phone: message.from.replace("@c.us", ""),
        text: message.body,
        source: "WhatsApp",
        account: "Personal",
        date: message.timestamp
            ? new Date(message.timestamp * 1000).toISOString()
            : new Date().toISOString()
    };
}

function enqueuePendingMessage(message) {
    const messageKey = `${message.chatId}:${message.id}`;

    if (pendingMessageIds.has(messageKey))
        return false;

    pendingMessageIds.add(messageKey);
    pendingMessages.push(message);
    return true;
}

async function recoverUnreadMessages() {
    const chats = await client.getChats();
    let recoveredCount = 0;

    for (const chat of chats) {
        const chatId = chat.id?._serialized || "";

        if (chat.isGroup || chatId.includes("status@broadcast") || chat.unreadCount <= 0)
            continue;

        try {
            const unreadMessages = await chat.fetchMessages({
                limit: chat.unreadCount,
                fromMe: false
            });

            for (const message of unreadMessages) {
                if (!isSupportedIncomingMessage(message))
                    continue;

                const incomingMessage = await createIncomingMessage(message, chat.name || chatId);

                if (enqueuePendingMessage(incomingMessage))
                    recoveredCount++;
            }
        } catch (error) {
            console.error(`Error al recuperar mensajes no leídos de ${chatId}:`);
            console.error(error);
        }
    }

    console.log(`${recoveredCount} mensaje(s) no leído(s) recuperado(s).`);
}

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

async function getPendingMessages() {
    const messages = [...pendingMessages];
    pendingMessages = [];

    for (const message of messages)
        pendingMessageIds.delete(`${message.chatId}:${message.id}`);

    const chatIds = [...new Set(messages.map(message => message.chatId))];

    for (const chatId of chatIds) {
        try {
            await client.sendSeen(chatId);
        } catch (error) {
            console.error(`No se pudo marcar como leído el chat ${chatId}:`);
            console.error(error);
        }
    }

    return messages;

}

function saveUser(user) {
    const savedUser = {
        Phone: user.phone,
        FullName: user.fullName,
        Email: user.email
    };

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(userFilePath, JSON.stringify(savedUser, null, 2), "utf8");

    User.Phone = savedUser.Phone;
    User.FullName = savedUser.FullName;
    User.Email = savedUser.Email;
}

function loadUser() {
    if (!fs.existsSync(userFilePath))
        return;

    const savedUser = JSON.parse(fs.readFileSync(userFilePath, "utf8"));

    User.Phone = savedUser.Phone || "";
    User.FullName = savedUser.FullName || "";
    User.Email = savedUser.Email || "";
}

function clearUser() {
    User.Phone = "";
    User.FullName = "";
    User.Email = "";

    if (fs.existsSync(userFilePath))
        fs.unlinkSync(userFilePath);
}

async function initialize() {

    if (initialized) {
        console.log("WhatsApp ya fue inicializado.");
        return;
    }

    initialized = true;
    User.IsRegistered = false;
    loadUser();

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
    return { connected, User };
}

module.exports = {
    initialize,
    getClient() { return client; },
    sendMessage,
    getPendingMessages,
    getQr,
    saveUser,
    clearUser,
    isConnected
};
