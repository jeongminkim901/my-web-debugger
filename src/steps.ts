import { Step } from "./types";

function parseLine(line: string): Step | null {
  const raw = line.trim();
  if (!raw) return null;

  const [cmd, ...rest] = raw.split(" ");
  const arg = rest.join(" ").trim();

  if (cmd === "goto") return { kind: "goto", url: arg };
  if (cmd === "click") return { kind: "click", selector: arg };
  if (cmd === "fill") {
    const [selector, value] = arg.split("|").map((s) => s.trim());
    return { kind: "fill", selector, value: value ?? "" };
  }
  if (cmd === "press") {
    const [selector, key] = arg.split("|").map((s) => s.trim());
    return { kind: "press", selector, key: key ?? "Enter" };
  }
  if (cmd === "wait") return { kind: "wait", ms: Number(arg) || 0 };
  if (cmd === "assert") {
    if (arg.startsWith("text=")) return { kind: "assert_text", text: arg.slice("text=".length) };
    if (arg.startsWith("selector=")) return { kind: "assert_selector", selector: arg.slice("selector=".length) };
  }
  if (cmd === "screenshot") return { kind: "screenshot", name: arg || undefined };

  throw new Error(`Unknown step: ${raw}`);
}

export function parseSteps(raw: string): Step[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseLine)
    .filter(Boolean) as Step[];
}

