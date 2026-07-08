const fs = require("fs");
const os = require("os");
const path = require("path");
const { google } = require("googleapis");
const config = require("./gateway-config.json");

const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const userFilePath = path.join(dataDirectory, "user-data.json");
const gmailConfigPath = path.join(__dirname, "gmail-config.json");
const localGmailConfigPath = path.join(__dirname, "gmail-config.local.json");
const defaultTokenFileName = "gmail-token.json";
const processedFilePath = path.join(dataDirectory, "gmail-airbnb-processed.json");
const gmailScopes = ["https://www.googleapis.com/auth/gmail.readonly"];
const firebaseBaseUrl = config.FirebaseBaseUrl || "https://voicemessaginghub-default-rtdb.firebaseio.com";

let getUser = () => null;

function configure(options = {}) {
    if (typeof options.getUser === "function")
        getUser = options.getUser;
}

function ensureDataDirectory() {
    fs.mkdirSync(dataDirectory, { recursive: true });
}

function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readUserData() {
    if (!fs.existsSync(userFilePath))
        return {};

    return readJsonFile(userFilePath);
}

function getGmailConfig() {
    const configPath = fs.existsSync(localGmailConfigPath) ? localGmailConfigPath : gmailConfigPath;
    const gmail = fs.existsSync(configPath)
        ? readJsonFile(configPath)
        : {};

    const gmailConfig = {
        enabled: gmail.enabled !== false,
        clientId: gmail.clientId || "",
        clientSecret: gmail.clientSecret || "",
        redirectUri: gmail.redirectUri || "http://localhost:3000/gmail/callback",
        tokenPath: gmail.tokenPath || defaultTokenFileName
    };

    return gmailConfig;
}

function getTokenPath(gmailConfig = getGmailConfig()) {
    if (path.isAbsolute(gmailConfig.tokenPath))
        return gmailConfig.tokenPath;

    return path.join(dataDirectory, gmailConfig.tokenPath || defaultTokenFileName);
}

function createOAuthClient() {
    const gmailConfig = getGmailConfig();

    if (!gmailConfig.clientId || !gmailConfig.clientSecret)
        throw new Error("Configura clientId y clientSecret en WhatsAppGateway/gmail-config.json o gmail-config.local.json.");

    return new google.auth.OAuth2(gmailConfig.clientId, gmailConfig.clientSecret, gmailConfig.redirectUri);
}

function readToken() {
    const tokenPath = getTokenPath();

    if (!fs.existsSync(tokenPath))
        return null;

    return readJsonFile(tokenPath);
}

function saveToken(token) {
    ensureDataDirectory();
    fs.writeFileSync(getTokenPath(), JSON.stringify(token, null, 2), "utf8");
}

function getAuthenticatedClient() {
    const token = readToken();

    if (!token)
        return null;

    const client = createOAuthClient();
    client.setCredentials(token);
    return client;
}

async function getStatus() {
    const gmailConfig = getGmailConfig();
    const token = readToken();
    const status = {
        enabled: gmailConfig.enabled,
        configured: Boolean(gmailConfig.clientId && gmailConfig.clientSecret),
        authenticated: Boolean(token)
    };

    if (!status.configured || !token)
        return status;

    try {
        const gmail = google.gmail({ version: "v1", auth: getAuthenticatedClient() });
        const profile = await gmail.users.getProfile({ userId: "me" });
        status.email = profile.data.emailAddress || "";
    } catch (error) {
        status.authenticated = false;
        status.message = error.message;
    }

    return status;
}

function getLoginUrl() {
    const client = createOAuthClient();

    return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: gmailScopes
    });
}

async function handleOAuthCallback(code) {
    if (!code)
        throw new Error("Google no devolvió un código OAuth.");

    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    saveToken(tokens);
}

function decodeBase64Url(data) {
    if (!data)
        return "";

    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf8");
}

function collectBodyParts(payload, bodies = []) {
    if (!payload)
        return bodies;

    if (payload.body?.data)
        bodies.push(decodeBase64Url(payload.body.data));

    for (const part of payload.parts || [])
        collectBodyParts(part, bodies);

    return bodies;
}

