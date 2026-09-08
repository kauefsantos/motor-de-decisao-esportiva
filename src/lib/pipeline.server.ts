// Pipeline único: CSV -> resolução -> coleta -> limpeza -> features -> modelo -> mercados.
// Provedores suportados: 5DollarFootballAPI (padrão) e API-Football/API-Sports.

import { buildContracts } from "./engine/markets";
import { evaluateContract, type MatchContext, type ModelRegistryEntry } from "./engine/opportunity";
import { isCrossLeagueCompetitionName } from "./competition-kind";

export type { PipelineStepKey } from "./pipeline.steps";
import type { PipelineStepKey } from "./pipeline.steps";

type ProviderId = "five_dollar" | "api_sports";
type Db = Awaited<ReturnType<typeof getDb>>;

function activeProvider(): ProviderId {
  const explicit = process.env["FOOTBALL_API_PROVIDER"]?.trim();
  if (explicit === "api_sports") return "api_sports";
  if (explicit === "five_dollar") return "five_dollar";
  if (process.env["FIVE_DOLLAR_FOOTBALL_API_KEY"]?.trim()) return "five_dollar";
  if (process.env["API_FOOTBALL_KEY"]?.trim()) return "api_sports";
  return "five_dollar";
}

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
  await db.from("pipeline_logs").insert({ run_id: runId, step, level, message, payload: payload as never });
}

const SEPARATOR = /\s+(?:x|vs?|-)+\s+/i;

function parseTeams(partida: string): { home: string | null; away: string | null } {
  const parts = partida.split(SEPARATOR);
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0]!.trim(), away: parts[1]!.trim() };
}

function parseKickoff(targetDate: string | null, horario: string): string | null {
  const m = horario.match(/(\d{1,2})[:h](\d{2})/);
  if (!m || !targetDate) return null;
  const hh = m[1]!.padStart(2, "0");
  return `${targetDate}T${hh}:${m[2]}:00-03:00`;
}

export async function executeStep(runId: string, step: PipelineStepKey) {
  const db = await getDb();
  await db
    .from("analysis_runs")
    .update({ current_step: step, status: "RUNNING", updated_at: new Date().toISOString() })
    .eq("id", runId);

  switch (step) {
    case "RESOLVE": return resolveMatches(db, runId);
    case "COLLECT": return collect(db, runId);
    case "CLEAN": return clean(db, runId);
    case "FEATURES": return features(db, runId);
    case "PROBABILITY": return probability(db, runId);
    case "GATES": return gates(db, runId);
    case "MARKETS": return markets(db, runId);
  }
}

async function runPredictionAt(db: Db, runId: string): Promise<string> {
  const { data: run } = await db.from("analysis_runs").select("notes, created_at").eq("id", runId).single();
  const stored = (run?.notes as { prediction_at?: unknown } | null)?.prediction_at;
  if (typeof stored === "string" && Number.isFinite(Date.parse(stored))) return stored;
  const fallback = run?.created_at ?? new Date().toISOString();
  const notes = { ...((run?.notes as Record<string, unknown> | null) ?? {}), prediction_at: fallback };
  await db.from("analysis_runs").update({ notes: notes as never }).eq("id", runId);
  return fallback;
}

async function replaceExternalIds(
  db: Db,
  matchId: string,
  fixtureSource: string,
  homeSource: string,
  awaySource: string,
  eventId: number,
  homeTeamId: number | null,
  awayTeamId: number | null,
  confidence: number,
  leagueSource?: string,
  leagueId?: number | null,
) {
  const sources = [fixtureSource, homeSource, awaySource, ...(leagueSource ? [leagueSource] : [])];
  await db.from("match_external_ids").delete().eq("match_id", matchId).in("source", sources);
  await db.from("match_external_ids").insert([
    { match_id: matchId, source: fixtureSource, external_id: String(eventId), confidence },
    ...(homeTeamId ? [{ match_id: matchId, source: homeSource, external_id: String(homeTeamId), confidence }] : []),
    ...(awayTeamId ? [{ match_id: matchId, source: awaySource, external_id: String(awayTeamId), confidence }] : []),
    ...(leagueSource && leagueId ? [{ match_id: matchId, source: leagueSource, external_id: String(leagueId), confidence }] : []),
  ]);
}

