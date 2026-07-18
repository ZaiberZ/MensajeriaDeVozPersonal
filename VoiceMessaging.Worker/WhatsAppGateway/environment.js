const fs = require("fs");
const os = require("os");
const path = require("path");

function loadEnvironment() {
    const candidates = [
        path.join(__dirname, ".env.local"),
        path.resolve(__dirname, "..", "..", ".env.local"),
        path.join(process.env.PROGRAMDATA || path.join(os.homedir(), "AppData", "Local"), "VoiceMessaging", "environment.env")
    ];
    const filePath = candidates.find(candidate => fs.existsSync(candidate));

    if (!filePath)
        return;

    for (const line of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;

        const separator = trimmed.indexOf("=");
        if (separator <= 0)
            continue;

        const name = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();

        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
            value = value.slice(1, -1).replace(/\\"/g, '"');

        if (!process.env[name])
            process.env[name] = value;
    }
}

function requireEnvironment(name) {
    const value = process.env[name]?.trim();

    if (!value)
        throw new Error(`Falta la variable de entorno requerida ${name}.`);

    return value;
}

loadEnvironment();

module.exports = { requireEnvironment };
