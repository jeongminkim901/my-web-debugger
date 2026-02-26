import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const docsDir = path.join(root, "docs");

const files = ["viewer.html", "viewer.js"];

fs.mkdirSync(docsDir, { recursive: true });

for (const file of files) {
  const src = path.join(distDir, file);
  const dest = path.join(docsDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-public] missing: ${src}`);
    continue;
  }
  fs.copyFileSync(src, dest);
}
