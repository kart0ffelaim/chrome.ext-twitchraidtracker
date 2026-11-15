import {createRaidElement, debugLog, option_defaults} from "./shared.js";

document.addEventListener("DOMContentLoaded", () => {
    debugLog("popup.js", "DOMContentLoaded event received");
    let currentPage = 1;
    let totalPages = 1;

    const raidList = document.getElementById("raid-list");
    const searchInput = document.getElementById("search-input");
    const periodFilter = document.getElementById("period-filter");
    const prevBtn = document.getElementById("prev-btn");
    const nextBtn = document.getElementById("next-btn");
    const pageInfo = document.getElementById("page-info");

    function showEmptyList(message) {
        raidList.textContent = message;
        pageInfo.textContent = "0/0";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    }

    function loadRaids() {
        chrome.storage.local.get(["raids", "overviewPageSize"], (result) => {
            debugLog("popup.js:loadRaids", `Raids loaded from storage`, result);
            let raids = result.raids || [];
            if (raids.length === 0) {
                showEmptyList("No raids tracked yet. Watch some streams and raid somebody!");
                debugLog("popup.js:loadRaids", "No raids -> No content");
                return;
            }

            const searchTerm = searchInput.value.trim().toLowerCase();
            const period = periodFilter.value;
            const now = new Date();

            debugLog("popup.js:loadRaids", `filtering raids (search term: ${searchTerm}; period: ${period})`);
            raids = raids.filter(raid => {
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
            debugLog("popup.js:loadRaids", `filtered raids (new count: ${raids.length})`, raids);

            if (raids.length < 1) {
                showEmptyList("No raids match your criteria.");
                debugLog("popup.js:loadRaids", "No raids after filter -> No content");
                return;
            }

            //newest raids first, so the first page shows the latest raids
            raids.sort((raidA, raidB) => new Date(raidB.timestamp) - new Date(raidA.timestamp));

            const pageSize = result.overviewPageSize || option_defaults.overviewPageSize;
            debugLog("popup.js:loadRaids", `page size is ${pageSize}`);
            totalPages = Math.ceil(raids.length / pageSize) || 1;
            if (currentPage > totalPages) currentPage = totalPages;

            const startIndex = (currentPage - 1) * pageSize;
            raids = raids.slice(startIndex, startIndex + pageSize);
            debugLog("popup.js:loadRaids", `rendering page ${currentPage} (start at ${startIndex}, size ${pageSize}) of ${totalPages}`);

            raidList.replaceChildren(...raids.map(raid => createRaidElement(raid, true)));

            pageInfo.textContent = `${currentPage} / ${totalPages}`;
            prevBtn.disabled = currentPage === 1;
            nextBtn.disabled = currentPage === totalPages;
            debugLog("popup.js:loadRaids", "Raids loaded, filtered, paged and rendered.");
        });
    }

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
});