function cleanEmailBody(body) {
    return String(body || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
        .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeForMatch(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function isAirbnbMessageCandidate(cleanBody, subject) {
    const text = normalizeForMatch(`${subject} ${cleanBody}`);

    return text.includes("responde a la consulta de") ||
        text.includes("nueva reservacion confirmada") ||
        text.includes("reservacion confirmada") ||
        text.includes("consulta sobre");
}

function cleanExtractedText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .replace(/^[-:.,\s]+/, "")
        .trim();
}

function compactDuplicateName(value) {
    const name = cleanAirbnbSenderName(value);
    const words = name.split(" ");
    const half = words.length / 2;

    if (words.length > 1 &&
        Number.isInteger(half) &&
        words.slice(0, half).join(" ").toLowerCase() === words.slice(half).join(" ").toLowerCase()) {
        return words.slice(half).join(" ");
    }

    return name;
}

function cleanAirbnbSenderName(value) {
    return cleanExtractedText(value)
        .replace(/\[[^\]]*https?:\/\/[^\]]*\]/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/www\.\S+/gi, " ")
        .replace(/\b(?:Ver perfil|Perfil|Airbnb)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBetween(text, startPattern, endPatterns) {
    const startMatch = text.match(startPattern);

    if (!startMatch)
        return "";

    const startIndex = (startMatch.index ?? 0) + startMatch[0].length;
    const rest = text.slice(startIndex);
    const endIndexes = endPatterns
        .map(pattern => {
            const match = rest.match(pattern);
            return match?.index ?? -1;
        })
        .filter(index => index >= 0);
    const endIndex = endIndexes.length > 0 ? Math.min(...endIndexes) : rest.length;

    return cleanExtractedText(rest.slice(0, endIndex));
}

function cleanAirbnbMessageText(value) {
    return cleanExtractedText(value)
        .replace(/^[^.!?]{2,100},\s*[^.!?]{2,60}\s+(?=(?:tengo|hola|buen|me|quisiera|queremos|vamos|planeo)\b)/i, "")
        .trim();
}

function buildParsedAirbnbEmail(cleanBody, gmailMessageId, date, subject) {
    const inquiryName = extractBetween(cleanBody, /Responde a la consulta de\s+/i, [
        /Identidad verificada/i,
        /Preaprobar/i,
        /Casa con/i
    ]);
    const reservationName = extractBetween(cleanBody, /Nueva reservaci[oó]n confirmada!\s*/i, [
        /\s+llega\b/i,
        /Env[ií]a un mensaje/i
    ]);
    const subjectName = extractBetween(subject, /Reservaci[oó]n confirmada\s*-\s*/i, [
        /\s+llega\b/i
    ]);
    const sender = compactDuplicateName(inquiryName || subjectName || reservationName) || "Huésped de Airbnb";
    const inquiryMessage = extractBetween(cleanBody, /Identidad verificada(?:\s*[·.-]\s*\d+\s+evaluaci[oó]n(?:es)?)?/i, [
        /Preaprobar o rechazar/i,
        /Enviar un mensaje/i,
        /Casa con/i,
        /Llegada/i
    ]);
    const reservationStart = new RegExp(`${escapeRegex(sender)}\\s*(?:Identidad verificada[^A-ZÁÉÍÓÚÑ]*)?`, "i");
    const reservationMessage = extractBetween(cleanBody, reservationStart, [
        /Enviar un mensaje/i,
        /Casa con/i,
        /Llegada/i
    ]);
    const fallbackMessage = cleanExtractedText(cleanBody);
    const text = cleanAirbnbMessageText(inquiryMessage || reservationMessage || fallbackMessage).slice(0, 1200);

    return {
        gmailMessageId,
        chatId: `gmail_airbnb_${gmailMessageId}`,
        sender,
        text,
        date
    };
}

function parseAirbnbEmail(body, gmailMessageId, date, subject = "") {
    const cleanBody = cleanEmailBody(body);

    if (!isAirbnbMessageCandidate(cleanBody, subject))
        return null;

    return buildParsedAirbnbEmail(cleanBody, gmailMessageId, date, subject);
    const sender = senderMatch?.[1]?.trim() || "Huésped de Airbnb";
}

function readProcessedIds() {
    if (!fs.existsSync(processedFilePath))
        return new Set();

    const ids = readJsonFile(processedFilePath);
    return new Set(Array.isArray(ids) ? ids : []);
}

function writeProcessedIds(ids) {
    ensureDataDirectory();
    fs.writeFileSync(processedFilePath, JSON.stringify([...ids].slice(-1000), null, 2), "utf8");
}

async function getAirbnbMessages(options = {}) {
    const client = getAuthenticatedClient();

    if (!client)
        throw new Error("Gmail no está autenticado.");

    const gmail = google.gmail({ version: "v1", auth: client });
    const query = options.query || 'from:automated@airbnb.com ("Responde a la consulta de" OR "Reservación confirmada" OR "Nueva reservación confirmada" OR "Consulta sobre") newer_than:7d';
    const maxResults = Math.min(Math.max(Number(options.maxResults) || 10, 1), 25);
    const processedIds = options.includeProcessed ? new Set() : readProcessedIds();
    const listResponse = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
    const messages = [];

    for (const item of listResponse.data.messages || []) {
        if (!item.id || processedIds.has(item.id))
            continue;

        const messageResponse = await gmail.users.messages.get({ userId: "me", id: item.id, format: "full" });
        const headers = messageResponse.data.payload?.headers || [];
        const dateHeader = headers.find(header => header.name?.toLowerCase() === "date")?.value;
        const subjectHeader = headers.find(header => header.name?.toLowerCase() === "subject")?.value || "";
        const date = dateHeader && !Number.isNaN(Date.parse(dateHeader)) ? new Date(dateHeader).toISOString() : new Date().toISOString();
        const body = collectBodyParts(messageResponse.data.payload).join(" ");
        const parsed = parseAirbnbEmail(body || messageResponse.data.snippet, item.id, date, subjectHeader);

        if (parsed)
            messages.push(parsed);
    }

    return messages;
}

function getCurrentUserPhone() {
    const user = getUser() || readUserData();
    return String(user.Phone || user.phone || "").replace(/\D/g, "");
}

async function saveMessageToFirebase(phone, message) {
    const id = `gmail_airbnb_${message.gmailMessageId}`;
    const payload = {
        MessageId: id,
        ChatId: message.chatId || id,
        Sender: message.sender || "Huésped de Airbnb",
        Account: "Airbnb",
        Source: "AirbnbEmail",
        Text: message.text,
        Date: message.date,
        IsRead: false
    };
    const response = await fetch(`${firebaseBaseUrl}/usuarios/${phone}/mensajes_pendientes.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok)
        throw new Error(`Firebase respondió HTTP ${response.status}.`);
}

async function setHasPendingMessages(phone) {
    const response = await fetch(`${firebaseBaseUrl}/usuarios/${phone}/control/has_pending_messages.json`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(true)
    });

    if (!response.ok)
        throw new Error(`Firebase respondió HTTP ${response.status}.`);
}

async function syncAirbnbMessages() {
    const phone = getCurrentUserPhone();

    if (!phone)
        throw new Error("Primero registra el teléfono del usuario en el Gateway.");

    const processedIds = readProcessedIds();
    const messages = await getAirbnbMessages();
    const savedMessages = [];
    let savedCount = 0;

    for (const message of messages) {
        if (processedIds.has(message.gmailMessageId))
            continue;

        await saveMessageToFirebase(phone, message);
        processedIds.add(message.gmailMessageId);
        savedMessages.push(message);
        savedCount++;
    }

    if (savedCount > 0) {
        writeProcessedIds(processedIds);
        await setHasPendingMessages(phone);
    }

    return { success: true, savedCount, detectedCount: messages.length, messages, savedMessages };
}

module.exports = {
    configure,
    getStatus,
    getLoginUrl,
    handleOAuthCallback,
    getAirbnbMessages,
    syncAirbnbMessages,
    parseAirbnbEmail
};
