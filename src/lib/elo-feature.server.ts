import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  applyEloToGoalLambdas,
  ELO_INITIAL_RATING,
  ELO_MODEL_VERSION,
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

type EloAt = {
  found: boolean;
  leagueId: number | null;
  rating: number;
};

const db = supabaseAdmin as unknown as UntypedDb;

async function ratingAt(
  leagueKey: string,
  teamId: number,
  predictionAt: string,
): Promise<EloAt> {
  const res = await db
    .from("elo_fixture_history")
    .select("league_id,home_team_id,away_team_id,home_rating_after,away_rating_after")
    .eq("model_version", ELO_MODEL_VERSION)
    .eq("league_key", leagueKey)
    .lt("kickoff_at", predictionAt)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("kickoff_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data || typeof res.data !== "object") {
    return { found: false, leagueId: null, rating: ELO_INITIAL_RATING };
  }
  const row = res.data as HistoryRow;
  const isHome = Number(row.home_team_id) === teamId;
  const rating = Number(isHome ? row.home_rating_after : row.away_rating_after);
  return {
    found: Number.isFinite(rating),
    leagueId: Number.isFinite(Number(row.league_id)) ? Number(row.league_id) : null,
    rating: Number.isFinite(rating) ? rating : ELO_INITIAL_RATING,
  };
}

export async function eloAdjustGoalForecast(input: {
  runId: string;
  matchId: string;
  leagueKey: string;
  homeTeamId: number;
  awayTeamId: number;
  predictionAt: string;
  lambdaHome: number;
  lambdaAway: number;
}) {
  const [home, away] = await Promise.all([
    ratingAt(input.leagueKey, input.homeTeamId, input.predictionAt),
    ratingAt(input.leagueKey, input.awayTeamId, input.predictionAt),
  ]);

  if (!home.found || !away.found || home.leagueId === null || home.leagueId !== away.leagueId) {
    return {
      applied: false as const,
      modelVersionSuffix: null,
      lambdaHome: input.lambdaHome,
      lambdaAway: input.lambdaAway,
      homeRating: home.rating,
      awayRating: away.rating,
      reason: "Elo pré-jogo indisponível para os dois times na mesma liga.",
    };
  }

  const adjusted = applyEloToGoalLambdas(
    input.lambdaHome,
    input.lambdaAway,
    home.rating,
    away.rating,
  );
  const write = await db.from("elo_prediction_context").upsert(
    {
      run_id: input.runId,
      match_id: input.matchId,
      prediction_at: input.predictionAt,
      model_version: ELO_MODEL_VERSION,
      league_id: home.leagueId,
      home_team_id: input.homeTeamId,
      away_team_id: input.awayTeamId,
      home_rating: home.rating,
      away_rating: away.rating,
      elo_delta: adjusted.eloDelta,
      base_lambda_home: input.lambdaHome,
      base_lambda_away: input.lambdaAway,
      adjusted_lambda_home: adjusted.lambdaHome,
      adjusted_lambda_away: adjusted.lambdaAway,
      created_at: new Date().toISOString(),
    },
    { onConflict: "run_id,match_id" },
  );
  if (write.error) {
    throw new Error(`Falha ao auditar ajuste Elo: ${write.error.message}`);
  }

  return {
    applied: true as const,
    modelVersionSuffix: ELO_MODEL_VERSION,
    lambdaHome: adjusted.lambdaHome,
    lambdaAway: adjusted.lambdaAway,
    homeRating: home.rating,
    awayRating: away.rating,
    eloDelta: adjusted.eloDelta,
    baseHomeShare: adjusted.baseHomeShare,
    adjustedHomeShare: adjusted.adjustedHomeShare,
    reason: null,
  };
}
