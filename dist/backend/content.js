// content.js
// ????��
// 1) inject.js�??�이지??주입
// 2) inject.js가 window�???CustomEvent�?받아??background�??�달
(function injectScript() {
    try {
        const s = document.createElement("script");
        s.src = chrome.runtime.getURL("dist/backend/inject.js");
        s.onload = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
    }
    catch (e) {
        // 주입 ?�패?�도 content.js가 죽�? ?�게�?
    }
})();
function safeSendMessage(message) {
    try {
        chrome.runtime.sendMessage(message, () => {
            // receiving end ?�을 ??lastError�??�는 경우가 많아??"?�어주기"
            void chrome.runtime.lastError;
        });
    }
    catch {
        // ?�장 컨텍?�트 invalidate ?�?�밍 방어
    }
}
// console ?�벤??
window.addEventListener("MY_DEBUGGER_CONSOLE", (e) => {
    safeSendMessage({ type: "CONSOLE_EVENT", payload: e.detail });
});
// ??network ?�벤??
window.addEventListener("MY_DEBUGGER_NETWORK", (e) => {
    safeSendMessage({ type: "NETWORK_EVENT", payload: e.detail });
});
