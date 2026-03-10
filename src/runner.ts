import path from "node:path";
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { loadTestCases } from "./excel";
import { CaseResult, Step, TestCase } from "./types";
import { writeHtmlReport, writeJsonReport } from "./report";

type RunOptions = {
  caseFile: string;
  extensionPath: string;
  headless: boolean;
  outDir: string;
};

function getEnvBoolean(name: string, fallback: boolean) {
  const v = String(process.env[name] || "").toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

function resolveOptions(): RunOptions {
  const caseFile = process.env.CASE_FILE || path.join("samples", "testcases.csv");
  const extensionPath = process.env.EXT_PATH || path.resolve("..", "my-web-debugger", "dist");
  const headless = getEnvBoolean("HEADLESS", false);
  const outDir = process.env.OUT_DIR || "reports";
  return { caseFile, extensionPath, headless, outDir };
}

function applyBaseUrl(url: string, baseUrl?: string) {
  if (!baseUrl) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, baseUrl).toString();
}

async function runStep(page, step: Step, tc: TestCase) {
  switch (step.kind) {
    case "goto":
      await page.goto(applyBaseUrl(step.url, tc.baseUrl));
      return;
    case "click":
      await page.click(step.selector);
      return;
    case "fill":
      await page.fill(step.selector, step.value);
      return;
    case "press":
      await page.press(step.selector, step.key);
      return;
    case "wait":
      if (step.ms > 0) await page.waitForTimeout(step.ms);
      return;
    case "assert_text":
      await page.waitForSelector(`text=${step.text}`);
      return;
    case "assert_selector":
      await page.waitForSelector(step.selector);
      return;
    case "screenshot":
      await page.screenshot({ path: step.name || undefined, fullPage: true });
      return;
  }
}

async function runCase(page, tc: TestCase, outDir: string): Promise<CaseResult> {
  if (tc.enabled === false) {
    return { id: tc.id, title: tc.title, status: "skipped", durationMs: 0 };
  }

  const started = Date.now();
  const shotPath = path.join(outDir, `${tc.id}.png`);
  try {
    for (const step of tc.steps) {
      await runStep(page, step, tc);
    }
    await page.screenshot({ path: shotPath, fullPage: true });
    return {
      id: tc.id,
      title: tc.title,
      status: "passed",
      durationMs: Date.now() - started,
      screenshotPath: shotPath
    };
  } catch (err: any) {
    try {
      await page.screenshot({ path: shotPath, fullPage: true });
    } catch {
      // ignore
    }
    return {
      id: tc.id,
      title: tc.title,
      status: "failed",
      durationMs: Date.now() - started,
      screenshotPath: fs.existsSync(shotPath) ? shotPath : undefined,
      error: err?.stack || String(err)
    };
  }
}

async function main() {
  const opts = resolveOptions();
  if (!fs.existsSync(opts.outDir)) fs.mkdirSync(opts.outDir, { recursive: true });
  if (!fs.existsSync(opts.extensionPath)) {
    throw new Error(`Extension path not found: ${opts.extensionPath}`);
  }

  const cases = loadTestCases(opts.caseFile);
  if (!cases.length) throw new Error("No test cases found.");

  const userDataDir = path.join(process.cwd(), ".pw-user");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: opts.headless,
    channel: "chrome",
    args: [
      `--disable-extensions-except=${opts.extensionPath}`,
      `--load-extension=${opts.extensionPath}`
    ]
  });

  const page = await context.newPage();
  const results: CaseResult[] = [];

  for (const tc of cases) {
    results.push(await runCase(page, tc, opts.outDir));
  }

  await context.close();
  const jsonPath = writeJsonReport(opts.outDir, results);
  const htmlPath = writeHtmlReport(opts.outDir, results);

  console.log(`Report written: ${jsonPath}`);
  console.log(`Report written: ${htmlPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

