import { readFile, writeFile, unlink } from "node:fs/promises";

const path = "src/lib/pipeline.server.ts";
let source = await readFile(path, "utf8");

const requireText = (text) => {
  if (!source.includes(text)) throw new Error(`Expected pipeline marker not found: ${text}`);
};

requireText('import { isCrossLeagueCompetitionName } from "./competition-kind";');
requireText('import { saoPauloLocalDateTimeToIso } from "./sao-paulo-time";');
requireText('import { loadFiveDollarCacheRows } from "./raw-observations.server";');
requireText('type ProviderId = "five_dollar" | "api_sports";');
requireText('const SEPARATOR = /\\s+(?:x|vs?|-)+\\s+/i;');
requireText('async function runPredictionAt(db: Db, runId: string): Promise<string> {');
requireText('function sourceAgreement(');

source = source
  .replace('import { isCrossLeagueCompetitionName } from "./competition-kind";\n', '')
  .replace('import { saoPauloLocalDateTimeToIso } from "./sao-paulo-time";\n', '')
  .replace('import { loadFiveDollarCacheRows } from "./raw-observations.server";\n', '')
  .replace(
    'import type { PipelineStepKey } from "./pipeline.steps";\n',
    'import type { PipelineStepKey } from "./pipeline.steps";\nimport { collectPipelineData } from "./pipeline/collect.server";\nimport { resolvePipelineMatches } from "./pipeline/resolve.server";\n',
  );

const providerStart = source.indexOf('type ProviderId = "five_dollar" | "api_sports";');
const dbStart = source.indexOf('type Db = Awaited<ReturnType<typeof getDb>>;', providerStart);
if (providerStart < 0 || dbStart < 0) throw new Error("Could not isolate provider policy block");
const providerEnd = dbStart;
source = source.slice(0, providerStart) + source.slice(providerEnd);

// Remove activeProvider after Db type while preserving getDb.
const activeStart = source.indexOf('function activeProvider():');
const getDbStart = source.indexOf('async function getDb()', activeStart);
if (activeStart < 0 || getDbStart < 0) throw new Error("Could not isolate activeProvider");
source = source.slice(0, activeStart) + source.slice(getDbStart);

// Parsing and provider-specific resolution moved to pipeline/resolve.server.ts.
const parseStart = source.indexOf('const SEPARATOR = /\\s+(?:x|vs?|-)+\\s+/i;');
const executeStart = source.indexOf('export async function executeStep', parseStart);
if (parseStart < 0 || executeStart < 0) throw new Error("Could not isolate inline resolution helpers");
source = source.slice(0, parseStart) + source.slice(executeStart);

source = source
  .replace('case "RESOLVE": return resolveMatches(db, runId);', 'case "RESOLVE": return resolvePipelineMatches(db, runId);')
  .replace('case "COLLECT": return collect(db, runId);', 'case "COLLECT": return collectPipelineData(db, runId);');

// Resolution and collection stages now live in focused modules.
const legacyStageStart = source.indexOf('async function runPredictionAt(db: Db, runId: string): Promise<string> {');
const cleanHelpersStart = source.indexOf('function sourceAgreement(', legacyStageStart);
if (legacyStageStart < 0 || cleanHelpersStart < 0) throw new Error("Could not isolate legacy RESOLVE/COLLECT stages");
source = source.slice(0, legacyStageStart) + source.slice(cleanHelpersStart);

if (source.includes('activeProvider()') || source.includes('resolveMatches(db') || source.includes('collect(db')) {
  throw new Error("Legacy pipeline responsibilities remain after refactor");
}

await writeFile(path, source);
await unlink("scripts/one-shot-pipeline-refactor.mjs");
await unlink(".github/workflows/one-shot-architecture-refactor.yml");
console.log("Pipeline RESOLVE/COLLECT stages extracted successfully.");
