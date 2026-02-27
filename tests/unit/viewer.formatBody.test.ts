import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

const viewerPath = path.resolve(process.cwd(), "dist", "ui", "viewer.js");
const viewerSource = fs.readFileSync(viewerPath, "utf8");

function createViewerDom() {
  const dom = new JSDOM(
    `<!doctype html>
    <html>
      <body>
        <div id="drop"></div>
        <input id="file" />
        <div id="content"></div>
        <input id="netSearch" />
        <input id="hostFilter" />
        <select id="statusFilter"></select>
        <select id="methodFilter"></select>
        <select id="sortBy"></select>
        <input id="durMin" />
        <input id="durMax" />
        <input id="conSearch" />
        <select id="levelFilter"></select>
        <button id="toggleSlow"></button>
        <button id="toggleNetErrors"></button>
        <button id="toggleConErrors"></button>
        <div id="netDetail"></div>
        <div id="network"></div>
        <div id="timeline"></div>
        <div id="console"></div>
        <div id="meta"></div>
        <div id="metaNote"></div>
        <div id="metaTags"></div>
        <div id="kpis"></div>
        <div id="errorSummary"></div>
        <div id="slowest"></div>
        <div id="hosts"></div>
        <pre id="raw"></pre>
        <div id="screenshotWrap"></div>
        <span id="netCount"></span>
        <span id="conCount"></span>
      </body>
    </html>`,
    {
      url: "https://example.test/viewer.html",
      runScripts: "outside-only"
    }
  );

  dom.window.alert = () => {};
  dom.window.eval(viewerSource);
  return dom;
}

function getFormatBody(dom: JSDOM) {
  return (dom.window as any).__MY_WEB_DEBUGGER_TEST__.formatBody as (
    value: unknown,
    context?: { item?: { type?: string } }
  ) => string;
}

describe("viewer formatBody", () => {
  it("returns none for page hook items with null body", () => {
    const dom = createViewerDom();
    const formatBody = getFormatBody(dom);
    expect(formatBody(null, { item: { type: "page" } })).toBe("(none)");
    dom.window.close();
  });

  it("returns metadata-mode notice for webRequest items with null body", () => {
    const dom = createViewerDom();
    const formatBody = getFormatBody(dom);
    expect(formatBody(null, { item: { type: "xhr" } })).toBe(
      "(not captured in webRequest metadata mode)"
    );
    dom.window.close();
  });

  it("returns empty string notice when body is blank string", () => {
    const dom = createViewerDom();
    const formatBody = getFormatBody(dom);
    expect(formatBody("   ", { item: { type: "page" } })).toBe("(empty string)");
    dom.window.close();
  });

  it("stringifies object bodies", () => {
    const dom = createViewerDom();
    const formatBody = getFormatBody(dom);
    expect(formatBody({ ok: true }, { item: { type: "page" } })).toBe(
      "{\n  \"ok\": true\n}"
    );
    dom.window.close();
  });
});