async function resolveMatches(db: Db, runId: string) {
  const provider = activeProvider();
  const { data: run } = await db.from("analysis_runs").select("target_date").eq("id", runId).single();
  const targetDate = run?.target_date;
  const predictionAt = await runPredictionAt(db, runId);
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, raw_horario, raw_campeonato")
    .eq("run_id", runId);

  let resolved = 0;
  let failed = 0;
  let external = 0;
  let ambiguous = 0;
  let notFound = 0;
  let sourceUnavailable = 0;

  if (!targetDate) {
    await log(db, runId, "RESOLVE", "Run sem target_date. O CSV deve conter a coluna Data.", "ERROR");
    return { resolved: 0, failed: matches?.length ?? 0, external: 0, ambiguous: 0, notFound: 0, sourceUnavailable: 1, provider };
  }

  for (const m of matches ?? []) {
    const { home, away } = parseTeams(m.raw_partida);
    const kickoff = parseKickoff(targetDate, m.raw_horario);
    const localOk = Boolean(home && away && kickoff);
    if (localOk) resolved += 1;
    else failed += 1;

    let status = localOk ? "RESOLVED_LOCAL" : "UNRESOLVED";
    let reason = localOk ? "Normalização local do CSV." : "Não foi possível separar mandante/visitante, data ou horário.";
    let confidence = localOk ? 0.6 : 0;

    if (localOk && provider === "five_dollar") {
      const { fiveDollarResolveMatch, fiveDollarConfigured, FIVE_DOLLAR_SOURCE, FIVE_DOLLAR_DEFINITION_VERSION } = await import("./adapters/five_dollar.server");
      if (!fiveDollarConfigured()) {
        sourceUnavailable += 1;
        await db.from("source_fetches").insert({
          run_id: runId, match_id: m.id, source: FIVE_DOLLAR_SOURCE, status: "NOT_CONFIGURED", http_status: null,
          error_message: "FIVE_DOLLAR_FOOTBALL_API_KEY ausente no servidor.", fetched_at: new Date().toISOString(),
        });
      } else {
        const fd = await fiveDollarResolveMatch({ homeTeam: home, awayTeam: away, competition: m.raw_campeonato, kickoff }, targetDate);
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: m.id,
          source: FIVE_DOLLAR_SOURCE,
          status: fd.fetch.status === "OK" ? "OK" : fd.fetch.status === "RATE_LIMITED" ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE",
          http_status: fd.fetch.httpStatus,
          error_message: fd.fetch.errorMessage,
          fetched_at: fd.fetch.fetchedAt,
        });

        if (fd.resolution?.status === "MATCH_RESOLVED") {
          external += 1;
          status = "RESOLVED_FIVE_DOLLAR";
          reason = fd.resolution.reason;
          confidence = fd.resolution.confidence;
          const event = fd.events.find((e) => e.eventId === fd.resolution!.eventId);
          await replaceExternalIds(db, m.id, "five_dollar_fixture", "five_dollar_team_home", "five_dollar_team_away", fd.resolution.eventId!, event?.homeTeamId ?? null, event?.awayTeamId ?? null, fd.resolution.confidence, "five_dollar_league", event?.leagueId ?? null);
        } else if (fd.resolution?.status === "MATCH_AMBIGUOUS") {
          ambiguous += 1;
          reason = `${reason} 5Dollar: ${fd.resolution.reason}`;
        } else if (fd.resolution?.status === "MATCH_NOT_FOUND") {
          notFound += 1;
          reason = `${reason} 5Dollar: ${fd.resolution.reason}`;
        } else {
          sourceUnavailable += 1;
          reason = `${reason} 5Dollar indisponível: ${fd.fetch.errorMessage ?? "sem detalhe"}.`;
        }

        await log(db, runId, "RESOLVE", `Resolução 5Dollar para ${m.raw_partida}: ${fd.resolution?.status ?? fd.fetch.status}`, fd.resolution?.status === "MATCH_RESOLVED" ? "INFO" : "WARN", {
          provider,
          definitionVersion: FIVE_DOLLAR_DEFINITION_VERSION,
          endpoint: fd.fetch.path,
          pages: fd.fetches?.length ?? 1,
          httpStatus: fd.fetch.httpStatus,
          fetchedAt: fd.fetch.fetchedAt,
          rateLimit: fd.fetch.rateLimit,
          predictionAt,
          targetDate,
          candidates: fd.resolution?.candidates ?? [],
        });
      }
    }

    if (localOk && provider === "api_sports") {
      const { apiFootballResolveMatch, apiFootballConfigured, API_FOOTBALL_SOURCE, API_FOOTBALL_DEFINITION_VERSION } = await import("./adapters/api_football.server");
      if (!apiFootballConfigured()) {
        sourceUnavailable += 1;
        await db.from("source_fetches").insert({
          run_id: runId, match_id: m.id, source: API_FOOTBALL_SOURCE, status: "NOT_CONFIGURED", http_status: null,
          error_message: "API_FOOTBALL_KEY ausente no servidor.", fetched_at: new Date().toISOString(),
        });
      } else {
        const af = await apiFootballResolveMatch({ homeTeam: home, awayTeam: away, competition: m.raw_campeonato, kickoff }, targetDate);
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: m.id,
          source: API_FOOTBALL_SOURCE,
          status: af.fetch.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
          http_status: af.fetch.httpStatus,
          error_message: af.fetch.errorMessage,
          fetched_at: af.fetch.fetchedAt,
        });

        if (af.resolution?.status === "MATCH_RESOLVED") {
          external += 1;
          status = "RESOLVED_API_FOOTBALL";
          reason = af.resolution.reason;
          confidence = af.resolution.confidence;
          const event = af.events.find((e) => e.eventId === af.resolution!.eventId);
          await replaceExternalIds(db, m.id, "api_football_fixture", "api_football_team_home", "api_football_team_away", af.resolution.eventId!, event?.homeTeamId ?? null, event?.awayTeamId ?? null, af.resolution.confidence);
        } else if (af.resolution?.status === "MATCH_AMBIGUOUS") {
          ambiguous += 1;
          reason = `${reason} API-Football: ${af.resolution.reason}`;
        } else if (af.resolution?.status === "MATCH_NOT_FOUND") {
          notFound += 1;
          reason = `${reason} API-Football: ${af.resolution.reason}`;
        } else {
          sourceUnavailable += 1;
          reason = `${reason} API-Football indisponível: ${af.fetch.errorMessage ?? "sem detalhe"}.`;
        }

        await log(db, runId, "RESOLVE", `Resolução API-Football para ${m.raw_partida}: ${af.resolution?.status ?? af.fetch.status}`, af.resolution?.status === "MATCH_RESOLVED" ? "INFO" : "WARN", {
          provider,
          definitionVersion: API_FOOTBALL_DEFINITION_VERSION,
          endpoint: af.fetch.path,
          httpStatus: af.fetch.httpStatus,
          fetchedAt: af.fetch.fetchedAt,
          predictionAt,
          targetDate,
          candidates: af.resolution?.candidates ?? [],
        });
      }
    }

    await db.from("matches").update({
      home_team: home,
      away_team: away,
      competition: m.raw_campeonato,
      kickoff_local: kickoff,
      resolution_status: status,
      resolution_reason: reason,
      resolver_confidence: confidence,
    }).eq("id", m.id);
  }

  await db.from("analysis_runs").update({ matches_resolved: resolved, matches_failed: failed }).eq("id", runId);
  await log(db, runId, "RESOLVE", `${resolved} partidas normalizadas; ${external} resolvidas externamente via ${provider}; ${ambiguous} ambíguas; ${notFound} não encontradas; ${sourceUnavailable} indisponíveis.`, external ? "INFO" : "WARN", { provider, targetDate });
  return { resolved, failed, external, ambiguous, notFound, sourceUnavailable, provider };
}

