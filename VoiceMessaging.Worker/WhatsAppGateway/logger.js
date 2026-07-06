const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const MAX_LOG_ENTRIES = 1000;
const MAX_DUPLICATE_ENTRIES = 5;
const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const logFilePath = path.join(dataDirectory, "gateway-logs.json");

let consoleCaptureInstalled = false;
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

function ensureLogFile() {
    fs.mkdirSync(dataDirectory, { recursive: true });

    if (!fs.existsSync(logFilePath))
        fs.writeFileSync(logFilePath, "[]", "utf8");
}

function readLogs() {
    try {
        ensureLogFile();
        const content = fs.readFileSync(logFilePath, "utf8");
        const logs = JSON.parse(content);
        return Array.isArray(logs) ? logs : [];
    } catch (error) {
        originalConsoleError("No fue posible leer el archivo de logs:", error);
        return [];
    }
}

function writeLog(level, args, source = "WhatsAppGateway") {
    try {
        const logs = readLogs();
        const timestamp = new Date().toISOString();
        const message = formatArguments(args);
        const duplicateIndexes = [];

        for (let index = 0; index < logs.length; index++) {
            const log = logs[index];

            if (log.level === level && log.source === source && log.message === message)
                duplicateIndexes.push(index);
        }

        const lastDuplicateIndex = duplicateIndexes[duplicateIndexes.length - 1];
        const previousAttemptCount = lastDuplicateIndex === undefined
            ? 0
            : logs[lastDuplicateIndex].attemptCount;

        const entry = {
            timestamp,
            level,
            source,
            message,
            attemptCount: previousAttemptCount + 1,
            lastAttemptAt: timestamp
        };
        let savedEntry = entry;

        if (duplicateIndexes.length < MAX_DUPLICATE_ENTRIES) {
            logs.push(entry);
        } else {
            savedEntry = {
                ...logs[lastDuplicateIndex],
                attemptCount: entry.attemptCount,
                lastAttemptAt: timestamp
            };
            logs.splice(lastDuplicateIndex, 1);
            logs.push(savedEntry);
        }

        fs.writeFileSync(logFilePath, JSON.stringify(logs.slice(-MAX_LOG_ENTRIES), null, 2), "utf8");

        return savedEntry;
    } catch (error) {
        originalConsoleError("No fue posible guardar el log:", error);
        return null;
    }
}

function addLog(level, message, source = "External") {
    const normalizedLevel = level?.toLowerCase();

    if (!["error", "warning"].includes(normalizedLevel))
        throw new Error("El nivel debe ser error o warning.");

    if (typeof message !== "string" || !message.trim())
        throw new Error("El mensaje del log es obligatorio.");

    return writeLog(normalizedLevel, [message.trim()], source);
}

function formatArguments(args) {
    return args.map(value => {
        if (value instanceof Error)
            return value.stack || value.message;

        if (typeof value === "string")
            return value;

        return util.inspect(value, {
            depth: 5,
            breakLength: Infinity
        });
    }).join(" ");
}

function installConsoleCapture() {
    if (consoleCaptureInstalled)
        return;

    consoleCaptureInstalled = true;

    console.error = (...args) => { writeLog("error", args); originalConsoleError(...args); };
    console.warn = (...args) => { writeLog("warning", args); originalConsoleWarn(...args); };
}

function getLogs(level, limit = 200) {
    const normalizedLevel = level?.toLowerCase();
    const logs = readLogs();
    const filteredLogs = normalizedLevel ? logs.filter(log => log.level === normalizedLevel) : logs;

    return filteredLogs.slice(-limit).reverse();
}

function clearLogs() {
    ensureLogFile();
    fs.writeFileSync(logFilePath, "[]", "utf8");
}

module.exports = {
    addLog,
    clearLogs,
    getLogs,
    installConsoleCapture,
    logFilePath
};
