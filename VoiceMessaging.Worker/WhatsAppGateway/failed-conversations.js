const fs = require("fs");
const os = require("os");
const path = require("path");

const dataRoot = process.env.VOICE_MESSAGING_DATA_DIR || process.env.PROGRAMDATA || process.env.LOCALAPPDATA || os.tmpdir();
const dataDirectory = path.join(dataRoot, "VoiceMessaging");
const filePath = path.join(dataDirectory, "failed-conversations.json");
const retentionMilliseconds = 15 * 24 * 60 * 60 * 1000;

function ensureFile() {
    fs.mkdirSync(dataDirectory, { recursive: true });

    if (!fs.existsSync(filePath))
        fs.writeFileSync(filePath, "[]", "utf8");
}

function readAll() {
    try {
        ensureFile();
        const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

function writeAll(items) {
    ensureFile();
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf8");
}

function isWithinRetention(item) {
    const timestamp = Date.parse(item?.updatedAt || item?.startedAt || item?.copiedAt || "");
    return Number.isFinite(timestamp) && timestamp >= Date.now() - retentionMilliseconds;
}

function normalizeTrace(value, previous) {
    return {
        id: String(value?.id || "").trim(),
        operation: value?.operation === "new_message" ? "new_message" : "reply",
        recipient: String(value?.recipient || "").trim(),
        startedAt: value?.startedAt || null,
        updatedAt: value?.updatedAt || null,
        status: String(value?.status || "").trim(),
        sessionId: String(value?.sessionId || "").trim(),
        turns: Array.isArray(value?.turns) ? value.turns.map(turn => String(turn)).slice(0, 50) : [],
        isNew: previous ? previous.isNew === true : true,
        copiedAt: previous?.copiedAt || new Date().toISOString()
    };
}

function sync(values) {
    const previousById = new Map(readAll().map(item => [item.id, item]));
    const incoming = Array.isArray(values) ? values : [];
    const items = incoming
        .filter(value => String(value?.id || "").trim())
        .map(value => normalizeTrace(value, previousById.get(String(value.id).trim())));
    const retainedItems = items.filter(isWithinRetention);
    writeAll(retainedItems);
    return { count: retainedItems.length, newCount: retainedItems.filter(item => item.isNew).length };
}

function acknowledge() {
    const items = readAll();
    let updatedCount = 0;

    for (const item of items) {
        if (item.isNew) {
            item.isNew = false;
            updatedCount++;
        }
    }

    if (updatedCount > 0)
        writeAll(items);

    return updatedCount;
}

function getSummary() {
    const allItems = readAll();
    const conversations = allItems.filter(isWithinRetention).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));

    if (conversations.length !== allItems.length)
        writeAll(conversations);

    return {
        file: filePath,
        count: conversations.length,
        newCount: conversations.filter(item => item.isNew).length,
        conversations
    };
}

module.exports = { acknowledge, filePath, getSummary, sync };