async function collect(db: Db, runId: string) {
  const provider = activeProvider();
  const { data: matches } = await db
    .from("matches")
    .select("id, home_team, away_team, competition, kickoff_local, resolution_status")
    .eq("run_id", runId);
  const predictionAt = await runPredictionAt(db, runId);
  const matchIds = (matches ?? []).map((m) => m.id);
  const { data: externalIds } = matchIds.length
    ? await db.from("match_external_ids").select("match_id, source, external_id").in("match_id", matchIds)
    : { data: [] };
  const perSource: Record<string, number> = {};

  if (provider === "five_dollar") {
    const { fiveDollarTeamHistory, fiveDollarLeagueHistory, fiveDollarConfigured, fiveDollarUsage, FIVE_DOLLAR_SOURCE, FIVE_DOLLAR_DEFINITION_VERSION } = await import("./adapters/five_dollar.server");
    let observationsCount = 0;
    let insufficient = 0;
    let reusedFromCache = 0;
    let rateLimited = false;

    if (fiveDollarConfigured()) {
      const { data: cachedRows } = await db
        .from("raw_observations")
        .select("metric, raw_value, observed_at, fetched_at")
        .eq("source", FIVE_DOLLAR_SOURCE)
        .eq("definition_version", FIVE_DOLLAR_DEFINITION_VERSION)
        .limit(5000);
      const cacheIndex = new Map<string, typeof cachedRows>();
      for (const row of cachedRows ?? []) {
        const key = (row.raw_value as { cacheKey?: string } | null)?.cacheKey;
        if (!key) continue;
        const list = cacheIndex.get(key) ?? [];
        list.push(row);
        cacheIndex.set(key, list);
      }

      const leagueHistoryCache = new Map<string, Awaited<ReturnType<typeof fiveDollarLeagueHistory>>>();
      const leagueTeamIds = new Map<string, Set<number>>();
      for (const m of matches ?? []) {
        const leagueExternal = (externalIds ?? []).find((e) => e.match_id === m.id && e.source === "five_dollar_league");
        if (!leagueExternal?.external_id) continue;
        const key = String(leagueExternal.external_id);
        const set = leagueTeamIds.get(key) ?? new Set<number>();
        for (const e of (externalIds ?? []).filter((x) => x.match_id === m.id && (x.source === "five_dollar_team_home" || x.source === "five_dollar_team_away"))) {
          const id = Number(e.external_id);
          if (Number.isFinite(id)) set.add(id);
        }
        leagueTeamIds.set(key, set);
      }

      for (const m of matches ?? []) {
        if (rateLimited) break;
        const teams = (externalIds ?? []).filter((e) => e.match_id === m.id && (e.source === "five_dollar_team_home" || e.source === "five_dollar_team_away"));
        const leagueExternal = (externalIds ?? []).find((e) => e.match_id === m.id && e.source === "five_dollar_league");
        const crossLeague = isCrossLeagueCompetitionName(m.competition);
        if (teams.length === 0) {
          perSource[`${FIVE_DOLLAR_SOURCE}:NO_FIXTURE`] = (perSource[`${FIVE_DOLLAR_SOURCE}:NO_FIXTURE`] ?? 0) + 1;
          continue;
        }

        for (const team of teams) {
          if (rateLimited) break;
          const scope = team.source === "five_dollar_team_home" ? "HOME" : "AWAY";
          const cacheKey = `five_dollar:${team.external_id}:${predictionAt}`;
          const cached = cacheIndex.get(cacheKey);
          if (cached?.length) {
            reusedFromCache += cached.length;
            observationsCount += cached.length;
            await db.from("raw_observations").insert(cached.map((row) => ({
              run_id: runId, match_id: m.id, source: FIVE_DOLLAR_SOURCE, metric: row.metric,
              raw_value: row.raw_value as never, observed_at: row.observed_at, fetched_at: row.fetched_at,
              definition_version: FIVE_DOLLAR_DEFINITION_VERSION,
            })));
            continue;
          }

          let history;
          if (leagueExternal?.external_id && !crossLeague) {
            const key = `${leagueExternal.external_id}:${predictionAt}`;
            history = leagueHistoryCache.get(key);
            if (!history) {
              history = await fiveDollarLeagueHistory(
                Number(leagueExternal.external_id),
                [...(leagueTeamIds.get(String(leagueExternal.external_id)) ?? new Set<number>())],
                predictionAt,
                365,
              );
              leagueHistoryCache.set(key, history);
            }
          } else {
            history = await fiveDollarTeamHistory(Number(team.external_id), predictionAt, crossLeague ? 40 : 20);
          }
          for (const f of history.fetches) {
            perSource[`${FIVE_DOLLAR_SOURCE}:${f.status}`] = (perSource[`${FIVE_DOLLAR_SOURCE}:${f.status}`] ?? 0) + 1;
            if (f.status === "RATE_LIMITED") rateLimited = true;
            await db.from("source_fetches").insert({
              run_id: runId, match_id: m.id, source: FIVE_DOLLAR_SOURCE,
              status: f.status === "OK" ? "OK" : f.status === "RATE_LIMITED" ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE",
              http_status: f.httpStatus, error_message: f.errorMessage, fetched_at: f.fetchedAt,
            });
          }
          if (history.insufficientHistory) insufficient += 1;

          const teamObservations = history.observations.filter((o) => o.teamId === Number(team.external_id));
          if (teamObservations.length > 0) {
            observationsCount += teamObservations.length;
            await db.from("raw_observations").insert(teamObservations.map((o) => ({
              run_id: runId,
              match_id: m.id,
              source: FIVE_DOLLAR_SOURCE,
              metric: `${scope}:${o.observation.canonical}`,
              raw_value: {
                value: o.observation.value,
                sourceLabel: o.observation.sourceLabel,
                metricLabelRaw: o.observation.sourceLabel,
                teamScope: scope,
                statScope: o.observation.scope,
                contractCompatible: o.observation.contractCompatible,
                note: o.observation.note,
                endpoint: o.endpoint,
                fixtureId: o.fixtureId,
                externalMatchId: o.externalMatchId,
                fixtureDate: o.fixtureDate,
                teamExternalId: team.external_id,
                teamId: o.teamId,
                opponentId: o.opponentId,
                teamSideInFixture: o.teamSide,
                rawHomeAway: o.rawHomeAway,
                kickoff: o.observedAt,
                predictionAt,
                cacheKey,
              } as never,
              observed_at: o.observedAt,
              fetched_at: o.fetchedAt,
              definition_version: FIVE_DOLLAR_DEFINITION_VERSION,
            })));
          }
        }
      }

      const usage = fiveDollarUsage();
      await db.from("source_definitions").upsert({
        source: FIVE_DOLLAR_SOURCE,
        definition_version: FIVE_DOLLAR_DEFINITION_VERSION,
        configured: observationsCount > 0,
        notes: "5DollarFootballAPI nativa v1 — provedor principal experimental.",
        metric_definitions: {
          provider: "five_dollar",
          metrics: {
            goals_for: "placar final relativo ao time",
            goals_against: "placar final do adversário",
            corners_taken_for: "corners.home/away relativo ao time",
            corners_taken_against: "corners.home/away do adversário",
            cards_yellow_raw: "bruto; não libera mercado de cartões",
            cards_red_raw: "bruto; não libera mercado de cartões",
          },
        } as never,
      } as never, { onConflict: "source,definition_version" } as never);

      await log(db, runId, "COLLECT", `${observationsCount} observações 5Dollar; ${reusedFromCache} de cache; ${insufficient} times com histórico insuficiente${rateLimited ? "; coleta parcial por rate limit" : ""}.`, observationsCount ? "INFO" : "WARN", {
        provider, predictionAt, requestsMade: usage.requestsMade, rateLimit: usage.rateLimit, rateLimitHits: usage.rateLimitHits,
        bulkLeagues: leagueHistoryCache.size,
        uniqueHistoricalFixtures: [...leagueHistoryCache.values()].reduce((sum, h) => sum + h.fixtures.length, 0),
      });
    }
  }

  if (provider === "api_sports") {
    const { apiFootballTeamHistory, apiFootballConfigured, API_FOOTBALL_SOURCE, API_FOOTBALL_DEFINITION_VERSION } = await import("./adapters/api_football.server");
    let observationsCount = 0;
    if (apiFootballConfigured()) {
      for (const m of matches ?? []) {
        const teams = (externalIds ?? []).filter((e) => e.match_id === m.id && (e.source === "api_football_team_home" || e.source === "api_football_team_away"));
        if (teams.length === 0) {
          perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] = (perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] ?? 0) + 1;
          continue;
        }
        for (const team of teams) {
          const targetScope = team.source === "api_football_team_home" ? "HOME" : "AWAY";
          const history = await apiFootballTeamHistory(Number(team.external_id), predictionAt);
          for (const f of history.fetches) {
            perSource[`${API_FOOTBALL_SOURCE}:${f.status}`] = (perSource[`${API_FOOTBALL_SOURCE}:${f.status}`] ?? 0) + 1;
            await db.from("source_fetches").insert({
              run_id: runId, match_id: m.id, source: API_FOOTBALL_SOURCE,
              status: f.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
              http_status: f.httpStatus, error_message: f.errorMessage, fetched_at: f.fetchedAt,
            });
          }
          if (history.observations.length > 0) {
            observationsCount += history.observations.length;
            await db.from("raw_observations").insert(history.observations.map((o) => ({
              run_id: runId,
              match_id: m.id,
              source: API_FOOTBALL_SOURCE,
              metric: `${targetScope}:${o.observation.canonical}`,
              raw_value: {
                value: o.observation.value,
                sourceLabel: o.observation.sourceLabel,
                teamScope: targetScope,
                statScope: o.observation.scope,
                contractCompatible: o.observation.contractCompatible,
                note: o.observation.note,
                endpoint: o.endpoint,
                fixtureId: o.fixtureId,
                teamExternalId: team.external_id,
                predictionAt,
              } as never,
              observed_at: o.observedAt,
              fetched_at: o.fetchedAt,
              definition_version: API_FOOTBALL_DEFINITION_VERSION,
            })));
          }
        }
      }
      await log(db, runId, "COLLECT", `${observationsCount} observações coletadas na API-Football.`, observationsCount ? "INFO" : "WARN", { provider, predictionAt });
    }
  }

  await log(db, runId, "COLLECT", "Coleta concluída usando um único provedor ativo.", "INFO", { provider, ...perSource });
  return { provider, ...perSource };
}

