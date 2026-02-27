import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcDir = path.join(root, "src", "ui");
const distDir = path.join(root, "dist", "ui");
const files = ["popup.html", "viewer.html", "index.html"];

fs.mkdirSync(distDir, { recursive: true });

function copyOne(file) {
  const src = path.join(srcDir, file);
  const dest = path.join(distDir, file);
  if (!fs.existsSync(src)) return;
  fs.copyFileSync(src, dest);
  // eslint-disable-next-line no-console
  console.log(`[copy-static] ${file}`);
}

for (const file of files) copyOne(file);

for (const file of files) {
  const src = path.join(srcDir, file);
  if (!fs.existsSync(src)) continue;
  fs.watch(src, { persistent: true }, () => copyOne(file));
}

// Keep process alive
setInterval(() => {}, 1 << 30);


