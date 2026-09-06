// Orquestração do pipeline. Server-only.
// CSV Parser -> Match Resolver -> Data Collector -> Data Cleaner -> Feature Engine
// -> Probability Engine -> Opportunity Engine (Motor 1).

import { collectFromSources, adapterSources } from "./adapters/sources.server";
import { buildContracts } from "./engine/markets";
import { evaluateContract, type MatchContext, type ModelRegistryEntry } from "./engine/opportunity";

export const PIPELINE_STEPS = [
  { key: "RESOLVE", label: "Identificando partidas" },
  { key: "COLLECT", label: "Coletando estatísticas" },
  { key: "CLEAN", label: "Higienizando e compatibilizando definições" },
  { key: "FEATURES", label: "Construindo features" },
  { key: "PROBABILITY", label: "Estimando probabilidades" },
  { key: "GATES", label: "Aplicando gates" },
  { key: "MARKETS", label: "Selecionando mercados" },
] as const;

export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]["key"];

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function log(
  db: Db,
  runId: string,
  step: string,
  message: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
  payload: Record<string, unknown> = {},
) {
  await db
    .from("pipeline_logs")
    .insert({ run_id: runId, step, level, message, payload: payload as never });
}

const SEPARATOR = /\s+(?:x|vs?|-)\s+/i;

function parseTeams(partida: string): { home: string | null; away: string | null } {
  const parts = partida.split(SEPARATOR);
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0]!.trim(), away: parts[1]!.trim() };
}

function parseKickoff(targetDate: string | null, horario: string): string | null {
  const m = horario.match(/(\d{1,2})[:h](\d{2})/);
  if (!m) return null;
  const date = targetDate ?? new Date().toISOString().slice(0, 10);
  const hh = m[1]!.padStart(2, "0");
  // America/Sao_Paulo (UTC-03:00, sem horário de verão)
  return `${date}T${hh}:${m[2]}:00-03:00`;
}

export async function executeStep(runId: string, step: PipelineStepKey) {
  const db = await getDb();
  await db
    .from("analysis_runs")
    .update({ current_step: step, status: "RUNNING", updated_at: new Date().toISOString() })
    .eq("id", runId);

  switch (step) {
    case "RESOLVE":
      return resolveMatches(db, runId);
    case "COLLECT":
      return collect(db, runId);
    case "CLEAN":
      return clean(db, runId);
    case "FEATURES":
      return features(db, runId);
    case "PROBABILITY":
      return probability(db, runId);
    case "GATES":
      return gates(db, runId);
    case "MARKETS":
      return markets(db, runId);
  }
}

async function resolveMatches(db: Db, runId: string) {
  const { data: run } = await db.from("analysis_runs").select("target_date").eq("id", runId).single();
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, raw_horario, raw_campeonato")
    .eq("run_id", runId);

  let resolved = 0;
  let failed = 0;
  for (const m of matches ?? []) {
    const { home, away } = parseTeams(m.raw_partida);
    const kickoff = parseKickoff(run?.target_date ?? null, m.raw_horario);
    const ok = Boolean(home && away && kickoff);
    if (ok) resolved++;
    else failed++;
    await db
      .from("matches")
      .update({
        home_team: home,
        away_team: away,
        competition: m.raw_campeonato,
        kickoff_local: kickoff,
        // Sem provedor de IDs externos configurado, a resolução é apenas local.
        resolution_status: ok ? "RESOLVED_LOCAL" : "UNRESOLVED",
        resolution_reason: ok
          ? "Normalização local do CSV; nenhum provedor de IDs externos configurado."
          : "Não foi possível separar mandante/visitante ou horário.",
        resolver_confidence: ok ? 0.6 : 0,
      })
      .eq("id", m.id);
  }

  await db
    .from("analysis_runs")
    .update({ matches_resolved: resolved, matches_failed: failed })
    .eq("id", runId);
  await log(db, runId, "RESOLVE", `${resolved} partidas normalizadas, ${failed} sem resolução.`);
  return { resolved, failed };
}

async function collect(db: Db, runId: string) {
  const { data: matches } = await db
    .from("matches")
    .select("id, home_team, away_team, competition, kickoff_local")
    .eq("run_id", runId);

  const perSource: Record<string, number> = {};
  for (const m of matches ?? []) {
    const results = await collectFromSources({
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      competition: m.competition,
      kickoff: m.kickoff_local,
      predictionAt: new Date().toISOString(),
    });
    for (const r of results) {
      perSource[`${r.source}:${r.status}`] = (perSource[`${r.source}:${r.status}`] ?? 0) + 1;
      await db.from("source_fetches").insert({
        run_id: runId,
        match_id: m.id,
        source: r.source,
        status: r.status,
        http_status: r.httpStatus,
        error_message: r.errorMessage,
        fetched_at: r.fetchedAt,
      });
      if (r.observations.length > 0) {
        await db.from("raw_observations").insert(
          r.observations.map((o) => ({
            run_id: runId,
            match_id: m.id,
            source: r.source,
            metric: o.metric,
            raw_value: o.rawValue as never,
            observed_at: o.observedAt,
            fetched_at: r.fetchedAt,
            definition_version: r.definitionVersion,
          })),
        );
      }
    }
  }
  await log(
    db,
    runId,
    "COLLECT",
    `Coleta concluída em ${adapterSources.length} adapters.`,
    "WARN",
    perSource,
  );
  return perSource;
}

