import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { Step, TestCase } from "./types";
import { parseSteps } from "./steps";

type RawRow = Record<string, unknown>;

function normalizeKey(key: string) {
  return String(key || "").trim().toLowerCase();
}

function asString(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function splitTags(raw: string) {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function rowToCase(row: RawRow): TestCase | null {
  const keys = Object.keys(row);
  const map: Record<string, unknown> = {};
  for (const k of keys) map[normalizeKey(k)] = row[k];

  const id = asString(map["case_id"] || map["id"]).trim();
  const title = asString(map["title"] || map["name"]).trim();
  const stepsRaw = asString(map["steps"] || map["step"] || "").trim();
  if (!id || !title || !stepsRaw) return null;

  const enabledRaw = asString(map["enabled"] || "y").trim().toLowerCase();
  const enabled = enabledRaw === "y" || enabledRaw === "yes" || enabledRaw === "true" || enabledRaw === "1";

  const expected = asString(map["expected"]).trim() || undefined;
  const baseUrl = asString(map["base_url"]).trim() || undefined;
  const tags = splitTags(asString(map["tags"] || "")).filter(Boolean);
  const steps = parseSteps(stepsRaw);

  return { id, title, steps, expected, baseUrl, enabled, tags };
}

export function loadTestCases(filePath: string): TestCase[] {
  const ext = path.extname(filePath).toLowerCase();
  if (!fs.existsSync(filePath)) {
    throw new Error(`Test case file not found: ${filePath}`);
  }

  let rows: RawRow[] = [];
  if (ext === ".xlsx" || ext === ".xls") {
    const wb = XLSX.readFile(filePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as RawRow[];
  } else if (ext === ".csv") {
    const csv = fs.readFileSync(filePath, "utf-8");
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as RawRow[];
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return rows
    .map(rowToCase)
    .filter(Boolean)
    .map((x) => x as TestCase);
}

