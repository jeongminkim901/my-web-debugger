// background.js (MV3 service worker)

let recording = false;
let sessionStartedAt = null;
let sessionEndedAt = null;

// Public viewer (GitHub Pages) for sharing.
const PUBLIC_VIEWER_URL = "https://jeongminkim901.github.io/my-web-debugger/";
const PUBLIC_VIEWER_MAX_INLINE_BYTES = 700_000; // keep URL reasonably short
const SCREENSHOT_MAX_INLINE_BYTES = 200_000;

// tabId -> { console: [], network: [], requests: Map() }
const store = new Map();

function ensure(tabId) {
  if (!store.has(tabId)) {
    store.set(tabId, { console: [], network: [], requests: new Map() });
  }
  return store.get(tabId);
}

async function saveMeta(tabId, meta) {
  const key = `meta:${tabId}`;
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: meta });
      return true;
    }
    await chrome.storage.local.set({ [key]: meta });
    return true;
  } catch {
    return false;
  }
}

async function loadMeta(tabId) {
  const key = `meta:${tabId}`;
  try {
    if (chrome.storage?.session) {
      const res = await chrome.storage.session.get(key);
      return res?.[key] || null;
    }
    const res = await chrome.storage.local.get(key);
    return res?.[key] || null;
  } catch {
    return null;
  }
}

// ✅ URL 마스킹
function maskUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);

    const SENSITIVE_KEYS = new Set([
      "token","access_token","refresh_token","id_token",
      "auth","authorization",
      "apikey","api_key","key",
      "secret","password","pass",
      "session","sessionid","sid"
    ]);

    for (const [k] of u.searchParams) {
      const key = k.toLowerCase();
      if (SENSITIVE_KEYS.has(key) || key.includes("token") || key.includes("secret")) {
        u.searchParams.set(k, "***");
      }
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

function maskSensitiveValue(value) {
  const SENSITIVE_KEYS = [
    "token","access_token","refresh_token","id_token",
    "auth","authorization",
    "apikey","api_key","key",
    "secret","password","pass",
    "session","sessionid","sid"
  ];

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    let s = value;
    for (const k of SENSITIVE_KEYS) {
      const re = new RegExp(`(${k}\\s*[:=]\\s*)([^\\s&]+)`, "ig");
      s = s.replace(re, "$1***");
    }
    return s;
  }

  if (Array.isArray(value)) return value.map(maskSensitiveValue);

  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = String(k).toLowerCase();
      if (SENSITIVE_KEYS.includes(key) || key.includes("token") || key.includes("secret")) {
        out[k] = "***";
      } else {
        out[k] = maskSensitiveValue(v);
      }
    }
    return out;
  }

  return value;
}

// ✅ network 정규화
function normalizeNetworkItem(item) {
  const maskedUrl = maskUrl(item.url);

  let host = "";
  let path = "";
  let shortUrl = maskedUrl;

  try {
    const u = new URL(maskedUrl);
    host = u.host;
    path = u.pathname;
    shortUrl = u.origin + u.pathname;
  } catch {}

  const statusCode = item.statusCode ?? null;
  const statusGroup =
    typeof statusCode === "number" ? `${Math.floor(statusCode / 100)}xx` : "unknown";

  const startIso = item.startTime ? new Date(item.startTime).toISOString() : null;
  const endIso = item.endTime ? new Date(item.endTime).toISOString() : null;

  return {
    id: item.id,
    method: item.method,
    url: maskedUrl,
    host,
    path,
    shortUrl,
    type: item.type,
    statusCode,
    statusGroup,
    durationMs: item.durationMs ?? null,
    startedAt: item.startTime ?? null,
    endedAt: item.endTime ?? null,
    startedAtIso: startIso,
    endedAtIso: endIso,

    // page hook 전용(있으면 viewer Raw에서 확인 가능)
    transport: item.transport || null,
    requestBody: maskSensitiveValue(item.requestBody ?? null),
    responseBody: maskSensitiveValue(item.responseBody ?? null),
    ok: item.ok ?? null,
    error: maskSensitiveValue(item.error ?? null),
    pageUrl: item.pageUrl ?? null
  };
}

