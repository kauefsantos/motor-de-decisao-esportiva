import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("src");
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry);
    const info = await stat(absolute);
    if (info.isDirectory()) files.push(...await walk(absolute));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(absolute);
  }
  return files;
}

const files = await walk(root);
const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
const explicitAnyPattern = /:\s*any\b|\bas\s+any\b|<\s*any\s*>/;
const criticalTypedFiles = new Set([
  "src/lib/analysis.functions.ts",
  "src/lib/analytics.functions.ts",
  "src/lib/bankroll.functions.ts",
  "src/lib/authorization.server.ts",
  "src/lib/decision-queue.functions.ts",
]);

for (const absolute of files) {
  const relative = path.relative(process.cwd(), absolute).replaceAll("\\", "/");
  if (relative.endsWith("routeTree.gen.ts")) continue;
  const source = await readFile(absolute, "utf8");

  if (source.includes("types.live")) {
    violations.push(`${relative}: use the canonical database.types module instead of types.live`);
  }

  const isEngine = relative.startsWith("src/lib/engine/");
  const isTest = /\.(test|spec)\.[^.]+$/.test(relative);
  if (isEngine && !isTest && relative.endsWith(".server.ts")) {
    violations.push(`${relative}: persistence/server orchestration must live outside the pure engine layer`);
  }

  if (isEngine && !isTest) {
    for (const match of source.matchAll(importPattern)) {
      const target = match[1];
      if (
        target.startsWith("@/integrations/") ||
        target.startsWith("@/components/") ||
        target.startsWith("@/routes/") ||
        target.includes(".functions")
      ) {
        violations.push(`${relative}: engine import crosses architectural boundary -> ${target}`);
      }
    }
  }

  if (relative.startsWith("src/routes/") && source.includes("client.server")) {
    violations.push(`${relative}: routes must call application/server functions instead of the privileged DB client directly`);
  }

  const criticalTyped =
    criticalTypedFiles.has(relative)
    || relative.startsWith("src/lib/application/")
    || relative.startsWith("src/lib/domain/")
    || relative.startsWith("src/lib/repositories/");
  if (criticalTyped && explicitAnyPattern.test(source)) {
    violations.push(`${relative}: explicit any is forbidden in critical application/domain/repository boundaries`);
  }
}

if (violations.length) {
  console.error("Architecture boundary violations:\n" + violations.map((v) => `- ${v}`).join("\n"));
  process.exit(1);
}

console.log(`Architecture boundaries OK (${files.length} TypeScript files checked).`);