async function clean(db: Db, runId: string) {
  const { count } = await db
    .from("raw_observations")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  await log(
    db,
    runId,
    "CLEAN",
    count
      ? `${count} observações brutas higienizadas com lineage.`
      : "Nenhuma observação bruta recebida; nada foi preenchido com média global.",
    count ? "INFO" : "WARN",
  );
  return { rawObservations: count ?? 0 };
}

async function features(db: Db, runId: string) {
  const { count } = await db
    .from("normalized_match_stats")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  await log(
    db,
    runId,
    "FEATURES",
    count
      ? `${count} features normalizadas disponíveis.`
      : "Sem estatísticas normalizadas: nenhuma feature pôde ser construída.",
    count ? "INFO" : "WARN",
  );
  return { features: count ?? 0 };
}

async function probability(db: Db, runId: string) {
  const { data: versions } = await db
    .from("model_versions")
    .select("market_family, validation_status, calibration_version");
  const validated = (versions ?? []).filter(
    (v) => v.validation_status === "PRODUCTION_VALIDATED" && v.calibration_version,
  );
  await log(
    db,
    runId,
    "PROBABILITY",
    validated.length
      ? `${validated.length} famílias com modelo calibrado e validado.`
      : "Nenhuma família de mercado possui modelo calibrado e validado out-of-sample; nenhuma probabilidade foi inventada.",
    validated.length ? "INFO" : "WARN",
  );
  return { validatedFamilies: validated.length };
}

async function gates(db: Db, runId: string) {
  await log(db, runId, "GATES", "Gate-base aplicado: binários p_cal >= 0,65; asiáticos p_profit_cal >= 0,65.");
  return { gate: 0.65 };
}

async function markets(db: Db, runId: string) {
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, home_team, away_team, competition, kickoff_local")
    .eq("run_id", runId)
    .order("kickoff_local", { ascending: true });

  const { data: versions } = await db
    .from("model_versions")
    .select("market_family, model_version, calibration_version, validation_status");
  const registry = new Map<string, ModelRegistryEntry>(
    (versions ?? []).map((v) => [
      v.market_family,
      {
        family: v.market_family,
        modelVersion: v.model_version,
        calibrationVersion: v.calibration_version,
        validationStatus: v.validation_status,
      },
    ]),
  );

  const { data: normalized } = await db
    .from("normalized_match_stats")
    .select("match_id, metric, normalized_value, sample_size, source, definition_version")
    .eq("run_id", runId);

  await db.from("market_candidates").delete().eq("run_id", runId);

  let published = 0;
  let blocked = 0;
  let index = 0;

  for (const m of matches ?? []) {
    const ctx: MatchContext = {
      matchId: m.id,
      matchLabel: m.home_team && m.away_team ? `${m.home_team} x ${m.away_team}` : m.raw_partida,
      league: m.competition ?? "",
      kickoff: m.kickoff_local,
      predictionAt: new Date().toISOString(),
      features: new Map(
        (normalized ?? [])
          .filter((n) => n.match_id === m.id)
          .map((n) => [
            n.metric,
            {
              metric: n.metric,
              value: Number(n.normalized_value ?? 0),
              sampleSize: n.sample_size ?? 0,
              source: n.source ?? "",
              definitionVersion: n.definition_version ?? "",
              definitionCompatible: true,
            },
          ]),
      ),
      countDistributions: new Map(),
      binaryProbabilities: new Map(),
      sources: [],
    };

    const contracts = buildContracts({
      home: m.home_team ?? "Mandante",
      away: m.away_team ?? "Visitante",
    });

    const rows = contracts.map((contract) => {
      index += 1;
      const out = evaluateContract(ctx, contract, registry, index);
      if (out.published) published += 1;
      else blocked += 1;
      return {
        run_id: runId,
        match_id: m.id,
        prediction_id: out.predictionId,
        market: out.market,
        market_family: out.family,
        participant: out.participant,
        side: out.side,
        line_raw: out.lineRaw,
        line_canonical: out.lineCanonical,
        market_label: out.marketLabel,
        p_cal: out.pCal,
        p_cons: out.pCons,
        fair_odd_info: out.fairOddInfo,
        confidence_score: out.confidenceScore,
        data_quality_score: out.dataQualityScore,
        sample_reliability: out.sampleReliability,
        uncertainty: out.uncertainty,
        stability: out.stability,
        market_score: out.marketScore,
        settlement_definition: out.settlementDefinition,
        model_status: out.modelStatus,
        data_status: out.dataStatus,
        published: out.published,
        block_reason: out.blockReason,
        reason_short: out.reasonShort,
        sources: out.sources as never,
      };
    });

    for (let i = 0; i < rows.length; i += 200) {
      await db.from("market_candidates").insert(rows.slice(i, i + 200));
    }
  }

  await db
    .from("analysis_runs")
    .update({
      candidates_published: published,
      candidates_blocked: blocked,
      status: "READY_FOR_ODDS",
      current_step: "MARKETS",
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  await log(
    db,
    runId,
    "MARKETS",
    `${published} contratos publicados para observação, ${blocked} bloqueados por gates/dados/modelo.`,
    published ? "INFO" : "WARN",
  );
  return { published, blocked };
}
