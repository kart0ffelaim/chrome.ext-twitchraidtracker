(async () => {
    const shared_js = chrome.runtime.getURL("content/shared.js");
    const {
        OBSERVATION_ORIGINS,
        debugLog,
        saveRaid,
        channelFromUrl,
        parseRaidMessage,
        option_defaults
    } = await import(shared_js);
    debugLog("passive_raid_tracker.js", "imported functions");

    const observerParams = {childList: true, subtree: true};
    const maxFindChatTries = 10;
    const duplicateTimeframe = 60000;
    const userMessageSelector = ".chat-line__message";

    let trackingEnabled = option_defaults.trackPassiveRaids;
    let chatObserver = null;
    let startTimer = null;
    const recentRaids = new Map(); //the same raid message can be observed more than once

    function handleAddedNode(node, currentChannel) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        //messages written by users (also /me messages) are never raid messages, only notices created by twitch are
        if (node.matches(userMessageSelector) || node.closest(userMessageSelector) || node.querySelector(userMessageSelector)) {
            return;
        }
        //with debug mode enabled this shows the markup of every twitch notice, helpful to add support for other languages
        debugLog("passive_raid_tracker.js:handleAddedNode", "twitch notice added to chat", node.textContent, node.outerHTML);
        const raidMessage = parseRaidMessage(node.textContent);
        if (!raidMessage) {
            return;
        }
        const raider = raidMessage.raider;
        debugLog("passive_raid_tracker.js:handleAddedNode", "found raid message", raider, currentChannel);

        const recentKey = `${raider}|${currentChannel}`;
        if (Date.now() - (recentRaids.get(recentKey) || 0) < duplicateTimeframe) {
            debugLog("passive_raid_tracker.js:handleAddedNode", "raid message was already handled");
            return;
        }
        recentRaids.set(recentKey, Date.now());

        chrome.storage.local.get(["raids"], (result) => {
            const raids = result.raids || [];
            //the raid may be saved already by the active tracker or another tab
            const isDuplicateEntry = raids.slice(-15).some(raid => {
                const timeDiff = Date.now() - new Date(raid.timestamp);
                return String(raid.source).toLowerCase() === raider && String(raid.target).toLowerCase() === currentChannel && timeDiff < duplicateTimeframe;
            });

            debugLog("passive_raid_tracker.js:handleAddedNode", `found duplicate? ${isDuplicateEntry}`);
            if (!isDuplicateEntry) {
                saveRaid(raider, currentChannel, OBSERVATION_ORIGINS.CHAT, raidMessage.viewers);
                debugLog("passive_raid_tracker.js:handleAddedNode", `raid saved`);
            }
        });
    }

    function observeChat(currentChannel, tryCounter) {
        startTimer = null;
        debugLog("passive_raid_tracker.js:observeChat", `starting chat observation, counter: ${tryCounter}`)
        const chatContainer = document.querySelector('.chat-scrollable-area__message-container');
        if (!chatContainer) {
            if (tryCounter >= maxFindChatTries) {
                //not every channel page has a chat (videos, schedule, about, ...), so this is no reason to bother the user
                console.warn("[Raid Tracker] Unable to find the chat container on this page, raids are not tracked through chat here.");
            } else {
                startTimer = setTimeout(observeChat, 2000, currentChannel, tryCounter + 1);
            }
            return;
        }
        debugLog("passive_raid_tracker.js:observeChat", "found chat container", chatContainer);

        chatObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => handleAddedNode(node, currentChannel));
            });
        });
        chatObserver.observe(chatContainer, observerParams);
        debugLog('passive_raid_tracker.js:observeChat', "started observer");
    }

    function stopChatObserver() {
        if (startTimer) {
            clearTimeout(startTimer);
            startTimer = null;
        }
        if (chatObserver) {
            chatObserver.disconnect();
            chatObserver = null;
            debugLog("passive_raid_tracker.js:stopChatObserver", "disconnected observer");
        }
    }

    function restartChatObserver() {
        stopChatObserver();
        if (!trackingEnabled) {
            debugLog("passive_raid_tracker.js", "did not start observer, tracking not enabled.");
            return;
        }
        const currentChannel = channelFromUrl(window.location.href);
        if (!currentChannel) {
            debugLog("passive_raid_tracker.js", `${window.location.href} is not a twitch channel`);
            return;
        }
        debugLog("passive_raid_tracker.js", `currentChannel is ${currentChannel}`);
        startTimer = setTimeout(observeChat, 5000, currentChannel, 0); //delayed start so after an active raid the observer does not track the same raid again or before the active raid tracker
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes.trackPassiveRaids) {
            trackingEnabled = !!changes.trackPassiveRaids.newValue;
            debugLog("passive_raid_tracker.js", `tracking raids from chat enabled? ${trackingEnabled}`);
            restartChatObserver();
        }
    });

    chrome.runtime.onMessage.addListener((request) => {
        if (request.action === "trtSideNavigationEvent") {
            debugLog("passive_raid_tracker.js", "navigation detected")
            restartChatObserver();
        }
    });

    const settings = await chrome.storage.local.get(["trackPassiveRaids"]);
    debugLog('passive_raid_tracker.js', "Loaded settings from storage", settings);
    trackingEnabled = settings.trackPassiveRaids ?? option_defaults.trackPassiveRaids;
    restartChatObserver();
})();
