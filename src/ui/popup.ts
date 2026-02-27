export {};
// popup.ts
const statusEl = document.getElementById("status") as HTMLElement;
const badgeEl = document.getElementById("recBadge") as HTMLElement;
const noteEl = document.getElementById("note") as HTMLTextAreaElement;
const tagsEl = document.getElementById("tags") as HTMLInputElement;
const deepCaptureEl = document.getElementById("deepCapture") as HTMLInputElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const serverBaseUrlEl = document.getElementById("serverBaseUrl") as HTMLInputElement;
const viewerBaseUrlEl = document.getElementById("viewerBaseUrl") as HTMLInputElement;
const serverJwtEl = document.getElementById("serverJwt") as HTMLInputElement;

let statusTimer = null as ReturnType<typeof setTimeout> | null;
let toastTimer = null as ReturnType<typeof setTimeout> | null;

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

function showToast(text: string) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.style.display = "block";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.display = "none";
    toastEl.textContent = "";
  }, 2500);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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
    } catch {
      return false;
    }
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

function getServerConfigFromInputs() {
  return {
    serverBaseUrl: (serverBaseUrlEl?.value || "").trim() || null,
    viewerBaseUrl: (viewerBaseUrlEl?.value || "").trim() || null,
    jwt: (serverJwtEl?.value || "").trim() || null
  };
}

async function loadServerConfig() {
  return new Promise<any>((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_SERVER_CONFIG" }, (res) => resolve(res?.config || null));
  });
}

async function saveServerConfig() {
  return new Promise<boolean>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "SET_SERVER_CONFIG", config: getServerConfigFromInputs() },
      (res) => resolve(!!res?.ok)
    );
  });
}

// popup status sync
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
  if (res?.ok) setBadge(!!res.recording);
});

async function syncDeepCaptureToggle() {
  const tabId = await getCurrentTabId();
  if (!tabId || !deepCaptureEl) return;

  chrome.runtime.sendMessage({ type: "GET_DEEP_CAPTURE", tabId }, (res) => {
    if (!deepCaptureEl) return;
    if (res?.ok) {
      deepCaptureEl.checked = !!res.enabled;
      deepCaptureEl.disabled = false;
    } else {
      deepCaptureEl.checked = false;
      deepCaptureEl.disabled = true;
    }
  });
}

syncDeepCaptureToggle();

// load server config
loadServerConfig().then((config) => {
  if (!config) return;
  if (serverBaseUrlEl) serverBaseUrlEl.value = config.serverBaseUrl || "";
  if (viewerBaseUrlEl) viewerBaseUrlEl.value = config.viewerBaseUrl || "";
  if (serverJwtEl) serverJwtEl.value = config.jwt || "";
});

document.getElementById("saveServer")?.addEventListener("click", async () => {
  const ok = await saveServerConfig();
  setStatus(ok ? "Server settings saved." : "Failed to save server settings.");
});

if (deepCaptureEl) {
  deepCaptureEl.addEventListener("change", async () => {
    const tabId = await getCurrentTabId();
    if (!tabId) return setStatus("Could not find current tab.");

    const enable = !!deepCaptureEl.checked;
    chrome.runtime.sendMessage({ type: "SET_DEEP_CAPTURE", tabId, enabled: enable }, (res) => {
      if (res?.ok) {
        setStatus(enable ? "Deep capture enabled" : "Deep capture disabled");
      } else {
        deepCaptureEl.checked = !enable;
        setStatus(`Deep capture failed: ${res?.error || "unknown"}`);
      }
    });
  });
}

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
      const url = res?.url;
      if (url) {
        copyToClipboard(url).then((copied) => {
          if (copied) showToast("Share link copied.");
          else showToast("Share opened (copy failed).");
        });
      }
      if (res.inline) setStatus("Public Viewer opened.");
      else setStatus("Public Viewer opened. Upload the downloaded JSON.");
    } else {
      const err = res?.error || "unknown";
      if (err === "missing_server_url") setStatus("Server URL missing.");
      else if (err === "missing_jwt") setStatus("JWT missing.");
      else setStatus(`Open Viewer failed: ${err}`);
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

