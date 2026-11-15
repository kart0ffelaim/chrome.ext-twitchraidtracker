import {channelFromUrl, debugLog, saveRaid, OBSERVATION_ORIGINS} from "../shared.js";

function rememberChannel(tabId, channel) {
    const tabKey = `tab_${tabId}`;
    return chrome.storage.session.set({[tabKey]: channel})
        .then(() => debugLog("active_raid_tracker.js:rememberChannel", `saved current channel ${channel} for ${tabKey}`));
}

//tabs that are already open when the extension gets installed, updated or the browser starts never fire a created event
function rememberOpenTabs() {
    chrome.tabs.query({url: "*://www.twitch.tv/*"})
        .then((tabs) => {
            debugLog("active_raid_tracker.js:rememberOpenTabs", `found ${tabs.length} open twitch tabs`);
            tabs.forEach((tab) => {
                const currentChannel = channelFromUrl(tab.url || tab.pendingUrl);
                if (tab.id && currentChannel) {
                    rememberChannel(tab.id, currentChannel);
                }
            });
        })
        .catch((err) => debugLog("active_raid_tracker.js:rememberOpenTabs", "unable to query open tabs", err));
}

chrome.runtime.onInstalled.addListener(rememberOpenTabs);
chrome.runtime.onStartup.addListener(rememberOpenTabs);

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
