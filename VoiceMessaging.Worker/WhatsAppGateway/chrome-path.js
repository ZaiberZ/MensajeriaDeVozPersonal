const fs = require("fs");
const path = require("path");

process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, ".cache");

function getBundledChromePath() {
    const cachePath = path.join(__dirname, ".cache", "chrome");

    if (!fs.existsSync(cachePath))
        return null;

    const versions = fs.readdirSync(cachePath);

    for (const version of versions) {
        const chromePath = path.join(cachePath, version, "chrome-win64", "chrome.exe");

        if (!fs.existsSync(chromePath))
            continue;

        const icuDataPath = path.join(path.dirname(chromePath), "icudtl.dat");

        if (fs.existsSync(icuDataPath))
            return chromePath;

        console.warn(`La instalacion empaquetada de Chrome esta incompleta; falta: ${icuDataPath}`);
    }

    return null;
}

function getInstalledChromePath() {
    const candidates = [
        process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
        process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
    ].filter(Boolean);

    return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function getChromePath() {
    const configuredPath = process.env.CHROME_EXECUTABLE_PATH?.trim();

    if (configuredPath) {
        if (!fs.existsSync(configuredPath))
            throw new Error(`CHROME_EXECUTABLE_PATH no existe: ${configuredPath}`);

        return configuredPath;
    }

    const bundledChromePath = getBundledChromePath();

    if (bundledChromePath)
        return bundledChromePath;

    const installedChromePath = getInstalledChromePath();

    if (installedChromePath)
        return installedChromePath;

    throw new Error(
        "No se encontro una instalacion completa de Chrome. Define CHROME_EXECUTABLE_PATH o reinstala Chrome dentro de WhatsAppGateway\\.cache.");
}

module.exports = {
    getChromePath
};
