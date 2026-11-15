import {
    channelFromUrl,
    computeStats,
    createRaidElement,
    debugLog,
    deleteRaid,
    describeChannelSummary,
    option_defaults,
    summarizeChannel
} from "./shared.js";

document.addEventListener("DOMContentLoaded", () => {
    debugLog("popup.js", "DOMContentLoaded event received");
    let currentPage = 1;
    let totalPages = 1;
    let showStats = false;

    const raidList = document.getElementById("raid-list");
    const searchInput = document.getElementById("search-input");
    const periodFilter = document.getElementById("period-filter");
    const prevBtn = document.getElementById("prev-btn");
    const nextBtn = document.getElementById("next-btn");
    const pageInfo = document.getElementById("page-info");
    const historyTab = document.getElementById("history-tab");
    const statsTab = document.getElementById("stats-tab");
    const historyView = document.getElementById("history-view");
    const statsView = document.getElementById("stats-view");
    const channelInfo = document.getElementById("channel-info");
    const channelInfoName = document.getElementById("channel-info-name");
    const channelInfoText = document.getElementById("channel-info-text");
    const channelInfoFilter = document.getElementById("channel-info-filter");

    function showEmptyList(message) {
        raidList.textContent = message;
        pageInfo.textContent = "0/0";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    }

    function filterRaids(raids) {
        const searchTerm = searchInput.value.trim().toLowerCase();
        const period = periodFilter.value;
        const now = new Date();

        debugLog("popup.js:filterRaids", `filtering raids (search term: ${searchTerm}; period: ${period})`);
        return raids.filter(raid => {
            const matchesSearch = searchTerm.length < 1 || String(raid.source).toLowerCase().includes(searchTerm) || String(raid.target).toLowerCase().includes(searchTerm);
            let matchesPeriod;
            if (period === "all") {
                matchesPeriod = true;
            } else {
                const diff = (now - new Date(raid.timestamp)) / (1000 * 60 * 60);
                matchesPeriod = diff <= parseInt(period);
            }
            return matchesSearch && matchesPeriod;
        });
    }

    function renderHistory(raids, pageSize) {
        if (raids.length < 1) {
            showEmptyList("No raids match your criteria.");
            debugLog("popup.js:renderHistory", "No raids after filter -> No content");
            return;
        }

        //newest raids first, so the first page shows the latest raids
        raids.sort((raidA, raidB) => new Date(raidB.timestamp) - new Date(raidA.timestamp));

        totalPages = Math.ceil(raids.length / pageSize) || 1;
        if (currentPage > totalPages) currentPage = totalPages;

        const startIndex = (currentPage - 1) * pageSize;
        raids = raids.slice(startIndex, startIndex + pageSize);
        debugLog("popup.js:renderHistory", `rendering page ${currentPage} (start at ${startIndex}, size ${pageSize}) of ${totalPages}`);

        raidList.replaceChildren(...raids.map(raid => createRaidElement(raid, {
            showOrigin: true,
            links: true,
            onDelete: (raidToDelete) => deleteRaid(raidToDelete).then(loadRaids)
        })));

        pageInfo.textContent = `${currentPage} / ${totalPages}`;
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage === totalPages;
    }

    function createStatTile(value, label) {
        const tile = document.createElement("div");
        tile.className = "stat-tile";
        const valueElem = document.createElement("div");
        valueElem.className = "stat-value";
        valueElem.textContent = value;
        const labelElem = document.createElement("div");
        labelElem.className = "stat-label";
        labelElem.textContent = label;
        tile.append(valueElem, labelElem);
        return tile;
    }

    function createBarList(title, entries) {
        const elements = [];
        const heading = document.createElement("h4");
        heading.textContent = title;
        elements.push(heading);

        const max = Math.max(1, ...entries.map(entry => entry.count));
        entries.forEach(entry => {
            const row = document.createElement("div");
            row.className = "bar-row";
            row.title = `${entry.name}: ${entry.count} ${entry.count === 1 ? "raid" : "raids"}`;
            const label = document.createElement("span");
            label.className = "bar-label";
            label.textContent = entry.name;
            const track = document.createElement("div");
            const bar = document.createElement("div");
            bar.className = entry.count > 0 ? "bar" : "bar empty";
            bar.style.width = `${entry.count / max * 100}%`;
            track.append(bar);
            const value = document.createElement("span");
            value.className = "bar-value";
            value.textContent = entry.count;
            row.append(label, track, value);
            elements.push(row);
        });
        return elements;
    }

    function renderStats(raids) {
        if (raids.length < 1) {
            const empty = document.createElement("div");
            empty.className = "stats-empty";
            empty.textContent = "No raids match your criteria.";
            statsView.replaceChildren(empty);
            return;
        }
        const stats = computeStats(raids);
        const tiles = document.createElement("div");
        tiles.className = "stat-tiles";
        tiles.append(
            createStatTile(stats.total, stats.total === 1 ? "raid" : "raids"),
            createStatTile(stats.channels, "channels"),
            createStatTile(stats.fromChat, "seen in chat")
        );
        statsView.replaceChildren(
            tiles,
            ...createBarList("Most raids started from", stats.topSources),
            ...createBarList("Most raided channels", stats.topTargets),
            ...createBarList("Raids per month", stats.perMonth)
        );
    }

    function loadRaids() {
        chrome.storage.local.get(["raids", "overviewPageSize"], (result) => {
            debugLog("popup.js:loadRaids", `Raids loaded from storage`, result);
            const allRaids = result.raids || [];
            if (allRaids.length === 0) {
                showEmptyList("No raids tracked yet. Watch some streams and raid somebody!");
                statsView.textContent = "No raids tracked yet.";
                debugLog("popup.js:loadRaids", "No raids -> No content");
                return;
            }

            const raids = filterRaids(allRaids);
            debugLog("popup.js:loadRaids", `filtered raids (new count: ${raids.length})`, raids);
            if (showStats) {
                renderStats(raids);
            } else {
                renderHistory(raids, result.overviewPageSize || option_defaults.overviewPageSize);
            }
            debugLog("popup.js:loadRaids", "Raids loaded, filtered and rendered.");
        });
    }

    //shows what is known about the channel of the currently viewed tab
    async function loadChannelInfo() {
        try {
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            const channel = channelFromUrl(tab?.url);
            if (!channel) {
                return;
            }
            const result = await chrome.storage.local.get(["raids"]);
            const text = describeChannelSummary(summarizeChannel(result.raids || [], channel, true));
            if (!text) {
                return;
            }
            channelInfoName.textContent = channel;
            channelInfoText.textContent = text;
            channelInfoFilter.onclick = () => {
                searchInput.value = channel;
                periodFilter.value = "all";
                currentPage = 1;
                loadRaids();
            };
            channelInfo.hidden = false;
        } catch (err) {
            debugLog("popup.js:loadChannelInfo", "unable to load info for the current tab", err);
        }
    }

    function selectView(stats) {
        showStats = stats;
        historyTab.setAttribute("aria-selected", String(!stats));
        statsTab.setAttribute("aria-selected", String(stats));
        historyView.hidden = stats;
        statsView.hidden = !stats;
        loadRaids();
    }

    historyTab.addEventListener("click", () => selectView(false));
    statsTab.addEventListener("click", () => selectView(true));

    searchInput.addEventListener("input", () => {
        debugLog("popup.js:sinput-event-listener", "got event on search input");
        currentPage = 1;
        loadRaids();
    });

    periodFilter.addEventListener("change", () => {
        debugLog("popup.js:change-event-listener", "got event on period select");
        currentPage = 1;
        loadRaids();
    });

    prevBtn.addEventListener("click", () => {
        debugLog("popup.js:click-event-listener", "got event on page-1 btn");
        if (currentPage > 1) {
            currentPage--;
            loadRaids();
        }
    });

    nextBtn.addEventListener("click", () => {
        debugLog("popup.js:click-event-listener", "got event on page+1 btn");
        if (currentPage < totalPages) {
            currentPage++;
            loadRaids();
        }
    })

    loadRaids();
    loadChannelInfo();
});
