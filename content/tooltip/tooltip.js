(async () => {
    const shared_js = chrome.runtime.getURL("content/shared.js");
    const {
        channelFromUrl,
        createRaidElement,
        debugLog,
        option_defaults,
        OBSERVATION_ORIGINS
    } = await import(shared_js);
    debugLog("tooltip.js", "imported functions");

    const tooltipMargin = 8;
    const tooltip = document.createElement("div");
    tooltip.id = "raid-tracker-tooltip";
    tooltip.classList.add("raid-tracker-tooltip");
    document.body.appendChild(tooltip);

    let hoveredLink = null;
    let requestCounter = 0; //storage is read async, so a result may arrive after the mouse already left the link

    function hideTooltip() {
        hoveredLink = null;
        requestCounter++;
        tooltip.classList.remove("show-tooltip");
        tooltip.replaceChildren();
    }

    function positionTooltip(link) {
        const rect = link.getBoundingClientRect();
        let top = rect.top - tooltip.offsetHeight - tooltipMargin;
        if (top < tooltipMargin) {
            top = rect.bottom + tooltipMargin; //no space above the link
        }
        const maxLeft = window.innerWidth - tooltip.offsetWidth - tooltipMargin;
        const left = Math.max(tooltipMargin, Math.min(rect.left, maxLeft));
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
    }

    document.addEventListener("mouseover", async (event) => {
        if (!chrome.runtime?.id) {
            return; //extension got reloaded or removed, this script is orphaned
        }
        const link = event.target instanceof Element ? event.target.closest("a") : null;
        if (link === hoveredLink) {
            return; //mouse moved inside the same link
        }
        hideTooltip();
        if (!link) {
            return;
        }
        const currentChannel = channelFromUrl(link.getAttribute("href"), window.location.origin);
        if (!currentChannel) {
            return;
        }
        debugLog('tooltip.js:mouseover-event-listener', `currentChannel is ${currentChannel}`);
        hoveredLink = link;
        const request = requestCounter;

        let result;
        try {
            result = await chrome.storage.local.get(["raids", "showPassiveRaidsOnTooltip", "tooltipItemNumber"]);
        } catch (err) {
            debugLog('tooltip.js:mouseover-event-listener', "unable to load raids from storage", err);
            return;
        }
        if (request !== requestCounter) {
            debugLog('tooltip.js:mouseover-event-listener', "mouse left the link before the raids were loaded");
            return;
        }

        const showPassiveRaids = result.showPassiveRaidsOnTooltip ?? option_defaults.showPassiveRaidsOnTooltip;
        const size = result.tooltipItemNumber || option_defaults.tooltipItemNumber;
        const raids = (result.raids || [])
            .filter(raid => String(raid.target).toLowerCase() === currentChannel && (showPassiveRaids || raid.dataOrigin !== OBSERVATION_ORIGINS.CHAT))
            .reverse()
            .slice(0, size);
        debugLog('tooltip.js:mouseover-event-listener', `Raids were filtered so only the ${size} newest raids that targeted the channel ${currentChannel} are in it`, raids);
        if (raids.length < 1) {
            return;
        }

        tooltip.replaceChildren(...raids.map(raid => createRaidElement(raid, false)));
        positionTooltip(link);
        tooltip.classList.add("show-tooltip");
        debugLog('tooltip.js:mouseover-event-listener', "tooltip shown");
    });

    document.addEventListener("mouseout", (event) => {
        if (!hoveredLink) {
            return;
        }
        if (event.relatedTarget instanceof Node && hoveredLink.contains(event.relatedTarget)) {
            return; //mouse moved inside the same link
        }
        hideTooltip();
        debugLog('tooltip.js:mouseout-event-listener', "Removed tooltip and cleared content");
    });

    //the tooltip position is fixed and a clicked link may vanish without a mouseout event
    document.addEventListener("scroll", hideTooltip, {capture: true, passive: true});
    document.addEventListener("click", hideTooltip, true);
})();
