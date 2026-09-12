import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = ".output/public/assets";
const MAX_SINGLE_JS_GZIP = 120 * 1024;
const MAX_TOTAL_JS_GZIP = 300 * 1024;
const MAX_TOTAL_CSS_GZIP = 24 * 1024;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const assets = files(root);
const rows = assets
  .filter((path) => path.endsWith(".js") || path.endsWith(".css"))
  .map((path) => {
    const bytes = readFileSync(path);
    return { path: relative(root, path), raw: bytes.length, gzip: gzipSync(bytes).length };
  });

const js = rows.filter((row) => row.path.endsWith(".js"));
const css = rows.filter((row) => row.path.endsWith(".css"));
const largestJs = [...js].sort((a, b) => b.gzip - a.gzip)[0];
const totalJs = js.reduce((sum, row) => sum + row.gzip, 0);
const totalCss = css.reduce((sum, row) => sum + row.gzip, 0);

console.log(`Largest JS gzip: ${largestJs?.path ?? "n/a"} ${largestJs?.gzip ?? 0} B`);
console.log(`Total JS gzip: ${totalJs} B`);
console.log(`Total CSS gzip: ${totalCss} B`);

const failures = [];
if ((largestJs?.gzip ?? 0) > MAX_SINGLE_JS_GZIP) failures.push(`largest JS exceeds ${MAX_SINGLE_JS_GZIP} B gzip`);
if (totalJs > MAX_TOTAL_JS_GZIP) failures.push(`total JS exceeds ${MAX_TOTAL_JS_GZIP} B gzip`);
if (totalCss > MAX_TOTAL_CSS_GZIP) failures.push(`total CSS exceeds ${MAX_TOTAL_CSS_GZIP} B gzip`);

if (failures.length) {
  console.error(`Performance budget failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("Performance budget: PASS");
