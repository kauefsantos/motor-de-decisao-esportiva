from pathlib import Path


def replace(path: str, old: str, new: str, count: int | None = None) -> None:
    file = Path(path)
    text = file.read_text()
    found = text.count(old)
    if found == 0:
        raise RuntimeError(f"pattern not found in {path}: {old[:120]!r}")
    if count is not None and found != count:
        raise RuntimeError(f"expected {count} occurrence(s) in {path}, found {found}: {old[:120]!r}")
    file.write_text(text.replace(old, new))


# Null/index-safety and exact optional typing surfaced by the new strict gate.
replace(
    "src/components/SourceAudit.tsx",
    'RESOLUTION_LABEL[match.resolution_status] ?? "Em conferência"',
    'match.resolution_status ? (RESOLUTION_LABEL[match.resolution_status] ?? "Em conferência") : "Em conferência"',
    1,
)
replace(
    "src/components/WebVitalsReporter.tsx",
    '''      const metrics: Array<[VitalMetric, number]> = [\n        ["LCP", lcp],\n        ["CLS", cls],\n        ["INP", inp],\n        ["TTFB", ttfb],\n      ].filter(([, value]) => value > 0) as Array<[VitalMetric, number]>;\n      if (!metrics.length) return;''',
    '''      const metrics: Array<[VitalMetric, number]> = [\n        ["LCP", lcp],\n        ["CLS", cls],\n        ["INP", inp],\n        ["TTFB", ttfb],\n      ];\n      const positiveMetrics = metrics.filter(([, value]) => value > 0);\n      if (!positiveMetrics.length) return;''',
    1,
)
replace(
    "src/components/WebVitalsReporter.tsx",
    'await Promise.all(metrics.map(([metric, value]) => reportPerformanceVital({',
    'await Promise.all(positiveMetrics.map(([metric, value]) => reportPerformanceVital({',
    1,
)
replace(
    "src/frontend-accessibility-typography-contract.test.ts",
    '  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];',
    '  const [red = 0, green = 0, blue = 0] = linear;\n  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;',
    1,
)
replace(
    "src/lib/adapters/five_dollar.standings.test.ts",
    'rows[0]?.raw.first_half',
    'rows[0]?.raw["first_half"]',
    1,
)
replace(
    "src/lib/analysis-worker-security.test.ts",
    'payload?.runId',
    'payload?.["runId"]',
    1,
)
replace(
    "src/lib/application/bankroll/capture-clv.server.ts",
    '  if (betError || !bet) return null;\n\n  const supported = new Set([',
    '''  if (betError || !bet) return null;\n  if (!bet.match_id) {\n    await db.from("experimental_bet_tracking").update({\n      clv_status: "SOURCE_UNAVAILABLE",\n      closing_source: "five_dollar_bet365",\n      closing_fetched_at: new Date().toISOString(),\n      updated_at: new Date().toISOString(),\n    }).eq("id", trackingId);\n    return { status: "SOURCE_UNAVAILABLE", clvPct: null, impliedDelta: null };\n  }\n\n  const supported = new Set([''',
    1,
)
replace(
    "src/lib/auto-bet365-odds.functions.ts",
    'await assertRunOwner(supabase as unknown as { from: (table: string) => any }, context.userId, data.runId);',
    'await assertRunOwner(supabase, context.userId, data.runId);',
    1,
)
replace(
    "src/lib/decision-observability.functions.ts",
    '''      passesExperimentalModelGate(probability) &&\n      odd !== null &&\n      probability * odd - 1 >= EV_TARGET''',
    '''      probability !== null &&\n      passesExperimentalModelGate(probability) &&\n      odd !== null &&\n      probability * odd - 1 >= EV_TARGET''',
    1,
)

# Strongly type match lookup data instead of allowing Map inference to collapse to {}.
replace(
    "src/lib/decision-queue.functions.ts",
    '''type Ranked = ValueResult & {''',
    '''type DecisionMatchRow = {\n  id: string;\n  raw_partida: string;\n  home_team: string | null;\n  away_team: string | null;\n  competition: string | null;\n};\n\ntype Ranked = ValueResult & {''',
    1,
)
replace(
    "src/lib/decision-queue.functions.ts",
    'const matchById = new Map((matches ?? []).map((match: any) => [match.id, match]));',
    'const matchById = new Map(((matches ?? []) as DecisionMatchRow[]).map((match) => [match.id, match]));',
    1,
)
replace(
    "src/lib/engine/corners.test.ts",
    'import { buildDataset } from "./corners.train.server";',
    'import { buildDataset } from "../application/training/corners-training.server";',
    1,
)
replace(
    "src/lib/engine/count-market-distribution.ts",
    'typeof record.lambda === "number" ? record.lambda : Number(record.lambda)',
    'typeof record["lambda"] === "number" ? record["lambda"] : Number(record["lambda"])',
    1,
)
replace("src/lib/engine/count-market-distribution.ts", 'record.distribution', 'record["distribution"]', 1)
replace("src/lib/engine/count-market-distribution.ts", 'record.alpha_applied', 'record["alpha_applied"]', 1)
replace(
    "src/lib/qualified-alternates.functions.ts",
    'const lineLabel = Number.isFinite(numericLine) ? formatBookmakerLine(numericLine) : "";',
    'const lineLabel = numericLine !== null && Number.isFinite(numericLine) ? formatBookmakerLine(numericLine) : "";',
    1,
)

