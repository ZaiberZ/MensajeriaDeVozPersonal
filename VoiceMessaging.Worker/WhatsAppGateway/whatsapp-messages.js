const logger = require("./logger");

/**
 * Encapsula todas las operaciones que leen o envían contenido. El módulo recibe
 * el estado por referencia para no duplicar una segunda noción de "conectado".
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

    async function fetchRecentMessagesFromChat(chatId, messageLimit, attempts) {
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const chat = await client.getChatById(chatId);

                if (!chat)
                    throw new Error("El chat no está disponible en la sesión actual de WhatsApp.");

                const chatMessages = await chat.fetchMessages({ limit: messageLimit * 10 });
                return {
                    chat,
                    messages: chatMessages.filter(isSupportedIncomingMessage).slice(-messageLimit)
                };
            } catch (error) {
                lastError = error;

                if (attempt < attempts)
                    await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        throw lastError;
    }

    /**
     * WhatsApp migra algunos contactos de PN (@c.us) a LID. Se prueban ambos
     * identificadores para conservar favoritos creados antes de esa migración.
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
        let successfulChats = 0;
        let lastError = null;

        for (const contact of requestedContacts) {
            let result = null;
            let resolvedChatId = null;

            if (contact.chatId) {
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
                }
            }

            if (!result) {
                console.warn(`No fue posible recuperar los mensajes recientes del contacto favorito ${contact.name || contact.phone || contact.chatId}:`);
                console.warn(lastError);
                continue;
            }

            for (const message of result.messages)
                recentMessages.push(await createIncomingMessage(message, result.chat.name || contact.name || resolvedChatId));

            successfulChats++;

            if (contact.id && resolvedChatId && resolvedChatId !== contact.chatId)
                reconciledContacts.push({ id: contact.id, previousChatId: contact.chatId, chatId: resolvedChatId });
        }

        if (requestedContacts.length > 0 && successfulChats === 0) {
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
        logger.addLog("info", recoveryMessage, "WhatsAppGateway");

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

    async function getContacts() {
        if (!runtime.connected)
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
