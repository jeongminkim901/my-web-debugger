export {};

const DB_NAME = "my-web-debugger";
const STORE_NAME = "recordings";

let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let currentTabId: number | null = null;
let currentStream: MediaStream | null = null;
let pendingStopResponder: ((value?: unknown) => void) | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "tabId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function clearRecording(tabId: number) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(tabId);
  await txComplete(tx);
  db.close();
}

async function saveRecording(tabId: number, blob: Blob, mime: string) {
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

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function stopStream() {
  if (!currentStream) return;
  for (const track of currentStream.getTracks()) track.stop();
  currentStream = null;
}

async function startRecording(tabId: number) {
  if (!tabId || !Number.isFinite(tabId)) return;

  if (recorder && recorder.state !== "inactive") {
    await stopRecording();
  }

  await clearRecording(tabId);
  currentTabId = tabId;

  chrome.tabCapture.capture({ audio: false, video: true }, (stream) => {
    const err = chrome.runtime.lastError;
    if (err || !stream) {
      console.warn("tabCapture failed", err?.message);
      return;
    }

    currentStream = stream;
    const mime = pickMimeType();
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      const finalBlob = new Blob(chunks, { type: mime || "video/webm" });
      if (currentTabId) {
        try {
          await saveRecording(currentTabId, finalBlob, finalBlob.type || "video/webm");
        } catch (e) {
          console.warn("Failed to save recording", e);
        }
      }
      chunks = [];
      recorder = null;
      stopStream();
      if (pendingStopResponder) {
        pendingStopResponder({ ok: true });
        pendingStopResponder = null;
      }
    };

    recorder.start(1000);
  });
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
    startRecording(Number(msg.tabId));
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
  return true;
});
