import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src", "ui");
const distDir = path.join(root, "dist", "ui");

const files = ["popup.html", "viewer.html", "index.html"];

fs.mkdirSync(distDir, { recursive: true });

for (const file of files) {
  const src = path.join(srcDir, file);
  const dest = path.join(distDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-static] missing: ${src}`);
    continue;
  }
  fs.copyFileSync(src, dest);
}