function sourceAgreement(perSource: Array<{ source: string; value: number }>): "SINGLE_SOURCE" | "CROSS_SOURCE_CONFIRMED" | "SOURCE_CONFLICT" {
  if (perSource.length < 2) return "SINGLE_SOURCE";
  const values = perSource.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return Math.abs(max - min) <= 0.1 ? "CROSS_SOURCE_CONFIRMED" : "SOURCE_CONFLICT";
}

async function clean(db: Db, runId: string) {
  const { data: raws } = await db
    .from("raw_observations")
    .select("id, match_id, source, metric, raw_value, fetched_at, definition_version")
    .eq("run_id", runId);
  await db.from("normalized_match_stats").delete().eq("run_id", runId);

  type RawValue = {
    value?: number;
    sourceLabel?: string;
    statScope?: "HOME" | "AWAY";
    contractCompatible?: boolean;
    note?: string;
    metricLabelRaw?: string;
    externalMatchId?: string;
    fixtureDate?: string;
    predictionAt?: string;
  };

  const buckets = new Map<string, {
    matchId: string | null;
    scope: string;
    metric: string;
    values: number[];
    perSource: Map<string, number[]>;
    definitionVersion: string | null;
    lineage: Array<Record<string, unknown>>;
  }>();
  let rejectedByDefinition = 0;
  const rejectedDetail: Record<string, number> = {};

  for (const r of raws ?? []) {
    const v = (r.raw_value ?? {}) as RawValue;
    if (typeof v.value !== "number" || !Number.isFinite(v.value)) continue;
    const [teamScope, canonical] = r.metric.split(":");
    if (!teamScope || !canonical) continue;
    if (v.contractCompatible !== true) {
      rejectedByDefinition += 1;
      const key = `${r.source}:${canonical}`;
      rejectedDetail[key] = (rejectedDetail[key] ?? 0) + 1;
      continue;
    }
    const key = `${r.match_id}|${teamScope}|${canonical}`;
    const bucket = buckets.get(key) ?? {
      matchId: r.match_id,
      scope: teamScope,
      metric: canonical,
      values: [],
      perSource: new Map<string, number[]>(),
      definitionVersion: r.definition_version,
      lineage: [],
    };
    bucket.values.push(v.value);
    const bySource = bucket.perSource.get(r.source) ?? [];
    bySource.push(v.value);
    bucket.perSource.set(r.source, bySource);
    bucket.lineage.push({
      rawObservationId: r.id,
      source: r.source,
      fetchedAt: r.fetched_at,
      rawValue: v.value,
      normalizedValue: v.value,
      canonicalMetric: canonical,
      metricLabelRaw: v.metricLabelRaw ?? v.sourceLabel ?? null,
      sourceLabel: v.sourceLabel ?? null,
      statScope: v.statScope ?? null,
      externalMatchId: v.externalMatchId ?? null,
      observedDate: v.fixtureDate ?? null,
      predictionAt: v.predictionAt ?? null,
      definitionVersion: r.definition_version,
      note: v.note ?? null,
    });
    buckets.set(key, bucket);
  }

  let conflicts = 0;
  let confirmed = 0;
  const rows = [...buckets.values()].map((b) => {
    const perSource = [...b.perSource.entries()].map(([source, values]) => ({
      source,
      value: values.reduce((a, c) => a + c, 0) / values.length,
      sampleSize: values.length,
    }));
    const status = sourceAgreement(perSource);
    if (status === "SOURCE_CONFLICT") conflicts += 1;
    if (status === "CROSS_SOURCE_CONFIRMED") confirmed += 1;
    return {
      run_id: runId,
      match_id: b.matchId,
      scope: b.scope,
      metric: b.metric,
      normalized_value: b.values.reduce((a, c) => a + c, 0) / b.values.length,
      sample_size: b.values.length,
      source: perSource.map((p) => p.source).join("+"),
      definition_version: b.definitionVersion,
      lineage: { observations: b.lineage, crossCheck: { status, perSource } } as never,
    };
  });

  for (let i = 0; i < rows.length; i += 200) {
    await db.from("normalized_match_stats").insert(rows.slice(i, i + 200));
  }

  await log(db, runId, "CLEAN", rows.length
    ? `${rows.length} métricas normalizadas; ${rejectedByDefinition} observações bloqueadas por definição.`
    : `Nenhuma métrica normalizada (${rejectedByDefinition} observações bloqueadas por definição).`,
  rows.length ? "INFO" : "WARN", { rejectedByDefinition, rejectedDetail, crossSourceConfirmed: confirmed, sourceConflicts: conflicts });

  return { normalized: rows.length, rejectedByDefinition, rejectedDetail, crossSourceConfirmed: confirmed, sourceConflicts: conflicts, rawObservations: raws?.length ?? 0 };
}

