export const OBSERVATION_ORIGINS = Object.freeze({
    CHAT: "chat", RAID: "raid"
});

//ignores all subpaths not linking to channels
export const ignoredPaths = ["u", "privacy", "settings", "subscriptions", "drops", "wallet", "search", "directory", "downloads", "p", "jobs", "turbo", "videos", "moderator", "popout", "embed", "team", "store", "prime", "friends", "inventory", "payments", "messages", "bits", "checkout", "broadcast", "partner", "creatorcamp", "event", "events", "collections", "annual-recap", "login", "signup", "user"];
export const twitchHostname = "www.twitch.tv"; //ignores [dashboard | appeals | blog | dev | careers | safety | legal | help].twitch.tv
export const option_defaults = {
    debugMode: false,
    tooltipItemNumber: 5,
    overviewPageSize: 15,
    trackPassiveRaids: false,
    showPassiveRaidsOnTooltip: false
};

const channelLoginPattern = /^[a-z0-9_]{1,25}$/;
const maxChannelNameLength = 50;

//the debug flag is cached, so a log call does not need a storage read every time
let debugMode = option_defaults.debugMode;
const debugModeLoaded = chrome.storage.local.get(["debugMode"])
    .then((result) => {
        debugMode = !!result.debugMode;
    })
    .catch(() => {
    });
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.debugMode) {
        debugMode = !!changes.debugMode.newValue;
    }
});

export function debugLog(origin, message, ...args) {
    debugModeLoaded.then(() => {
        if (debugMode) {
            console.log(`[Raid Tracker][${origin}] ${message}`, args);
        }
    });
}

/**
 * Channel names are compared case-insensitive, so they are stored in lower case.
 * Returns null if the value is not usable as a channel name.
 */
export function normalizeChannel(name) {
    if (typeof name !== "string") {
        return null;
    }
    const channel = name.trim().toLowerCase();
    if (channel.length < 1 || channel.length > maxChannelNameLength) {
        return null;
    }
    return channel;
}

/**
 * Extracts the channel name from a twitch url.
 * Returns null if the url does not point to a channel.
 */
export function channelFromUrl(url, base) {
    if (!url) {
        return null;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(url, base);
    } catch (err) {
        return null;
    }
    if (parsedUrl.hostname !== twitchHostname) {
        return null;
    }
    const subPath = (parsedUrl.pathname.split('/')[1] || "").toLowerCase();
    if (!channelLoginPattern.test(subPath) || ignoredPaths.includes(subPath)) {
        return null;
    }
    return subPath;
}

export class Raid {
    constructor(raid_source, raid_target, observation_origin) {
        debugLog("shared.js:raidConstructor", "new raid created", raid_source, raid_target, observation_origin)
        this.uuid = crypto.randomUUID();
        this.source = normalizeChannel(raid_source) || String(raid_source);
        this.target = normalizeChannel(raid_target) || String(raid_target);
        this.timestamp = new Date().toISOString();
        this.dataOrigin = observation_origin;
    }
}

//saves are queued, so two raids saved shortly after each other do not overwrite each other
let saveQueue = Promise.resolve();

export function saveRaid(source, target, observation_source) {
    debugLog("shared.js:saveRaid", `Saving Raid ${source} -> ${target} from ${observation_source}`, source, target, observation_source);
    const raid = new Raid(source, target, observation_source);
    saveQueue = saveQueue.then(async () => {
        const result = await chrome.storage.local.get(["raids"]);
        const raids = result.raids || [];
        debugLog("shared.js:saveRaid", `Loaded ${raids.length} raids from storage`);
        raids.push(raid);
        debugLog("shared.js:saveRaid", `added raid`, raid);
        await chrome.storage.local.set({raids: raids});
        debugLog("shared.js:saveRaid", `saved ${raids.length} raids`);
    }).catch((err) => console.error("[Raid Tracker] unable to save raid", err));
    return saveQueue;
}

/**
 * Validates imported data and converts it to clean raid objects.
 * Entries that are not usable as a raid are skipped.
 */
export function sanitizeImportedRaids(data) {
    if (!Array.isArray(data)) {
        throw new Error("File contains invalid or corrupted data");
    }
    const raids = [];
    let skipped = 0;
    const knownOrigins = Object.values(OBSERVATION_ORIGINS);
    for (const entry of data) {
        const source = normalizeChannel(entry?.source);
        const target = normalizeChannel(entry?.target);
        const time = typeof entry?.timestamp === "string" ? new Date(entry.timestamp) : null;
        if (!source || !target || !time || isNaN(time.getTime())) {
            skipped++;
            continue;
        }
        const raid = {
            uuid: typeof entry.uuid === "string" && entry.uuid.length > 0 ? entry.uuid : crypto.randomUUID(),
            source: source,
            target: target,
            timestamp: time.toISOString()
        };
        if (knownOrigins.includes(entry.dataOrigin)) {
            raid.dataOrigin = entry.dataOrigin;
        }
        raids.push(raid);
    }
    return {raids, skipped};
}

/**
 * Merges two raid lists to one list sorted by date (oldest first) without duplicates.
 * A raid is a duplicate if the uuid or the combination of source, target and timestamp is already known.
 */
export function mergeRaids(existingRaids, newRaids) {
    const raids = [...existingRaids, ...newRaids];
    raids.sort((raidA, raidB) => new Date(raidA.timestamp) - new Date(raidB.timestamp));
    const knownUuids = new Set();
    const knownContents = new Set();
    return raids.filter((raid) => {
        const content = `${String(raid.source).toLowerCase()}|${String(raid.target).toLowerCase()}|${raid.timestamp}`;
        if ((raid.uuid && knownUuids.has(raid.uuid)) || knownContents.has(content)) {
            return false;
        }
        if (raid.uuid) {
            knownUuids.add(raid.uuid);
        }
        knownContents.add(content);
        return true;
    });
}

export function formatRaidTime(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

/**
 * Builds the element showing a raid. Uses textContent only, so stored names can never be interpreted as html.
 */
export function createRaidElement(raid, showOrigin) {
    const item = document.createElement("div");
    item.className = "raid-item";

    const channels = document.createElement("div");
    const source = document.createElement("span");
    source.className = "source";
    source.textContent = raid.source;
    const target = document.createElement("span");
    target.className = "target";
    target.textContent = raid.target;
    channels.append(source, " -> ", target);

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = formatRaidTime(raid.timestamp);
    if (showOrigin && raid.dataOrigin === OBSERVATION_ORIGINS.CHAT) {
        const warning = document.createElement("span");
        warning.className = "passive-warning";
        warning.textContent = raid.dataOrigin;
        time.append(" ", warning);
    }

    item.append(channels, time);
    return item;
}
