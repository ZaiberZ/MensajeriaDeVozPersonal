const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const MAX_LOG_ENTRIES = 1000;
const MAX_DETAIL_VARIANTS_PER_MESSAGE = 3;
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
        if (!Array.isArray(logs))
            return [];

        const { normalizedLogs, changed } = normalizeLogs(logs);

        if (changed)
            fs.writeFileSync(logFilePath, JSON.stringify(normalizedLogs, null, 2), "utf8");

        return normalizedLogs;
    } catch (error) {
        originalConsoleError("No fue posible leer el archivo de logs:", error);
        return [];
    }
}

function createLogId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localIsoTimestamp(date = new Date()) {
    const pad = (value, length = 2) => String(value).padStart(length, "0");
    const offsetMinutes = -date.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteOffset = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absoluteOffset / 60));
    const offsetRemainingMinutes = pad(absoluteOffset % 60);

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
        `${offsetSign}${offsetHours}:${offsetRemainingMinutes}`;
}

function normalizeLogs(logs) {
    let changed = false;

    const normalizedLogs = logs.map(log => {
        const normalizedLog = { ...log };

        if (!normalizedLog.id) {
            normalizedLog.id = createLogId();
            changed = true;
        }

        if (!Object.hasOwn(normalizedLog, "reportedAt")) {
            normalizedLog.reportedAt = null;
            changed = true;
        }

        if (!Object.hasOwn(normalizedLog, "detail")) {
            normalizedLog.detail = null;
            changed = true;
        }

        return normalizedLog;
    });

    return { normalizedLogs, changed };
}

function writeLog(level, message, detail = null, source = "WhatsAppGateway") {
    try {
        const logs = readLogs();
        const timestamp = localIsoTimestamp();
        const exactDuplicateIndexes = [];
        const variantIndexes = new Map();

        for (let index = 0; index < logs.length; index++) {
            const log = logs[index];

            if (log.level !== level || log.source !== source || log.message !== message)
                continue;

            const detailKey = log.detail || null;
            const indexes = variantIndexes.get(detailKey) || [];
            indexes.push(index);
            variantIndexes.set(detailKey, indexes);

            if (detailKey === (detail || null))
                exactDuplicateIndexes.push(index);
        }

        const lastExactDuplicateIndex = exactDuplicateIndexes[exactDuplicateIndexes.length - 1];
        const previousAttemptCount = lastExactDuplicateIndex === undefined
            ? 0
            : Number(logs[lastExactDuplicateIndex].attemptCount || 1);

        const entry = {
            id: createLogId(),
            timestamp,
            level,
            source,
            message,
            detail,
            attemptCount: previousAttemptCount + 1,
            lastAttemptAt: timestamp,
            reportedAt: null
        };
        let savedEntry = entry;

        if (lastExactDuplicateIndex !== undefined) {
            savedEntry = {
                ...logs[lastExactDuplicateIndex],
                attemptCount: entry.attemptCount,
                lastAttemptAt: timestamp,
                reportedAt: null
            };
            for (const index of [...exactDuplicateIndexes].sort((left, right) => right - left))
                logs.splice(index, 1);

            logs.push(savedEntry);
        } else {
            if (variantIndexes.size >= MAX_DETAIL_VARIANTS_PER_MESSAGE) {
                const oldestVariantIndexes = [...variantIndexes.values()]
                    .sort((left, right) => left[0] - right[0])[0];

                for (const index of [...oldestVariantIndexes].sort((left, right) => right - left))
                    logs.splice(index, 1);
            }

            logs.push(entry);
        }

        fs.writeFileSync(logFilePath, JSON.stringify(logs.slice(-MAX_LOG_ENTRIES), null, 2), "utf8");

        return savedEntry;
    } catch (error) {
        originalConsoleError("No fue posible guardar el log:", error);
        return null;
    }
}

function addLog(level, message, source = "External", detail = null) {
    const normalizedLevel = level?.toLowerCase();

    if (!["error", "warning", "info"].includes(normalizedLevel))
        throw new Error("El nivel debe ser error, warning o info.");

    if (typeof message !== "string" || !message.trim())
        throw new Error("El mensaje del log es obligatorio.");

    const normalizedDetail = typeof detail === "string" && detail.trim() ? detail.trim() : null;
    return writeLog(normalizedLevel, message.trim(), normalizedDetail, source);
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

function splitLogArguments(args) {
    if (args.length === 0)
        return { message: "Log sin mensaje.", detail: null };

    const first = args[0];

    if (first instanceof Error) {
        return {
            message: first.message || first.name || "Error sin mensaje.",
            detail: first.stack || formatArguments(args)
        };
    }

    const message = typeof first === "string" ? first.trim() : formatArguments([first]);
    const detail = args.length > 1 ? formatArguments(args.slice(1)) : null;
    return { message: message || "Log sin mensaje.", detail };
}

function installConsoleCapture() {
    if (consoleCaptureInstalled)
        return;

    consoleCaptureInstalled = true;

    console.error = (...args) => {
        const { message, detail } = splitLogArguments(args);
        writeLog("error", message, detail);
        originalConsoleError(...args);
    };
    console.warn = (...args) => {
        const { message, detail } = splitLogArguments(args);
        writeLog("warning", message, detail);
        originalConsoleWarn(...args);
    };
}

function getLogs(level, limit = 200) {
    const normalizedLevels = level?.toLowerCase().split(",").map(value => value.trim()).filter(Boolean);
    const logs = readLogs();
    const filteredLogs = normalizedLevels?.length ? logs.filter(log => normalizedLevels.includes(log.level)) : logs;

    return filteredLogs.slice(-limit).reverse();
}

function getUnreportedErrorLogs(limit = 100) {
    const logs = readLogs();
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), MAX_LOG_ENTRIES) : 100;
    const unreportedLogs = logs.filter(log => log.level === "error" && !log.reportedAt);
    const latestLogs = unreportedLogs.slice(-safeLimit).reverse();

    return {
        count: unreportedLogs.length,
        allIds: unreportedLogs.map(log => log.id).filter(Boolean),
        logs: latestLogs
    };
}

function markLogsReported(ids) {
    if (!Array.isArray(ids) || ids.length === 0)
        return 0;

    const idSet = new Set(ids.filter(id => typeof id === "string" && id.trim()).map(id => id.trim()));

    if (idSet.size === 0)
        return 0;

    const logs = readLogs();
    const reportedAt = localIsoTimestamp();
    let updatedCount = 0;

    for (const log of logs) {
        if (idSet.has(log.id) && !log.reportedAt) {
            log.reportedAt = reportedAt;
            updatedCount++;
        }
    }

    fs.writeFileSync(logFilePath, JSON.stringify(logs.slice(-MAX_LOG_ENTRIES), null, 2), "utf8");

    return updatedCount;
}

function clearLogs() {
    ensureLogFile();
    fs.writeFileSync(logFilePath, "[]", "utf8");
}

module.exports = {
    addLog,
    clearLogs,
    getLogs,
    getUnreportedErrorLogs,
    installConsoleCapture,
    logFilePath,
    markLogsReported
};
