const logger = require("./logger");
const { Message } = require("whatsapp-web.js");

/**
 * @typedef {Object} IncomingWhatsAppMessage
 * @property {string} id
 * @property {string} chatId
 * @property {string} sender
 * @property {string} phone
 * @property {string} text
 * @property {"WhatsApp"} source
 * @property {"Personal"} account
 * @property {string} date Fecha ISO.
 */

/**
 * @typedef {Object} FavoriteContactRequest
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [phone]
 * @property {string} [chatId]
 */

/**
 * @typedef {Object} ReconciledContact
 * @property {string} id
 * @property {string} previousChatId
 * @property {string} chatId
 */

/**
 * @typedef {Object} RecentMessagesResult
 * @property {IncomingWhatsAppMessage[]} messages
 * @property {ReconciledContact[]} reconciledContacts
 * @property {number} successfulChats
 * @property {number} requestedChats
 */

/**
 * @typedef {Object} WhatsAppMessagesApi
 * @property {() => void} attachMessageHandler
 * @property {() => Promise<Array<{name: string, phone: string, chatId: string, source: "WhatsApp"}>>} getContacts
 * @property {() => Promise<IncomingWhatsAppMessage[]>} getPendingMessages
 * @property {(contacts: Array<FavoriteContactRequest|string>, count?: number) => Promise<RecentMessagesResult>} getRecentMessages
 * @property {() => Promise<IncomingWhatsAppMessage[]>} getUnreadMessages
 * @property {(chatId: string) => Promise<void>} markChatAsRead
 * @property {(phone: string) => string} normalizePhone
 * @property {() => Promise<void>} recoverUnreadMessages
 * @property {(chatId: string|null, phone: string, text: string) => Promise<void>} sendMessage
 */

/**
 * Encapsula todas las operaciones que leen o envían contenido. El módulo recibe
 * el estado por referencia para no duplicar una segunda noción de "conectado".
 * @param {{
 *   client: import("whatsapp-web.js").Client,
 *   diagnostics: {
 *     diagnoseFavoriteChats: (targets: Object[]) => Promise<void>,
 *     logFunctionalDiagnostics: (context: string, error: unknown) => Promise<void>,
 *     logSkippedChatModelsIfAny: (context: string) => Promise<void>
 *   },
 *   recovery: {
 *     recordFunctionalFailure: (error: unknown, failureCount?: number) => void,
 *     recordSuccessfulRead: () => void
 *   },
 *   runtime: {connected: boolean}
 * }} dependencies
 * @returns {WhatsAppMessagesApi}
 */
