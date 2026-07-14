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
let restartScheduled = false;
const initializationRetryDelayMs = 15 * 1000;
const initializationMaxAttempts = 5;
const sendRetryDelayMs = 5 * 1000;
const sendMaxAttempts = 3;
let lastQr = null;
let pendingMessages = [];
const pendingMessageIds = new Set();
const User = { "Phone": "", "FullName": "", "Email": "", "SupportPhone": "", "SecondAribnbPhone": "", IsRegistered: false };

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "personal", dataPath: authPath }),

    puppeteer: {
        headless: hasReadySession,
        executablePath: getChromePath(),
        protocolTimeout: 180000,
        timeout: 180000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions'
        ]
    }
});

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

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

client.on("disconnected", async reason => {

    connected = false;
    User.IsRegistered = false;

    console.log("WhatsApp desconectado.");
    console.log(reason);

    if (reason === "LOGOUT" && fs.existsSync(readyFilePath))
        fs.unlinkSync(readyFilePath);

    if (!logoutInProgress && !restartScheduled) {
        restartScheduled = true;
        console.log("Reiniciando WhatsAppGateway para recuperar la conexión o generar un nuevo QR.");
        try {
            await client.destroy();
        } catch (cleanupError) {
            console.error("No fue posible cerrar Chromium antes de reiniciar WhatsAppGateway:");
            console.error(cleanupError);
        }

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

    return message.type === "chat" &&
        Boolean(message.body) &&
        !message.fromMe &&
        chatId !== "0@c.us" &&
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

function isTransientBrowserError(error) {
    const message = String(error?.message || error || "").toLowerCase();

    return message.includes("detached frame") ||
        message.includes("execution context was destroyed") ||
        message.includes("target closed") ||
        message.includes("whatsapp no está conectado");
}

async function sendMessageOnce(chatId, phone, text) {
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

async function sendMessage(chatId, phone, text) {
    for (let attempt = 1; attempt <= sendMaxAttempts; attempt++) {
        try {
            await sendMessageOnce(chatId, phone, text);
            return;
        } catch (error) {
            if (!isTransientBrowserError(error) || attempt === sendMaxAttempts)
                throw error;

            console.warn(`WhatsApp Web cambió de contexto durante el envío. Reintento ${attempt + 1} de ${sendMaxAttempts} en ${sendRetryDelayMs / 1000} segundos.`);
            await new Promise(resolve => setTimeout(resolve, sendRetryDelayMs));
        }
    }
}

async function getPendingMessages() {
    const messages = [...pendingMessages];
    pendingMessages = [];

    for (const message of messages)
        pendingMessageIds.delete(`${message.chatId}:${message.id}`);

    return messages;

}

async function getContacts() {
    if (!connected)
        throw new Error("WhatsApp no está conectado.");

    const contacts = await client.getContacts();

    return contacts
        .filter(contact => contact.isMyContact && contact.id && contact.id.user)
        .map(contact => ({
            name: contact.name || contact.pushname || contact.number || contact.id.user,
            phone: contact.id.user,
            chatId: contact.id._serialized,
            source: "WhatsApp"
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

function saveUser(user) {
    const savedUser = {
        Phone: user.phone,
        FullName: user.fullName,
        Email: user.email,
        SupportPhone: user.supportPhone || "",
        SecondAribnbPhone: user.secondAribnbPhone || ""
    };

    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(userFilePath, JSON.stringify(savedUser, null, 2), "utf8");

    User.Phone = savedUser.Phone;
    User.FullName = savedUser.FullName;
    User.Email = savedUser.Email;
    User.SupportPhone = savedUser.SupportPhone;
    User.SecondAribnbPhone = savedUser.SecondAribnbPhone;
}

function loadUser() {
    if (!fs.existsSync(userFilePath))
        return;

    const savedUser = readJsonFile(userFilePath);

    User.Phone = savedUser.Phone || "";
    User.FullName = savedUser.FullName || "";
    User.Email = savedUser.Email || "";
    User.SupportPhone = savedUser.SupportPhone || "";
    User.SecondAribnbPhone = savedUser.SecondAribnbPhone || "";
}

function clearUser() {
    User.Phone = "";
    User.FullName = "";
    User.Email = "";
    User.SupportPhone = "";
    User.SecondAribnbPhone = "";

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
    restartScheduled = true;
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
    getContacts,
    markChatAsRead,
    logout,
    getQr,
    saveUser,
    clearUser,
    isConnected
};
