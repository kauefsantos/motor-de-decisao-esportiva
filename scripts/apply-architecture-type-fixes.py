from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def repl(path: str, old: str, new: str, *, expected: int | None = None) -> int:
    text = read(path)
    count = text.count(old)
    if expected is not None and count not in (0, expected):
        raise RuntimeError(f"unexpected occurrence count in {path}: expected 0 or {expected}, got {count} for {old[:100]!r}")
    if count:
        write(path, text.replace(old, new))
        print(f"updated {path}: {count} replacement(s)")
    return count


# Canonical database facade: include runtime schema that the generated snapshot has not caught up with yet.
path = "src/integrations/supabase/database.types.ts"
text = read(path)
text = text.replace(
    "Row: BaseTables['analysis_runs']['Row'] & { owner_id: string };",
    "Row: BaseTables['analysis_runs']['Row'] & { owner_id: string; selection_finalized_at: string | null };",
)
text = text.replace(
    "Insert: BaseTables['analysis_runs']['Insert'] & { owner_id?: string };",
    "Insert: BaseTables['analysis_runs']['Insert'] & { owner_id?: string; selection_finalized_at?: string | null };",
)
text = text.replace(
    "Update: BaseTables['analysis_runs']['Update'] & { owner_id?: string };",
    "Update: BaseTables['analysis_runs']['Update'] & { owner_id?: string; selection_finalized_at?: string | null };",
)
if "type AnalysisDraftsTable =" not in text:
    marker = "type RawObservationsTable = {"
    block = """type AnalysisDraftsTable = {\n  Row: {\n    id: string;\n    owner_id: string;\n    client_request_id: string;\n    filename: string;\n    target_date: string | null;\n    headers: Json;\n    leagues: Json;\n    invalid_count: number;\n    status: string;\n    final_run_id: string | null;\n    created_at: string;\n    updated_at: string;\n  };\n  Insert: {\n    id?: string;\n    owner_id: string;\n    client_request_id: string;\n    filename: string;\n    target_date?: string | null;\n    headers?: Json;\n    leagues?: Json;\n    invalid_count?: number;\n    status?: string;\n    final_run_id?: string | null;\n    created_at?: string;\n    updated_at?: string;\n  };\n  Update: {\n    id?: string;\n    owner_id?: string;\n    client_request_id?: string;\n    filename?: string;\n    target_date?: string | null;\n    headers?: Json;\n    leagues?: Json;\n    invalid_count?: number;\n    status?: string;\n    final_run_id?: string | null;\n    created_at?: string;\n    updated_at?: string;\n  };\n  Relationships: [];\n};\n\n"""
    if marker not in text:
        raise RuntimeError("database.types.ts marker missing")
    text = text.replace(marker, block + marker, 1)
if "analysis_drafts: AnalysisDraftsTable;" not in text:
    marker = "      analysis_runs: AnalysisRunsTable;\n"
    if marker not in text:
        raise RuntimeError("database.types.ts table marker missing")
    text = text.replace(marker, marker + "      analysis_drafts: AnalysisDraftsTable;\n", 1)
write(path, text)

# Existing strictness findings.
repl(
    "src/lib/auto-bet365-odds.functions.ts",
    'await assertRunOwner(supabase as unknown as { from: (table: string) => any }, context.userId, data.runId);',
    'await assertRunOwner(supabase, context.userId, data.runId);',
    expected=1,
)
repl(
    "src/lib/decision-observability.functions.ts",
    '''      passesExperimentalModelGate(probability) &&\n      odd !== null &&\n      probability * odd - 1 >= EV_TARGET''',
    '''      probability !== null &&\n      passesExperimentalModelGate(probability) &&\n      odd !== null &&\n      probability * odd - 1 >= EV_TARGET''',
    expected=1,
)

# Decision queue lookup typing.
path = "src/lib/decision-queue.functions.ts"
text = read(path)
if "type DecisionMatchRow =" not in text:
    text = text.replace(
        "type Ranked = ValueResult & {",
        """type DecisionMatchRow = {\n  id: string;\n  raw_partida: string;\n  home_team: string | null;\n  away_team: string | null;\n  competition: string | null;\n};\n\ntype Ranked = ValueResult & {""",
        1,
    )
text = text.replace(
    'const matchById = new Map((matches ?? []).map((match: any) => [match.id, match]));',
    'const matchById = new Map(((matches ?? []) as DecisionMatchRow[]).map((match) => [match.id, match]));',
)
write(path, text)

