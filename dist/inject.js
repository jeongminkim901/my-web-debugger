// inject.js
// ✅ 역할
// - 페이지 컨텍스트에서 console.* 훅킹
// - ✅ fetch / XHR 훅킹 (네트워크 메타 수집)
// - CustomEvent로 content.js에 전달
// - 페이지 원래 동작은 그대로 유지
// - ⚠️ inject 내부에서는 console 호출 금지(오류쌓임 방지)
(() => {
    // 중복 주입 방지
    if (window.__MY_WEB_DEBUGGER_INSTALLED__)
        return;
    window.__MY_WEB_DEBUGGER_INSTALLED__ = true;
    const MAX_BODY_CHARS = 50_000; // 저장 상한 (대략 50KB 텍스트)
    function safeSerialize(value) {
        try {
            const seen = new WeakSet();
            return JSON.parse(JSON.stringify(value, (k, v) => {
                if (typeof v === "object" && v !== null) {
                    if (seen.has(v))
                        return "[Circular]";
                    seen.add(v);
                }
                if (typeof v === "function")
                    return `[Function ${v.name || "anonymous"}]`;
                if (v instanceof Error) {
                    return { name: v.name, message: v.message, stack: v.stack };
                }
                return v;
            }));
        }
        catch {
            try {
                return String(value);
            }
            catch {
                return "[Unserializable]";
            }
        }
    }
    function emit(name, payload) {
        try {
            window.dispatchEvent(new CustomEvent(name, { detail: payload }));
        }
        catch {
            // 조용히 무시
        }
    }
    // -------------------------
    // Console hook
    // -------------------------
    function emitConsoleEvent(level, args) {
        emit("MY_DEBUGGER_CONSOLE", {
            level,
            args: (args || []).map(safeSerialize),
            timestamp: Date.now(),
            url: location.href
        });
    }
    function hookConsole(method) {
        const original = console[method];
        if (typeof original !== "function")
            return;
        console[method] = function (...args) {
            emitConsoleEvent(method, args);
            try {
                return Reflect.apply(original, console, args);
            }
            catch {
                // console을 여기서 또 호출하면 위험 -> 무시
            }
        };
    }
    ["log", "info", "warn", "error", "debug"].forEach(hookConsole);
    // -------------------------
    // Network hook helpers
    // -------------------------
    function clampText(s) {
        if (typeof s !== "string")
            return s;
        if (s.length <= MAX_BODY_CHARS)
            return s;
        return s.slice(0, MAX_BODY_CHARS) + `\n...[truncated ${s.length - MAX_BODY_CHARS} chars]`;
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
    function readBodyValueSync(body, contentTypeHint = "") {
        try {
            if (body == null)
                return null;
            if (typeof body === "string")
                return clampText(body);
            if (body instanceof URLSearchParams)
                return clampText(body.toString());
            if (typeof FormData !== "undefined" && body instanceof FormData) {
                const parts = [];
                body.forEach((v, k) => {
                    if (typeof v === "string")
                        parts.push(`${k}=${v}`);
                    else if (v && typeof v === "object") {
                        const name = v.name || "blob";
                        const type = v.type || "application/octet-stream";
                        const size = v.size ?? "?";
                        parts.push(`${k}=[file:${name}, ${type}, ${size} bytes]`);
                    }
                });
                return clampText(parts.join("&"));
            }
            if (typeof Blob !== "undefined" && body instanceof Blob) {
                return `[binary ${body.type || contentTypeHint || "blob"}; ${body.size} bytes]`;
            }
            if (body instanceof ArrayBuffer) {
                return `[binary ArrayBuffer; ${body.byteLength} bytes]`;
            }
            if (ArrayBuffer.isView(body)) {
                return `[binary ${body.constructor?.name || "TypedArray"}; ${body.byteLength} bytes]`;
            }
            if (typeof body === "object")
                return "[non-string body]";
        }
        catch {
            return "[unreadable body]";
        }
        return null;
    }
    async function readBodyValue(body, contentTypeHint = "") {
        try {
            if (body == null)
                return null;
            if (typeof body === "string")
                return clampText(body);
            if (body instanceof URLSearchParams)
                return clampText(body.toString());
            if (typeof FormData !== "undefined" && body instanceof FormData) {
                const parts = [];
                body.forEach((v, k) => {
                    if (typeof v === "string")
                        parts.push(`${k}=${v}`);
                    else if (v && typeof v === "object") {
                        const name = v.name || "blob";
                        const type = v.type || "application/octet-stream";
                        const size = v.size ?? "?";
                        parts.push(`${k}=[file:${name}, ${type}, ${size} bytes]`);
                    }
                });
                return clampText(parts.join("&"));
            }
            if (typeof Blob !== "undefined" && body instanceof Blob) {
                if (!isTextContentType(body.type || contentTypeHint || "")) {
                    return `[binary ${body.type || "blob"}; ${body.size} bytes]`;
                }
                try {
                    return clampText(await body.text());
                }
                catch {
                    return "[unreadable blob]";
                }
            }
            if (body instanceof ArrayBuffer) {
                return `[binary ArrayBuffer; ${body.byteLength} bytes]`;
            }
            if (ArrayBuffer.isView(body)) {
                return `[binary ${body.constructor?.name || "TypedArray"}; ${body.byteLength} bytes]`;
            }
            if (typeof body === "object")
                return "[non-string body]";
        }
        catch {
            return "[unreadable body]";
        }
        return null;
    }
    async function readRequestBody(input, init) {
        if (init && "body" in init) {
            return await readBodyValue(init.body, init?.headers?.get?.("content-type"));
        }
        if (input instanceof Request) {
            try {
                const ct = input.headers.get("content-type") || "";
                if (!isTextContentType(ct)) {
                    return ct ? `[binary ${ct}]` : "[binary body]";
                }
                const clone = input.clone();
                return clampText(await clone.text());
            }
            catch {
                return "[unreadable body]";
            }
        }
        return null;
    }
    function genId() {
        // 충돌 거의 없게
        return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    // -------------------------
    // fetch hook
    // -------------------------
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
        window.fetch = async function (input, init) {
            const id = genId();
            const start = Date.now();
            // method / url 추출
            let url = "";
            let method = "GET";
            let reqBody = null;
            try {
                if (typeof input === "string")
                    url = input;
                else if (input instanceof URL)
                    url = input.toString();
                else if (input instanceof Request)
                    url = input.url;
                // method 결정 우선순위: init.method > Request.method > GET
                if (init?.method)
                    method = String(init.method).toUpperCase();
                else if (input instanceof Request)
                    method = String(input.method).toUpperCase();
                // body는 가능한 경우만(문자열/JSON)
                reqBody = await readRequestBody(input, init);
            }
            catch {
                // ignore
            }
            // 시작 이벤트(원하면 Viewer에서 타임라인 찍을 때 유용)
            emit("MY_DEBUGGER_NETWORK", {
                id,
                phase: "start",
                transport: "fetch",
                url,
                method,
                startTime: start,
                requestBody: reqBody,
                pageUrl: location.href
            });
            try {
                const res = await origFetch.apply(this, arguments);
                const end = Date.now();
                // response body는 clone()으로만 읽기 (원본 소비 방지)
                let resText = null;
                try {
                    const cloned = res.clone();
                    const ct = res.headers?.get?.("content-type") || "";
                    if (!isTextContentType(ct)) {
                        resText = ct ? `[binary ${ct}]` : "[binary body]";
                    }
                    else {
                        // text()가 실패할 수 있으니 방어
                        resText = clampText(await cloned.text());
                    }
                }
                catch (e) {
                    const reason = (e && e.message) ? String(e.message) : "failed to read body";
                    resText = `[unreadable body] ${reason}`;
                }
                emit("MY_DEBUGGER_NETWORK", {
                    id,
                    phase: "end",
                    transport: "fetch",
                    url,
                    method,
                    statusCode: res.status,
                    ok: !!res.ok,
                    startTime: start,
                    endTime: end,
                    durationMs: end - start,
                    requestBody: reqBody,
                    responseBody: resText,
                    pageUrl: location.href
                });
                return res;
            }
            catch (err) {
                const end = Date.now();
                emit("MY_DEBUGGER_NETWORK", {
                    id,
                    phase: "end",
                    transport: "fetch",
                    url,
                    method,
                    statusCode: null,
                    ok: false,
                    startTime: start,
                    endTime: end,
                    durationMs: end - start,
                    error: safeSerialize(err),
                    pageUrl: location.href
                });
                throw err;
            }
        };
    }
    // -------------------------
    // XHR hook
    // -------------------------
    const XHROpen = XMLHttpRequest.prototype.open;
    const XHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
        try {
            this.__MWD_id = genId();
            this.__MWD_method = String(method || "GET").toUpperCase();
            this.__MWD_url = String(url || "");
        }
        catch {
            // ignore
        }
        return XHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
        const id = this.__MWD_id || genId();
        const method = this.__MWD_method || "GET";
        const url = this.__MWD_url || "";
        const start = Date.now();
        let reqBody = null;
        try {
            reqBody = readBodyValueSync(body);
        }
        catch {
            // ignore
        }
        emit("MY_DEBUGGER_NETWORK", {
            id,
            phase: "start",
            transport: "xhr",
            url,
            method,
            startTime: start,
            requestBody: reqBody,
            pageUrl: location.href
        });
        const onDone = () => {
            try {
                const end = Date.now();
                let resText = null;
                try {
                    const ct = this.getResponseHeader ? this.getResponseHeader("content-type") : "";
                    // responseType==''/'text'인 경우 responseText만
                    if (!this.responseType || this.responseType === "text") {
                        if (!isTextContentType(ct))
                            resText = ct ? `[binary ${ct}]` : "[binary body]";
                        else
                            resText = clampText(this.responseText);
                    }
                    else {
                        resText = `[responseType:${this.responseType}]`;
                    }
                }
                catch (e) {
                    const reason = (e && e.message) ? String(e.message) : "failed to read body";
                    resText = `[unreadable body] ${reason}`;
                }
                emit("MY_DEBUGGER_NETWORK", {
                    id,
                    phase: "end",
                    transport: "xhr",
                    url,
                    method,
                    statusCode: typeof this.status === "number" ? this.status : null,
                    ok: typeof this.status === "number" ? (this.status >= 200 && this.status < 400) : false,
                    startTime: start,
                    endTime: end,
                    durationMs: end - start,
                    requestBody: reqBody,
                    responseBody: resText,
                    pageUrl: location.href
                });
            }
            catch {
                // ignore
            }
        };
        // loadend면 성공/실패 포함 종료 시점
        try {
            this.addEventListener("loadend", onDone, { once: true });
        }
        catch {
            // ignore
        }
        return XHRSend.apply(this, arguments);
    };
})();
