import {
    channelFromUrl,
    debugLog,
    describeChannelSummary,
    option_defaults,
    saveRaid,
    summarizeChannel,
    updateRaids,
    OBSERVATION_ORIGINS
} from "../shared.js";

const twitchTabsQuery = {url: "*://www.twitch.tv/*"};
const defaultActionTitle = chrome.runtime.getManifest().name;

//shows on the extension icon how often the user was raided to the channel viewed in the tab
async function updateBadge(tabId, url) {
    try {
        const result = await chrome.storage.local.get(["raids", "showBadge", "showPassiveRaidsOnTooltip"]);
        const channel = channelFromUrl(url);
        let text = "";
        let title = defaultActionTitle;
        if (channel && (result.showBadge ?? option_defaults.showBadge)) {
            const includeChatRaids = result.showPassiveRaidsOnTooltip ?? option_defaults.showPassiveRaidsOnTooltip;
            const summary = summarizeChannel(result.raids || [], channel, includeChatRaids);
            if (summary.incoming.length > 0) {
                text = summary.incoming.length > 999 ? "999+" : String(summary.incoming.length);
                title = `${channel}: ${describeChannelSummary(summary)}`;
            }
        }
        await chrome.action.setBadgeText({tabId, text});
        await chrome.action.setTitle({tabId, title});
    } catch (err) {
        //the tab may be closed already
        debugLog("active_raid_tracker.js:updateBadge", `unable to update badge of tab ${tabId}`, err);
    }
}

function updateAllBadges() {
    chrome.tabs.query(twitchTabsQuery)
        .then((tabs) => tabs.forEach((tab) => tab.id && updateBadge(tab.id, tab.url)))
        .catch((err) => debugLog("active_raid_tracker.js:updateAllBadges", "unable to query open tabs", err));
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
        return;
    }
    if (changes.raids || changes.showBadge || changes.showPassiveRaidsOnTooltip) {
        updateAllBadges();
    }
    if (changes.retentionMonths) {
        updateRaids((raids) => raids); //applies the new retention
    }
});

function rememberChannel(tabId, channel) {
    const tabKey = `tab_${tabId}`;
    return chrome.storage.session.set({[tabKey]: channel})
        .then(() => debugLog("active_raid_tracker.js:rememberChannel", `saved current channel ${channel} for ${tabKey}`));
}

//tabs that are already open when the extension gets installed, updated or the browser starts never fire a created event
function rememberOpenTabs() {
    chrome.tabs.query(twitchTabsQuery)
        .then((tabs) => {
            debugLog("active_raid_tracker.js:rememberOpenTabs", `found ${tabs.length} open twitch tabs`);
            tabs.forEach((tab) => {
                const currentChannel = channelFromUrl(tab.url || tab.pendingUrl);
                if (tab.id && currentChannel) {
                    rememberChannel(tab.id, currentChannel);
                }
                if (tab.id) {
                    updateBadge(tab.id, tab.url);
                }
            });
        })
        .catch((err) => debugLog("active_raid_tracker.js:rememberOpenTabs", "unable to query open tabs", err));
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.action.setBadgeBackgroundColor({color: "#9146FF"});
    rememberOpenTabs();
});
chrome.runtime.onStartup.addListener(() => {
    chrome.action.setBadgeBackgroundColor({color: "#9146FF"});
    rememberOpenTabs();
    updateRaids((raids) => raids); //applies the retention
});

chrome.tabs.onCreated.addListener((tab) => {
    debugLog("active_raid_tracker.js:tab-created-listener", `received creation of tab`, tab);
    if (!tab.id) {
        debugLog("active_raid_tracker.js:tab-created-listener", "Tab has no id");
        return;
    }

    const currentChannel = channelFromUrl(tab.url || tab.pendingUrl);
    if (!currentChannel) {
        debugLog("active_raid_tracker.js:tab-created-listener", "tab url is not a twitch channel");
        return;
    }
    debugLog("active_raid_tracker.js:tab-created-listener", `currentChannel is ${currentChannel}`);
    rememberChannel(tab.id, currentChannel);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
    debugLog("active_raid_tracker.js:tab-updated-listener", `received update on tab ${tabId}`, changeInfo, _tab);
    //a page load resets the badge of the tab, so it is set again after the load too
    if ((changeInfo.url || changeInfo.status === "complete") && _tab.url) {
        updateBadge(tabId, _tab.url);
    }
    if (!changeInfo.url) {
        debugLog("active_raid_tracker.js:tab-updated-listener", "update does not contain url");
        return;
    }
    let url;
    try {
        url = new URL(changeInfo.url);
    } catch (err) {
        debugLog("active_raid_tracker.js:tab-updated-listener", "updated url is not parseable", changeInfo.url);
        return;
    }
    if (!url.hostname.endsWith("twitch.tv")) {
        debugLog("active_raid_tracker.js:tab-updated-listener", "updated url is not a twitch domain", changeInfo.url);
        return;
    }

    //the passive tracker has to know about every navigation, also when leaving a channel
    chrome.tabs.sendMessage(tabId, {action: "trtSideNavigationEvent"})
        .then(() => debugLog("active_raid_tracker.js:tab-updated-listener", "send message to restart passive tracker"))
        .catch((err) => debugLog("active_raid_tracker.js:tab-updated-listener", "encountered error while restarting passive tracker", err));

    const currentChannel = channelFromUrl(url.href);
    if (!currentChannel) {
        debugLog("active_raid_tracker.js:tab-updated-listener", "updated url is not a twitch channel", changeInfo.url);
        return;
    }
    debugLog("active_raid_tracker.js:tab-updated-listener", `currentChannel is ${currentChannel}`);

    const isRaid = url.searchParams.get("referrer") === "raid"; //this param is added by twitch to the url when redirecting the user to the raid victim
    const tabKey = `tab_${tabId}`;
    chrome.storage.session.get([tabKey], (result) => {
        debugLog("active_raid_tracker.js:tab-updated-listener", `loaded session data for ${tabKey}`, result);
        const previousChannel = result[tabKey];
        debugLog("active_raid_tracker.js:tab-updated-listener", `checking ${isRaid} && ${previousChannel} != ${currentChannel}`)
        if (isRaid && previousChannel && previousChannel !== currentChannel) {
            saveRaid(previousChannel, currentChannel, OBSERVATION_ORIGINS.RAID);
            debugLog("active_raid_tracker.js:tab-updated-listener", "saved raid");
        } else {
            debugLog("active_raid_tracker.js:tab-updated-listener", "no raid detected");
        }
        rememberChannel(tabId, currentChannel);
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
    debugLog("active_raid_tracker.js:tab-removed-listener", `Received tab ${tabId} destroyed event`);
    const tabKey = `tab_${tabId}`;
    chrome.storage.session.remove([`${tabKey}`], () => {
        debugLog("active_raid_tracker.js:tab-removed-listener", `removed session data for ${tabKey}`);
    });
});
