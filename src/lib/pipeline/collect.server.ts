import type { AdminDb } from "../admin-db";
import { isCrossLeagueCompetitionName } from "../competition-kind";
import { loadFiveDollarCacheRows } from "../raw-observations.server";
import { activeFootballProvider } from "./provider.server";

async function pipelineLog(
  db: AdminDb,
  runId: string,
  step: string,
  message: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
  payload: Record<string, unknown> = {},
) {
  await db.from("pipeline_logs").insert({ run_id: runId, step, level, message, payload: payload as never });
}

async function predictionAt(db: AdminDb, runId: string): Promise<string> {
  const { data: run } = await db.from("analysis_runs").select("notes,created_at").eq("id", runId).single();
  const stored = (run?.notes as { prediction_at?: unknown } | null)?.prediction_at;
  if (typeof stored === "string" && Number.isFinite(Date.parse(stored))) return stored;
  const fallback = run?.created_at ?? new Date().toISOString();
  const notes = { ...((run?.notes as Record<string, unknown> | null) ?? {}), prediction_at: fallback };
  await db.from("analysis_runs").update({ notes: notes as never }).eq("id", runId);
  return fallback;
}

export async function collectPipelineData(db: AdminDb, runId: string) {
  const provider = activeFootballProvider();
  const { data: matches } = await db
    .from("matches")
    .select("id,home_team,away_team,competition,kickoff_local,resolution_status")
    .eq("run_id", runId);
  const runPredictionAt = await predictionAt(db, runId);
  const matchIds = (matches ?? []).map((match) => match.id);
  const { data: externalIds } = matchIds.length
    ? await db.from("match_external_ids").select("match_id,source,external_id").in("match_id", matchIds)
    : { data: [] };
  const perSource: Record<string, number> = {};

  if (provider === "five_dollar") {
    const {
      fiveDollarTeamHistory,
      fiveDollarLeagueHistory,
      fiveDollarConfigured,
      fiveDollarUsage,
      FIVE_DOLLAR_SOURCE,
      FIVE_DOLLAR_DEFINITION_VERSION,
    } = await import("../adapters/five_dollar.server");
    let observationsCount = 0;
    let insufficient = 0;
    let reusedFromCache = 0;
    let rateLimited = false;

    if (fiveDollarConfigured()) {
      const cacheKeys = [...new Set((externalIds ?? [])
        .filter((entry) => entry.source === "five_dollar_team_home" || entry.source === "five_dollar_team_away")
        .map((entry) => `five_dollar:${entry.external_id}:${runPredictionAt}`))];
      const cachedRows = await loadFiveDollarCacheRows(
        db,
        FIVE_DOLLAR_SOURCE,
        FIVE_DOLLAR_DEFINITION_VERSION,
        cacheKeys,
      );
      const cacheIndex = new Map<string, typeof cachedRows>();
      for (const row of cachedRows) {
        const list = cacheIndex.get(row.cache_key) ?? [];
        list.push(row);
        cacheIndex.set(row.cache_key, list);
      }

      const leagueHistoryCache = new Map<string, Awaited<ReturnType<typeof fiveDollarLeagueHistory>>>();
      const leagueTeamIds = new Map<string, Set<number>>();
      for (const match of matches ?? []) {
        const leagueExternal = (externalIds ?? []).find(
          (entry) => entry.match_id === match.id && entry.source === "five_dollar_league",
        );
        if (!leagueExternal?.external_id) continue;
        const key = String(leagueExternal.external_id);
        const set = leagueTeamIds.get(key) ?? new Set<number>();
        for (const entry of (externalIds ?? []).filter(
          (candidate) => candidate.match_id === match.id
            && (candidate.source === "five_dollar_team_home" || candidate.source === "five_dollar_team_away"),
        )) {
          const id = Number(entry.external_id);
          if (Number.isFinite(id)) set.add(id);
        }
        leagueTeamIds.set(key, set);
      }

      for (const match of matches ?? []) {
        if (rateLimited) break;
        const teams = (externalIds ?? []).filter(
          (entry) => entry.match_id === match.id
            && (entry.source === "five_dollar_team_home" || entry.source === "five_dollar_team_away"),
        );
        const leagueExternal = (externalIds ?? []).find(
          (entry) => entry.match_id === match.id && entry.source === "five_dollar_league",
        );
        const crossLeague = isCrossLeagueCompetitionName(match.competition);
        if (teams.length === 0) {
          perSource[`${FIVE_DOLLAR_SOURCE}:NO_FIXTURE`] = (perSource[`${FIVE_DOLLAR_SOURCE}:NO_FIXTURE`] ?? 0) + 1;
          continue;
        }

        for (const team of teams) {
          if (rateLimited) break;
          const scope = team.source === "five_dollar_team_home" ? "HOME" : "AWAY";
          const cacheKey = `five_dollar:${team.external_id}:${runPredictionAt}`;
          const cached = cacheIndex.get(cacheKey);
          if (cached?.length) {
            reusedFromCache += cached.length;
            observationsCount += cached.length;
            await db.from("raw_observations").insert(cached.map((row) => ({
              run_id: runId,
              match_id: match.id,
              source: FIVE_DOLLAR_SOURCE,
              metric: row.metric,
              raw_value: row.raw_value as never,
              observed_at: row.observed_at,
              fetched_at: row.fetched_at,
              definition_version: FIVE_DOLLAR_DEFINITION_VERSION,
            })));
            continue;
          }

          let history;
          if (leagueExternal?.external_id && !crossLeague) {
            const key = `${leagueExternal.external_id}:${runPredictionAt}`;
            history = leagueHistoryCache.get(key);
            if (!history) {
              history = await fiveDollarLeagueHistory(
                Number(leagueExternal.external_id),
                [...(leagueTeamIds.get(String(leagueExternal.external_id)) ?? new Set<number>())],
                runPredictionAt,
                365,
              );
              leagueHistoryCache.set(key, history);
            }
          } else {
            history = await fiveDollarTeamHistory(Number(team.external_id), runPredictionAt, crossLeague ? 40 : 20);
          }

          for (const fetch of history.fetches) {
            perSource[`${FIVE_DOLLAR_SOURCE}:${fetch.status}`] = (perSource[`${FIVE_DOLLAR_SOURCE}:${fetch.status}`] ?? 0) + 1;
            if (fetch.status === "RATE_LIMITED") rateLimited = true;
            await db.from("source_fetches").insert({
              run_id: runId,
              match_id: match.id,
              source: FIVE_DOLLAR_SOURCE,
              status: fetch.status === "OK" ? "OK" : fetch.status === "RATE_LIMITED" ? "RATE_LIMITED" : "SOURCE_UNAVAILABLE",
              http_status: fetch.httpStatus,
              error_message: fetch.errorMessage,
              fetched_at: fetch.fetchedAt,
            });
          }
          if (history.insufficientHistory) insufficient += 1;

          const teamObservations = history.observations.filter(
            (observation) => observation.teamId === Number(team.external_id),
          );
          if (teamObservations.length > 0) {
            observationsCount += teamObservations.length;
            await db.from("raw_observations").insert(teamObservations.map((observation) => ({
              run_id: runId,
              match_id: match.id,
              source: FIVE_DOLLAR_SOURCE,
              metric: `${scope}:${observation.observation.canonical}`,
              raw_value: {
                value: observation.observation.value,
                sourceLabel: observation.observation.sourceLabel,
                metricLabelRaw: observation.observation.sourceLabel,
                teamScope: scope,
                statScope: observation.observation.scope,
                contractCompatible: observation.observation.contractCompatible,
                note: observation.observation.note,
                endpoint: observation.endpoint,
                fixtureId: observation.fixtureId,
                externalMatchId: observation.externalMatchId,
                fixtureDate: observation.fixtureDate,
                teamExternalId: team.external_id,
                teamId: observation.teamId,
                opponentId: observation.opponentId,
                teamSideInFixture: observation.teamSide,
                rawHomeAway: observation.rawHomeAway,
                kickoff: observation.observedAt,
                predictionAt: runPredictionAt,
                cacheKey,
              } as never,
              observed_at: observation.observedAt,
              fetched_at: observation.fetchedAt,
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

      await pipelineLog(
        db,
        runId,
        "COLLECT",
        `${observationsCount} observações 5Dollar; ${reusedFromCache} de cache; ${insufficient} times com histórico insuficiente${rateLimited ? "; coleta parcial por rate limit" : ""}.`,
        observationsCount ? "INFO" : "WARN",
        {
          provider,
          predictionAt: runPredictionAt,
          requestsMade: usage.requestsMade,
          rateLimit: usage.rateLimit,
          rateLimitHits: usage.rateLimitHits,
          bulkLeagues: leagueHistoryCache.size,
          uniqueHistoricalFixtures: [...leagueHistoryCache.values()].reduce((sum, history) => sum + history.fixtures.length, 0),
        },
      );
    }
  }

  if (provider === "api_sports") {
    const {
      apiFootballTeamHistory,
      apiFootballConfigured,
      API_FOOTBALL_SOURCE,
      API_FOOTBALL_DEFINITION_VERSION,
    } = await import("../adapters/api_football.server");
    let observationsCount = 0;
    if (apiFootballConfigured()) {
      for (const match of matches ?? []) {
        const teams = (externalIds ?? []).filter(
          (entry) => entry.match_id === match.id
            && (entry.source === "api_football_team_home" || entry.source === "api_football_team_away"),
        );
        if (teams.length === 0) {
          perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] = (perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] ?? 0) + 1;
          continue;
        }
        for (const team of teams) {
          const targetScope = team.source === "api_football_team_home" ? "HOME" : "AWAY";
          const history = await apiFootballTeamHistory(Number(team.external_id), runPredictionAt);
          for (const fetch of history.fetches) {
            perSource[`${API_FOOTBALL_SOURCE}:${fetch.status}`] = (perSource[`${API_FOOTBALL_SOURCE}:${fetch.status}`] ?? 0) + 1;
            await db.from("source_fetches").insert({
              run_id: runId,
              match_id: match.id,
              source: API_FOOTBALL_SOURCE,
              status: fetch.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
              http_status: fetch.httpStatus,
              error_message: fetch.errorMessage,
              fetched_at: fetch.fetchedAt,
            });
          }
          if (history.observations.length > 0) {
            observationsCount += history.observations.length;
            await db.from("raw_observations").insert(history.observations.map((observation) => ({
              run_id: runId,
              match_id: match.id,
              source: API_FOOTBALL_SOURCE,
              metric: `${targetScope}:${observation.observation.canonical}`,
              raw_value: {
                value: observation.observation.value,
                sourceLabel: observation.observation.sourceLabel,
                teamScope: targetScope,
                statScope: observation.observation.scope,
                contractCompatible: observation.observation.contractCompatible,
                note: observation.observation.note,
                endpoint: observation.endpoint,
                fixtureId: observation.fixtureId,
                teamExternalId: team.external_id,
                predictionAt: runPredictionAt,
              } as never,
              observed_at: observation.observedAt,
              fetched_at: observation.fetchedAt,
              definition_version: API_FOOTBALL_DEFINITION_VERSION,
            })));
          }
        }
      }
      await pipelineLog(
        db,
        runId,
        "COLLECT",
        `${observationsCount} observações coletadas na API-Football.`,
        observationsCount ? "INFO" : "WARN",
        { provider, predictionAt: runPredictionAt },
      );
    }
  }

  await pipelineLog(
    db,
    runId,
    "COLLECT",
    "Coleta concluída usando um único provedor ativo.",
    "INFO",
    { provider, ...perSource },
  );
  return { provider, ...perSource };
}
