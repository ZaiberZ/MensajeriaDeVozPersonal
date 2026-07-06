const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer");
const config = require("./gateway-config.json");

const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const sessionPath = path.join(dataRoot, "VoiceMessaging", "airbnb-auth");
const airbnbConfig = config.Airbnb ?? {};
const airbnbMessageSelectors = {
    inbox: '[data-testid="inbox-container-marker"] #list_inbox',
    threadLinks: '[data-testid="inbox-container-marker"] #list_inbox a[data-testid^="inbox_list_"]',
    messageList: '[data-testid="message-list"]',
    messageNodes: '[data-testid="message-list"] [role="group"][data-item-id] .t12j2ntd'
};

let browser = null;
let page = null;
let authenticated = false;
let getUser = () => null;

function configure(options = {}) {
    if (typeof options.getUser === "function")
        getUser = options.getUser;
}

function getUserId() {
    return String(getUser()?.Phone ?? "").replace(/\D/g, "");
}

function getEnabledUrl() {
    const userId = getUserId();

    if (!userId)
        return null;

    return `${config.FirebaseBaseUrl}/usuarios/${userId}/configuracion/airbnb/enabled.json`;
}

async function isAirbnbEnabled() {
    const enabledUrl = getEnabledUrl();

    if (!enabledUrl)
        return airbnbConfig.Enabled === true;

    try {
        const response = await fetch(enabledUrl, { signal: AbortSignal.timeout(5000) });

        if (!response.ok)
            throw new Error(`Firebase respondió HTTP ${response.status}.`);

        const value = await response.json();
        if (value === null && airbnbConfig.Enabled === true) {
            await writeAirbnbEnabled(true);
            return true;
        }

        return value === true;
    } catch (error) {
        console.warn(`No se pudo leer la configuración de Airbnb en Firebase: ${error.message}`);
        return airbnbConfig.Enabled === true;
    }
}

async function writeAirbnbEnabled(enabled) {
    const enabledUrl = getEnabledUrl();

    if (!enabledUrl)
        throw new Error("Registra primero el teléfono del usuario.");

    const response = await fetch(enabledUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabled === true),
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok)
        throw new Error(`Firebase respondió HTTP ${response.status}.`);
}

async function setAirbnbEnabled(enabled) {
    await writeAirbnbEnabled(enabled);

    if (enabled === true)
        await startAirbnb();
    else
        await stopAirbnb();

    return getAirbnbStatus();
}

function isBrowserRunning() {
    return browser?.connected === true && page && !page.isClosed();
}

function getLaunchOptions(visible = false) {
    const options = {
        headless: visible ? false : airbnbConfig.Headless === true,
        userDataDir: sessionPath,
        defaultViewport: null,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
    };

    if (process.env.CHROME_EXECUTABLE_PATH)
        options.executablePath = process.env.CHROME_EXECUTABLE_PATH;

    return options;
}

async function ensureBrowser(visible = false) {
    if (isBrowserRunning())
        return page;

    fs.mkdirSync(sessionPath, { recursive: true });
    browser = await puppeteer.launch(getLaunchOptions(visible));
    const pages = await browser.pages();
    page = pages[0] ?? await browser.newPage();

    browser.on("disconnected", () => {
        browser = null;
        page = null;
        authenticated = false;
    });

    return page;
}

function updateAuthenticationFromUrl(url) {
    authenticated = /^https:\/\/(?:www\.)?airbnb\.[^/]+\/hosting\/messages(?:\/|$|\?)/i.test(url);
    console.log("Url de Airbnb:", url, "Autenticado:", authenticated);
    return authenticated;
}

