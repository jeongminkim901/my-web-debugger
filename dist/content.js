// content.js
// ✅ 역할
// 1) inject.js를 페이지에 주입
// 2) inject.js가 window로 쏜 CustomEvent를 받아서 background로 전달
(function injectScript() {
    try {
        const s = document.createElement("script");
        s.src = chrome.runtime.getURL("dist/inject.js");
        s.onload = () => s.remove();
        (document.head || document.documentElement).appendChild(s);
    }
    catch (e) {
        // 주입 실패해도 content.js가 죽지 않게만
    }
})();
function safeSendMessage(message) {
    try {
        chrome.runtime.sendMessage(message, () => {
            // receiving end 없을 때 lastError만 뜨는 경우가 많아서 "읽어주기"
            void chrome.runtime.lastError;
        });
    }
    catch {
        // 확장 컨텍스트 invalidate 타이밍 방어
    }
}
function sendEnvOnce() {
    try {
        if (window.__MY_DEBUGGER_ENV_SENT)
            return;
        window.__MY_DEBUGGER_ENV_SENT = true;
        const uaData = navigator.userAgentData;
        const env = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            languages: navigator.languages,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            devicePixelRatio: window.devicePixelRatio,
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                availWidth: window.screen.availWidth,
                availHeight: window.screen.availHeight,
                colorDepth: window.screen.colorDepth,
                pixelDepth: window.screen.pixelDepth
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            uaData: uaData ? { brands: uaData.brands, mobile: uaData.mobile } : null
        };
        if (uaData?.getHighEntropyValues) {
            uaData.getHighEntropyValues([
                "platform",
                "platformVersion",
                "architecture",
                "model",
                "uaFullVersion",
                "fullVersionList"
            ]).then((hi) => {
                env.uaData = { ...(env.uaData || {}), ...hi };
                safeSendMessage({ type: "ENV", payload: env });
            }).catch(() => {
                safeSendMessage({ type: "ENV", payload: env });
            });
            return;
        }
        safeSendMessage({ type: "ENV", payload: env });
    }
    catch {
        // ignore
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
sendEnvOnce();
window.addEventListener("load", () => sendEnvOnce());
