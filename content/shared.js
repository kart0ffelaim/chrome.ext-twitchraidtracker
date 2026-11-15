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
    showPassiveRaidsOnTooltip: false,
    showBadge: true,
    retentionMonths: 0 //0 = raids are kept forever
};

//raid messages shown by twitch in the chat of the raided channel, group 1 is the raider, group 2 the number of raiders
//add a pattern here to support another twitch language
export const raidMessagePatterns = [
    /^([^\s:<>]{1,50})\s+is raiding with a party of(?:\s+(\d[\d.,\s]*))?/i,
    /^([^\s:<>]{1,50})\s+raidet mit einer Gruppe von(?:\s+(\d[\d.,\s]*))?/i
];

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

export function isChannelLogin(name) {
    return typeof name === "string" && channelLoginPattern.test(name);
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

/**
 * Checks if a text is a raid message and extracts the raider and the number of raiders (null if unknown).
 * Returns null if the text is no raid message.
 */
export function parseRaidMessage(text) {
    if (typeof text !== "string") {
        return null;
    }
    const trimmedText = text.trim();
    for (const pattern of raidMessagePatterns) {
        const matchResult = trimmedText.match(pattern);
        const raider = matchResult ? normalizeChannel(matchResult[1]) : null;
        if (raider) {
            const viewers = parseInt((matchResult[2] || "").replace(/\D/g, ""));
            return {raider, viewers: viewers > 0 ? viewers : null};
        }
    }
    return null;
}

export class Raid {
    constructor(raid_source, raid_target, observation_origin, viewers) {
        debugLog("shared.js:raidConstructor", "new raid created", raid_source, raid_target, observation_origin)
        this.uuid = crypto.randomUUID();
        this.source = normalizeChannel(raid_source) || String(raid_source);
        this.target = normalizeChannel(raid_target) || String(raid_target);
        this.timestamp = new Date().toISOString();
        this.dataOrigin = observation_origin;
        if (Number.isInteger(viewers) && viewers > 0) {
            this.viewers = viewers;
        }
    }
}

function isChatRaid(raid) {
    return raid.dataOrigin === OBSERVATION_ORIGINS.CHAT;
}

/**
 * Removes raids older than the given number of months. 0 months keeps everything.
 */
export function pruneRaids(raids, months, now = new Date()) {
    if (!Number.isInteger(months) || months < 1) {
        return raids;
    }
    const limit = new Date(now);
    limit.setMonth(limit.getMonth() - months);
    return raids.filter(raid => !(new Date(raid.timestamp) < limit));
}

//changes are queued, so two changes shortly after each other do not overwrite each other
let updateQueue = Promise.resolve();

/**
 * Loads the stored raids, applies the change and saves the result. The retention option is applied on every change.
 */
export function updateRaids(change) {
    updateQueue = updateQueue.then(async () => {
        const result = await chrome.storage.local.get(["raids", "retentionMonths"]);
        const raids = pruneRaids(change(result.raids || []), result.retentionMonths ?? option_defaults.retentionMonths);
        await chrome.storage.local.set({raids: raids});
        debugLog("shared.js:updateRaids", `saved ${raids.length} raids`);
    }).catch((err) => console.error("[Raid Tracker] unable to update raids", err));
    return updateQueue;
}

export function saveRaid(source, target, observation_source, viewers) {
    debugLog("shared.js:saveRaid", `Saving Raid ${source} -> ${target} from ${observation_source}`, source, target, observation_source, viewers);
    const raid = new Raid(source, target, observation_source, viewers);
    return updateRaids((raids) => [...raids, raid]);
}

export function deleteRaid(raid) {
    debugLog("shared.js:deleteRaid", "deleting raid", raid);
    return updateRaids((raids) => raids.filter(other => {
        if (raid.uuid) {
            return other.uuid !== raid.uuid;
        }
        return !(other.source === raid.source && other.target === raid.target && other.timestamp === raid.timestamp);
    }));
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
        if (Number.isInteger(entry.viewers) && entry.viewers > 0) {
            raid.viewers = entry.viewers;
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

/**
 * Raids a channel was part of, newest first. Raids seen in chat only count if includeChatRaids is set.
 * incoming are the raids that targeted the channel, outgoing the raids that started at the channel.
 */
export function summarizeChannel(raids, channel, includeChatRaids) {
    const relevant = raids.filter(raid => includeChatRaids || !isChatRaid(raid));
    const byDateDesc = (raidA, raidB) => new Date(raidB.timestamp) - new Date(raidA.timestamp);
    return {
        channel,
        incoming: relevant.filter(raid => String(raid.target).toLowerCase() === channel).sort(byDateDesc),
        outgoing: relevant.filter(raid => String(raid.source).toLowerCase() === channel).sort(byDateDesc)
    };
}

export function describeChannelSummary(summary) {
    const parts = [];
    if (summary.incoming.length > 0) {
        const last = summary.incoming[0];
        parts.push(`Raided here ${summary.incoming.length}x, last from ${last.source} on ${formatRaidTime(last.timestamp)}`);
    }
    if (summary.outgoing.length > 0) {
        parts.push(`Raided away from here ${summary.outgoing.length}x, last to ${summary.outgoing[0].target}`);
    }
    return parts.join(". ");
}

function countBy(raids, getKey) {
    const counts = new Map();
    raids.forEach(raid => {
        const key = getKey(raid);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([name, count]) => ({name, count}))
        .sort((entryA, entryB) => entryB.count - entryA.count || entryA.name.localeCompare(entryB.name));
}

/**
 * Numbers for the stats view: totals, most frequent channels and raids per month (the last monthCount months, oldest first).
 */
export function computeStats(raids, topCount = 5, monthCount = 6, now = new Date()) {
    const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const perMonthCounts = new Map();
    for (let offset = monthCount - 1; offset >= 0; offset--) {
        perMonthCounts.set(monthKey(new Date(now.getFullYear(), now.getMonth() - offset, 1)), 0);
    }
    raids.forEach(raid => {
        const key = monthKey(new Date(raid.timestamp));
        if (perMonthCounts.has(key)) {
            perMonthCounts.set(key, perMonthCounts.get(key) + 1);
        }
    });
    return {
        total: raids.length,
        fromChat: raids.filter(isChatRaid).length,
        channels: new Set(raids.flatMap(raid => [String(raid.source).toLowerCase(), String(raid.target).toLowerCase()])).size,
        topSources: countBy(raids, raid => String(raid.source).toLowerCase()).slice(0, topCount),
        topTargets: countBy(raids, raid => String(raid.target).toLowerCase()).slice(0, topCount),
        perMonth: [...perMonthCounts.entries()].map(([name, count]) => ({name, count}))
    };
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

function createChannelElement(name, className, asLink) {
    const element = document.createElement(asLink && isChannelLogin(name) ? "a" : "span");
    element.className = className;
    element.textContent = name;
    if (element.tagName === "A") {
        element.href = `https://${twitchHostname}/${name}`;
        element.target = "_blank";
        element.rel = "noopener";
    }
    return element;
}

/**
 * Builds the element showing a raid. Uses textContent only, so stored names can never be interpreted as html.
 * options: showOrigin (marks raids seen in chat), links (channel names link to the channel), onDelete (adds a delete button)
 */
export function createRaidElement(raid, options = {}) {
    const item = document.createElement("div");
    item.className = "raid-item";

    const channels = document.createElement("div");
    channels.className = "channels";
    const arrow = document.createElement("span");
    arrow.className = "arrow";
    arrow.textContent = "→";
    channels.append(
        createChannelElement(raid.source, "source", options.links),
        arrow,
        createChannelElement(raid.target, "target", options.links)
    );

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = formatRaidTime(raid.timestamp);
    if (Number.isInteger(raid.viewers) && raid.viewers > 0) {
        time.append(` · ${raid.viewers} ${raid.viewers === 1 ? "raider" : "raiders"}`);
    }
    if (options.showOrigin && isChatRaid(raid)) {
        const warning = document.createElement("span");
        warning.className = "passive-warning";
        warning.textContent = raid.dataOrigin;
        time.append(" ", warning);
    }

    const text = document.createElement("div");
    text.className = "raid-text";
    text.append(channels, time);
    item.append(text);

    if (options.onDelete) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.textContent = "✕";
        deleteBtn.title = "Delete this raid";
        deleteBtn.setAttribute("aria-label", `Delete raid ${raid.source} -> ${raid.target}`);
        //first click arms the button, second click deletes
        deleteBtn.addEventListener("click", () => {
            if (deleteBtn.classList.contains("armed")) {
                options.onDelete(raid);
                return;
            }
            deleteBtn.classList.add("armed");
            deleteBtn.textContent = "Delete?";
            setTimeout(() => {
                deleteBtn.classList.remove("armed");
                deleteBtn.textContent = "✕";
            }, 3000);
        });
        item.append(deleteBtn);
    }
    return item;
}
