const fs = require("fs");
const path = require("path");

process.env.PUPPETEER_CACHE_DIR = path.join(__dirname, ".cache");

function getBundledChromeCandidate() {
    const cachePath = path.join(__dirname, ".cache", "chrome");
    const missingFiles = [];

    if (!fs.existsSync(cachePath))
        return { chromePath: null, missingFiles };

    const versions = fs.readdirSync(cachePath);

    for (const version of versions) {
        const chromePath = path.join(cachePath, version, "chrome-win64", "chrome.exe");

        if (!fs.existsSync(chromePath))
            continue;

        const icuDataPath = path.join(path.dirname(chromePath), "icudtl.dat");

        if (fs.existsSync(icuDataPath))
            return { chromePath, missingFiles };

        missingFiles.push(icuDataPath);
    }

    return { chromePath: null, missingFiles };
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

        console.log(`Chrome seleccionado (CHROME_EXECUTABLE_PATH): ${configuredPath}`);
        return configuredPath;
    }

    const bundledChrome = getBundledChromeCandidate();

    if (bundledChrome.chromePath) {
        console.log(`Chrome seleccionado (empaquetado): ${bundledChrome.chromePath}`);
        return bundledChrome.chromePath;
    }

    const installedChromePath = getInstalledChromePath();

    if (installedChromePath) {
        console.log(`Chrome seleccionado (instalado): ${installedChromePath}`);
        return installedChromePath;
    }

    for (const missingFile of bundledChrome.missingFiles)
        console.warn(`La instalacion empaquetada de Chrome esta incompleta; falta: ${missingFile}`);

    throw new Error(
        "No se encontro una instalacion completa de Chrome. Define CHROME_EXECUTABLE_PATH o reinstala Chrome dentro de WhatsAppGateway\\.cache.");
}

module.exports = {
    getChromePath
};