repl(
    "src/lib/engine/corners.test.ts",
    'import { buildDataset } from "./corners.train.server";',
    'import { buildDataset } from "../application/training/corners-training.server";',
    expected=1,
)
for old, new in [
    ('typeof record.lambda === "number" ? record.lambda : Number(record.lambda)', 'typeof record["lambda"] === "number" ? record["lambda"] : Number(record["lambda"])'),
    ('record.distribution', 'record["distribution"]'),
    ('record.alpha_applied', 'record["alpha_applied"]'),
]:
    repl("src/lib/engine/count-market-distribution.ts", old, new, expected=1)

# Experimental market authorization casts no longer needed with canonical AdminDb.
repl(
    "src/lib/experimental-markets-run.functions.ts",
    'await assertRunOwner(supabase as unknown as { from: (table: string) => any }, context.userId, data.runId);',
    'await assertRunOwner(supabase, context.userId, data.runId);',
    expected=2,
)

# Experimental analysis: typed database client and match lookup.
path = "src/lib/experimental-analysis.functions.ts"
text = read(path)
if "type ExperimentalMatchRow =" not in text:
    text = text.replace(
        "type ReferenceAlternative = {",
        """type ExperimentalMatchRow = {\n  id: string;\n  raw_partida: string;\n  home_team: string | null;\n  away_team: string | null;\n  competition: string | null;\n};\n\ntype ReferenceAlternative = {""",
        1,
    )
text = text.replace("const supabase = supabaseAdmin as any;", "const supabase = supabaseAdmin;")
text = text.replace(
    'const matchById = new Map((matches ?? []).map((match: any) => [match.id, match]));',
    'const matchById = new Map(((matches ?? []) as ExperimentalMatchRow[]).map((match) => [match.id, match]));',
)
write(path, text)

# Persisted experimental ledger: remove `any` DB facade and unknown arrays so server functions are serializable.
path = "src/lib/experimental-result-ledger.functions.ts"
text = read(path)
if 'import type { AdminDb } from "./admin-db";' not in text:
    text = text.replace(
        'import { z } from "zod";\n',
        'import { z } from "zod";\n\nimport type { Json } from "@/integrations/supabase/types";\nimport type { AdminDb } from "./admin-db";\nimport { BackendError } from "./backend-contract";\n',
        1,
    )
text = text.replace('''type Db = {\n  from: (table: string) => any;\n};\n\n''', '')
if "export type PersistedReferenceAlternative =" not in text:
    marker = "export type PersistedExperimentalResult = {"
    block = """export type PersistedReferenceAlternative = {\n  matchId: string;\n  market: string;\n  participant: string | null;\n  side: \"OVER\" | \"UNDER\";\n  lineCanonical: number;\n  marketLabel: string;\n  probabilityExperimental: number;\n  fairOdd: number | null;\n  minOddTarget: number | null;\n  requiresRealOdd: true;\n  valueStatus: \"NAO_AVALIADO\";\n};\n\nexport type PersistedDirectionAssessment = {\n  matchId: string;\n  market: string;\n  participant: string | null;\n  anchorLine: number;\n  direction: \"VALUE_OVER\" | \"VALUE_UNDER\" | \"MODEL_LEAN_OVER\" | \"MODEL_LEAN_UNDER\" | \"NEUTRAL\";\n  basis: \"VALUE\" | \"MODEL_ONLY\" | \"NEUTRAL\";\n  overProbability: number;\n  underProbability: number;\n  bestValuePredictionId: string | null;\n  referenceAlternatives: PersistedReferenceAlternative[];\n};\n\nexport type PersistedCorrelatedAlternate = Omit<PersistedExperimentalEvaluation, \"selected\">;\n\n"""
    if marker not in text:
        raise RuntimeError("ledger type marker missing")
    text = text.replace(marker, block + marker, 1)
text = text.replace("  directionAssessments: unknown[];\n  referenceAlternatives: unknown[];\n  correlatedAlternates: unknown[];", "  directionAssessments: PersistedDirectionAssessment[];\n  referenceAlternatives: PersistedReferenceAlternative[];\n  correlatedAlternates: PersistedCorrelatedAlternate[];")
text = text.replace("  rawDb: Db,", "  rawDb: AdminDb,")
text = text.replace("    result_payload: input,", "    result_payload: input as unknown as Json,")
text = text.replace("    const rawDb = supabaseAdmin as unknown as Db;", "    const rawDb = supabaseAdmin;")
text = text.replace("if (error) throw new Error(`Não foi possível recuperar o resultado experimental: ${error.message}`);", "if (error) throw new BackendError(\"INTERNAL_ERROR\", \"Não foi possível recuperar o resultado experimental.\", 500);")
text = text.replace("      throw new Error(\"O snapshot persistido não corresponde à rodada solicitada.\");", "      throw new BackendError(\"CONFLICT\", \"O snapshot persistido não corresponde à rodada solicitada.\", 409);")
text = text.replace("const result = row.result_payload as PersistedExperimentalResult;", "const result = row.result_payload as unknown as PersistedExperimentalResult;")
write(path, text)

