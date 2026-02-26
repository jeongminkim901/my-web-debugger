// popup.js
const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("recBadge");

let statusTimer = null;

function setStatus(text) {
  statusEl.textContent = text;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.textContent = ""), 3000);
}

function setBadge(isOn) {
  if (isOn) {
    badgeEl.textContent = "● REC";
    badgeEl.style.borderColor = "#16a34a";
    badgeEl.style.color = "#16a34a";
  } else {
    badgeEl.textContent = "● OFF";
    badgeEl.style.borderColor = "#ccc";
    badgeEl.style.color = "#666";
  }
}

async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

// ✅ popup 열릴 때 recording 상태 반영
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (res) => {
  if (res?.ok) setBadge(!!res.recording);
});

document.getElementById("start").onclick = async () => {
  const tabId = await getCurrentTabId();
  if (!tabId) return setStatus("⚠️ 현재 탭을 찾을 수 없어요");

  chrome.runtime.sendMessage({ type: "START", tabId }, (res) => {
    if (res?.ok) {
      setBadge(true);
      setStatus(`✅ Recording started (cleared tab ${res.clearedTabId})`);
    } else {
      setStatus("❌ Failed to start recording");
    }
  });
};

document.getElementById("stop").onclick = async () => {
  chrome.runtime.sendMessage({ type: "STOP" }, (res) => {
    if (res?.ok) {
      setBadge(false);
      setStatus("⏸ Recording stopped");
    } else {
      setStatus("❌ Failed to stop recording");
    }
  });
};

// ✅ (NEW) 바로 Viewer 열기
document.getElementById("openViewer").onclick = async () => {
  const tabId = await getCurrentTabId();
  if (!tabId) return setStatus("⚠️ 현재 탭을 찾을 수 없어요");

  chrome.runtime.sendMessage({ type: "OPEN_VIEWER", tabId }, (res) => {
    if (res?.ok) setStatus("👀 Viewer opened!");
    else setStatus(`❌ Open Viewer failed: ${res?.error || "unknown"}`);
  });
};

// ✅ 기존 파일 저장 Export
document.getElementById("export").onclick = async () => {
  const tabId = await getCurrentTabId();
  if (!tabId) return setStatus("⚠️ Export할 탭이 없어요");

  chrome.runtime.sendMessage({ type: "EXPORT", tabId }, (res) => {
    if (res?.ok) setStatus("📦 Export downloaded!");
    else setStatus(`❌ Export failed: ${res?.error || "unknown"}`);
  });
};