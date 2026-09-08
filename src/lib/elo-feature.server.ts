import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  applyEloToGoalLambdas,
  ELO_INITIAL_RATING,
  ELO_MODEL_VERSION,
  HIERARCHICAL_ELO_MODEL_VERSION,
  LEAGUE_ELO_MODEL_VERSION,
} from "./engine/elo";

type DbError = { message: string } | null;
type DbResponse = { data: unknown; error: DbError };
interface DbQuery extends PromiseLike<DbResponse> {
  select(columns?: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  lt(column: string, value: unknown): DbQuery;
  or(filters: string): DbQuery;
  order(column: string, options?: Record<string, unknown>): DbQuery;
  limit(value: number): DbQuery;
  maybeSingle(): DbQuery;
  upsert(values: unknown, options?: Record<string, unknown>): DbQuery;
}
interface UntypedDb {
  from(table: string): DbQuery;
}

type HistoryRow = {
  league_id: number | string;
  home_team_id: number | string;
  away_team_id: number | string;
  home_rating_after: number | string;
  away_rating_after: number | string;
};

type LeagueRatingRow = {
  league_id: number | string;
  rating: number | string;
  updated_at: string;
};

type EloAt = {
  found: boolean;
  leagueId: number | null;
  rating: number;
};

type LeagueAt = {
  found: boolean;
  leagueId: number | null;
  rating: number;
};

const db = supabaseAdmin as unknown as UntypedDb;

function parseHistoryRow(data: unknown, teamId: number): EloAt {
  if (!data || typeof data !== "object") {
    return { found: false, leagueId: null, rating: ELO_INITIAL_RATING };
  }
  const row = data as HistoryRow;
  const isHome = Number(row.home_team_id) === teamId;
  const rating = Number(isHome ? row.home_rating_after : row.away_rating_after);
  const leagueId = Number(row.league_id);
  return {
    found: Number.isFinite(rating) && Number.isFinite(leagueId),
    leagueId: Number.isFinite(leagueId) ? leagueId : null,
    rating: Number.isFinite(rating) ? rating : ELO_INITIAL_RATING,
  };
}

async function ratingAtLeague(
  leagueKey: string,
  leagueId: number | null | undefined,
  teamId: number,
  predictionAt: string,
): Promise<EloAt> {
  let query = db
    .from("elo_fixture_history")
    .select("league_id,home_team_id,away_team_id,home_rating_after,away_rating_after")
    .eq("model_version", ELO_MODEL_VERSION);

  query = leagueId && Number.isFinite(leagueId)
    ? query.eq("league_id", leagueId)
    : query.eq("league_key", leagueKey);

  const res = await query
    .lt("kickoff_at", predictionAt)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("kickoff_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) return { found: false, leagueId: null, rating: ELO_INITIAL_RATING };
  return parseHistoryRow(res.data, teamId);
}

/**
 * Busca o Elo doméstico mais recente do time antes do prediction_at, sem exigir
 * que a partida analisada pertença à mesma competição. elo_fixture_history só
 * contém ligas domésticas alvo do ledger Elo, portanto esta busca é segura para
 * Champions/Europa/Libertadores/Sul-Americana.
 */
async function latestDomesticRatingAt(teamId: number, predictionAt: string): Promise<EloAt> {
  const res = await db
    .from("elo_fixture_history")
    .select("league_id,home_team_id,away_team_id,home_rating_after,away_rating_after")
    .eq("model_version", ELO_MODEL_VERSION)
    .lt("kickoff_at", predictionAt)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("kickoff_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) return { found: false, leagueId: null, rating: ELO_INITIAL_RATING };
  return parseHistoryRow(res.data, teamId);
}

/**
 * O rating de liga atual só pode ser usado quando foi calculado antes do
 * prediction_at. Isso evita reaproveitar, em backtests, evidência continental
 * que ainda não existia naquele instante.
 */
async function leagueRatingAtCurrentSnapshot(leagueId: number, predictionAt: string): Promise<LeagueAt> {
  const res = await db
    .from("elo_league_ratings")
    .select("league_id,rating,updated_at")
    .eq("model_version", LEAGUE_ELO_MODEL_VERSION)
    .eq("league_id", leagueId)
    .lt("updated_at", predictionAt)
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data || typeof res.data !== "object") {
    return { found: false, leagueId: null, rating: ELO_INITIAL_RATING };
  }
  const row = res.data as LeagueRatingRow;
  const rating = Number(row.rating);
  const id = Number(row.league_id);
  return {
    found: Number.isFinite(rating) && Number.isFinite(id),
    leagueId: Number.isFinite(id) ? id : null,
    rating: Number.isFinite(rating) ? rating : ELO_INITIAL_RATING,
  };
}

export async function eloAdjustGoalForecast(input: {
  runId: string;
  matchId: string;
  leagueKey: string;
  leagueId?: number | null;
  homeTeamId: number;
  awayTeamId: number;
  predictionAt: string;
  lambdaHome: number;
  lambdaAway: number;
}) {
  const [sameHome, sameAway] = await Promise.all([
    ratingAtLeague(input.leagueKey, input.leagueId, input.homeTeamId, input.predictionAt),
    ratingAtLeague(input.leagueKey, input.leagueId, input.awayTeamId, input.predictionAt),
  ]);

  let home = sameHome;
  let away = sameAway;
  let homeLeagueRating: LeagueAt | null = null;
  let awayLeagueRating: LeagueAt | null = null;
  let scope: "SAME_LEAGUE" | "CROSS_LEAGUE_HIERARCHICAL" = "SAME_LEAGUE";

  const sameDomesticLeague =
    home.found && away.found && home.leagueId !== null && home.leagueId === away.leagueId;

  if (!sameDomesticLeague) {
    scope = "CROSS_LEAGUE_HIERARCHICAL";
    [home, away] = await Promise.all([
      latestDomesticRatingAt(input.homeTeamId, input.predictionAt),
      latestDomesticRatingAt(input.awayTeamId, input.predictionAt),
    ]);

    if (!home.found || !away.found || home.leagueId === null || away.leagueId === null) {
      return {
        applied: false as const,
        modelVersionSuffix: null,
        lambdaHome: input.lambdaHome,
        lambdaAway: input.lambdaAway,
        homeRating: home.rating,
        awayRating: away.rating,
        reason: "Elo doméstico pré-jogo indisponível para um dos times.",
      };
    }

    [homeLeagueRating, awayLeagueRating] = await Promise.all([
      leagueRatingAtCurrentSnapshot(home.leagueId, input.predictionAt),
      leagueRatingAtCurrentSnapshot(away.leagueId, input.predictionAt),
    ]);

    if (!homeLeagueRating.found || !awayLeagueRating.found) {
      return {
        applied: false as const,
        modelVersionSuffix: null,
        lambdaHome: input.lambdaHome,
        lambdaAway: input.lambdaAway,
        homeRating: home.rating,
        awayRating: away.rating,
        reason: "Elo de liga hierárquico ainda não estava disponível no prediction_at.",
      };
    }
  }

  const homeEffective = scope === "SAME_LEAGUE"
    ? home.rating
    : (homeLeagueRating!.rating + (home.rating - ELO_INITIAL_RATING));
  const awayEffective = scope === "SAME_LEAGUE"
    ? away.rating
    : (awayLeagueRating!.rating + (away.rating - ELO_INITIAL_RATING));

  const adjusted = applyEloToGoalLambdas(
    input.lambdaHome,
    input.lambdaAway,
    homeEffective,
    awayEffective,
  );

  const write = await db.from("elo_prediction_context").upsert(
    {
      run_id: input.runId,
      match_id: input.matchId,
      prediction_at: input.predictionAt,
      model_version: scope === "SAME_LEAGUE" ? ELO_MODEL_VERSION : HIERARCHICAL_ELO_MODEL_VERSION,
      league_id: input.leagueId ?? home.leagueId,
      home_team_id: input.homeTeamId,
      away_team_id: input.awayTeamId,
      home_rating: home.rating,
      away_rating: away.rating,
      home_league_id: home.leagueId,
      away_league_id: away.leagueId,
      home_league_rating: homeLeagueRating?.rating ?? null,
      away_league_rating: awayLeagueRating?.rating ?? null,
      home_global_rating: homeEffective,
      away_global_rating: awayEffective,
      elo_scope: scope,
      elo_delta: adjusted.eloDelta,
      base_lambda_home: input.lambdaHome,
      base_lambda_away: input.lambdaAway,
      adjusted_lambda_home: adjusted.lambdaHome,
      adjusted_lambda_away: adjusted.lambdaAway,
      created_at: new Date().toISOString(),
    },
    { onConflict: "run_id,match_id" },
  );
  if (write.error) throw new Error(`Falha ao auditar ajuste Elo: ${write.error.message}`);

  return {
    applied: true as const,
    modelVersionSuffix: scope === "SAME_LEAGUE" ? ELO_MODEL_VERSION : HIERARCHICAL_ELO_MODEL_VERSION,
    lambdaHome: adjusted.lambdaHome,
    lambdaAway: adjusted.lambdaAway,
    homeRating: home.rating,
    awayRating: away.rating,
    homeLeagueRating: homeLeagueRating?.rating ?? null,
    awayLeagueRating: awayLeagueRating?.rating ?? null,
    homeGlobalRating: homeEffective,
    awayGlobalRating: awayEffective,
    eloScope: scope,
    eloDelta: adjusted.eloDelta,
    baseHomeShare: adjusted.baseHomeShare,
    adjustedHomeShare: adjusted.adjustedHomeShare,
    reason: null,
  };
}
