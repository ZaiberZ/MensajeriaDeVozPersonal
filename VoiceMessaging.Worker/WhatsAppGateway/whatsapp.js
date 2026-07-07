const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getChromePath } = require("./chrome-path");

const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const authPath = path.join(dataDirectory, "whatsapp-auth");
const legacyAuthPath = path.join(__dirname, "data", "auth");

function migrateLegacyAuth() {
    if (fs.existsSync(authPath) || !fs.existsSync(legacyAuthPath))
        return;

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.cpSync(legacyAuthPath, authPath, { recursive: true });
}

migrateLegacyAuth();

const sessionPath = path.join(authPath, "session-personal");
const readyFilePath = path.join(authPath, "personal.ready");
const hasReadySession = fs.existsSync(readyFilePath);
const userFilePath = path.join(dataDirectory, "user-data.json");

const hasSession = fs.existsSync(sessionPath);

let initialized = false;
let connected = false;
let logoutInProgress = false;
const initializationRetryDelayMs = 15 * 1000;
const initializationMaxAttempts = 5;
let lastQr = null;
let pendingMessages = [];
const pendingMessageIds = new Set();
const User = { "Phone": "", "FullName": "", "Email": "", "SupportPhone": "", IsRegistered: false };

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "personal", dataPath: authPath }),

    puppeteer: {
        headless: hasReadySession,
        executablePath: getChromePath(),
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

    console.log("QR generado. Abre http://localhost:3000/whatsapp/qr para escanearlo.");
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
    User.IsRegistered = false;

    console.log("WhatsApp desconectado.");
    console.log(reason);

    if (reason === "LOGOUT" && fs.existsSync(readyFilePath))
        fs.unlinkSync(readyFilePath);

    if (!logoutInProgress) {
        console.log("Reiniciando WhatsAppGateway para recuperar la conexión o generar un nuevo QR.");
        setTimeout(() => process.exit(0), 1000);
    }

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
        !chatId.includes("status@broadcast") &&
        !isChannelChatId(chatId);
}

function isChannelChatId(chatId) {
    return /@\w*newsletter\b/.test(chatId);
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
    const unreadMessages = await getUnreadMessages();
    let recoveredCount = 0;

    for (const message of unreadMessages) {
        if (enqueuePendingMessage(message))
            recoveredCount++;
    }

    console.log(`${recoveredCount} mensaje(s) no leído(s) recuperado(s).`);
}

async function getUnreadMessages() {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    let chats;

    try {
        chats = await client.getChats();
    } catch (error) {
        console.warn("WhatsApp no está disponible temporalmente para consultar los chats:");
        console.warn(error);

        const unavailableError = new Error("WhatsApp no está disponible temporalmente.");
        unavailableError.statusCode = 503;
        throw unavailableError;
    }

    const unreadMessages = [];

    for (const chat of chats) {
        const chatId = chat.id?._serialized || "";

        if (chat.isGroup || chat.isChannel || chatId.includes("status@broadcast") || isChannelChatId(chatId) || chat.unreadCount <= 0)
            continue;

        try {
            const chatMessages = await chat.fetchMessages({
                limit: chat.unreadCount,
                fromMe: false
            });

            for (const message of chatMessages) {
                if (!isSupportedIncomingMessage(message))
                    continue;

                const incomingMessage = await createIncomingMessage(message, chat.name || chatId);
                unreadMessages.push(incomingMessage);
            }
        } catch (error) {
            console.error(`Error al recuperar mensajes no leídos de ${chatId}:`);
            console.error(error);
        }
    }

    return unreadMessages;
}

async function markChatAsRead(chatId) {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    if (!chatId)
        throw new Error("El chat es obligatorio.");

    await client.sendSeen(chatId);
}

async function logout() {
    logoutInProgress = true;

    try {
        const canLogoutRemotely = client.pupPage && !client.pupPage.isClosed() && client.pupBrowser?.isConnected();

        if (canLogoutRemotely) {
            try {
                await client.logout();
            } catch (error) {
                console.warn("No se pudo cerrar la sesión desde WhatsApp Web; se eliminará la sesión local:");
                console.warn(error);
                await client.destroy();
                await fs.promises.rm(sessionPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
            }
        } else {
            await client.destroy();
            await fs.promises.rm(sessionPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
        }
    } finally {
        connected = false;
        lastQr = null;
        User.IsRegistered = false;

        if (fs.existsSync(readyFilePath))
            fs.unlinkSync(readyFilePath);
    }
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

    return messages;

}

function saveUser(user) {
    const savedUser = {
        Phone: user.phone,
        FullName: user.fullName,
        Email: user.email,
        SupportPhone: user.supportPhone || ""
    };

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(userFilePath, JSON.stringify(savedUser, null, 2), "utf8");

    User.Phone = savedUser.Phone;
    User.FullName = savedUser.FullName;
    User.Email = savedUser.Email;
    User.SupportPhone = savedUser.SupportPhone;
}

function loadUser() {
    if (!fs.existsSync(userFilePath))
        return;

    const savedUser = JSON.parse(fs.readFileSync(userFilePath, "utf8"));

    User.Phone = savedUser.Phone || "";
    User.FullName = savedUser.FullName || "";
    User.Email = savedUser.Email || "";
    User.SupportPhone = savedUser.SupportPhone || "";
}

function clearUser() {
    User.Phone = "";
    User.FullName = "";
    User.Email = "";
    User.SupportPhone = "";

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

    for (let attempt = 1; attempt <= initializationMaxAttempts; attempt++) {
        try {
            console.log(`Intento de inicialización de WhatsApp ${attempt} de ${initializationMaxAttempts}.`);
            await client.initialize();
            return;
        } catch (error) {
            connected = false;

            console.error(`Error inicializando WhatsApp en el intento ${attempt} de ${initializationMaxAttempts}:`);
            console.error(error);

            try {
                await client.destroy();
            } catch (cleanupError) {
                console.error("No fue posible cerrar Chromium después del error de inicialización:");
                console.error(cleanupError);
            }

            if (attempt < initializationMaxAttempts) {
                console.log(`Se volverá a intentar en ${initializationRetryDelayMs / 1000} segundos.`);
                await new Promise(resolve => setTimeout(resolve, initializationRetryDelayMs));
            }
        }
    }

    initialized = false;
    console.error(`No fue posible inicializar WhatsApp después de ${initializationMaxAttempts} intentos. Se reiniciará WhatsAppGateway.`);
    setTimeout(() => process.exit(1), 1000);
}

function isConnected() {
    return { connected, User };
}

module.exports = {
    initialize,
    getClient() { return client; },
    sendMessage,
    getPendingMessages,
    getUnreadMessages,
    markChatAsRead,
    logout,
    getQr,
    saveUser,
    clearUser,
    isConnected
};
