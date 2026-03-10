const DB_NAME = "my-web-debugger";
const DB_VERSION = 2;
const STORE_NAME = "recordings";
const CLIP_STORE = "recordingClips";
const DEFAULT_CLIP_PRE_MS = 10000;
const DEFAULT_CLIP_POST_MS = 10000;
const DEFAULT_MAX_CLIPS = 3;
let recorder = null;
let chunks = [];
let currentTabId = null;
let currentStream = null;
let pendingStopResponder = null;
let currentMime = null;
let chunkBuffer = [];
let activeMarks = [];
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "tabId" });
            }
            if (!db.objectStoreNames.contains(CLIP_STORE)) {
                const store = db.createObjectStore(CLIP_STORE, { keyPath: "clipId" });
                store.createIndex("tabId", "tabId", { unique: false });
                store.createIndex("createdAt", "createdAt", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function txComplete(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
async function clearRecording(tabId) {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(tabId);
    await txComplete(tx);
    db.close();
}
async function saveRecording(tabId, blob, mime) {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({
        tabId,
        blob,
        mime,
        createdAt: Date.now()
    });
    await txComplete(tx);
    db.close();
}
async function listClips(tabId) {
    const db = await openDb();
    const tx = db.transaction(CLIP_STORE, "readonly");
    const store = tx.objectStore(CLIP_STORE);
    const idx = store.index("tabId");
    const clips = [];
    await new Promise((resolve, reject) => {
        const req = idx.openCursor(IDBKeyRange.only(tabId));
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                clips.push(cursor.value);
                cursor.continue();
            }
            else {
                resolve();
            }
        };
        req.onerror = () => reject(req.error);
    });
    await txComplete(tx);
    db.close();
    return clips;
}
async function enforceClipLimit(tabId, maxClips) {
    const clips = await listClips(tabId);
    if (clips.length <= maxClips)
        return;
    const sorted = clips.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const toDelete = sorted.slice(0, Math.max(0, sorted.length - maxClips));
    const db = await openDb();
    const tx = db.transaction(CLIP_STORE, "readwrite");
    const store = tx.objectStore(CLIP_STORE);
    for (const c of toDelete) {
        store.delete(c.clipId);
    }
    await txComplete(tx);
    db.close();
}
async function saveClip(tabId, blob, mime, meta, maxClips) {
    const db = await openDb();
    const tx = db.transaction(CLIP_STORE, "readwrite");
    const clipId = `${tabId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tx.objectStore(CLIP_STORE).put({
        clipId,
        tabId,
        blob,
        mime,
        createdAt: Date.now(),
        statusCode: meta.statusCode ?? null,
        url: meta.url ?? null,
        at: meta.at ?? Date.now()
    });
    await txComplete(tx);
    db.close();
    await enforceClipLimit(tabId, maxClips);
}
function pickMimeType() {
    const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm"
    ];
    for (const t of candidates) {
        if (MediaRecorder.isTypeSupported(t))
            return t;
    }
    return "";
}
function stopStream() {
    if (!currentStream)
        return;
    for (const track of currentStream.getTracks())
        track.stop();
    currentStream = null;
}
function addChunk(data) {
    const ts = Date.now();
    chunkBuffer.push({ ts, data });
    const cutoff = ts - DEFAULT_CLIP_PRE_MS;
    while (chunkBuffer.length && chunkBuffer[0].ts < cutoff)
        chunkBuffer.shift();
    if (activeMarks.length) {
        for (const mark of activeMarks) {
            if (ts <= mark.endAt)
                mark.future.push(data);
        }
        finalizeExpiredMarks(ts);
    }
}
function capturePreChunks(now, preMs) {
    const cutoff = now - preMs;
    return chunkBuffer.filter((x) => x.ts >= cutoff).map((x) => x.data);
}
function markClip(tabId, meta, preMs, postMs, maxClips) {
    if (!recorder || recorder.state === "inactive")
        return;
    const now = Date.now();
    const pre = capturePreChunks(now, preMs);
    activeMarks.push({
        tabId,
        meta,
        pre,
        future: [],
        endAt: now + postMs,
        maxClips
    });
    if (activeMarks.length > 6)
        activeMarks = activeMarks.slice(-6);
}
function finalizeExpiredMarks(now, force = false) {
    if (!activeMarks.length)
        return;
    const ready = activeMarks.filter((m) => force || now >= m.endAt);
    if (!ready.length)
        return;
    activeMarks = activeMarks.filter((m) => !(force || now >= m.endAt));
    for (const m of ready) {
        const parts = [...m.pre, ...m.future];
        if (!parts.length)
            continue;
        const mime = currentMime || "video/webm";
        const blob = new Blob(parts, { type: mime });
        void saveClip(m.tabId, blob, mime, m.meta, m.maxClips);
    }
}
async function startRecordingWithStreamId(tabId, streamId) {
    if (!tabId || !Number.isFinite(tabId))
        return;
    if (recorder && recorder.state !== "inactive") {
        await stopRecording();
    }
    await clearRecording(tabId);
    currentTabId = tabId;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: "tab",
                    chromeMediaSourceId: streamId
                }
            }
        });
        currentStream = stream;
        const mime = pickMimeType();
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        currentMime = mime || "video/webm";
        chunks = [];
        chunkBuffer = [];
        activeMarks = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                chunks.push(e.data);
                addChunk(e.data);
            }
        };
        recorder.onstop = async () => {
            finalizeExpiredMarks(Date.now(), true);
            const finalBlob = new Blob(chunks, { type: mime || "video/webm" });
            if (currentTabId) {
                try {
                    await saveRecording(currentTabId, finalBlob, finalBlob.type || "video/webm");
                }
                catch (e) {
                    console.warn("Failed to save recording", e);
                }
            }
            chunks = [];
            recorder = null;
            currentMime = null;
            stopStream();
            if (pendingStopResponder) {
                pendingStopResponder({ ok: true });
                pendingStopResponder = null;
            }
        };
        recorder.start(1000);
    }
    catch (e) {
        console.warn("getUserMedia failed", e);
    }
}
async function stopRecording() {
    if (recorder && recorder.state !== "inactive") {
        recorder.stop();
        return;
    }
    stopStream();
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "REC_START") {
        const tabId = Number(msg.tabId);
        const streamId = String(msg.streamId || "");
        if (!streamId) {
            sendResponse({ ok: false, error: "missing_stream_id" });
            return true;
        }
        startRecordingWithStreamId(tabId, streamId);
        sendResponse({ ok: true });
        return true;
    }
    if (msg?.type === "REC_STOP") {
        stopRecording();
        sendResponse({ ok: true });
        return true;
    }
    if (msg?.type === "REC_STOP_WAIT") {
        if (recorder && recorder.state !== "inactive") {
            pendingStopResponder = sendResponse;
            recorder.stop();
            return true;
        }
        stopStream();
        sendResponse({ ok: true });
        return true;
    }
    if (msg?.type === "REC_MARK") {
        const tabId = Number(msg.tabId);
        if (!tabId) {
            sendResponse({ ok: false, error: "no_tab" });
            return true;
        }
        const preMs = Number(msg.preMs ?? DEFAULT_CLIP_PRE_MS);
        const postMs = Number(msg.postMs ?? DEFAULT_CLIP_POST_MS);
        const maxClips = Number(msg.maxClips ?? DEFAULT_MAX_CLIPS);
        const meta = {
            statusCode: typeof msg.statusCode === "number" ? msg.statusCode : undefined,
            url: typeof msg.url === "string" ? msg.url : undefined,
            at: typeof msg.at === "number" ? msg.at : Date.now()
        };
        markClip(tabId, meta, preMs, postMs, maxClips);
        sendResponse({ ok: true });
        return true;
    }
    return true;
});