function buildSummary(networkItems) {
  const totalRequests = networkItems.length;

  const byStatusGroup = {};
  for (const item of networkItems) {
    const key = item.statusGroup || "unknown";
    byStatusGroup[key] = (byStatusGroup[key] || 0) + 1;
  }

  const byHost = {};
  for (const item of networkItems) {
    const host = item.host || "unknown";
    byHost[host] = (byHost[host] || 0) + 1;
  }

  const slowestTop5 = [...networkItems]
    .filter((x) => typeof x.durationMs === "number")
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5)
    .map((x) => ({
      method: x.method,
      statusCode: x.statusCode,
      durationMs: x.durationMs,
      shortUrl: x.shortUrl
    }));

  return { totalRequests, byStatusGroup, byHost, slowestTop5 };
}

function buildExportData({ tabId, tab, data, meta, screenshot }) {
  const normalizedNetwork = data.network.map(normalizeNetworkItem);
  const summary = buildSummary(normalizedNetwork);

  const started = sessionStartedAt;
  const ended = sessionEndedAt || Date.now();
  const session =
    started
      ? {
          startedAt: started,
          endedAt: ended,
          startedAtIso: new Date(started).toISOString(),
          endedAtIso: new Date(ended).toISOString(),
          durationMs: ended - started
        }
      : null;

  return {
    version: "0.1.0",
    createdAt: Date.now(),
    createdAtIso: new Date().toISOString(),
    tabId,
    page: {
      url: tab?.url ? maskUrl(tab.url) : null,
      title: tab?.title || null
    },
    session,
    meta: meta || null,
    screenshot: screenshot || null,
    summary,
    console: data.console,
    network: normalizedNetwork
  };
}

function sanitizeFilename(name) {
  const trimmed = String(name || "").trim();
  const safe = trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!safe) return "unknown";
  return safe.slice(0, 80);
}

function makeFilename(exportData) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(exportData.createdAt || Date.now());

  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());

  const host = (() => {
    try {
      return sanitizeFilename(new URL(exportData.page?.url || "").host.replaceAll(".", "_"));
    } catch {
      return "unknown";
    }
  })();

  return `debug-session_${host}_${yyyy}${mm}${dd}_${hh}${mi}${ss}.json`;
}

function base64FromBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function encodeForUrlPayload(text) {
  const bytes = new TextEncoder().encode(text);
  const b64 = base64FromBytes(bytes);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function captureScreenshot(tab) {
  try {
    if (!tab?.windowId) return null;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    if (typeof dataUrl !== "string") return null;
    return dataUrl;
  } catch {
    return null;
  }
}

function isInlineSafe(text, screenshot) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > PUBLIC_VIEWER_MAX_INLINE_BYTES) return false;
  if (screenshot) {
    const sBytes = new TextEncoder().encode(screenshot);
    if (sBytes.length > SCREENSHOT_MAX_INLINE_BYTES) return false;
  }
  return true;
}

async function saveExportToSession(tabId, exportData) {
  const key = `lastExport:${tabId}`;
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [key]: exportData });
      return true;
    }
    await chrome.storage.local.set({ [key]: exportData });
    return true;
  } catch {
    return false;
  }
}

async function loadExportFromSession(tabId) {
  const key = `lastExport:${tabId}`;
  try {
    if (chrome.storage?.session) {
      const res = await chrome.storage.session.get(key);
      return res?.[key] || null;
    }
    const res = await chrome.storage.local.get(key);
    return res?.[key] || null;
  } catch {
    return null;
  }
}

