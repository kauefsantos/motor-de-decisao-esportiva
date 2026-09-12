import type { AdminDb } from "../admin-db";
import { saoPauloLocalDateTimeToIso } from "../sao-paulo-time";
import { activeFootballProvider } from "./provider.server";

const SEPARATOR = /\s+(?:x|vs?|-)+\s+/i;

function parseTeams(partida: string): { home: string | null; away: string | null } {
  const parts = partida.split(SEPARATOR);
  if (parts.length !== 2) return { home: null, away: null };
  return { home: parts[0]!.trim(), away: parts[1]!.trim() };
}

function parseKickoff(targetDate: string | null, horario: string): string | null {
  const match = horario.match(/(\d{1,2})[:h](\d{2})/);
  if (!match || !targetDate) return null;
  const hours = match[1]!.padStart(2, "0");
  return saoPauloLocalDateTimeToIso(targetDate, `${hours}:${match[2]}`);
}

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

async function replaceExternalIds(
  db: AdminDb,
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

export async function resolvePipelineMatches(db: AdminDb, runId: string) {
  const provider = activeFootballProvider();
  const { data: run } = await db.from("analysis_runs").select("target_date").eq("id", runId).single();
  const targetDate = run?.target_date ?? null;
  const runPredictionAt = await predictionAt(db, runId);
  const { data: matches } = await db
    .from("matches")
    .select("id,raw_partida,raw_horario,raw_campeonato")
    .eq("run_id", runId);

  let resolved = 0;
  let failed = 0;
  let external = 0;
  let ambiguous = 0;
  let notFound = 0;
  let sourceUnavailable = 0;

  if (!targetDate) {
    await pipelineLog(db, runId, "RESOLVE", "Run sem target_date. O CSV deve conter a coluna Data.", "ERROR");
    return { resolved: 0, failed: matches?.length ?? 0, external: 0, ambiguous: 0, notFound: 0, sourceUnavailable: 1, provider };
  }

  for (const match of matches ?? []) {
    const { home, away } = parseTeams(match.raw_partida);
    const kickoff = parseKickoff(targetDate, match.raw_horario);
    const localOk = Boolean(home && away && kickoff);
    if (localOk) resolved += 1;
    else failed += 1;

    let status = localOk ? "RESOLVED_LOCAL" : "UNRESOLVED";
    let reason = localOk ? "Normalização local do CSV." : "Não foi possível separar mandante/visitante, data ou horário.";
    let confidence = localOk ? 0.6 : 0;

    if (localOk && home && away && kickoff && provider === "five_dollar") {
      const {
        fiveDollarResolveMatch,
        fiveDollarConfigured,
        FIVE_DOLLAR_SOURCE,
        FIVE_DOLLAR_DEFINITION_VERSION,
      } = await import("../adapters/five_dollar.server");
      if (!fiveDollarConfigured()) {
        sourceUnavailable += 1;
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: match.id,
          source: FIVE_DOLLAR_SOURCE,
          status: "NOT_CONFIGURED",
          http_status: null,
          error_message: "FIVE_DOLLAR_FOOTBALL_API_KEY ausente no servidor.",
          fetched_at: new Date().toISOString(),
        });
      } else {
        const response = await fiveDollarResolveMatch(
          { homeTeam: home, awayTeam: away, competition: match.raw_campeonato, kickoff },
          targetDate,
        );
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: match.id,
          source: FIVE_DOLLAR_SOURCE,
          status: response.fetch.status === "OK"
            ? "OK"
            : response.fetch.status === "RATE_LIMITED"
              ? "RATE_LIMITED"
              : "SOURCE_UNAVAILABLE",
          http_status: response.fetch.httpStatus,
          error_message: response.fetch.errorMessage,
          fetched_at: response.fetch.fetchedAt,
        });

        if (response.resolution?.status === "MATCH_RESOLVED") {
          external += 1;
          status = "RESOLVED_FIVE_DOLLAR";
          reason = response.resolution.reason;
          confidence = response.resolution.confidence;
          const event = response.events.find((item) => item.eventId === response.resolution!.eventId);
          await replaceExternalIds(
            db,
            match.id,
            "five_dollar_fixture",
            "five_dollar_team_home",
            "five_dollar_team_away",
            response.resolution.eventId!,
            event?.homeTeamId ?? null,
            event?.awayTeamId ?? null,
            response.resolution.confidence,
            "five_dollar_league",
            event?.leagueId ?? null,
          );
        } else if (response.resolution?.status === "MATCH_AMBIGUOUS") {
          ambiguous += 1;
          reason = `${reason} 5Dollar: ${response.resolution.reason}`;
        } else if (response.resolution?.status === "MATCH_NOT_FOUND") {
          notFound += 1;
          reason = `${reason} 5Dollar: ${response.resolution.reason}`;
        } else {
          sourceUnavailable += 1;
          reason = `${reason} 5Dollar indisponível: ${response.fetch.errorMessage ?? "sem detalhe"}.`;
        }

        await pipelineLog(
          db,
          runId,
          "RESOLVE",
          `Resolução 5Dollar para ${match.raw_partida}: ${response.resolution?.status ?? response.fetch.status}`,
          response.resolution?.status === "MATCH_RESOLVED" ? "INFO" : "WARN",
          {
            provider,
            definitionVersion: FIVE_DOLLAR_DEFINITION_VERSION,
            endpoint: response.fetch.path,
            pages: response.fetches?.length ?? 1,
            httpStatus: response.fetch.httpStatus,
            fetchedAt: response.fetch.fetchedAt,
            rateLimit: response.fetch.rateLimit,
            predictionAt: runPredictionAt,
            targetDate,
            candidates: response.resolution?.candidates ?? [],
          },
        );
      }
    }

    if (localOk && home && away && kickoff && provider === "api_sports") {
      const {
        apiFootballResolveMatch,
        apiFootballConfigured,
        API_FOOTBALL_SOURCE,
        API_FOOTBALL_DEFINITION_VERSION,
      } = await import("../adapters/api_football.server");
      if (!apiFootballConfigured()) {
        sourceUnavailable += 1;
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: match.id,
          source: API_FOOTBALL_SOURCE,
          status: "NOT_CONFIGURED",
          http_status: null,
          error_message: "API_FOOTBALL_KEY ausente no servidor.",
          fetched_at: new Date().toISOString(),
        });
      } else {
        const response = await apiFootballResolveMatch(
          { homeTeam: home, awayTeam: away, competition: match.raw_campeonato, kickoff },
          targetDate,
        );
        await db.from("source_fetches").insert({
          run_id: runId,
          match_id: match.id,
          source: API_FOOTBALL_SOURCE,
          status: response.fetch.status === "OK" ? "OK" : "SOURCE_UNAVAILABLE",
          http_status: response.fetch.httpStatus,
          error_message: response.fetch.errorMessage,
          fetched_at: response.fetch.fetchedAt,
        });

        if (response.resolution?.status === "MATCH_RESOLVED") {
          external += 1;
          status = "RESOLVED_API_FOOTBALL";
          reason = response.resolution.reason;
          confidence = response.resolution.confidence;
          const event = response.events.find((item) => item.eventId === response.resolution!.eventId);
          await replaceExternalIds(
            db,
            match.id,
            "api_football_fixture",
            "api_football_team_home",
            "api_football_team_away",
            response.resolution.eventId!,
            event?.homeTeamId ?? null,
            event?.awayTeamId ?? null,
            response.resolution.confidence,
          );
        } else if (response.resolution?.status === "MATCH_AMBIGUOUS") {
          ambiguous += 1;
          reason = `${reason} API-Football: ${response.resolution.reason}`;
        } else if (response.resolution?.status === "MATCH_NOT_FOUND") {
          notFound += 1;
          reason = `${reason} API-Football: ${response.resolution.reason}`;
        } else {
          sourceUnavailable += 1;
          reason = `${reason} API-Football indisponível: ${response.fetch.errorMessage ?? "sem detalhe"}.`;
        }

        await pipelineLog(
          db,
          runId,
          "RESOLVE",
          `Resolução API-Football para ${match.raw_partida}: ${response.resolution?.status ?? response.fetch.status}`,
          response.resolution?.status === "MATCH_RESOLVED" ? "INFO" : "WARN",
          {
            provider,
            definitionVersion: API_Football_DEFINITION_VERSION,
            endpoint: response.fetch.path,
            httpStatus: response.fetch.httpStatus,
            fetchedAt: response.fetch.fetchedAt,
            predictionAt: runPredictionAt,
            targetDate,
            candidates: response.resolution?.candidates ?? [],
          },
        );
      }
    }

    await db.from("matches").update({
      home_team: home,
      away_team: away,
      competition: match.raw_campeonato,
      kickoff_local: kickoff,
      resolution_status: status,
      resolution_reason: reason,
      resolver_confidence: confidence,
    }).eq("id", match.id);
  }

  await db.from("analysis_runs")
    .update({ matches_resolved: resolved, matches_failed: failed })
    .eq("id", runId);
  await pipelineLog(
    db,
    runId,
    "RESOLVE",
    `${resolved} partidas normalizadas; ${external} resolvidas externamente via ${provider}; ${ambiguous} ambíguas; ${notFound} não encontradas; ${sourceUnavailable} indisponíveis.`,
    external ? "INFO" : "WARN",
    { provider, targetDate },
  );
  return { resolved, failed, external, ambiguous, notFound, sourceUnavailable, provider };
}
