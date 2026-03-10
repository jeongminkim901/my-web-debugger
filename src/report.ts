import fs from "node:fs";
import path from "node:path";
import { CaseResult } from "./types";

export function writeJsonReport(outDir: string, results: CaseResult[]) {
  const jsonPath = path.join(outDir, "report.json");
  fs.writeFileSync(jsonPath, JSON.stringify({ results }, null, 2), "utf-8");
  return jsonPath;
}

export function writeHtmlReport(outDir: string, results: CaseResult[]) {
  const rows = results.map((r) => `
    <tr class="${r.status}">
      <td>${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.durationMs.toString())}ms</td>
      <td>${r.screenshotPath ? `<a href="${escapeHtml(r.screenshotPath)}">screenshot</a>` : "-"}</td>
      <td>${r.error ? `<pre>${escapeHtml(r.error)}</pre>` : "-"}</td>
    </tr>
  `).join("");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Test Report</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #ddd; padding: 8px; vertical-align: top; text-align: left; }
      tr.passed { background: #f0fff4; }
      tr.failed { background: #fff5f5; }
      tr.skipped { background: #f7fafc; }
      pre { white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Test Report</h1>
    <table>
      <thead>
        <tr>
          <th>Case ID</th>
          <th>Title</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Screenshot</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan='6'>No results</td></tr>"}
      </tbody>
    </table>
  </body>
</html>`;

  const htmlPath = path.join(outDir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf-8");
  return htmlPath;
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[c] as string));
}

