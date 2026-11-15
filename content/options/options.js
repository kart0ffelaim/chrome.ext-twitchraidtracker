import {debugLog, mergeRaids, option_defaults, sanitizeImportedRaids} from "../shared.js";

const statusText = document.getElementById("status");

function clearStatusTextLater() {
    setTimeout(() => statusText.textContent = "", 2000);
}

function showSavedStatus() {
    statusText.textContent = "Settings saved!";
    clearStatusTextLater();
}

function bindCheckboxOption(elementId, optionName) {
    const checkbox = document.getElementById(elementId);
    chrome.storage.local.get([optionName], (result) => {
        debugLog(`options.js:${optionName}`, "loaded settings from storage", result);
        checkbox.checked = result[optionName] ?? option_defaults[optionName];
    });
    checkbox.addEventListener("change", () => {
        const obj = {[optionName]: checkbox.checked};
        chrome.storage.local.set(obj, () => {
            debugLog(`options.js:${optionName}`, "saved settings to storage", obj);
            showSavedStatus();
        });
    });
}

function bindNumberOption(elementId, optionName, displayName) {
    const input = document.getElementById(elementId);
    const min = parseInt(input.min);
    let savedValue = option_defaults[optionName];
    chrome.storage.local.get([optionName], (result) => {
        debugLog(`options.js:${optionName}`, "loaded settings from storage", result);
        savedValue = result[optionName] || option_defaults[optionName];
        input.value = savedValue;
    });
    input.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isInteger(value) || value < min) {
            debugLog(`options.js:${optionName}`, `value ${input.value} is not a whole number >= ${min} -> no save`);
            statusText.textContent = `${displayName} must be a whole number >= ${min}! Save failed!`;
            input.value = savedValue;
            clearStatusTextLater();
            return;
        }
        const obj = {[optionName]: value};
        chrome.storage.local.set(obj, () => {
            debugLog(`options.js:${optionName}`, "saved settings to storage", obj);
            savedValue = value;
            showSavedStatus();
        });
    });
}

bindCheckboxOption("debug-mode", "debugMode");
bindCheckboxOption("track-passive", "trackPassiveRaids");
bindCheckboxOption("show-passive-tooltip", "showPassiveRaidsOnTooltip");
bindNumberOption("tooltip-item-number", "tooltipItemNumber", "Tooltip item number");
bindNumberOption("overview-page-size", "overviewPageSize", "Overview page size");

export function showConfirmationDialog(parentElement, message) {
    debugLog("options.js:confirmDialog", "showing confirm dialog", parentElement, message);
    const dialogElem = document.createElement("dialog");
    parentElement.appendChild(dialogElem);

    const messageElem = document.createElement("p");
    messageElem.textContent = message;
    dialogElem.appendChild(messageElem);

    const okBtn = document.createElement("button");
    okBtn.type = "submit";
    okBtn.textContent = "OK";
    dialogElem.appendChild(okBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "reset";
    cancelBtn.textContent = "Cancel";
    dialogElem.appendChild(cancelBtn);
    debugLog("options.js:confirmDialog", "created dialog", dialogElem);

    return new Promise((resolve) => {
        const finish = (result) => {
            debugLog("options.js:confirmDialog", `dialog result is ${result}`);
            okBtn.removeEventListener("click", onOk);
            cancelBtn.removeEventListener("click", onCancel);
            dialogElem.close();
            parentElement.removeChild(dialogElem);
            resolve(result);
        }

        const onOk = () => finish(true);
        const onCancel = () => finish(false);

        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);

        dialogElem.showModal();
    });
}

function createFileDialog(message) {
    const dialogElem = document.createElement("dialog");
    document.body.appendChild(dialogElem);
    dialogElem.style.textAlign = "center";
    const messageElem = document.createElement("p");
    messageElem.textContent = message;
    dialogElem.appendChild(messageElem);
    const progressElem = document.createElement("div");
    progressElem.classList.add("loader");
    progressElem.style.margin = "auto";
    progressElem.style.paddingTop = "15px";
    dialogElem.appendChild(progressElem);
    dialogElem.showModal();
    return {dialogElem, messageElem, progressElem};
}

