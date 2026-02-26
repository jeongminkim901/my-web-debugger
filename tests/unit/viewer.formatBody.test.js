import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

const viewerPath = path.resolve(process.cwd(), "viewer.js");
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
        <select id="statusFilter"></select>
        <select id="sortBy"></select>
        <input id="conSearch" />
        <select id="levelFilter"></select>
        <button id="toggleSlow"></button>
        <button id="toggleNetErrors"></button>
        <button id="toggleConErrors"></button>
        <div id="netDetail"></div>
        <div id="network"></div>
        <div id="console"></div>
        <div id="meta"></div>
        <div id="kpis"></div>
        <div id="slowest"></div>
        <div id="hosts"></div>
        <pre id="raw"></pre>
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

describe("viewer formatBody", () => {
  it("returns none for page hook items with null body", () => {
    const dom = createViewerDom();
    const formatBody = dom.window.__MY_WEB_DEBUGGER_TEST__.formatBody;
    expect(formatBody(null, { item: { type: "page" } })).toBe("(none)");
    dom.window.close();
  });

  it("returns metadata-mode notice for webRequest items with null body", () => {
    const dom = createViewerDom();
    const formatBody = dom.window.__MY_WEB_DEBUGGER_TEST__.formatBody;
    expect(formatBody(null, { item: { type: "xhr" } })).toBe(
      "(not captured in webRequest metadata mode)"
    );
    dom.window.close();
  });

  it("returns empty string notice when body is blank string", () => {
    const dom = createViewerDom();
    const formatBody = dom.window.__MY_WEB_DEBUGGER_TEST__.formatBody;
    expect(formatBody("   ", { item: { type: "page" } })).toBe("(empty string)");
    dom.window.close();
  });

  it("stringifies object bodies", () => {
    const dom = createViewerDom();
    const formatBody = dom.window.__MY_WEB_DEBUGGER_TEST__.formatBody;
    expect(formatBody({ ok: true }, { item: { type: "page" } })).toBe(
      "{\n  \"ok\": true\n}"
    );
    dom.window.close();
  });
});
