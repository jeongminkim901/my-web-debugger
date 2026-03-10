// viewer.js (Step 3-1 refined: tighter time window + same-origin constraint)
(() => {
    let session = null;
    let recordingBlob = null;
    let recordingMime = null;
    let recordingCreatedAt = null;
    let recordingObjectUrl = null;
    let clipObjectUrls = [];
    let recordingClips = [];
    const el = (id) => document.getElementById(id);
    const drop = el("drop");
    const fileInput = el("file");
    const content = el("content");
    // Controls
    const netSearch = el("netSearch");
    const hostFilter = el("hostFilter");
    const statusFilter = el("statusFilter");
    const methodFilter = el("methodFilter");
    const sortBy = el("sortBy");
    const durMin = el("durMin");
    const durMax = el("durMax");
    const conSearch = el("conSearch");
    const levelFilter = el("levelFilter");
    // Meta / extra
    const metaNote = el("metaNote");
    const metaTags = el("metaTags");
    const errorSummaryStats = el("errorSummaryStats");
    const errorSummaryList = el("errorSummaryList");
    const timelineEl = el("timeline");
    const timelineMeta = el("timelineMeta");
    const timelineAxis = el("timelineAxis");
    const timelineLegend = el("timelineLegend");
    const screenshotWrap = el("screenshotWrap");
    const shotModal = el("shotModal");
    const shotModalImg = el("shotModalImg");
    const shotModalMeta = el("shotModalMeta");
    const shotModalClose = el("shotModalClose");
    const shotPrev = el("shotPrev");
    const shotNext = el("shotNext");
    let shotItems = [];
    let shotIndex = -1;
    const recordingWrap = el("recordingWrap");
    const clipWrap = el("clipWrap");
    // Toggles
    const SLOW_THRESHOLD_MS = 1000;
    // ✅ 너무 넓게 걸리는 문제 해결: 기본 3초 → 1.2초
    const HILITE_WINDOW_MS = 1200;
    // ✅ 같은 페이지 컨텍스트로만 묶기: origin 기준 필터
    let hiliteOrigin = null;
    let slowOnly = false;
    let netErrorsOnly = false;
    let conErrorsOnly = false;
    let bodyOnly = false;
    const toggleSlowBtn = el("toggleSlow");
    const toggleNetErrorsBtn = el("toggleNetErrors");
    const toggleConErrorsBtn = el("toggleConErrors");
    const toggleBodyBtn = el("toggleBody");
    // Detail panel
    const netDetail = el("netDetail");
    let currentNetMap = new Map(); // id -> item
    let selectedNetId = null;
    // Cross highlight state
    let hiliteMode = "none"; // "none" | "fromConsole" | "fromNetwork"
    let hiliteCenterTs = null;
    let selectedConsoleKey = null;
    // ---------- DnD ----------
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", async (e) => {
        e.preventDefault();
        drop.classList.remove("drag");
        const file = e.dataTransfer.files[0];
        if (file)
            loadFile(file);
    });
    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        if (file)
            loadFile(file);
    });
    function loadFile(file) {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                session = JSON.parse(String(reader.result));
                resetToggles();
                resetFilters();
                clearNetDetail();
                clearHilite();
                renderAll();
            }
            catch {
                alert("JSON 파싱 실패: 파일이 올바른지 확인해줘!");
            }
        };
        reader.readAsText(file);
    }
    function resetToggles() {
        slowOnly = false;
        netErrorsOnly = false;
        conErrorsOnly = false;
        bodyOnly = false;
        syncToggleUI();
    }
    function resetFilters() {
        if (netSearch)
            netSearch.value = "";
        if (hostFilter)
            hostFilter.value = "";
        if (statusFilter)
            statusFilter.value = "all";
        if (methodFilter)
            methodFilter.value = "all";
        if (sortBy)
            sortBy.value = "time_desc";
        if (durMin)
            durMin.value = "";
        if (durMax)
            durMax.value = "";
        if (conSearch)
            conSearch.value = "";
        if (levelFilter)
            levelFilter.value = "all";
    }
    function syncToggleUI() {
        if (toggleSlowBtn) {
            toggleSlowBtn.textContent = `Slow only: ${slowOnly ? "ON" : "OFF"}`;
            toggleSlowBtn.classList.toggle("toggle-on", slowOnly);
        }
        if (toggleNetErrorsBtn) {
            toggleNetErrorsBtn.textContent = `Errors only: ${netErrorsOnly ? "ON" : "OFF"}`;
            toggleNetErrorsBtn.classList.toggle("toggle-on", netErrorsOnly);
        }
        if (toggleConErrorsBtn) {
            toggleConErrorsBtn.textContent = `Warn+Error: ${conErrorsOnly ? "ON" : "OFF"}`;
            toggleConErrorsBtn.classList.toggle("toggle-on", conErrorsOnly);
        }
        if (toggleBodyBtn) {
            toggleBodyBtn.textContent = `Body only: ${bodyOnly ? "ON" : "OFF"}`;
            toggleBodyBtn.classList.toggle("toggle-on", bodyOnly);
        }
    }
    // Re-render on control changes
    [netSearch, hostFilter, statusFilter, methodFilter, sortBy, durMin, durMax, conSearch, levelFilter].forEach(ctrl => {
        ctrl.addEventListener("input", () => { renderTables(); });
        ctrl.addEventListener("change", () => { renderTables(); });
    });
    // Toggles
    if (toggleSlowBtn) {
        toggleSlowBtn.addEventListener("click", () => {
            slowOnly = !slowOnly;
            syncToggleUI();
            renderNetworkTable();
        });
    }
    if (toggleNetErrorsBtn) {
        toggleNetErrorsBtn.addEventListener("click", () => {
            netErrorsOnly = !netErrorsOnly;
            syncToggleUI();
            renderNetworkTable();
        });
    }
    if (toggleConErrorsBtn) {
        toggleConErrorsBtn.addEventListener("click", () => {
            conErrorsOnly = !conErrorsOnly;
            syncToggleUI();
            renderConsoleTable();
        });
    }
    if (toggleBodyBtn) {
        toggleBodyBtn.addEventListener("click", () => {
            bodyOnly = !bodyOnly;
            syncToggleUI();
            renderNetworkTable();
        });
    }
    // ✅ Network row click (detail + cross highlight)
    el("network").addEventListener("click", (e) => {
        const target = e.target;
        const tr = target?.closest?.("tr[data-net-id]");
        if (!tr)
            return;
        const id = tr.getAttribute("data-net-id");
        if (!id)
            return;
        const item = currentNetMap.get(id);
        if (!item)
            return;
        selectedNetId = id;
        renderNetDetail(item);
        // cross highlight: fromNetwork (✅ endedAt 우선, 없으면 startedAt)
        const center = (typeof item.endedAt === "number") ? item.endedAt
            : (typeof item.startedAt === "number") ? item.startedAt
                : null;
        if (typeof center === "number") {
            hiliteMode = "fromNetwork";
            hiliteCenterTs = center;
            selectedConsoleKey = null;
            // ✅ 동일 origin 제한
            hiliteOrigin = getOrigin(item.pageUrl || item.url || null);
            renderConsoleTable();
            renderNetworkTable();
        }
    });
    // ✅ Console row click (cross highlight)
    el("console").addEventListener("click", (e) => {
        const target = e.target;
        const tr = target?.closest?.("tr[data-con-key]");
        if (!tr)
            return;
        const key = tr.getAttribute("data-con-key");
        const tsStr = tr.getAttribute("data-con-ts");
        const url = tr.getAttribute("data-con-url") || null;
        if (!key || !tsStr)
            return;
        const ts = Number(tsStr);
        if (!Number.isFinite(ts))
            return;
        hiliteMode = "fromConsole";
        hiliteCenterTs = ts;
        selectedConsoleKey = key;
        // ✅ 동일 origin 제한
        hiliteOrigin = getOrigin(url);
        renderNetworkTable();
        renderConsoleTable();
    });
    // ESC로 하이라이트 해제
    window.addEventListener("keydown", (e) => {
        if (isModalOpen()) {
            if (e.key === "ArrowLeft")
                return stepShot(-1);
            if (e.key === "ArrowRight")
                return stepShot(1);
        }
        if (e.key === "Escape") {
            clearHilite();
            renderNetworkTable();
            renderConsoleTable();
        }
    });
    if (shotModal) {
        shotModal.addEventListener("click", (e) => {
            const target = e.target;
            if (!target)
                return;
            if (target.id === "shotModal" || target.id === "shotModalClose") {
                closeShotModal();
            }
        });
    }
    if (shotModalClose) {
        shotModalClose.addEventListener("click", () => closeShotModal());
    }
    if (shotPrev) {
        shotPrev.addEventListener("click", () => stepShot(-1));
    }
    if (shotNext) {
        shotNext.addEventListener("click", () => stepShot(1));
    }
    if (screenshotWrap) {
        screenshotWrap.addEventListener("click", (e) => {
            const target = e.target;
            const img = target?.closest?.("img[data-shot-src]");
            if (!img)
                return;
            const src = img.getAttribute("data-shot-src") || "";
            const meta = img.getAttribute("data-shot-meta") || "";
            if (src)
                openShotModal(src, meta);
        });
    }
    function clearHilite() {
        hiliteMode = "none";
        hiliteCenterTs = null;
        selectedConsoleKey = null;
        hiliteOrigin = null;
    }
    function openShotModalAt(index) {
        if (!shotItems.length)
            return;
        if (!shotModal || !shotModalImg || !shotModalMeta)
            return;
        const safeIndex = ((index % shotItems.length) + shotItems.length) % shotItems.length;
        const item = shotItems[safeIndex];
        shotIndex = safeIndex;
        shotModalImg.src = item.src;
        shotModalMeta.textContent = item.meta || "";
        shotModal.classList.add("open");
        if (shotPrev)
            shotPrev.disabled = shotItems.length <= 1;
        if (shotNext)
            shotNext.disabled = shotItems.length <= 1;
    }
    function openShotModal(src, meta) {
        if (!shotItems.length)
            shotItems = [{ src, meta }];
        const idx = shotItems.findIndex((x) => x.src === src && x.meta === meta);
        openShotModalAt(idx >= 0 ? idx : 0);
    }
    function stepShot(delta) {
        if (!shotItems.length)
            return;
        openShotModalAt(shotIndex + delta);
    }
    function isModalOpen() {
        return !!shotModal?.classList.contains("open");
    }
    function closeShotModal() {
        if (!shotModal || !shotModalImg || !shotModalMeta)
            return;
        shotModal.classList.remove("open");
        shotModalImg.src = "";
        shotModalMeta.textContent = "";
    }
    function formatDuration(ms) {
        if (typeof ms !== "number")
            return "-";
        if (ms < 1000)
            return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
    }
    function renderAll() {
        if (!session)
            return;
        content.classList.remove("hidden");
        const created = session.createdAtIso || (session.createdAt ? new Date(session.createdAt).toISOString() : null);
        const sess = session.session;
        const sessionText = sess
            ? `session: ${escapeHtml(sess.startedAtIso || "-")} → ${escapeHtml(sess.endedAtIso || "-")} (${escapeHtml(formatDuration(sess.durationMs))})`
            : `session: -`;
        el("meta").innerHTML = `
      <span class="pill">version: ${escapeHtml(session.version || "-")}</span>
      <span class="pill">tabId: ${escapeHtml(String(session.tabId ?? "-"))}</span>
      <span class="pill">createdAt: ${escapeHtml(created || "-")}</span>
      <span class="pill">${sessionText}</span>
      <span class="pill muted">Tip: 행 클릭=상호 하이라이트(±${HILITE_WINDOW_MS}ms, same-origin) · ESC 해제</span>
    `;
        const meta = session.meta || {};
        if (metaNote)
            metaNote.textContent = meta.note || "-";
        if (metaTags)
            metaTags.textContent = Array.isArray(meta.tags) ? meta.tags.join(", ") : (meta.tags || "-");
        const s = session.summary || {};
        const total = s.totalRequests ?? (session.network?.length || 0);
        const by = s.byStatusGroup || {};
        el("kpis").innerHTML = `
      ${kpi("Total Requests", total)}
      ${kpi("2xx", by["2xx"] || 0)}
      ${kpi("3xx", by["3xx"] || 0)}
      ${kpi("4xx", by["4xx"] || 0)}
      ${kpi("5xx", by["5xx"] || 0)}
    `;
        const slow = (s.slowestTop5 || []).map(x => `
      <div class="row" style="padding:8px 0; border-bottom:1px solid #1f2a3a;">
        <span class="pill mono">${escapeHtml(x.method || "-")}</span>
        <span class="pill">${escapeHtml(String(x.statusCode ?? "-"))}</span>
        <span class="pill">${escapeHtml(String(x.durationMs ?? "-"))}ms</span>
        <span class="mono small" title="${escapeHtml(x.shortUrl || "")}">${escapeHtml(x.shortUrl || "")}</span>
      </div>
    `).join("");
        el("slowest").innerHTML = slow || `<div class="muted">데이터 없음</div>`;
        const hostsObj = s.byHost || {};
        const hosts = Object.entries(hostsObj)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([host, cnt]) => `
        <div class="row" style="padding:8px 0; border-bottom:1px solid #1f2a3a;">
          <span class="mono">${escapeHtml(host)}</span>
          <span class="right pill">${escapeHtml(String(cnt))}</span>
        </div>
      `).join("");
        el("hosts").innerHTML = hosts || `<div class="muted">데이터 없음</div>`;
        el("raw").textContent = JSON.stringify(session, null, 2);
        renderTables();
        renderErrorSummary();
        renderTimeline();
        renderScreenshot();
        renderRecording();
    }
    function renderTables() {
        if (!session)
            return;
        renderNetworkTable();
        renderConsoleTable();
    }
    function renderErrorSummary() {
        if (!session || !errorSummaryStats || !errorSummaryList)
            return;
        const net = Array.isArray(session.network) ? session.network : [];
        const con = Array.isArray(session.console) ? session.console : [];
        const net4xx = net.filter((x) => x.statusGroup === "4xx").length;
        const net5xx = net.filter((x) => x.statusGroup === "5xx").length;
        const conErr = con.filter((x) => x.level === "error").length;
        const conWarn = con.filter((x) => x.level === "warn").length;
        errorSummaryStats.innerHTML = `
      <div class="row">
        <span class="pill">Network 4xx: ${escapeHtml(String(net4xx))}</span>
        <span class="pill">Network 5xx: ${escapeHtml(String(net5xx))}</span>
        <span class="pill">Console error: ${escapeHtml(String(conErr))}</span>
        <span class="pill">Console warn: ${escapeHtml(String(conWarn))}</span>
      </div>
    `;
        const netErrors = net
            .filter((x) => typeof x.statusCode === "number" && x.statusCode >= 400)
            .map((x) => ({
            key: x.shortUrl || x.url || "(unknown)",
            code: x.statusCode
        }));
        const netCounts = new Map();
        for (const e of netErrors) {
            const k = `${e.code}|${e.key}`;
            netCounts.set(k, (netCounts.get(k) || 0) + 1);
        }
        const topNet = [...netCounts.entries()]
            .map(([k, c]) => {
            const [code, url] = k.split("|");
            return { code, url, count: c };
        })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        const conErrors = con
            .filter((x) => x.level === "error" || x.level === "warn")
            .map((x) => ({ lvl: x.level || "log", msg: prettyArgs(x.args) }));
        const conCounts = new Map();
        for (const e of conErrors) {
            const k = `${e.lvl}|${e.msg.slice(0, 120)}`;
            conCounts.set(k, (conCounts.get(k) || 0) + 1);
        }
        const topCon = [...conCounts.entries()]
            .map(([k, c]) => {
            const [lvl, msg] = k.split("|");
            return { lvl, msg, count: c };
        })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        const netList = topNet.map((x) => `
      <div class="error-item">
        <span class="pill">${escapeHtml(String(x.code))}</span>
        <div class="error-url mono">${escapeHtml(x.url)}</div>
        <span class="pill">${escapeHtml(String(x.count))}</span>
      </div>
    `).join("");
        const conList = topCon.map((x) => `
      <div class="error-item">
        <span class="pill">${escapeHtml(String(x.lvl))}</span>
        <div class="error-url mono">${escapeHtml(x.msg)}</div>
        <span class="pill">${escapeHtml(String(x.count))}</span>
      </div>
    `).join("");
        errorSummaryList.innerHTML =
            (netList ? `<div class="muted small">Network</div>${netList}` : `<div class="muted small">Network: none</div>`)
                + (conList ? `<div class="muted small" style="margin-top:8px;">Console</div>${conList}` : `<div class="muted small" style="margin-top:8px;">Console: none</div>`);
    }
    function renderTimeline() {
        if (!session || !timelineEl || !timelineAxis || !timelineMeta || !timelineLegend)
            return;
        const items = Array.isArray(session.network) ? session.network : [];
        const withTimes = items.filter((x) => typeof x.startedAt === "number");
        if (!withTimes.length) {
            timelineEl.innerHTML = `<div class="muted" style="padding:10px;">No timeline data</div>`;
            timelineAxis.innerHTML = "";
            timelineMeta.textContent = "";
            timelineLegend.innerHTML = "";
            return;
        }
        const minT = Math.min(...withTimes.map((x) => x.startedAt ?? 0));
        const maxT = Math.max(...withTimes.map((x) => (x.endedAt ?? x.startedAt ?? 0)));
        const range = Math.max(1, maxT - minT);
        timelineEl.innerHTML = "";
        timelineAxis.innerHTML = `
      <span>${escapeHtml(new Date(minT).toISOString())}</span>
      <span>${escapeHtml(new Date(minT + Math.floor(range / 2)).toISOString())}</span>
      <span>${escapeHtml(new Date(maxT).toISOString())}</span>
    `;
        timelineMeta.textContent = `${withTimes.length} requests · range ${(range / 1000).toFixed(2)}s`;
        timelineLegend.innerHTML = `
      <span><i class="legend-dot legend-ok"></i> OK</span>
      <span><i class="legend-dot legend-warn"></i> Slow</span>
      <span><i class="legend-dot legend-err"></i> Error</span>
    `;
        [0.25, 0.5, 0.75].forEach((p) => {
            const g = document.createElement("div");
            g.className = "timeline-grid";
            g.style.left = `${p * 100}%`;
            timelineEl.appendChild(g);
        });
        withTimes.slice(0, 60).forEach((x, i) => {
            const s = x.startedAt ?? minT;
            const e = x.endedAt ?? s;
            const left = ((s - minT) / range) * 100;
            const width = Math.max(1, ((e - s) / range) * 100);
            const bar = document.createElement("div");
            const code = x.statusCode;
            bar.className = "timeline-bar" + ((typeof code === "number" && code >= 400) ? " err" : (x.durationMs >= SLOW_THRESHOLD_MS ? " warn" : ""));
            bar.style.left = `${left}%`;
            bar.style.width = `${width}%`;
            bar.style.top = `${(i % 7) * 20 + 6}px`;
            bar.title = `${x.method || ""} ${x.shortUrl || x.url || ""}`;
            bar.textContent = `${x.method || "-"} ${x.statusCode ?? "-"}`;
            timelineEl.appendChild(bar);
        });
    }
    function renderScreenshot() {
        if (!session || !screenshotWrap)
            return;
        const list = Array.isArray(session.errorScreenshots) ? session.errorScreenshots : [];
        if (list.length) {
            const items = list.map((x, i) => {
                const ts = x?.at ? new Date(x.at).toISOString() : "-";
                const code = x?.statusCode ?? "-";
                const url = x?.url || "";
                const src = x?.dataUrl || "";
                const meta = `#${i + 1} · ${code} · ${ts}`;
                return `
          <div class="shot-item">
            <div class="shot-meta">${escapeHtml(meta)}</div>
            <div class="shot-url">${escapeHtml(url)}</div>
            <img class="shot-thumb"
                 src="${escapeHtml(src)}"
                 data-shot-src="${escapeHtml(src)}"
                 data-shot-meta="${escapeHtml(meta)}"
                 alt="Error screenshot ${i + 1}" />
          </div>
        `;
            }).join("");
            shotItems = list.map((x, i) => {
                const ts = x?.at ? new Date(x.at).toISOString() : "-";
                const code = x?.statusCode ?? "-";
                const src = x?.dataUrl || "";
                const meta = `#${i + 1} 쨌 ${code} 쨌 ${ts}`;
                return { src, meta };
            }).filter((x) => !!x.src);
            screenshotWrap.innerHTML = `<div class="shot-grid">${items}</div>`;
            return;
        }
        const s = session.errorScreenshot || session.screenshot;
        if (!s) {
            screenshotWrap.textContent = "No screenshot";
            return;
        }
        const label = session.errorScreenshot ? "Error screenshot" : "Screenshot";
        const at = session.errorScreenshotAt
            ? ` (${new Date(session.errorScreenshotAt).toISOString()})`
            : "";
        const meta = `${label}${at}`;
        shotItems = [{ src: s, meta }];
        screenshotWrap.innerHTML = `
      <div class="shot-item">
        <div class="shot-meta">${escapeHtml(meta)}</div>
        <img class="shot-thumb"
             src="${escapeHtml(s)}"
             data-shot-src="${escapeHtml(s)}"
             data-shot-meta="${escapeHtml(meta)}"
             alt="${escapeHtml(label)}" />
      </div>
    `;
    }
    // ---------- Helpers (origin & time window) ----------
    function getOrigin(url) {
        try {
            if (!url)
                return null;
            return new URL(url).origin;
        }
        catch {
            return null;
        }
    }
    function sameOrigin(url) {
        if (!hiliteOrigin)
            return true; // origin 모르면 제한 안 함
        const o = getOrigin(url);
        if (!o)
            return true;
        return o === hiliteOrigin;
    }
    function isNetworkInWindow(item, centerTs, windowMs) {
        const s = item.startedAt;
        const e = item.endedAt;
        const w1 = centerTs - windowMs;
        const w2 = centerTs + windowMs;
        if (typeof s === "number" && typeof e === "number") {
            return !(e < w1 || s > w2);
        }
        if (typeof s === "number")
            return Math.abs(s - centerTs) <= windowMs;
        if (typeof e === "number")
            return Math.abs(e - centerTs) <= windowMs;
        return false;
    }
    // ---------- Highlight helpers ----------
    function getNetworkRowClass(item, rowId) {
        const code = item.statusCode;
        const dur = item.durationMs;
        if (hiliteMode === "fromConsole" && typeof hiliteCenterTs === "number") {
            // ✅ 동일 origin 제한(페이지URL 우선, 없으면 URL)
            if (sameOrigin(item.pageUrl || item.url || null) && isNetworkInWindow(item, hiliteCenterTs, HILITE_WINDOW_MS)) {
                return (typeof code === "number" && code >= 400) ? "row-error" : "row-warn";
            }
        }
        if (rowId && selectedNetId && rowId === selectedNetId) {
            return (typeof code === "number" && code >= 400) ? "row-error" : "row-warn";
        }
        if (typeof code === "number" && code >= 400)
            return "row-error";
        if (typeof dur === "number" && dur >= SLOW_THRESHOLD_MS)
            return "row-warn";
        return "";
    }
    function getConsoleRowClass(level, key, ts, url) {
        if (hiliteMode === "fromNetwork" && typeof hiliteCenterTs === "number") {
            // ✅ 동일 origin 제한
            if (sameOrigin(url) && typeof ts === "number" && Math.abs(ts - hiliteCenterTs) <= HILITE_WINDOW_MS) {
                if (level === "error")
                    return "row-con-error";
                return "row-con-warn";
            }
        }
        if (hiliteMode === "fromConsole" && key && selectedConsoleKey === key) {
            if (level === "error")
                return "row-con-error";
            return "row-con-warn";
        }
        if (level === "error")
            return "row-con-error";
        if (level === "warn")
            return "row-con-warn";
        return "";
    }
    function levelPillClass(level) {
        if (level === "error")
            return "pill pill-level lvl-error";
        if (level === "warn")
            return "pill pill-level lvl-warn";
        if (level === "info")
            return "pill pill-level lvl-info";
        if (level === "debug")
            return "pill pill-level lvl-debug";
        return "pill pill-level lvl-log";
    }
    // ---------- Network ----------
    function hasBody(x) {
        return x && (x.requestBody !== null && x.requestBody !== undefined || x.responseBody !== null && x.responseBody !== undefined);
    }
    function getSourceLabel(x) {
        if (!x)
            return "-";
        if (x.type === "debugger" || x.transport === "debugger")
            return "debugger";
        if (x.type === "page")
            return x.transport || "page";
        return "webRequest";
    }
    function renderNetworkTable() {
        const items = Array.isArray(session.network) ? session.network : [];
        const q = (netSearch.value || "").trim().toLowerCase();
        const hostQ = (hostFilter.value || "").trim().toLowerCase();
        const status = statusFilter.value;
        const method = methodFilter.value;
        const minMs = parseOptionalNumber(durMin.value);
        const maxMs = parseOptionalNumber(durMax.value);
        let filtered = items.filter(x => {
            const hay = `${x.host || ""} ${x.path || ""} ${x.url || ""}`.toLowerCase();
            const okQuery = q ? hay.includes(q) : true;
            const okStatus = (status === "all") ? true : (String(x.statusGroup || "unknown") === status);
            const okHost = hostQ ? String(x.host || "").toLowerCase().includes(hostQ) : true;
            const okMethod = (method === "all") ? true : String(x.method || "").toUpperCase() === method;
            const okNetErrors = netErrorsOnly
                ? (x.statusGroup === "4xx" || x.statusGroup === "5xx" || (typeof x.statusCode === "number" && x.statusCode >= 400))
                : true;
            return okQuery && okStatus && okHost && okMethod && okNetErrors;
        });
        if (slowOnly)
            filtered = filtered.filter(x => typeof x.durationMs === "number" && x.durationMs >= SLOW_THRESHOLD_MS);
        if (bodyOnly)
            filtered = filtered.filter((x) => hasBody(x));
        if (!Number.isNaN(minMs))
            filtered = filtered.filter(x => typeof x.durationMs === "number" && x.durationMs >= minMs);
        if (!Number.isNaN(maxMs))
            filtered = filtered.filter(x => typeof x.durationMs === "number" && x.durationMs <= maxMs);
        const sort = sortBy.value;
        filtered.sort((a, b) => {
            const aT = a.startedAt ?? 0;
            const bT = b.startedAt ?? 0;
            const aD = typeof a.durationMs === "number" ? a.durationMs : -1;
            const bD = typeof b.durationMs === "number" ? b.durationMs : -1;
            if (sort === "time_desc")
                return bT - aT;
            if (sort === "time_asc")
                return aT - bT;
            if (sort === "dur_desc")
                return bD - aD;
            if (sort === "dur_asc")
                return aD - bD;
            return 0;
        });
        el("netCount").textContent = `${filtered.length} / ${items.length}`;
        currentNetMap = new Map();
        for (const x of filtered) {
            const id = String(x.id ?? `${x.method || "GET"}:${x.url || ""}:${x.startedAt || ""}`);
            currentNetMap.set(id, x);
        }
        const rows = filtered.map((x) => {
            const id = String(x.id ?? `${x.method || "GET"}:${x.url || ""}:${x.startedAt || ""}`);
            const src = getSourceLabel(x);
            const bodyBadge = hasBody(x) ? `<span class="pill pill-body">body</span>` : "";
            return `
        <tr data-net-id="${escapeHtml(id)}" class="${getNetworkRowClass(x, id)}" title="클릭: 상세 + 콘솔 하이라이트">
          <td class="mono small">${escapeHtml(x.method || "-")}</td>
          <td><span class="pill pill-src">${escapeHtml(src)}</span></td>
          <td>
            <span class="pill">${escapeHtml(String(x.statusGroup || "unknown"))}</span>
            <span class="pill">${escapeHtml(String(x.statusCode ?? "-"))}</span>
          </td>
          <td class="mono small">${escapeHtml(String(x.durationMs ?? "-"))}ms</td>
          <td class="mono small" title="${escapeHtml(x.url || "")}">
            ${escapeHtml(x.shortUrl || x.url || "")}
            ${bodyBadge}
            <div class="muted">${escapeHtml(x.host || "")}${escapeHtml(x.path || "")}</div>
          </td>
          <td class="mono small">${escapeHtml(x.startedAtIso || "-")}</td>
        </tr>
      `;
        }).join("");
        el("network").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Src</th>
            <th>Status</th>
            <th>Duration</th>
            <th>URL</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" class="muted">결과 없음</td></tr>`}
        </tbody>
      </table>
    `;
        if (selectedNetId && !currentNetMap.has(selectedNetId))
            clearNetDetail();
    }
    function clearNetDetail() {
        selectedNetId = null;
        netDetail.classList.add("hidden");
        netDetail.innerHTML = "";
    }
    function renderNetDetail(item) {
        netDetail.classList.remove("hidden");
        const method = item.method || "-";
        const status = (item.statusCode ?? "-");
        const statusGroup = item.statusGroup || "unknown";
        const dur = (typeof item.durationMs === "number") ? `${item.durationMs}ms` : "-";
        const url = item.url || "";
        const shortUrl = item.shortUrl || url;
        const transport = item.transport || item.type || "-";
        const started = item.startedAtIso || (item.startedAt ? new Date(item.startedAt).toISOString() : "-");
        const ended = item.endedAtIso || (item.endedAt ? new Date(item.endedAt).toISOString() : "-");
        const pageUrl = item.pageUrl || "-";
        const reqBody = formatBody(item.requestBody, { kind: "request", item });
        const resBody = formatBody(item.responseBody, { kind: "response", item });
        const err = item.error ? formatBody(item.error) : "";
        netDetail.innerHTML = `
      <div class="row">
        <h3>Network Detail</h3>
        <span class="pill mono">${escapeHtml(method)}</span>
        <span class="pill">${escapeHtml(String(statusGroup))}</span>
        <span class="pill">${escapeHtml(String(status))}</span>
        <span class="pill">${escapeHtml(dur)}</span>
        <span class="right"></span>
        <button class="pill btn xbtn" id="netDetailClose" type="button">닫기</button>
      </div>

      <div class="row muted" style="margin-top:6px;">
        <span class="pill">transport: ${escapeHtml(transport)}</span>
        <span class="pill">started: ${escapeHtml(started)}</span>
        <span class="pill">ended: ${escapeHtml(ended)}</span>
      </div>

      <div class="row" style="margin-top:10px;">
        <div style="flex: 1 1 620px;">
          <div class="muted">URL</div>
          <div class="mono small" title="${escapeHtml(url)}">${escapeHtml(shortUrl)}</div>
          <div class="muted mono small">${escapeHtml(url)}</div>
        </div>
        <div style="flex: 1 1 420px;">
          <div class="muted">Page URL</div>
          <div class="mono small" title="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</div>
        </div>
      </div>

      <div class="row" style="margin-top:12px;">
        <div style="flex: 1 1 520px;">
          <div class="muted"><b>Request Body</b></div>
          <pre class="mono small">${escapeHtml(reqBody)}</pre>
        </div>
        <div style="flex: 1 1 520px;">
          <div class="muted"><b>Response Body</b></div>
          <pre class="mono small">${escapeHtml(resBody)}</pre>
        </div>
      </div>

      ${err
            ? `<div style="margin-top:12px;">
               <div class="muted"><b>Error</b></div>
               <pre class="mono small">${escapeHtml(err)}</pre>
             </div>`
            : ``}
    `;
        const closeBtn = el("netDetailClose");
        if (closeBtn)
            closeBtn.addEventListener("click", clearNetDetail, { once: true });
        try {
            netDetail.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        catch { }
    }
    function formatBody(v, ctx = {}) {
        if (v === null || v === undefined) {
            if (ctx.item && ctx.item.type === "debugger") {
                return "(not captured by debugger)";
            }
            if (ctx.item && ctx.item.type !== "page") {
                return "(not captured in webRequest metadata mode)";
            }
            return "(none)";
        }
        if (typeof v === "string")
            return v.trim() ? v : "(empty string)";
        try {
            return JSON.stringify(v, null, 2);
        }
        catch {
            return String(v);
        }
    }
    // ---------- Console ----------
    function renderConsoleTable() {
        const items = Array.isArray(session.console) ? session.console : [];
        const q = (conSearch.value || "").trim().toLowerCase();
        const level = levelFilter.value;
        let filtered = items.filter(x => {
            const msg = JSON.stringify(x.args || []);
            const okQuery = q ? msg.toLowerCase().includes(q) : true;
            const lvl = String(x.level || "");
            const okLevel = (level === "all") ? true : (lvl === level);
            const okConErrors = conErrorsOnly ? (lvl === "warn" || lvl === "error") : true;
            return okQuery && okLevel && okConErrors;
        });
        filtered.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
        el("conCount").textContent = `${filtered.length} / ${items.length}`;
        const rows = filtered.map((x) => {
            const lvl = String(x.level || "-");
            const ts = typeof x.timestamp === "number" ? x.timestamp : NaN;
            const key = makeConsoleKey(x);
            const url = x.url || null;
            const rowClass = getConsoleRowClass(lvl, key, ts, url);
            return `
        <tr data-con-key="${escapeHtml(key)}"
            data-con-ts="${escapeHtml(String(ts))}"
            data-con-url="${escapeHtml(url || "")}"
            class="${rowClass}"
            title="클릭: 네트워크 하이라이트">
          <td class="mono small">${escapeHtml(new Date(x.timestamp).toISOString())}</td>
          <td><span class="${levelPillClass(lvl)}">${escapeHtml(lvl)}</span></td>
          <td class="mono small" style="white-space: pre-wrap; word-break: break-word;">
            ${escapeHtml(prettyArgs(x.args))}
            <div class="muted">${escapeHtml(x.url || "")}</div>
          </td>
        </tr>
      `;
        }).join("");
        el("console").innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="3" class="muted">결과 없음</td></tr>`}
        </tbody>
      </table>
    `;
    }
    function makeConsoleKey(x) {
        const ts = x.timestamp ?? 0;
        const lvl = x.level ?? "";
        let msg = "";
        try {
            msg = JSON.stringify(x.args ?? []);
        }
        catch {
            msg = String(x.args ?? "");
        }
        return `${ts}|${lvl}|${msg.slice(0, 80)}`;
    }
    // ---------- Helpers ----------
    function kpi(label, value) {
        return `
      <div class="card kpi">
        <div class="muted">${escapeHtml(label)}</div>
        <div class="v">${escapeHtml(String(value))}</div>
      </div>
    `;
    }
    function prettyArgs(args) {
        try {
            if (!Array.isArray(args))
                return String(args ?? "");
            if (args.length === 1)
                return JSON.stringify(args[0], null, 2);
            return JSON.stringify(args, null, 2);
        }
        catch {
            return String(args);
        }
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        }[c]));
    }
    // ---------- Recording (IndexedDB) ----------
    const RECORDING_DB_NAME = "my-web-debugger";
    const RECORDING_DB_VERSION = 2;
    const RECORDING_STORE = "recordings";
    const RECORDING_CLIP_STORE = "recordingClips";
    function openRecordingDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(RECORDING_DB_NAME, RECORDING_DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(RECORDING_STORE)) {
                    db.createObjectStore(RECORDING_STORE, { keyPath: "tabId" });
                }
                if (!db.objectStoreNames.contains(RECORDING_CLIP_STORE)) {
                    const store = db.createObjectStore(RECORDING_CLIP_STORE, { keyPath: "clipId" });
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
    async function loadRecordingForTab(tabId) {
        if (!tabId || !Number.isFinite(tabId))
            return;
        try {
            const db = await openRecordingDb();
            const tx = db.transaction(RECORDING_STORE, "readonly");
            const req = tx.objectStore(RECORDING_STORE).get(tabId);
            const data = await new Promise((resolve, reject) => {
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
            await txComplete(tx);
            db.close();
            if (data?.blob) {
                recordingBlob = data.blob;
                recordingMime = data.mime || recordingBlob.type || "video/webm";
                recordingCreatedAt = data.createdAt || null;
            }
            recordingClips = await loadClipsForTab(tabId);
        }
        catch {
            // ignore
        }
    }
    async function loadClipsForTab(tabId) {
        try {
            const db = await openRecordingDb();
            const tx = db.transaction(RECORDING_CLIP_STORE, "readonly");
            const store = tx.objectStore(RECORDING_CLIP_STORE);
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
            return clips
                .map((c) => ({
                blob: c.blob,
                mime: c.mime || "video/webm",
                createdAt: c.createdAt || null,
                statusCode: c.statusCode ?? null,
                url: c.url ?? null,
                at: c.at ?? null
            }))
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
        catch {
            return [];
        }
    }
    function renderRecording() {
        if (!recordingWrap)
            return;
        if (!recordingBlob) {
            recordingWrap.textContent = "No recording";
            if (clipWrap)
                clipWrap.textContent = "No error clips";
            return;
        }
        if (recordingObjectUrl) {
            URL.revokeObjectURL(recordingObjectUrl);
            recordingObjectUrl = null;
        }
        recordingObjectUrl = URL.createObjectURL(recordingBlob);
        recordingWrap.innerHTML = "";
        const video = document.createElement("video");
        video.controls = true;
        video.src = recordingObjectUrl;
        video.style.maxWidth = "100%";
        video.style.maxHeight = "420px";
        video.style.border = "1px solid #1f2a3a";
        video.style.borderRadius = "10px";
        recordingWrap.appendChild(video);
        if (recordingCreatedAt) {
            const meta = document.createElement("div");
            meta.className = "muted small";
            meta.textContent = `Recorded at ${new Date(recordingCreatedAt).toISOString()}`;
            meta.style.marginTop = "6px";
            recordingWrap.appendChild(meta);
        }
        if (!clipWrap)
            return;
        if (clipObjectUrls.length) {
            clipObjectUrls.forEach((u) => URL.revokeObjectURL(u));
            clipObjectUrls = [];
        }
        if (!recordingClips.length) {
            clipWrap.textContent = "No error clips";
            return;
        }
        const clipItems = recordingClips.map((c, i) => {
            const url = c.url || "";
            const code = c.statusCode ?? "-";
            const at = c.at ? new Date(c.at).toISOString() : "-";
            const clipUrl = URL.createObjectURL(c.blob);
            clipObjectUrls.push(clipUrl);
            return `
        <div class="clip-card">
          <video controls src="${escapeHtml(clipUrl)}" style="width:100%; max-height:220px; border-radius:10px; border:1px solid #1f2a3a;"></video>
          <div class="clip-meta">#${i + 1} · ${escapeHtml(String(code))} · ${escapeHtml(at)}</div>
          <div class="clip-url">${escapeHtml(url)}</div>
        </div>
      `;
        }).join("");
        clipWrap.innerHTML = `<div class="clip-grid">${clipItems}</div>`;
    }
    // ---------- Auto load from extension ----------
    function base64UrlToBytes(b64url) {
        const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "===".slice((b64.length + 3) % 4);
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    async function decodeUrlPayload(payload) {
        try {
            const raw = (() => {
                try {
                    return decodeURIComponent(payload);
                }
                catch {
                    return payload;
                }
            })();
            let mode = "raw";
            let data = raw;
            if (raw.startsWith("gz:")) {
                mode = "gz";
                data = raw.slice(3);
            }
            else if (raw.startsWith("raw:")) {
                data = raw.slice(4);
            }
            const bytes = base64UrlToBytes(data);
            if (mode === "gz") {
                if (typeof DecompressionStream === "undefined")
                    return null;
                const ds = new DecompressionStream("gzip");
                const decompressed = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
                return new TextDecoder().decode(new Uint8Array(decompressed));
            }
            return new TextDecoder().decode(bytes);
        }
        catch {
            return null;
        }
    }
    function parseOptionalNumber(raw) {
        const t = String(raw || "").trim();
        if (!t)
            return NaN;
        const n = Number(t);
        return Number.isFinite(n) ? n : NaN;
    }
    function getLocationSafe() {
        if (typeof location !== "undefined")
            return location;
        if (typeof window !== "undefined" && window.location)
            return window.location;
        return null;
    }
    async function loadFromHashIfPossible() {
        const loc = getLocationSafe();
        if (!loc)
            return false;
        const hash = loc.hash || "";
        if (!hash.startsWith("#data="))
            return false;
        const payload = hash.slice("#data=".length);
        const json = await decodeUrlPayload(payload);
        if (!json) {
            try {
                alert("Failed to decode URL data. Try the downloaded JSON file.");
            }
            catch { }
            return false;
        }
        try {
            session = JSON.parse(json);
            resetToggles();
            resetFilters();
            clearNetDetail();
            clearHilite();
            renderAll();
            return true;
        }
        catch {
            try {
                alert("Invalid JSON in URL data. Try the downloaded JSON file.");
            }
            catch { }
            return false;
        }
    }
    async function autoLoadFromExtensionIfPossible() {
        const loc = getLocationSafe();
        if (!loc)
            return false;
        const qs = new URLSearchParams(loc.search);
        const tabIdRaw = qs.get("tabId");
        if (!tabIdRaw)
            return false;
        const tabId = Number(tabIdRaw);
        if (!Number.isFinite(tabId) || tabId <= 0)
            return false;
        if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage))
            return false;
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "GET_EXPORT_DATA", tabId }, (res) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    resolve(false);
                    return;
                }
                if (res?.ok && res.data) {
                    session = res.data;
                    loadRecordingForTab(tabId).then(() => {
                        resetToggles();
                        resetFilters();
                        clearNetDetail();
                        clearHilite();
                        renderAll();
                        resolve(true);
                    });
                    return;
                }
                else {
                    resolve(false);
                }
            });
        });
    }
    // Test-only hook for automated unit tests.
    if (typeof window !== "undefined") {
        window.__MY_WEB_DEBUGGER_TEST__ = {
            formatBody
        };
    }
    (async () => {
        const loaded = await autoLoadFromExtensionIfPossible();
        if (!loaded)
            await loadFromHashIfPossible();
    })();
    window.addEventListener("beforeunload", () => {
        if (recordingObjectUrl)
            URL.revokeObjectURL(recordingObjectUrl);
        if (clipObjectUrls.length) {
            clipObjectUrls.forEach((u) => URL.revokeObjectURL(u));
            clipObjectUrls = [];
        }
    });
})();
