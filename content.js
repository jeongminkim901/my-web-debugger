// content.js
// ✅ 역할
// 1) inject.js를 페이지에 주입
// 2) inject.js가 window로 쏜 CustomEvent를 받아서 background로 전달

(function injectScript() {
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    // 주입 실패해도 content.js가 죽지 않게만
  }
})();

function safeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // receiving end 없을 때 lastError만 뜨는 경우가 많아서 "읽어주기"
      void chrome.runtime.lastError;
    });
  } catch {
    // 확장 컨텍스트 invalidate 타이밍 방어
  }
}

// console 이벤트
window.addEventListener("MY_DEBUGGER_CONSOLE", (e) => {
  safeSendMessage({ type: "CONSOLE_EVENT", payload: e.detail });
});

// ✅ network 이벤트
window.addEventListener("MY_DEBUGGER_NETWORK", (e) => {
  safeSendMessage({ type: "NETWORK_EVENT", payload: e.detail });
});