async function features(db: Db, runId: string) {
  const { count } = await db.from("normalized_match_stats").select("id", { count: "exact", head: true }).eq("run_id", runId);
  await log(db, runId, "FEATURES", count ? `${count} features normalizadas disponíveis.` : "Sem estatísticas normalizadas: nenhuma feature pôde ser construída.", count ? "INFO" : "WARN");
  return { features: count ?? 0 };
}

async function probability(db: Db, runId: string) {
  const { data: versions } = await db.from("model_versions").select("market_family, validation_status, calibration_version");
  const validated = (versions ?? []).filter((v) => v.validation_status === "PRODUCTION_VALIDATED" && v.calibration_version);
  await log(db, runId, "PROBABILITY", validated.length ? `${validated.length} famílias com modelo calibrado e validado.` : "Produção continua bloqueada: nenhum modelo calibrado/validado out-of-sample.", validated.length ? "INFO" : "WARN");
  return { validatedFamilies: validated.length };
}

async function gates(db: Db, runId: string) {
  await log(db, runId, "GATES", "Gate-base: binários >= 0,65; asiáticos p_profit >= 0,65.");
  return { gate: 0.65 };
}

async function markets(db: Db, runId: string) {
  const predictionAt = await runPredictionAt(db, runId);
  const { data: matches } = await db
    .from("matches")
    .select("id, raw_partida, home_team, away_team, competition, kickoff_local")
    .eq("run_id", runId)
    .order("kickoff_local", { ascending: true });
  const { data: versions } = await db.from("model_versions").select("market_family, model_version, calibration_version, validation_status");
  const registry = new Map<string, ModelRegistryEntry>((versions ?? []).map((v) => [v.market_family, {
    family: v.market_family,
    modelVersion: v.model_version,
    calibrationVersion: v.calibration_version,
    validationStatus: v.validation_status,
  }]));
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
      predictionAt,
      features: new Map((normalized ?? []).filter((n) => n.match_id === m.id).map((n) => [n.metric, {
        metric: n.metric,
        value: Number(n.normalized_value ?? 0),
        sampleSize: n.sample_size ?? 0,
        source: n.source ?? "",
        definitionVersion: n.definition_version ?? "",
        definitionCompatible: true,
      }])),
      countDistributions: new Map(),
      binaryProbabilities: new Map(),
      sources: [],
    };

    const contracts = buildContracts({ home: m.home_team ?? "Mandante", away: m.away_team ?? "Visitante" });
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

  await db.from("analysis_runs").update({
    candidates_published: published,
    candidates_blocked: blocked,
    status: "READY_FOR_ODDS",
    current_step: "MARKETS",
    updated_at: new Date().toISOString(),
  }).eq("id", runId);
  await log(db, runId, "MARKETS", `${published} contratos publicados, ${blocked} bloqueados.`, published ? "INFO" : "WARN", { provider: activeProvider() });
  return { published, blocked, provider: activeProvider() };
}