function createWhatsAppMessages({ client, diagnostics, recovery, runtime }) {
    const sendRetryDelayMs = 5 * 1000;
    const sendMaxAttempts = 3;
    const functionalFailureThreshold = 3;
    let pendingMessages = [];
    const pendingMessageIds = new Set();

    function isChannelChatId(chatId) {
        return /@\w*newsletter\b/.test(chatId);
    }

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

    /**
     * Convierte el modelo interno de whatsapp-web.js al contrato que consume el Worker.
     * @param {import("whatsapp-web.js").Message} message
     * @param {string} [senderFallback]
     * @param {boolean} [skipContactLookup=false]
     * @returns {Promise<IncomingWhatsAppMessage>}
     */
    async function createIncomingMessage(message, senderFallback = "", skipContactLookup = false) {
        let sender = senderFallback || message.from;

        if (!skipContactLookup) {
            try {
                const contact = await message.getContact();
                sender = contact.pushname || contact.name || sender;
            } catch (error) {
                console.warn(`No se pudo obtener el contacto de ${message.from}: ${error.message}`);
            }
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

    /**
     * La fachada llama este método una sola vez. Mantener aquí el listener evita
     * que el formato de mensajes entrantes se mezcle con eventos de conexión.
     */
    function attachMessageHandler() {
        client.on("message", async message => {
            try {
                // Por diseño sólo se procesan textos individuales; grupos,
                // canales y estados se ignoran.
                if (!isSupportedIncomingMessage(message))
                    return;

                const incomingMessage = await createIncomingMessage(message);
                enqueuePendingMessage(incomingMessage);
                console.log("Mensaje recibido:");
                console.log(incomingMessage);
            } catch (error) {
                console.error("Error al procesar mensaje recibido:");
                console.error(error);
            }
        });
    }

    async function recoverUnreadMessages() {
        const unreadMessages = await getUnreadMessages();
        let recoveredCount = 0;

        for (const message of unreadMessages) {
            if (enqueuePendingMessage(message))
                recoveredCount++;
        }

        const recoveryMessage = `${recoveredCount} mensaje(s) no leído(s) recuperado(s) correctamente.`;
        console.log(recoveryMessage);
        logger.addLog("info", recoveryMessage, "WhatsAppGateway");
    }

    /**
     * @returns {Promise<IncomingWhatsAppMessage[]>}
     * @throws {Error} Con statusCode 503 cuando WhatsApp no puede consultar chats.
     */
    async function getUnreadMessages() {
        if (!runtime.connected)
            throw new Error("WhatsApp no está conectado.");

        let chats;

        try {
            chats = await client.getChats();
            await diagnostics.logSkippedChatModelsIfAny("la recuperación de mensajes no leídos");
            recovery.recordSuccessfulRead();
        } catch (error) {
            await diagnostics.logFunctionalDiagnostics("recuperacion-mensajes-no-leidos", error);
            recovery.recordFunctionalFailure(error);
            console.warn("WhatsApp no está disponible temporalmente para consultar los chats:", error);

            const unavailableError = new Error("WhatsApp no está disponible temporalmente.");
            unavailableError.statusCode = 503;
            throw unavailableError;
        }

        const unreadMessages = [];

        for (const chat of chats) {
            const chatId = chat.id?._serialized || "";

            if (chat.isGroup || chat.isChannel || chatId.includes("status@broadcast") ||
                isChannelChatId(chatId) || chat.unreadCount <= 0)
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

    /**
     * @param {string} chatId
     * @param {number} messageLimit
     * @param {number} attempts
     * @returns {Promise<{
     *   chatName: string,
     *   messages: import("whatsapp-web.js").Message[],
     *   usedDirectFallback: boolean,
     *   historyLoadFailed: boolean
     * }>}
     */
    async function fetchRecentMessagesFromChat(chatId, messageLimit, attempts) {
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const chat = await client.getChatById(chatId);

                if (!chat)
                    throw new Error("El chat no está disponible en la sesión actual de WhatsApp.");

                const chatMessages = await chat.fetchMessages({ limit: messageLimit * 10 });
                return {
                    chatName: chat.name || "",
                    messages: chatMessages.filter(isSupportedIncomingMessage).slice(-messageLimit),
                    usedDirectFallback: false,
                    historyLoadFailed: false
                };
            } catch (error) {
                lastError = error;

                // El fallback se prueba desde el primer fallo. En chats LID evita
                // esperar reintentos que repetirían el mismo DataError.
                try {
                    const fallbackResult = await fetchRecentMessagesFromRawChat(chatId, messageLimit);

                    if (fallbackResult)
                        return fallbackResult;
                } catch (fallbackError) {
                    lastError = fallbackError;
                }

                if (attempt < attempts)
                    await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        throw lastError;
    }

    /**
     * Lee y serializa mensajes individuales desde el modelo crudo del chat. No
     * llama getChatModel y, por tanto, evita el DataError confirmado en chats LID.
     * @param {string} chatId
     * @param {number} messageLimit
     * @returns {Promise<{
     *   chatName: string,
     *   messages: import("whatsapp-web.js").Message[],
     *   usedDirectFallback: true,
     *   historyLoadFailed: boolean
     * }|null>}
     */
    async function fetchRecentMessagesFromRawChat(chatId, messageLimit) {
        const browserResult = await client.pupPage.evaluate(async (targetChatId, targetMessageCount) => {
            const chatWid = window.require("WAWebWidFactory").createWid(targetChatId);
            const rawChat = window.require("WAWebCollections").Chat.get(chatWid);

            if (!rawChat?.msgs)
                return null;

            const requestedCacheSize = Math.max(targetMessageCount * 10, targetMessageCount);
            let rawMessages = rawChat.msgs.getModelsArray();
            let historyLoadFailed = false;

            // La carga histórica es de mejor esfuerzo. Si IndexedDB vuelve a
            // fallar, se conservan los mensajes que ya estaban en memoria.
            for (let attempt = 0; rawMessages.length < requestedCacheSize && attempt < 5; attempt++) {
                try {
                    const previousCount = rawMessages.length;
                    const loadedMessages = await window.require("WAWebChatLoadMessages").loadEarlierMsgs({ chat: rawChat });

                    if (!loadedMessages?.length)
                        break;

                    rawMessages = [...loadedMessages, ...rawMessages];

                    if (rawMessages.length <= previousCount)
                        break;
                } catch {
                    historyLoadFailed = true;
                    break;
                }
            }

            rawMessages.sort((left, right) => (left.t > right.t ? 1 : -1));
            rawMessages = rawMessages.slice(-requestedCacheSize);
            const messageModels = [];
            let serializationFailures = 0;

            for (const rawMessage of rawMessages) {
                try {
                    messageModels.push(await window.WWebJS.getMessageModel(rawMessage));
                } catch {
                    serializationFailures++;
                }
            }

            return {
                messageModels,
                historyLoadFailed,
                serializationFailures
            };
        }, chatId, messageLimit);

        if (!browserResult)
            return null;

        const messages = browserResult.messageModels
            .map(model => new Message(client, model))
            .filter(isSupportedIncomingMessage)
            .slice(-messageLimit);

        return {
            chatName: "",
            messages,
            usedDirectFallback: true,
            historyLoadFailed: browserResult.historyLoadFailed === true ||
                Number(browserResult.serializationFailures) > 0
        };
    }

    /**
     * WhatsApp migra algunos contactos de PN (@c.us) a LID. Se prueban ambos
     * identificadores para conservar favoritos creados antes de esa migración.
     */
    /**
     * @param {string} phone
     * @returns {Promise<string[]>} Identificadores PN, LID y serializado, sin duplicados.
     */
    async function resolveChatIdsByPhone(phone) {
        const normalizedPhone = String(phone || "").replace(/\D/g, "");

        if (!normalizedPhone)
            return [];

        const numberId = await client.getNumberId(normalizedPhone);
        const phoneChatId = numberId?._serialized || `${normalizedPhone}@c.us`;
        let lidMapping = null;

        try {
            [lidMapping] = await client.getContactLidAndPhone([phoneChatId]);
        } catch (error) {
            console.warn(`No fue posible resolver el LID actual del teléfono ${normalizedPhone}: ${error.message}`);
        }

        return [...new Set([lidMapping?.lid, lidMapping?.pn, numberId?._serialized].filter(Boolean))];
    }

    /**
     * Recupera favoritos tolerando ChatId antiguos y devuelve las reconciliaciones
     * que app.js debe persistir en Firebase.
     * @param {Array<FavoriteContactRequest|string>} contacts
     * @param {number} [count=5]
     * @returns {Promise<RecentMessagesResult>}
     */
    async function getRecentMessages(contacts, count = 5) {
        if (!runtime.connected)
            throw createWhatsAppUnavailableError();

        try {
            if (await client.getState() !== "CONNECTED")
                throw createWhatsAppUnavailableError();
        } catch (error) {
            if (error.statusCode === 503)
                throw error;

            throw createWhatsAppUnavailableError();
        }

        const requestedContacts = (contacts || [])
            .map(contact => typeof contact === "string"
                ? { id: "", name: "", phone: "", chatId: contact }
                : {
                    id: String(contact?.id || "").trim(),
                    name: String(contact?.name || "").trim(),
                    phone: String(contact?.phone || "").replace(/\D/g, ""),
                    chatId: String(contact?.chatId || "").trim()
                })
            .filter(contact => contact.chatId || contact.phone);
        const messageLimit = Math.min(Math.max(Number(count) || 5, 1), 5);
        const recentMessages = [];
        const reconciledContacts = [];
        const favoriteDiagnosticTargets = [];
        let successfulChats = 0;
        let directFallbackChats = 0;
        let directFallbackHistoryFailures = 0;
        let lastError = null;

        for (const [contactIndex, contact] of requestedContacts.entries()) {
            let result = null;
            let resolvedChatId = null;
            const diagnosticTarget = {
                favoriteIndex: contactIndex + 1,
                hasStoredChatId: Boolean(contact.chatId),
                hasPhone: Boolean(contact.phone),
                candidateChatIds: [],
                phoneResolutionError: null
            };
            favoriteDiagnosticTargets.push(diagnosticTarget);

            if (contact.chatId) {
                diagnosticTarget.candidateChatIds.push(contact.chatId);
                try {
                    result = await fetchRecentMessagesFromChat(contact.chatId, messageLimit, 1);
                    resolvedChatId = contact.chatId;
                } catch (error) {
                    lastError = error;
                }
            }

            if (!result && contact.phone) {
                try {
                    const currentChatIds = await resolveChatIdsByPhone(contact.phone);
                    diagnosticTarget.candidateChatIds.push(...currentChatIds);

                    for (const currentChatId of currentChatIds) {
                        if (result)
                            break;

                        try {
                            const attempts = currentChatId === contact.chatId ? 2 : 3;
                            result = await fetchRecentMessagesFromChat(currentChatId, messageLimit, attempts);
                            resolvedChatId = currentChatId;
                        } catch (error) {
                            lastError = error;
                        }
                    }
                } catch (error) {
                    lastError = error;
                    diagnosticTarget.phoneResolutionError = String(error?.message || error || "Error desconocido");
                }
            }

            if (!result)
                continue;

            for (const message of result.messages) {
                const incomingMessage = await createIncomingMessage(
                    message,
                    result.chatName || contact.name || resolvedChatId,
                    result.usedDirectFallback);

                if (result.usedDirectFallback) {
                    incomingMessage.chatId = resolvedChatId || incomingMessage.chatId;

                    if (contact.phone)
                        incomingMessage.phone = contact.phone;
                }

                recentMessages.push(incomingMessage);
            }

            successfulChats++;

            if (result.usedDirectFallback) {
                directFallbackChats++;

                if (result.historyLoadFailed)
                    directFallbackHistoryFailures++;
            }

            if (contact.id && resolvedChatId && resolvedChatId !== contact.chatId)
                reconciledContacts.push({ id: contact.id, previousChatId: contact.chatId, chatId: resolvedChatId });
        }

        if (requestedContacts.length > 0 && successfulChats === 0) {
            console.warn(
                `No fue posible recuperar mensajes de ninguno de los ${requestedContacts.length} contactos favoritos solicitados.`);
            // Este error suele llegar minificado como "r". La instantánea permite
            // saber si falló Store, IndexedDB, el frame o el socket de WhatsApp.
            await diagnostics.diagnoseFavoriteChats(favoriteDiagnosticTargets);
            await diagnostics.logFunctionalDiagnostics("recuperacion-favoritos-sin-chats-exitosos", lastError);
            recovery.recordFunctionalFailure(lastError);
            const error = createWhatsAppUnavailableError();
            error.cause = lastError;
            throw error;
        }

        if (successfulChats > 0)
            recovery.recordSuccessfulRead();

        if (successfulChats < requestedContacts.length)
            console.warn(`La sincronización de favoritos continuó parcialmente. Chats consultados: ${successfulChats} de ${requestedContacts.length}.`);

        const recoveryMessage = successfulChats === requestedContacts.length
            ? `Recuperación de favoritos completada correctamente. Chats consultados: ${successfulChats}. Mensajes recuperados: ${recentMessages.length}.`
            : `Recuperación parcial de favoritos completada. Chats consultados: ${successfulChats} de ${requestedContacts.length}. Mensajes recuperados: ${recentMessages.length}.`;
        const fallbackDetail = directFallbackChats > 0
            ? ` Fallback directo utilizado en ${directFallbackChats} chat(s); carga histórica limitada en ${directFallbackHistoryFailures}.`
            : "";
        logger.addLog("info", recoveryMessage + fallbackDetail, "WhatsAppGateway");

        return { messages: recentMessages, reconciledContacts, successfulChats, requestedChats: requestedContacts.length };
    }

    function createWhatsAppUnavailableError() {
        const error = new Error("WhatsApp no está disponible temporalmente.");
        error.statusCode = 503;
        return error;
    }

    async function markChatAsRead(chatId) {
        if (!runtime.connected)
            throw new Error("WhatsApp no está conectado.");

        if (!chatId)
            throw new Error("El chat es obligatorio.");

        await client.sendSeen(chatId);
    }

    function normalizePhone(phone) {
        return phone
            .replace(/\D/g, "")
            .replace(/^52(?=1\d{10}$)/, "521");
    }

    function isTransientBrowserError(error) {
        const message = String(error?.message || error || "").toLowerCase();

        return message.includes("detached frame") ||
            message.includes("execution context was destroyed") ||
            message.includes("target closed") ||
            message.includes("protocol error") ||
            message.includes("timed out") ||
            message.includes("timeout") ||
            message.includes("evaluation failed") ||
            message === "r" ||
            message.includes("whatsapp no está conectado");
    }

    async function sendMessageOnce(chatId, phone, text) {
        if (!runtime.connected)
            throw new Error("WhatsApp no está conectado.");

        if (chatId) {
            const sentMessage = await client.sendMessage(chatId, text);
            return { messageId: sentMessage?.id?._serialized || "" };
        }

        phone = phone.replace(/\D/g, "");
        const numberId = await client.getNumberId(phone);

        if (!numberId)
            throw new Error(`El número ${phone} no existe en WhatsApp.`);

        const sentMessage = await client.sendMessage(numberId._serialized, text);
        return { messageId: sentMessage?.id?._serialized || "" };
    }

    /**
     * Envía con reintentos solamente ante cambios transitorios de Puppeteer.
     * @param {string|null} chatId
     * @param {string} phone
     * @param {string} text
     * @returns {Promise<void>}
     */
    async function sendMessage(chatId, phone, text) {
        for (let attempt = 1; attempt <= sendMaxAttempts; attempt++) {
            try {
                const confirmation = await sendMessageOnce(chatId, phone, text);

                if (!confirmation.messageId)
                    throw new Error("WhatsApp Web no devolvió un identificador que confirme el envío.");

                return confirmation;
            } catch (error) {
                const transientError = isTransientBrowserError(error);

                if (!transientError)
                    throw error;

                if (attempt === sendMaxAttempts) {
                    recovery.recordFunctionalFailure(error, functionalFailureThreshold);
                    throw error;
                }

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

    /**
     * @returns {Promise<Array<{name: string, phone: string, chatId: string, source: "WhatsApp"}>>}
     */
    async function getContacts() {
        if (!runtime.connected)
            throw new Error("WhatsApp no está conectado.");

        const contacts = await client.getContacts();

        const uniqueContacts = new Map();

        for (const contact of contacts
            .filter(contact => contact.isMyContact && contact.id && contact.id.user)
            .map(contact => ({
                name: contact.name || contact.pushname || contact.number || contact.id.user,
                phone: contact.id.user,
                chatId: contact.id._serialized,
                source: "WhatsApp"
            }))) {
            const identity = normalizePhone(contact.phone) || contact.chatId;
            const existing = uniqueContacts.get(identity);

            if (!existing || (existing.name === existing.phone && contact.name !== contact.phone))
                uniqueContacts.set(identity, contact);
        }

        return [...uniqueContacts.values()]
            .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    }

    return {
        attachMessageHandler,
        getContacts,
        getPendingMessages,
        getRecentMessages,
        getUnreadMessages,
        markChatAsRead,
        normalizePhone,
        recoverUnreadMessages,
        sendMessage
    };
}

module.exports = { createWhatsAppMessages };
