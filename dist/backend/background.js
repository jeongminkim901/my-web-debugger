// background.js (MV3 service worker)
let recording = false;
let sessionStartedAt = null;
let sessionEndedAt = null;
// Viewer/share configuration.
// Flip ENABLE_SERVER_SHARING back to true when you want to re-enable the server flow.
const ENABLE_SERVER_SHARING = false;
const PUBLIC_VIEWER_URL = "https://jeongminkim901.github.io/my-web-debugger/";
const PUBLIC_VIEWER_MAX_INLINE_BYTES = 700_000; // keep URL reasonably short
const SCREENSHOT_MAX_INLINE_BYTES = 200_000;
const SERVER_BASE_URL = "http://192.168.20.112";
const SERVER_VIEWER_BASE_URL = "http://192.168.20.112";
const SERVER_TTL_DAYS = 30;
const SERVER_TTL_SECONDS = SERVER_TTL_DAYS * 24 * 60 * 60;
const OFFSCREEN_RECORDER_URL = "dist/offscreen/recorder.html";
const ERROR_SCREENSHOT_LIMIT = 3;
const ERROR_CLIP_PRE_MS = 10000;
const ERROR_CLIP_POST_MS = 10000;
const ERROR_CLIP_MAX = 3;
// tabId -> { console: [], network: [], requests: Map() }
const store = new Map();
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const DEBUGGER_MAX_BODY_CHARS = 200_000;
const WEBSOCKET_MAX_CHARS = 20_000;
const debuggerState = new Map(); // tabId -> { enabled: boolean, attached: boolean, requests: Map() }
let debuggerEventsInstalled = false;
function ensureDebuggerState(tabId) {
    if (!debuggerState.has(tabId)) {
        debuggerState.set(tabId, { enabled: false, attached: false, requests: new Map(), websockets: new Map() });
    }
    return debuggerState.get(tabId);
}
function isDeepCaptureEnabled(tabId) {
    return !!debuggerState.get(tabId)?.enabled;
}
function isTextContentType(ct) {
    if (!ct)
        return true;
    const v = String(ct).toLowerCase();
    return (v.startsWith("text/") ||
        v.includes("json") ||
        v.includes("xml") ||
        v.includes("x-www-form-urlencoded") ||
        v.includes("javascript"));
}
function clampText(s) {
    if (typeof s !== "string")
        return s;
    if (s.length <= DEBUGGER_MAX_BODY_CHARS)
        return s;
    return s.slice(0, DEBUGGER_MAX_BODY_CHARS) + `\n...[truncated ${s.length - DEBUGGER_MAX_BODY_CHARS} chars]`;
}
function clampWsPayload(s) {
    if (typeof s !== "string")
        return s;
    if (s.length <= WEBSOCKET_MAX_CHARS)
        return s;
    return s.slice(0, WEBSOCKET_MAX_CHARS) + `\n...[truncated ${s.length - WEBSOCKET_MAX_CHARS} chars]`;
}
function decodeDebuggerBody(body, base64Encoded, mimeType) {
    if (!body)
        return null;
    if (!base64Encoded)
        return clampText(body);
    if (body.length > DEBUGGER_MAX_BODY_CHARS * 2) {
        return "[base64 body too large]";
    }
    if (!isTextContentType(mimeType)) {
        const label = mimeType ? `base64 ${mimeType}` : "base64 binary";
        return `[${label}; ${body.length} chars]`;
    }
    try {
        const binary = atob(body);
        return clampText(binary);
    }
    catch {
        return "[unreadable base64 body]";
    }
}
function installDebuggerEventsOnce() {
    if (debuggerEventsInstalled)
        return;
    debuggerEventsInstalled = true;
    chrome.debugger.onEvent.addListener((source, method, params) => {
        const tabId = source?.tabId;
        if (!tabId)
            return;
        if (!recording || !isDeepCaptureEnabled(tabId))
            return;
        const state = ensureDebuggerState(tabId);
        if (!state.attached)
            return;
        const data = ensure(tabId);
        if (method === "Network.webSocketCreated") {
            const p = params || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            state.websockets.set(requestId, {
                id: requestId,
                url: p.url || "",
                createdAt: Date.now()
            });
            data.websockets.push({
                id: requestId,
                url: p.url || "",
                direction: "open",
                opcode: null,
                payload: null,
                timestamp: Date.now(),
                transport: "debugger"
            });
            return;
        }
        if (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived") {
            const p = params || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            const info = p.response || {};
            const ws = state.websockets.get(requestId);
            const payload = clampWsPayload(info.payloadData || "");
            data.websockets.push({
                id: requestId,
                url: ws?.url || "",
                direction: method === "Network.webSocketFrameSent" ? "sent" : "received",
                opcode: typeof info.opcode === "number" ? info.opcode : null,
                payload,
                timestamp: Date.now(),
                transport: "debugger"
            });
            return;
        }
        if (method === "Network.webSocketClosed") {
            const p = params || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            const ws = state.websockets.get(requestId);
            data.websockets.push({
                id: requestId,
                url: ws?.url || "",
                direction: "close",
                opcode: null,
                payload: null,
                timestamp: Date.now(),
                transport: "debugger"
            });
            state.websockets.delete(requestId);
            return;
        }
        if (method === "Network.requestWillBeSent") {
            const p = params || {};
            const req = p.request || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            state.requests.set(requestId, {
                id: requestId,
                url: req.url || "",
                method: req.method || "GET",
                type: "debugger",
                transport: "debugger",
                resourceType: p.type || null,
                startTime: Date.now(),
                requestBody: typeof req.postData === "string" ? clampText(req.postData) : null,
                pageUrl: p.documentURL || null
            });
            return;
        }
        if (method === "Network.responseReceived") {
            const p = params || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            const item = state.requests.get(requestId) || {
                id: requestId,
                url: p.response?.url || "",
                method: "(unknown)",
                type: "debugger",
                transport: "debugger",
                startTime: Date.now()
            };
            item.statusCode = p.response?.status ?? null;
            item.ok = typeof item.statusCode === "number" ? item.statusCode >= 200 && item.statusCode < 400 : null;
            item.mimeType = p.response?.mimeType || null;
            item.responseHeaders = p.response?.headers || null;
            state.requests.set(requestId, item);
            return;
        }
        if (method === "Network.loadingFailed") {
            const p = params || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            const item = state.requests.get(requestId);
            if (!item)
                return;
            item.endTime = Date.now();
            item.durationMs = item.startTime ? item.endTime - item.startTime : null;
            item.error = p.errorText || "loading failed";
            data.network.push(item);
            state.requests.delete(requestId);
            return;
        }
        if (method === "Network.loadingFinished") {
            const p = params || {};
            const requestId = p.requestId;
            if (!requestId)
                return;
            const item = state.requests.get(requestId);
            if (!item)
                return;
            const target = { tabId };
            chrome.debugger.sendCommand(target, "Network.getResponseBody", { requestId }, (res) => {
                const end = Date.now();
                item.endTime = end;
                item.durationMs = item.startTime ? end - item.startTime : null;
                if (chrome.runtime.lastError || !res) {
                    const reason = chrome.runtime.lastError?.message || "response body unavailable";
                    item.responseBody = `[body unavailable] ${reason}`;
                }
                else {
                    const bodyRes = res || {};
                    item.responseBody = decodeDebuggerBody(bodyRes.body, bodyRes.base64Encoded, item.mimeType || "");
                }
                data.network.push(item);
                state.requests.delete(requestId);
                void maybeCaptureErrorScreenshot(tabId, item.statusCode, item.url);
                maybeCaptureErrorClip(tabId, item.statusCode, item.url);
            });
        }
    });
}
async function attachDebugger(tabId) {
    installDebuggerEventsOnce();
    const state = ensureDebuggerState(tabId);
    if (state.attached)
        return { ok: true };
    return new Promise((resolve) => {
        chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION, () => {
            const err = chrome.runtime.lastError;
            if (err)
                return resolve({ ok: false, error: err.message || "attach_failed" });
            chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxPostDataSize: 65536 }, () => {
                const err2 = chrome.runtime.lastError;
                if (err2)
                    return resolve({ ok: false, error: err2.message || "enable_failed" });
                state.attached = true;
                resolve({ ok: true });
            });
        });
    });
}
async function detachDebugger(tabId) {
    const state = debuggerState.get(tabId);
    if (!state || !state.attached)
        return { ok: true };
    return new Promise((resolve) => {
        chrome.debugger.detach({ tabId }, () => {
            state.attached = false;
            state.requests.clear();
            resolve({ ok: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message });
        });
    });
}
function ensure(tabId) {
    if (!store.has(tabId)) {
        store.set(tabId, {
            console: [],
            network: [],
            websockets: [],
            requests: new Map(),
            errorScreenshots: [],
            errorScreenshot: null,
            errorScreenshotAt: null
        });
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
    }
    catch {
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
    }
    catch {
        return null;
    }
}
// ✅ URL 마스킹
function maskUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        const SENSITIVE_KEYS = new Set([
            "token", "access_token", "refresh_token", "id_token",
            "auth", "authorization",
            "apikey", "api_key", "key",
            "secret", "password", "pass",
            "session", "sessionid", "sid"
        ]);
        for (const [k] of u.searchParams) {
            const key = k.toLowerCase();
            if (SENSITIVE_KEYS.has(key) || key.includes("token") || key.includes("secret")) {
                u.searchParams.set(k, "***");
            }
        }
        return u.toString();
    }
    catch {
        return rawUrl;
    }
}
function maskSensitiveValue(value) {
    const SENSITIVE_KEYS = [
        "token", "access_token", "refresh_token", "id_token",
        "auth", "authorization",
        "apikey", "api_key", "key",
        "secret", "password", "pass",
        "session", "sessionid", "sid"
    ];
    if (value === null || value === undefined)
        return value;
    if (typeof value === "string") {
        let s = value;
        for (const k of SENSITIVE_KEYS) {
            const re = new RegExp(`(${k}\\s*[:=]\\s*)([^\\s&]+)`, "ig");
            s = s.replace(re, "$1***");
        }
        return s;
    }
    if (Array.isArray(value))
        return value.map(maskSensitiveValue);
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const key = String(k).toLowerCase();
            if (SENSITIVE_KEYS.includes(key) || key.includes("token") || key.includes("secret")) {
                out[k] = "***";
            }
            else {
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
    }
    catch { }
    const statusCode = item.statusCode ?? null;
    const statusGroup = typeof statusCode === "number" ? `${Math.floor(statusCode / 100)}xx` : "unknown";
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
    const session = started
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
        errorScreenshot: data?.errorScreenshot || null,
        errorScreenshotAt: data?.errorScreenshotAt || null,
        errorScreenshots: data?.errorScreenshots || null,
        summary,
        console: data.console,
        network: normalizedNetwork,
        websockets: data.websockets || []
    };
}
function sanitizeFilename(name) {
    const trimmed = String(name || "").trim();
    const safe = trimmed
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!safe)
        return "unknown";
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
        }
        catch {
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
function base64UrlFromBytes(bytes) {
    const b64 = base64FromBytes(bytes);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function encodeForUrlPayload(text) {
    const bytes = new TextEncoder().encode(text);
    const rawPayload = `raw:${base64UrlFromBytes(bytes)}`;
    // Prefer gzip compression when available.
    try {
        if (typeof CompressionStream !== "undefined") {
            const cs = new CompressionStream("gzip");
            const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
            const gzPayload = `gz:${base64UrlFromBytes(new Uint8Array(compressed))}`;
            const payload = (gzPayload.length < rawPayload.length) ? gzPayload : rawPayload;
            return { payload, byteLength: new TextEncoder().encode(payload).length };
        }
    }
    catch {
        // fallback to raw
    }
    return { payload: rawPayload, byteLength: new TextEncoder().encode(rawPayload).length };
}
async function captureScreenshot(tab) {
    try {
        if (!tab?.windowId)
            return null;
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        if (typeof dataUrl !== "string")
            return null;
        return dataUrl;
    }
    catch {
        return null;
    }
}
async function maybeCaptureErrorScreenshot(tabId, statusCode, url) {
    if (typeof statusCode !== "number" || statusCode < 400)
        return;
    const data = ensure(tabId);
    if (Array.isArray(data.errorScreenshots) && data.errorScreenshots.length >= ERROR_SCREENSHOT_LIMIT)
        return;
    chrome.tabs.get(tabId, async (tab) => {
        if (!tab || !tab.active)
            return;
        const shot = await captureScreenshot(tab);
        if (shot) {
            const at = Date.now();
            data.errorScreenshot = data.errorScreenshot || shot;
            data.errorScreenshotAt = data.errorScreenshotAt || at;
            if (!Array.isArray(data.errorScreenshots))
                data.errorScreenshots = [];
            data.errorScreenshots.push({
                dataUrl: shot,
                at,
                statusCode,
                url: url || null
            });
        }
    });
}
function maybeCaptureErrorClip(tabId, statusCode, url) {
    if (!recording)
        return;
    if (typeof statusCode !== "number" || statusCode < 400)
        return;
    try {
        chrome.runtime.sendMessage({
            type: "REC_MARK",
            tabId,
            statusCode,
            url,
            at: Date.now(),
            preMs: ERROR_CLIP_PRE_MS,
            postMs: ERROR_CLIP_POST_MS,
            maxClips: ERROR_CLIP_MAX
        }, () => void chrome.runtime.lastError);
    }
    catch {
        // ignore
    }
}
function isInlineSafe(text, screenshot) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > PUBLIC_VIEWER_MAX_INLINE_BYTES)
        return false;
    if (screenshot) {
        const sBytes = new TextEncoder().encode(screenshot);
        if (sBytes.length > SCREENSHOT_MAX_INLINE_BYTES)
            return false;
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
    }
    catch {
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
    }
    catch {
        return null;
    }
}
function normalizeBaseUrl(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return "";
    return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}
