// popup.ts
const statusEl = document.getElementById("status") as HTMLElement;
const badgeEl = document.getElementById("recBadge") as HTMLElement;
const noteEl = document.getElementById("note") as HTMLTextAreaElement;
const tagsEl = document.getElementById("tags") as HTMLInputElement;

let statusTimer = null as ReturnType<typeof setTimeout> | null;

function setStatus(text: string) {
  statusEl.textContent = text;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 3000);
}

function setBadge(isOn: boolean) {
  if (isOn) {
    badgeEl.textContent = "REC";
    badgeEl.style.borderColor = "#16a34a";
    badgeEl.style.color = "#16a34a";
  } else {
    badgeEl.textContent = "OFF";
    badgeEl.style.borderColor = "#ccc";
    badgeEl.style.color = "#666";
  }
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

async function sendMeta(tabId: number) {
  return new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({ type: "SET_META", tabId, meta: getMeta() }, () => resolve());
  });
}

// popup status sync
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
  if (res?.ok) setBadge(!!res.recording);
});

document.getElementById("start")!.onclick = async () => {
  const tabId = await getCurrentTabId();
  if (!tabId) return setStatus("Could not find current tab.");

  chrome.runtime.sendMessage({ type: "START", tabId }, (res) => {
    if (res?.ok) {
      setBadge(true);
      setStatus(`Recording started (cleared tab ${res.clearedTabId})`);
    } else {
      setStatus("Failed to start recording");
    }
  });
};

document.getElementById("stop")!.onclick = async () => {
  chrome.runtime.sendMessage({ type: "STOP" }, (res) => {
    if (res?.ok) {
      setBadge(false);
      setStatus("Recording stopped");
    } else {
      setStatus("Failed to stop recording");
    }
  });
};

// Open public viewer
// Downloads JSON if too large, otherwise opens inline.
document.getElementById("openViewer")!.onclick = async () => {
  const tabId = await getCurrentTabId();
  if (!tabId) return setStatus("Could not find current tab.");
  await sendMeta(tabId);

  chrome.runtime.sendMessage({ type: "OPEN_VIEWER", tabId }, (res) => {
    if (res?.ok) {
      if (res.inline) setStatus("Public Viewer opened.");
      else setStatus("Public Viewer opened. Upload the downloaded JSON.");
    } else {
      setStatus(`Open Viewer failed: ${res?.error || "unknown"}`);
    }
  });
};

// Export JSON
// Download only.
document.getElementById("export")!.onclick = async () => {
  const tabId = await getCurrentTabId();
  if (!tabId) return setStatus("No active tab to export.");
  await sendMeta(tabId);

  chrome.runtime.sendMessage({ type: "EXPORT", tabId }, (res) => {
    if (res?.ok) setStatus("Export downloaded!");
    else setStatus(`Export failed: ${res?.error || "unknown"}`);
  });
};
