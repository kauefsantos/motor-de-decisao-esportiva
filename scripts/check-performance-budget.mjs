import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const assetDir = path.resolve(".output/public/assets");
const files = await readdir(assetDir);
const rows = [];

for (const name of files) {
  if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
  const data = await readFile(path.join(assetDir, name));
  rows.push({ name, raw: data.length, gzip: gzipSync(data).length });
}

const js = rows.filter((row) => row.name.endsWith(".js")).sort((a, b) => b.gzip - a.gzip);
const css = rows.filter((row) => row.name.endsWith(".css")).sort((a, b) => b.gzip - a.gzip);
const maxJsGzip = 115 * 1024;
const maxCssGzip = 20 * 1024;
const failures = [];

if (js[0] && js[0].gzip > maxJsGzip) failures.push(`${js[0].name}: JS gzip ${js[0].gzip} > ${maxJsGzip}`);
if (css[0] && css[0].gzip > maxCssGzip) failures.push(`${css[0].name}: CSS gzip ${css[0].gzip} > ${maxCssGzip}`);

console.log("Largest client assets (gzip):");
for (const row of [...js.slice(0, 8), ...css.slice(0, 2)]) {
  console.log(`${row.name.padEnd(52)} ${(row.gzip / 1024).toFixed(1)} KiB gzip / ${(row.raw / 1024).toFixed(1)} KiB raw`);
}

if (failures.length) {
  console.error("Performance budget exceeded:\n" + failures.join("\n"));
  process.exit(1);
}

console.log(`Performance budget OK: JS <= ${maxJsGzip / 1024} KiB gzip; CSS <= ${maxCssGzip / 1024} KiB gzip.`);