async function ensureOffscreenRecorder() {
    const offscreen = chrome.offscreen;
    if (!offscreen)
        return false;
    if (await offscreen.hasDocument?.())
        return true;
    try {
        await offscreen.createDocument({
            url: OFFSCREEN_RECORDER_URL,
            reasons: [offscreen.Reason?.USER_MEDIA || "USER_MEDIA"],
            justification: "Record tab video for local session playback."
        });
        return true;
    }
    catch {
        return false;
    }
}
async function closeOffscreenRecorder() {
    const offscreen = chrome.offscreen;
    if (!offscreen)
        return;
    try {
        if (await offscreen.hasDocument?.()) {
            await offscreen.closeDocument();
        }
    }
    catch {
        // ignore
    }
}
async function startVideoRecording(tabId) {
    const ok = await ensureOffscreenRecorder();
    if (!ok)
        return false;
    return new Promise((resolve) => {
        try {
            chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                const err = chrome.runtime.lastError;
                if (err || !streamId) {
                    console.warn("getMediaStreamId failed", err?.message);
                    return resolve(false);
                }
                chrome.runtime.sendMessage({ type: "REC_START", tabId, streamId }, () => resolve(true));
            });
        }
        catch {
            resolve(false);
        }
    });
}
async function stopVideoRecording() {
    try {
        chrome.runtime.sendMessage({ type: "REC_STOP" });
    }
    finally {
        await closeOffscreenRecorder();
    }
}
async function stopVideoRecordingAndWait() {
    try {
        await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "REC_STOP_WAIT" }, () => resolve());
        });
    }
    finally {
        await closeOffscreenRecorder();
    }
}
function buildShareViewerUrl(viewerBaseUrl, id) {
    const base = normalizeBaseUrl(viewerBaseUrl || PUBLIC_VIEWER_URL);
    return `${base}/#id=${encodeURIComponent(id)}`;
}
async function shareToServer(exportData) {
    const baseUrl = normalizeBaseUrl(SERVER_BASE_URL);
    if (!baseUrl)
        return { ok: false, error: "missing_server_url" };
    const res = await fetch(`${baseUrl}/share`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            payload: exportData,
            meta: exportData?.meta || null,
            ttlSeconds: SERVER_TTL_SECONDS
        })
    });
    if (!res.ok) {
        return { ok: false, error: `share_failed_${res.status}` };
    }
    const data = await res.json().catch(() => null);
    const id = data?.id || data?.shareId || null;
    if (!id)
        return { ok: false, error: "missing_id" };
    return { ok: true, id };
}
// ✅ 메시지 처리
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_STATUS") {
        sendResponse({ ok: true, recording });
        return true;
    }
    if (msg.type === "GET_DEEP_CAPTURE") {
        const tabId = msg.tabId;
        if (!tabId) {
            sendResponse({ ok: false, error: "no_tab" });
            return true;
        }
        const state = ensureDebuggerState(tabId);
        sendResponse({ ok: true, enabled: !!state.enabled, attached: !!state.attached });
        return true;
    }
    if (msg.type === "SET_DEEP_CAPTURE") {
        (async () => {
            const tabId = msg.tabId;
            const enabled = !!msg.enabled;
            if (!tabId) {
                sendResponse({ ok: false, error: "no_tab" });
                return;
            }
            const state = ensureDebuggerState(tabId);
            state.enabled = enabled;
            if (enabled && recording) {
                const res = await attachDebugger(tabId);
                sendResponse({ ok: !!res.ok, error: res.error || null });
            }
            else {
                const res = await detachDebugger(tabId);
                sendResponse({ ok: !!res.ok, error: res.error || null });
            }
        })();
        return true;
    }
    if (msg.type === "START") {
        recording = true;
        sessionStartedAt = Date.now();
        sessionEndedAt = null;
        const tabId = sender.tab?.id || msg.tabId;
        if (tabId) {
            store.set(tabId, {
                console: [],
                network: [],
                websockets: [],
                requests: new Map(),
                errorScreenshots: [],
                errorScreenshot: null,
                errorScreenshotAt: null
            });
        }
        if (tabId && isDeepCaptureEnabled(tabId)) {
            void attachDebugger(tabId);
        }
        if (tabId)
            void startVideoRecording(tabId);
        sendResponse({ ok: true, clearedTabId: tabId || null });
        return true;
    }
    if (msg.type === "STOP") {
        recording = false;
        sessionEndedAt = Date.now();
        for (const [tabId, state] of debuggerState.entries()) {
            if (state.attached)
                void detachDebugger(tabId);
        }
        void stopVideoRecording();
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
        if (!recording)
            return true;
        const tabId = sender.tab?.id;
        if (!tabId)
            return true;
        const data = ensure(tabId);
        data.console.push(msg.payload);
        sendResponse({ ok: true });
        return true;
    }
    // ✅ (NEW) 페이지에서 수집한 network 이벤트 저장
    if (msg.type === "NETWORK_EVENT") {
        if (!recording)
            return true;
        const tabId = sender.tab?.id;
        if (!tabId)
            return true;
        if (isDeepCaptureEnabled(tabId)) {
            sendResponse({ ok: true, ignored: true, reason: "debugger_enabled" });
            return true;
        }
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
            type: "page", // webRequest와 구분
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
        void maybeCaptureErrorScreenshot(tabId, p.statusCode, p.url);
        maybeCaptureErrorClip(tabId, p.statusCode, p.url);
        sendResponse({ ok: true });
        return true;
    }
    if (msg.type === "GET_EXPORT_DATA") {
        (async () => {
            const tabId = msg.tabId;
            const exportData = await loadExportFromSession(tabId);
            if (exportData)
                sendResponse({ ok: true, data: exportData });
            else
                sendResponse({ ok: false, error: "no_export_data" });
        })();
        return true;
    }
    if (msg.type === "EXPORT") {
        const tabId = msg.tabId;
        chrome.tabs.get(tabId, async (tab) => {
            const data = store.get(tabId) || { console: [], network: [], websockets: [], requests: new Map() };
            const meta = await loadMeta(tabId);
            const screenshot = await captureScreenshot(tab);
            const exportData = buildExportData({ tabId, tab, data, meta, screenshot });
            const json = JSON.stringify(exportData, null, 2);
            const filename = makeFilename(exportData);
            const dataUrl = "data:application/json;charset=utf-8," + encodeURIComponent(json);
            chrome.downloads.download({ url: dataUrl, filename, saveAs: true }, (downloadId) => {
                const err = chrome.runtime.lastError;
                if (err || !downloadId) {
                    sendResponse({ ok: false, error: err?.message || "download_failed" });
                    return;
                }
                sendResponse({ ok: true, downloadId, filename });
            });
        });
        return true;
    }
    if (msg.type === "OPEN_VIEWER") {
        (async () => {
            const tabId = msg.tabId;
            chrome.tabs.get(tabId, async (tab) => {
                const data = store.get(tabId) || { console: [], network: [], websockets: [], requests: new Map() };
                const meta = await loadMeta(tabId);
                const screenshot = await captureScreenshot(tab);
                const exportData = buildExportData({ tabId, tab, data, meta, screenshot });
                await saveExportToSession(tabId, exportData);
                await stopVideoRecordingAndWait();
                if (ENABLE_SERVER_SHARING) {
                    try {
                        const shareRes = await shareToServer(exportData);
                        if (!shareRes.ok) {
                            sendResponse({ ok: false, error: shareRes.error || "share_failed" });
                            return;
                        }
                        const viewerUrl = buildShareViewerUrl(SERVER_VIEWER_BASE_URL, shareRes.id);
                        chrome.tabs.create({ url: viewerUrl }, () => {
                            sendResponse({ ok: true, public: false, inline: false, id: shareRes.id, url: viewerUrl });
                        });
                        return;
                    }
                    catch (err) {
                        sendResponse({ ok: false, error: "share_failed" });
                        return;
                    }
                }
        const localViewerBase = chrome.runtime.getURL("dist/viewer.html");
                const localViewerUrl = tabId ? `${localViewerBase}?tabId=${encodeURIComponent(String(tabId))}` : localViewerBase;
                chrome.tabs.create({ url: localViewerUrl }, () => {
                    sendResponse({ ok: true, local: true, url: localViewerUrl });
                });
                return;
            });
        })();
        return true;
    }
    return true;
});
// --------------------
// (옵션) webRequest 수집도 유지 (원하면 나중에 끄자)
// --------------------
chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (!recording)
        return;
    if (details.tabId === -1 || !details.tabId)
        return;
    if (isDeepCaptureEnabled(details.tabId))
        return;
    const data = ensure(details.tabId);
    data.requests.set(details.requestId, {
        id: details.requestId,
        url: details.url,
        method: details.method,
        type: details.type,
        startTime: Date.now()
    });
}, { urls: ["<all_urls>"] });
chrome.webRequest.onHeadersReceived.addListener((details) => {
    if (!recording)
        return;
    if (details.tabId === -1 || !details.tabId)
        return;
    if (isDeepCaptureEnabled(details.tabId))
        return;
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
    item.fromCache = details.fromCache;
    item.endTime = Date.now();
    if (item.startTime)
        item.durationMs = item.endTime - item.startTime;
    data.network.push(item);
    data.requests.delete(details.requestId);
    void maybeCaptureErrorScreenshot(details.tabId, item.statusCode, item.url);
    maybeCaptureErrorClip(details.tabId, item.statusCode, item.url);
}, { urls: ["<all_urls>"] });
chrome.tabs.onRemoved.addListener((tabId) => {
    if (debuggerState.has(tabId)) {
        void detachDebugger(tabId);
        debuggerState.delete(tabId);
    }
    store.delete(tabId);
});
export {};
