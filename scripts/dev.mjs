import { spawn } from "node:child_process";
import path from "node:path";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, label) {
  const p = spawn(npm, args, {
    stdio: "inherit",
    cwd: process.cwd()
  });
  p.on("exit", (code) => {
    if (code && code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`[dev] ${label} exited with code ${code}`);
    }
  });
  return p;
}

run(["run", "build:watch"], "tsc");
run(["run", "copy:watch"], "static");
