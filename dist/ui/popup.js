// popup.ts
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("recBadge");
const noteEl = document.getElementById("note");
const tagsEl = document.getElementById("tags");
const deepCaptureEl = document.getElementById("deepCapture");
const toastEl = document.getElementById("toast");
const sharePanelEl = document.getElementById("sharePanel");
const shareUrlEl = document.getElementById("shareUrl");
const copyShareBtn = document.getElementById("copyShare");
const openShareBtn = document.getElementById("openShare");
const metaModalEl = document.getElementById("metaModal");
const modalNoteEl = document.getElementById("modalNote");
const modalTagsEl = document.getElementById("modalTags");
const metaCancelBtn = document.getElementById("metaCancel");
const metaSaveBtn = document.getElementById("metaSave");
let statusTimer = null;
let toastTimer = null;
let lastShareUrl = null;
function setStatus(text) {
    statusEl.textContent = text;
    if (statusTimer)
        clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (statusEl.textContent = ""), 3000);
}
function setBadge(isOn) {
    if (isOn) {
        badgeEl.textContent = "REC";
        badgeEl.style.borderColor = "#16a34a";
        badgeEl.style.color = "#16a34a";
    }
    else {
        badgeEl.textContent = "OFF";
        badgeEl.style.borderColor = "#ccc";
        badgeEl.style.color = "#666";
    }
}
function showToast(text) {
    if (!toastEl)
        return;
    toastEl.textContent = text;
    toastEl.style.display = "block";
    if (toastTimer)
        clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastEl.style.display = "none";
        toastEl.textContent = "";
    }, 2500);
}
function showSharePanel(url) {
    lastShareUrl = url;
    if (shareUrlEl)
        shareUrlEl.value = url;
    if (sharePanelEl)
        sharePanelEl.style.display = "block";
}
function openMetaModal() {
    return new Promise((resolve) => {
        if (!metaModalEl)
            return resolve(false);
        if (modalNoteEl)
            modalNoteEl.value = noteEl?.value || "";
        if (modalTagsEl)
            modalTagsEl.value = tagsEl?.value || "";
        const cleanup = () => {
            metaModalEl.style.display = "none";
            metaCancelBtn?.removeEventListener("click", onCancel);
            metaSaveBtn?.removeEventListener("click", onSave);
            metaModalEl?.removeEventListener("click", onOverlay);
            document.removeEventListener("keydown", onKey);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        const onSave = () => {
            if (noteEl)
                noteEl.value = modalNoteEl?.value || "";
            if (tagsEl)
                tagsEl.value = modalTagsEl?.value || "";
            cleanup();
            resolve(true);
        };
        const onOverlay = (e) => {
            if (e.target === metaModalEl)
                onCancel();
        };
        const onKey = (e) => {
            if (e.key === "Escape")
                onCancel();
        };
        metaModalEl.style.display = "flex";
        metaCancelBtn?.addEventListener("click", onCancel);
        metaSaveBtn?.addEventListener("click", onSave);
        metaModalEl?.addEventListener("click", onOverlay);
        document.addEventListener("keydown", onKey);
    });
}
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    }
    catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return ok;
        }
        catch {
            return false;
        }
    }
}
if (copyShareBtn) {
    copyShareBtn.addEventListener("click", async () => {
        if (!lastShareUrl)
            return;
        const ok = await copyToClipboard(lastShareUrl);
        showToast(ok ? "Share link copied." : "Copy failed.");
    });
}
if (openShareBtn) {
    openShareBtn.addEventListener("click", () => {
        if (!lastShareUrl)
            return;
        chrome.tabs.create({ url: lastShareUrl });
    });
}
async function getCurrentTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
}
function getMeta() {
    const note = (noteEl?.value || "").trim();
    const tags = (tagsEl?.value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    return {
        note: note || null,
        tags: tags.length ? tags : null
    };
}
async function sendMeta(tabId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "SET_META", tabId, meta: getMeta() }, () => resolve());
    });
}
// popup status sync
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
    if (res?.ok)
        setBadge(!!res.recording);
});
async function syncDeepCaptureToggle() {
    const tabId = await getCurrentTabId();
    if (!tabId || !deepCaptureEl)
        return;
    chrome.runtime.sendMessage({ type: "GET_DEEP_CAPTURE", tabId }, (res) => {
        if (!deepCaptureEl)
            return;
        if (res?.ok) {
            deepCaptureEl.checked = !!res.enabled;
            deepCaptureEl.disabled = false;
        }
        else {
            deepCaptureEl.checked = false;
            deepCaptureEl.disabled = true;
        }
    });
}
syncDeepCaptureToggle();
if (deepCaptureEl) {
    deepCaptureEl.addEventListener("change", async () => {
        const tabId = await getCurrentTabId();
        if (!tabId)
            return setStatus("Could not find current tab.");
        const enable = !!deepCaptureEl.checked;
        chrome.runtime.sendMessage({ type: "SET_DEEP_CAPTURE", tabId, enabled: enable }, (res) => {
            if (res?.ok) {
                setStatus(enable ? "Deep capture enabled" : "Deep capture disabled");
            }
            else {
                deepCaptureEl.checked = !enable;
                setStatus(`Deep capture failed: ${res?.error || "unknown"}`);
            }
        });
    });
}
document.getElementById("start").onclick = async () => {
    const tabId = await getCurrentTabId();
    if (!tabId)
        return setStatus("Could not find current tab.");
    chrome.runtime.sendMessage({ type: "START", tabId }, (res) => {
        if (res?.ok) {
            setBadge(true);
            setStatus(`Recording started (cleared tab ${res.clearedTabId})`);
        }
        else {
            setStatus("Failed to start recording");
        }
    });
};
document.getElementById("stop").onclick = async () => {
    const confirmed = await openMetaModal();
    if (!confirmed)
        return;
    const tabId = await getCurrentTabId();
    if (tabId)
        await sendMeta(tabId);
    chrome.runtime.sendMessage({ type: "STOP" }, (res) => {
        if (res?.ok) {
            setBadge(false);
            setStatus("Recording stopped");
        }
        else {
            setStatus("Failed to stop recording");
        }
    });
};
// Open public viewer
// Downloads JSON if too large, otherwise opens inline.
document.getElementById("openViewer").onclick = async () => {
    const tabId = await getCurrentTabId();
    if (!tabId)
        return setStatus("Could not find current tab.");
    const confirmed = await openMetaModal();
    if (!confirmed)
        return;
    await sendMeta(tabId);
    chrome.runtime.sendMessage({ type: "OPEN_VIEWER", tabId }, (res) => {
        if (res?.ok) {
            const url = res?.url;
            if (url) {
                showSharePanel(url);
                copyToClipboard(url).then((copied) => {
                    if (copied)
                        showToast("Share link copied.");
                    else
                        showToast("Share opened (copy failed).");
                });
            }
            if (res.inline)
                setStatus("Public Viewer opened.");
            else
                setStatus("Public Viewer opened. Upload the downloaded JSON.");
        }
        else {
            const err = res?.error || "unknown";
            setStatus(`Open Viewer failed: ${err}`);
        }
    });
};
// Export JSON
// Download only.
document.getElementById("export").onclick = async () => {
    const tabId = await getCurrentTabId();
    if (!tabId)
        return setStatus("No active tab to export.");
    const confirmed = await openMetaModal();
    if (!confirmed)
        return;
    await sendMeta(tabId);
    chrome.runtime.sendMessage({ type: "EXPORT", tabId }, (res) => {
        if (res?.ok)
            setStatus("Export downloaded!");
        else
            setStatus(`Export failed: ${res?.error || "unknown"}`);
    });
};
//# sourceMappingURL=popup.js.map