async function navigateToMessages(visible = false) {
    const currentPage = await ensureBrowser(visible);
    await currentPage.goto(airbnbConfig.MessagesUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    updateAuthenticationFromUrl(currentPage.url());
    return currentPage;
}

async function startAirbnb() {
    if (!await isAirbnbEnabled())
        return getAirbnbStatus();

    try {
        await navigateToMessages(false);
    } catch (error) {
        authenticated = false;
        console.error("No se pudo iniciar Airbnb:");
        console.error(error);
    }

    return getAirbnbStatus();
}

async function stopAirbnb() {
    if (browser?.connected)
        await browser.close();

    browser = null;
    page = null;
    authenticated = false;
}

async function getAirbnbStatus() {
    const enabled = await isAirbnbEnabled();

    if (isBrowserRunning())
        updateAuthenticationFromUrl(page.url());

    return {
        enabled,
        running: isBrowserRunning(),
        authenticated: enabled && authenticated,
        loginRequired: enabled && !authenticated
    };
}

async function openAirbnbLogin() {
    if (!await isAirbnbEnabled())
        throw new Error("Airbnb está deshabilitado.");

    try {
        const currentPage = await navigateToMessages(true);

        if (!authenticated && !/airbnb\.[^/]+\/login/i.test(currentPage.url()))
            await currentPage.goto(airbnbConfig.LoginUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

        await currentPage.bringToFront();
    } catch (error) {
        console.error("No se pudo abrir el inicio de sesión de Airbnb:");
        console.error(error);
        throw error;
    }
}

async function getAirbnbMessages() {
    console.log("Airbnb mensajes: iniciando lectura.");

    if (!await isAirbnbEnabled()) {
        console.log("Airbnb mensajes: integración deshabilitada; no se consultan mensajes.");
        return [];
    }

    try {
        await navigateToMessages(false);
        console.log("Airbnb mensajes: URL después de navegar:", page.url());

        if (!authenticated) {
            console.log("Airbnb mensajes: no hay sesión válida en /hosting/messages/; no se consultan mensajes.");
            return [];
        }

        // Este extractor no distingue leídos contra no leídos: lee los mensajes visibles
        // de los hilos que Airbnb carga en la lista y el Worker evita duplicados en Firebase.
        console.log("Airbnb mensajes: esperando lista de conversaciones:", airbnbMessageSelectors.inbox);
        await page.waitForSelector(airbnbMessageSelectors.inbox, { timeout: 15000 });

        const threadIds = await page.$$eval(
            airbnbMessageSelectors.threadLinks,
            links => links.map(link => link.dataset.testid)
        );
        console.log(`Airbnb mensajes: hilos detectados=${threadIds.length}.`);

        if (threadIds.length === 0) {
            const selectorSnapshot = await page.evaluate(selectors => ({
                inboxExists: document.querySelector(selectors.inbox) !== null,
                threadLinkCount: document.querySelectorAll(selectors.threadLinks).length,
                bodyTextStart: document.body?.innerText?.slice(0, 500) ?? ""
            }), airbnbMessageSelectors);
            console.log("Airbnb mensajes: no se detectaron hilos. Snapshot:", JSON.stringify(selectorSnapshot));
        }

        const messages = [];

        for (const threadTestId of threadIds) {
            const threadSelector = `[data-testid="${threadTestId}"]`;
            console.log(`Airbnb mensajes: abriendo hilo ${threadTestId}.`);
            await page.click(threadSelector);
            await page.waitForFunction(
                selector => document.querySelector(selector)?.closest('[data-listrow="true"]')?.getAttribute("aria-current") === "true",
                { timeout: 15000 },
                threadSelector
            );
            await page.waitForSelector(airbnbMessageSelectors.messageList, { timeout: 15000 });

            const chatId = threadTestId.substring("inbox_list_".length);
            const threadResult = await page.$$eval(
                airbnbMessageSelectors.messageNodes,
                (messageNodes, selectedChatId) => messageNodes.map(messageNode => {
                    const messageGroup = messageNode.closest('[role="group"][data-item-id]');
                    const label = messageGroup?.getAttribute("aria-label") ?? "";
                    const sentAtMatch = label.match(/\. Sent (.+)$/);
                    const sentAt = Date.parse(sentAtMatch?.[1] ?? "");
                    const sender = messageGroup?.querySelector('span[aria-label^="Sent by "]')?.textContent?.trim() ?? "";
                    const text = messageNode.innerText.trim();

                    if (!sender || /^(?:You|Tú)$/i.test(sender) || !text || !Number.isFinite(sentAt))
                        return {
                            skipped: true,
                            reason: !sender ? "sin remitente" : /^(?:You|Tú|TÃº)$/i.test(sender) ? "mensaje propio" : !text ? "sin texto" : "fecha inválida",
                            label: label.slice(0, 200),
                            sender,
                            textStart: text.slice(0, 120)
                        };

                    return {
                        skipped: false,
                        chatId: selectedChatId,
                        sender,
                        text,
                        date: new Date(sentAt).toISOString()
                    };
                }),
                chatId
            );
            const threadMessages = threadResult.filter(message => !message.skipped).map(({ skipped, ...message }) => message);
            const skippedMessages = threadResult.filter(message => message.skipped);

            console.log(`Airbnb mensajes: hilo ${chatId}: nodos=${threadResult.length}, guardables=${threadMessages.length}, descartados=${skippedMessages.length}.`);

            if (threadResult.length === 0) {
                const threadSnapshot = await page.evaluate(selectors => ({
                    messageListExists: document.querySelector(selectors.messageList) !== null,
                    groupCount: document.querySelectorAll(`${selectors.messageList} [role="group"][data-item-id]`).length,
                    messageNodeCount: document.querySelectorAll(selectors.messageNodes).length,
                    panelTextStart: document.querySelector(selectors.messageList)?.innerText?.slice(0, 500) ?? ""
                }), airbnbMessageSelectors);
                console.log(`Airbnb mensajes: hilo ${chatId}: no hubo nodos de mensaje. Snapshot:`, JSON.stringify(threadSnapshot));
            } else if (skippedMessages.length > 0) {
                console.log(`Airbnb mensajes: hilo ${chatId}: descartes muestra:`, JSON.stringify(skippedMessages.slice(0, 3)));
            }

            messages.push(...threadMessages);
        }

        console.log(`Se leyeron ${messages.length} mensajes de Airbnb.`);

        return messages;
    } catch (error) {
        console.error("No se pudieron leer los mensajes de Airbnb:");
        console.error(error);
        return [];
    }
}

async function sendAirbnbMessage(chatId, text) {
    if (!chatId?.trim() || !text?.trim())
        return { success: false, message: "chatId and text are required" };

    if (!await isAirbnbEnabled())
        return { success: false, message: "Airbnb is disabled" };

    // TODO MVP: implementar cuando se hayan verificado el URL estable de cada hilo
    // y el selector del editor. Es preferible no enviar a una conversación incorrecta.
    return { success: false, message: "Airbnb send not implemented yet" };
}

module.exports = {
    configure,
    startAirbnb,
    getAirbnbStatus,
    openAirbnbLogin,
    getAirbnbMessages,
    sendAirbnbMessage,
    setAirbnbEnabled
};