function addCloseButton(dialogElem, onClose) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "reset";
    closeBtn.textContent = "Close";
    dialogElem.appendChild(document.createElement("br"));
    dialogElem.appendChild(closeBtn);
    closeBtn.addEventListener("click", () => {
        if (onClose) {
            onClose();
        }
        dialogElem.close();
        document.body.removeChild(dialogElem);
    });
}

function finishFileDialog({dialogElem, messageElem, progressElem}, message, content, onClose) {
    messageElem.textContent = message;
    progressElem.classList.remove("loader");
    progressElem.style.paddingTop = "";
    progressElem.replaceChildren(content);
    addCloseButton(dialogElem, onClose);
}

const importFileElem = document.getElementById("import-file");
const importModeElem = document.getElementById("import-mode");
const importBtn = document.getElementById("import-data");
importBtn.addEventListener("click", async () => {
    debugLog('options.js:importData', `received click event on import btn`, importFileElem.files);
    const file = importFileElem.files[0];
    if (!file) {
        debugLog('options.js:importData', `No file selected`);
        statusText.textContent = "Select JSON file to import.";
        clearStatusTextLater();
        return;
    }
    const append = importModeElem.checked;
    if (!append && !await showConfirmationDialog(document.body, "Importing without appending replaces all existing raid data. Continue?")) {
        debugLog('options.js:importData', "User aborted");
        return;
    }

    const fileDialog = createFileDialog("Importing data...");
    try {
        const {raids: importedRaids, skipped} = sanitizeImportedRaids(JSON.parse(await file.text()));
        debugLog('options.js:importData', `parsed json, skipped ${skipped} invalid entries`, importedRaids);

        const result = await chrome.storage.local.get(["raids"]);
        const oldRaids = append ? result.raids || [] : [];
        debugLog('options.js:importData', `set base for import (appending? ${append})`, oldRaids);
        const raids = mergeRaids(oldRaids, importedRaids);

        await chrome.storage.local.set({raids: raids});
        debugLog('options.js:importData', "new raid data saved", raids);
        let summary = `Imported ${raids.length - oldRaids.length} raids out of ${importedRaids.length + skipped}. New total raids: ${raids.length}`;
        if (skipped > 0) {
            summary += ` (${skipped} invalid entries skipped)`;
        }
        finishFileDialog(fileDialog, "Import successful", summary);
    } catch (err) {
        debugLog('options.js:importData', "import failed", err);
        finishFileDialog(fileDialog, "Import failed!", `Error: ${err.message}`);
    }
});

const exportBtn = document.getElementById("export-data");
exportBtn.addEventListener("click", () => {
    debugLog('options.js:exportData', `received click event on export btn`);
    chrome.storage.local.get(["raids"], (result) => {
        debugLog('options.js:exportData', `loaded raids from storage`, result);
        if (!result.raids || result.raids.length < 1) {
            debugLog('options.js:exportData', "no raids to export");
            statusText.textContent = "No data to export available.";
            clearStatusTextLater();
            return;
        }

        const fileDialog = createFileDialog("Exporting data...");

        const data = JSON.stringify(result.raids, null, 4);
        const dataBlob = new Blob([data], {type: "application/json"});
        const url = URL.createObjectURL(dataBlob);
        debugLog('options.js:exportData', "created download link", url)

        const dlLink = document.createElement("a");
        dlLink.href = url;
        dlLink.download = `raid_data_bkp_${new Date().toISOString().slice(0, 10)}.json`;
        dlLink.textContent = dlLink.download;
        finishFileDialog(fileDialog, "Download started...", dlLink, () => URL.revokeObjectURL(url));

        dlLink.click();
        debugLog('options.js:exportData', "exported data");
    });
});

const clearBtn = document.getElementById("clear-btn");
clearBtn.addEventListener("click", () => {
    debugLog("options.js:click-event-listener", "Got event on clear btn");
    (async () => {
        if (!await showConfirmationDialog(document.body, "Are you sure you want to delete everything?")) {
            debugLog("options.js:click-event-listener", "User aborted");
            return;
        }
        debugLog("options.js:click-event-listener", "User confirmed deletion");
        chrome.storage.local.set({raids: []}, () => {
            debugLog("options.js:click-event-listener", "Cleared all data");
            statusText.textContent = "All data erased!";
            clearStatusTextLater();
        });
    })();
});