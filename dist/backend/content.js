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
// console ?�벤??
window.addEventListener("MY_DEBUGGER_CONSOLE", (e) => {
    safeSendMessage({ type: "CONSOLE_EVENT", payload: e.detail });
});
// ??network ?�벤??
window.addEventListener("MY_DEBUGGER_NETWORK", (e) => {
    safeSendMessage({ type: "NETWORK_EVENT", payload: e.detail });
});
sendEnvOnce();
window.addEventListener("load", () => sendEnvOnce());