# Restore helpers accidentally dropped while splitting RESOLVE/COLLECT.
path = "src/lib/pipeline.server.ts"
text = read(path)
if 'import { activeFootballProvider } from "./pipeline/provider.server";' not in text:
    text = text.replace(
        'import { resolvePipelineMatches } from "./pipeline/resolve.server";',
        'import { resolvePipelineMatches } from "./pipeline/resolve.server";\nimport { activeFootballProvider } from "./pipeline/provider.server";',
        1,
    )
if "async function runPredictionAt(" not in text:
    marker = "export async function executeStep(runId: string, step: PipelineStepKey) {"
    helper = """async function runPredictionAt(db: Db, runId: string): Promise<string> {\n  const { data: run } = await db.from(\"analysis_runs\").select(\"notes, created_at\").eq(\"id\", runId).single();\n  const stored = (run?.notes as { prediction_at?: unknown } | null)?.prediction_at;\n  if (typeof stored === \"string\" && Number.isFinite(Date.parse(stored))) return stored;\n  const fallback = run?.created_at ?? new Date().toISOString();\n  const notes = { ...((run?.notes as Record<string, unknown> | null) ?? {}), prediction_at: fallback };\n  await db.from(\"analysis_runs\").update({ notes: notes as never }).eq(\"id\", runId);\n  return fallback;\n}\n\n"""
    if marker not in text:
        raise RuntimeError("pipeline executeStep marker missing")
    text = text.replace(marker, helper + marker, 1)
text = text.replace("activeProvider()", "activeFootballProvider()")
write(path, text)

repl(
    "src/lib/qualified-alternates.functions.ts",
    'const lineLabel = Number.isFinite(numericLine) ? formatBookmakerLine(numericLine) : "";',
    'const lineLabel = numericLine !== null && Number.isFinite(numericLine) ? formatBookmakerLine(numericLine) : "";',
    expected=1,
)

for prop in ("year", "month", "day", "hour", "minute", "second"):
    repl("src/lib/sao-paulo-time.ts", f"parts.{prop}", f'parts["{prop}"]', expected=1)

for prop in ("authorization", "route", "nested"):
    repl("src/lib/lovable-error-reporting.test.ts", f"payload.{prop}", f'payload["{prop}"]', expected=1)

repl("src/routes/api.analysis-worker.ts", 'body.runId', 'body["runId"]', expected=2)
repl("src/routes/api.analysis-worker.ts", 'body.dispatchToken', 'body["dispatchToken"]', expected=2)
repl("src/routes/api.five-dollar-maintenance.ts", 'body?.dispatchToken', 'body?.["dispatchToken"]', expected=1)
repl("src/routes/api.five-dollar-maintenance.ts", 'body.dispatchToken', 'body["dispatchToken"]', expected=1)

for prop in ("date", "partida", "label"):
    repl("src/routes/draft.$draftId.validacao.tsx", f"suggestion.{prop}", f'suggestion["{prop}"]')

# Home route: explicit recentRuns variable gives exact narrowing and removes remaining any usage.
path = "src/routes/index.tsx"
text = read(path)
if "type HomeSummary = Awaited<ReturnType<typeof getHomeSummary>>;" not in text:
    text = text.replace(
        "function dateLabel(iso: string | null | undefined) {",
        "type HomeSummary = Awaited<ReturnType<typeof getHomeSummary>>;\ntype RecentRun = HomeSummary[\"recentRuns\"][number];\n\nfunction dateLabel(iso: string | null | undefined) {",
        1,
    )
text = text.replace("function ResumeRunLink({ run }: { run: any }) {", "function ResumeRunLink({ run }: { run: RecentRun | null | undefined }) {\n  if (!run) return null;")
if "const recentRuns = summary?.recentRuns ?? [];" not in text:
    text = text.replace(
        "  const primaryPending = summary?.pendingDraft ?? summary?.resumableRun ?? null;",
        "  const primaryPending = summary?.pendingDraft ?? summary?.resumableRun ?? null;\n  const recentRuns = summary?.recentRuns ?? [];",
        1,
    )
text = text.replace("{summary?.recentRuns?.length > 0 && (", "{recentRuns.length > 0 && (")
text = text.replace("meta={summary.recentRuns.length}", "meta={recentRuns.length}")
text = text.replace("{summary.recentRuns.map((run: any) => (", "{recentRuns.map((run) => (")
write(path, text)

print("Applied remaining architecture/typecheck fixes.")
