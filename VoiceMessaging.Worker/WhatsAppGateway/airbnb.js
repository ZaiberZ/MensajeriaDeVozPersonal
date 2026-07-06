const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer");
const config = require("./gateway-config.json");

const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const sessionPath = path.join(dataRoot, "VoiceMessaging", "airbnb-auth");
const airbnbConfig = config.Airbnb ?? {};

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
        return value === null ? airbnbConfig.Enabled === true : value === true;
    } catch (error) {
        console.warn(`No se pudo leer la configuración de Airbnb en Firebase: ${error.message}`);
        return airbnbConfig.Enabled === true;
    }
}

async function setAirbnbEnabled(enabled) {
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
    authenticated = /^https:\/\/(?:www\.)?airbnb\.[^/]+\/hosting\/inbox(?:\/|$|\?)/i.test(url);
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
    if (!await isAirbnbEnabled())
        return [];

    try {
        await navigateToMessages(false);

        if (!authenticated)
            return [];

        // TODO MVP: agregar selectores verificados contra la versión de Airbnb usada
        // por el anfitrión. No se extrae texto con selectores genéricos para evitar
        // registrar como mensajes botones, estados o fragmentos de otras reservas.
        return [];
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
