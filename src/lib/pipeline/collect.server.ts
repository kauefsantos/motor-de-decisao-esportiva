import type { AdminDb } from "../admin-db";
import { isCrossLeagueCompetitionName } from "../competition-kind";
import { activeFootballProvider } from "./provider.server";

const COLLECT_BATCH_SIZE = 4;
const COLLECT_MATCH_DONE_STEP = "COLLECT_MATCH_DONE";

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

async function completedMatchIds(db: AdminDb, runId: string) {
  const { data } = await db
    .from("pipeline_logs")
    .select("payload")
    .eq("run_id", runId)
    .eq("step", COLLECT_MATCH_DONE_STEP);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const payload = row.payload as { matchId?: unknown } | null;
    if (typeof payload?.matchId === "string") ids.add(payload.matchId);
  }
  return ids;
}

async function markMatchDone(db: AdminDb, runId: string, matchId: string, provider: string) {
  await pipelineLog(db, runId, COLLECT_MATCH_DONE_STEP, "Coleta da partida concluída.", "INFO", { matchId, provider });
}

async function resetPartialMatchCollection(db: AdminDb, runId: string, matchId: string, source: string) {
  // Uma partida só entra no marcador DONE depois de terminar por inteiro. Se a
  // execução caiu no meio, o próximo lote remove apenas o parcial daquela
  // partida e a refaz, sem duplicar observações já concluídas de outros jogos.
  await db.from("raw_observations").delete().eq("run_id", runId).eq("match_id", matchId);
  await db.from("source_fetches").delete().eq("run_id", runId).eq("match_id", matchId).eq("source", source);
}

export async function collectPipelineData(db: AdminDb, runId: string) {
  const provider = activeFootballProvider();
  const { data: matches } = await db
    .from("matches")
    .select("id,home_team,away_team,competition,kickoff_local,resolution_status")
    .eq("run_id", runId)
    .order("kickoff_local", { ascending: true })
    .order("id", { ascending: true });

  const allMatches = matches ?? [];
  const doneBefore = await completedMatchIds(db, runId);
  const pendingMatches = allMatches.filter((match) => !doneBefore.has(match.id));
  if (pendingMatches.length === 0) {
    return { provider, complete: true, processedMatches: 0, remainingMatches: 0, totalMatches: allMatches.length };
  }

  const batch = pendingMatches.slice(0, COLLECT_BATCH_SIZE);
  const runPredictionAt = await predictionAt(db, runId);
  const batchIds = batch.map((match) => match.id);
  const { data: externalIds } = batchIds.length
    ? await db.from("match_external_ids").select("match_id,source,external_id").in("match_id", batchIds)
    : { data: [] };
  const perSource: Record<string, number> = {};
  const processed = new Set<string>();
  let rateLimited = false;

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

    if (!fiveDollarConfigured()) {
      for (const match of batch) {
        await markMatchDone(db, runId, match.id, provider);
        processed.add(match.id);
      }
      await pipelineLog(db, runId, "COLLECT", "Provedor 5Dollar não configurado; lote concluído sem observações.", "WARN", { processedMatches: processed.size });
    } else {
      const leagueHistoryCache = new Map<string, Awaited<ReturnType<typeof fiveDollarLeagueHistory>>>();
      const leagueTeamIds = new Map<string, Set<number>>();
      for (const match of batch) {
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

      for (const match of batch) {
        if (rateLimited) break;
        await resetPartialMatchCollection(db, runId, match.id, FIVE_DOLLAR_SOURCE);
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
          await markMatchDone(db, runId, match.id, provider);
          processed.add(match.id);
          continue;
        }

        for (const team of teams) {
          if (rateLimited) break;
          const scope = team.source === "five_dollar_team_home" ? "HOME" : "AWAY";
          const cacheKey = `five_dollar:${team.external_id}:${runPredictionAt}`;
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
              // Recalculado pelo trigger set_raw_observation_key() no banco.
              observation_key: "",
            })));
          }
        }

        if (!rateLimited) {
          await markMatchDone(db, runId, match.id, provider);
          processed.add(match.id);
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
        `${observationsCount} observações 5Dollar no lote; ${insufficient} times com histórico insuficiente${rateLimited ? "; lote interrompido por rate limit" : ""}.`,
        observationsCount ? "INFO" : "WARN",
        {
          provider,
          predictionAt: runPredictionAt,
          requestsMade: usage.requestsMade,
          rateLimit: usage.rateLimit,
          rateLimitHits: usage.rateLimitHits,
          batchSize: batch.length,
          processedMatches: processed.size,
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

    for (const match of batch) {
      if (apiFootballConfigured()) {
        await resetPartialMatchCollection(db, runId, match.id, API_FOOTBALL_SOURCE);
        const teams = (externalIds ?? []).filter(
          (entry) => entry.match_id === match.id
            && (entry.source === "api_football_team_home" || entry.source === "api_football_team_away"),
        );
        if (teams.length === 0) {
          perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] = (perSource[`${API_FOOTBALL_SOURCE}:NO_FIXTURE`] ?? 0) + 1;
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
      await markMatchDone(db, runId, match.id, provider);
      processed.add(match.id);
    }

    await pipelineLog(
      db,
      runId,
      "COLLECT",
      `${observationsCount} observações coletadas na API-Football no lote.`,
      observationsCount ? "INFO" : "WARN",
      { provider, predictionAt: runPredictionAt, processedMatches: processed.size },
    );
  }

  const doneAfter = new Set(doneBefore);
  for (const id of processed) doneAfter.add(id);
  const remainingMatches = Math.max(0, allMatches.length - doneAfter.size);
  const complete = remainingMatches === 0;

  await pipelineLog(
    db,
    runId,
    "COLLECT",
    complete
      ? "Coleta concluída para todas as partidas da rodada."
      : `Lote concluído; ${remainingMatches} partida(s) ainda aguardam coleta.`,
    complete ? "INFO" : rateLimited ? "WARN" : "INFO",
    { provider, complete, processedMatches: processed.size, remainingMatches, totalMatches: allMatches.length, rateLimited, ...perSource },
  );

  return { provider, complete, processedMatches: processed.size, remainingMatches, totalMatches: allMatches.length, rateLimited, ...perSource };
}