// ✅ 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_STATUS") {
    sendResponse({ ok: true, recording });
    return true;
  }

  if (msg.type === "START") {
    recording = true;
    sessionStartedAt = Date.now();
    sessionEndedAt = null;

    const tabId = sender.tab?.id || msg.tabId;
    if (tabId) store.set(tabId, { console: [], network: [], requests: new Map() });

    sendResponse({ ok: true, clearedTabId: tabId || null });
    return true;
  }

  if (msg.type === "STOP") {
    recording = false;
    sessionEndedAt = Date.now();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "SET_META") {
    (async () => {
      const tabId = msg.tabId;
      const meta = msg.meta || null;
      const ok = tabId ? await saveMeta(tabId, meta) : false;
      sendResponse({ ok: !!ok });
    })();
    return true;
  }

  if (msg.type === "CONSOLE_EVENT") {
    if (!recording) return true;
    const tabId = sender.tab?.id;
    if (!tabId) return true;

    const data = ensure(tabId);
    data.console.push(msg.payload);
    sendResponse({ ok: true });
    return true;
  }

  // ✅ (NEW) 페이지에서 수집한 network 이벤트 저장
  if (msg.type === "NETWORK_EVENT") {
    if (!recording) return true;
    const tabId = sender.tab?.id;
    if (!tabId) return true;

    const p = msg.payload || {};
    const data = ensure(tabId);

    // phase=end만 저장(시작 이벤트까지 저장하면 중복/노이즈)
    if (p.phase !== "end") {
      sendResponse({ ok: true, ignored: true });
      return true;
    }

    data.network.push({
      id: p.id || `p_${Date.now()}`,
      url: p.url || "",
      method: p.method || "GET",
      type: "page",          // webRequest와 구분
      transport: p.transport || null,
      statusCode: (typeof p.statusCode === "number") ? p.statusCode : null,
      startTime: p.startTime || null,
      endTime: p.endTime || null,
      durationMs: (typeof p.durationMs === "number") ? p.durationMs : null,
      requestBody: p.requestBody ?? null,
      responseBody: p.responseBody ?? null,
      ok: p.ok ?? null,
      error: p.error ?? null,
      pageUrl: p.pageUrl ?? null
    });

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "GET_EXPORT_DATA") {
    (async () => {
      const tabId = msg.tabId;
      const exportData = await loadExportFromSession(tabId);
      if (exportData) sendResponse({ ok: true, data: exportData });
      else sendResponse({ ok: false, error: "no_export_data" });
    })();
    return true;
  }

  if (msg.type === "EXPORT") {
    const tabId = msg.tabId;

    chrome.tabs.get(tabId, async (tab) => {
      const data = store.get(tabId) || { console: [], network: [], requests: new Map() };
      const meta = await loadMeta(tabId);
      const screenshot = await captureScreenshot(tab);
      const exportData = buildExportData({ tabId, tab, data, meta, screenshot });

      const json = JSON.stringify(exportData, null, 2);
      const filename = makeFilename(exportData);
      const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(json);

      chrome.downloads.download(
        { url: dataUrl, filename, saveAs: true },
        (downloadId) => {
          const err = chrome.runtime.lastError;
          if (err || !downloadId) {
            sendResponse({ ok: false, error: err?.message || "download_failed" });
            return;
          }
          sendResponse({ ok: true, downloadId, filename });
        }
      );
    });

    return true;
  }

  if (msg.type === "OPEN_VIEWER") {
    (async () => {
      const tabId = msg.tabId;

      chrome.tabs.get(tabId, async (tab) => {
        const data = store.get(tabId) || { console: [], network: [], requests: new Map() };
        const meta = await loadMeta(tabId);
        const screenshot = await captureScreenshot(tab);
        const exportData = buildExportData({ tabId, tab, data, meta, screenshot });

        const json = JSON.stringify(exportData, null, 2);
        const inlineSafe = isInlineSafe(json, exportData.screenshot);

        if (inlineSafe) {
          const payload = encodeForUrlPayload(json);
          const viewerUrl = `${PUBLIC_VIEWER_URL}#data=${payload}`;
          chrome.tabs.create({ url: viewerUrl }, () => {
            sendResponse({ ok: true, public: true, inline: true });
          });
          return;
        }

        // Fallback: download JSON for large payloads.
        const filename = makeFilename(exportData);
        const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(json);

        chrome.downloads.download(
          { url: dataUrl, filename, saveAs: true },
          (downloadId) => {
            const err = chrome.runtime.lastError;
            if (err || !downloadId) {
              sendResponse({ ok: false, error: err?.message || "download_failed" });
              return;
            }
            const viewerUrl = `${PUBLIC_VIEWER_URL}?t=${Date.now()}`;
            chrome.tabs.create({ url: viewerUrl }, () => {
              sendResponse({ ok: true, downloadId, filename, public: true, inline: false });
            });
          }
        );
      });
    })();

    return true;
  }

  return true;
});

// --------------------
// (옵션) webRequest 수집도 유지 (원하면 나중에 끄자)
// --------------------
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!recording) return;
    if (details.tabId === -1 || !details.tabId) return;

    const data = ensure(details.tabId);

    data.requests.set(details.requestId, {
      id: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      startTime: Date.now()
    });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!recording) return;
    if (details.tabId === -1 || !details.tabId) return;

    const data = ensure(details.tabId);
    const req = data.requests.get(details.requestId);

    const item = req || {
      id: details.requestId,
      url: details.url,
      method: "(unknown)",
      type: details.type,
      startTime: null
    };

    item.statusCode = details.statusCode;
    item.fromCache = (details as chrome.webRequest.WebResponseCacheDetails).fromCache;
    item.endTime = Date.now();
    if (item.startTime) item.durationMs = item.endTime - item.startTime;

    data.network.push(item);
    data.requests.delete(details.requestId);
  },
  { urls: ["<all_urls>"] }
);