# Dynamic Intl/JSON/request records must use index access under noPropertyAccessFromIndexSignature.
for prop in ("year", "month", "day", "hour", "minute", "second"):
    replace("src/lib/sao-paulo-time.ts", f"parts.{prop}", f'parts["{prop}"]', 1)
replace("src/routes/api.analysis-worker.ts", 'body.runId', 'body["runId"]', 2)
replace("src/routes/api.analysis-worker.ts", 'body.dispatchToken', 'body["dispatchToken"]', 2)
replace("src/routes/api.five-dollar-maintenance.ts", 'body?.dispatchToken', 'body?.["dispatchToken"]', 1)
replace("src/routes/api.five-dollar-maintenance.ts", 'body.dispatchToken', 'body["dispatchToken"]', 1)
for prop in ("date", "partida"):
    replace("src/routes/draft.$draftId.validacao.tsx", f"suggestion.{prop}", f'suggestion["{prop}"]')
replace("src/routes/draft.$draftId.validacao.tsx", 'suggestion.label', 'suggestion["label"]')
for prop in ("authorization", "route", "nested"):
    replace("src/lib/lovable-error-reporting.test.ts", f"payload.{prop}", f'payload["{prop}"]')

# Remove authorization casts that were made obsolete by the canonical AdminDb type.
replace(
    "src/lib/experimental-markets-run.functions.ts",
    'await assertRunOwner(supabase as unknown as { from: (table: string) => any }, context.userId, data.runId);',
    'await assertRunOwner(supabase, context.userId, data.runId);',
    2,
)

# Experimental analysis uses the canonical client and an explicit match-row type.
replace(
    "src/lib/experimental-analysis.functions.ts",
    '''type ReferenceAlternative = {''',
    '''type ExperimentalMatchRow = {\n  id: string;\n  raw_partida: string;\n  home_team: string | null;\n  away_team: string | null;\n  competition: string | null;\n};\n\ntype ReferenceAlternative = {''',
    1,
)
replace("src/lib/experimental-analysis.functions.ts", 'const supabase = supabaseAdmin as any;', 'const supabase = supabaseAdmin;', 1)
replace(
    "src/lib/experimental-analysis.functions.ts",
    'const matchById = new Map((matches ?? []).map((match: any) => [match.id, match]));',
    'const matchById = new Map(((matches ?? []) as ExperimentalMatchRow[]).map((match) => [match.id, match]));',
    1,
)

# Restore helpers accidentally left behind when RESOLVE/COLLECT were extracted.
replace(
    "src/lib/pipeline.server.ts",
    'import { resolvePipelineMatches } from "./pipeline/resolve.server";',
    'import { resolvePipelineMatches } from "./pipeline/resolve.server";\nimport { activeFootballProvider } from "./pipeline/provider.server";',
    1,
)
replace(
    "src/lib/pipeline.server.ts",
    '''async function log(\n  db: Db,\n  runId: string,\n  step: string,\n  message: string,\n  level: "INFO" | "WARN" | "ERROR" = "INFO",\n  payload: Record<string, unknown> = {},\n) {\n  await db.from("pipeline_logs").insert({ run_id: runId, step, level, message, payload: payload as never });\n}\n''',
    '''async function log(\n  db: Db,\n  runId: string,\n  step: string,\n  message: string,\n  level: "INFO" | "WARN" | "ERROR" = "INFO",\n  payload: Record<string, unknown> = {},\n) {\n  await db.from("pipeline_logs").insert({ run_id: runId, step, level, message, payload: payload as never });\n}\n\nasync function runPredictionAt(db: Db, runId: string): Promise<string> {\n  const { data: run } = await db.from("analysis_runs").select("notes, created_at").eq("id", runId).single();\n  const stored = (run?.notes as { prediction_at?: unknown } | null)?.prediction_at;\n  if (typeof stored === "string" && Number.isFinite(Date.parse(stored))) return stored;\n  const fallback = run?.created_at ?? new Date().toISOString();\n  const notes = { ...((run?.notes as Record<string, unknown> | null) ?? {}), prediction_at: fallback };\n  await db.from("analysis_runs").update({ notes: notes as never }).eq("id", runId);\n  return fallback;\n}\n''',
    1,
)
replace("src/lib/pipeline.server.ts", 'activeProvider()', 'activeFootballProvider()', 2)

print("Applied architecture/typecheck fixes.")
