import { supabaseAdmin } from "@/integrations/supabase/client.server";

import {
  applyEloToGoalLambdas,
  ELO_INITIAL_RATING,
  ELO_MODEL_VERSION,
  HIERARCHICAL_ELO_MODEL_VERSION,
  LEAGUE_ELO_MODEL_VERSION,
} from "./engine/elo";

type DbError = { message: string } | null;
type DbResponse = { data: unknown; error: DbError; count?: number | null };
interface DbQuery extends PromiseLike<DbResponse> {
  select(columns?: string, options?: Record<string, unknown>): DbQuery;
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
  evidence_matches: number | string;
  updated_at: string;
};

type LeagueHistoryRow = {
  competition_id: number | string;
  fixture_id: number | string;
  kickoff_at: string;
  home_league_id: number | string;
  away_league_id: number | string;
  home_league_rating_after: number | string;
  away_league_rating_after: number | string;
};

type LeagueConfigRow = {
  league_id: number | string;
  league_key: string;
  prior_rating: number | string;
  parent_league_key: string | null;
  focus_role: string;
  division_level: number | string;
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
  evidenceMatches: number;
};

type HistoricalLeagueBase = LeagueAt & {
  config: LeagueConfigRow | null;
};

const db = supabaseAdmin as unknown as UntypedDb;
const MIN_LEAGUE_EVIDENCE_MATCHES = 3;
const BIG_FIVE_LEAGUE_IDS = [
  4160026622, // Premier League
  4212821298, // La Liga
  686337048, // Bundesliga
  3405541143, // Serie A
  3614399544, // Ligue 1
] as const;

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
    .order("fixture_id", { ascending: false })
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
    .order("fixture_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (res.error) return { found: false, leagueId: null, rating: ELO_INITIAL_RATING };
  return parseHistoryRow(res.data, teamId);
}

/**
 * Snapshot atual é o caminho barato para previsões presentes/futuras. Ele só é
 * utilizável quando foi calculado antes do prediction_at; runs históricas caem
 * no ledger point-in-time abaixo.
 */
async function leagueRatingAtCurrentSnapshot(leagueId: number, predictionAt: string): Promise<LeagueAt> {
  const res = await db
    .from("elo_league_ratings")
    .select("league_id,rating,evidence_matches,updated_at")
    .eq("model_version", LEAGUE_ELO_MODEL_VERSION)
    .eq("league_id", leagueId)
    .lt("updated_at", predictionAt)
    .limit(1)
    .maybeSingle();

  if (res.error || !res.data || typeof res.data !== "object") {
    return { found: false, leagueId: null, rating: ELO_INITIAL_RATING, evidenceMatches: 0 };
  }
  const row = res.data as LeagueRatingRow;
  const rating = Number(row.rating);
  const id = Number(row.league_id);
  const evidenceMatches = Number(row.evidence_matches ?? 0);
  return {
    found:
      Number.isFinite(rating) &&
      Number.isFinite(id) &&
      Number.isFinite(evidenceMatches) &&
      evidenceMatches >= MIN_LEAGUE_EVIDENCE_MATCHES,
    leagueId: Number.isFinite(id) ? id : null,
    rating: Number.isFinite(rating) ? rating : ELO_INITIAL_RATING,
    evidenceMatches: Number.isFinite(evidenceMatches) ? evidenceMatches : 0,
  };
}

async function leagueConfigById(leagueId: number): Promise<LeagueConfigRow | null> {
  const res = await db
    .from("elo_target_leagues")
    .select("league_id,league_key,prior_rating,parent_league_key,focus_role,division_level")
    .eq("league_id", leagueId)
    .limit(1)
    .maybeSingle();
  return !res.error && res.data && typeof res.data === "object"
    ? (res.data as LeagueConfigRow)
    : null;
}

async function leagueConfigByKey(leagueKey: string): Promise<LeagueConfigRow | null> {
  const res = await db
    .from("elo_target_leagues")
    .select("league_id,league_key,prior_rating,parent_league_key,focus_role,division_level")
    .eq("league_key", leagueKey)
    .limit(1)
    .maybeSingle();
  return !res.error && res.data && typeof res.data === "object"
    ? (res.data as LeagueConfigRow)
    : null;
}

function ratingAfterForLeague(row: LeagueHistoryRow, leagueId: number): number | null {
  const isHome = Number(row.home_league_id) === leagueId;
  const isAway = Number(row.away_league_id) === leagueId;
  if (!isHome && !isAway) return null;
  const rating = Number(isHome ? row.home_league_rating_after : row.away_league_rating_after);
  return Number.isFinite(rating) ? rating : null;
}

/**
 * Reconstrói o rating bruto de uma liga no instante da previsão usando somente
 * fixtures interligas com kickoff anterior. A ordenação replica
 * elo_rebuild_league_ratings(): kickoff_at, competition_id, fixture_id.
 */
async function rawHistoricalLeagueRatingAt(
  leagueId: number,
  predictionAt: string,
): Promise<HistoricalLeagueBase> {
  const [config, latest, evidence] = await Promise.all([
    leagueConfigById(leagueId),
    db
      .from("elo_league_fixture_history")
      .select("competition_id,fixture_id,kickoff_at,home_league_id,away_league_id,home_league_rating_after,away_league_rating_after")
      .eq("model_version", LEAGUE_ELO_MODEL_VERSION)
      .lt("kickoff_at", predictionAt)
      .or(`home_league_id.eq.${leagueId},away_league_id.eq.${leagueId}`)
      .order("kickoff_at", { ascending: false })
      .order("competition_id", { ascending: false })
      .order("fixture_id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("elo_league_fixture_history")
      .select("fixture_id", { count: "exact", head: true })
      .eq("model_version", LEAGUE_ELO_MODEL_VERSION)
      .lt("kickoff_at", predictionAt)
      .or(`home_league_id.eq.${leagueId},away_league_id.eq.${leagueId}`),
  ]);

  const evidenceMatches = evidence.error ? 0 : Number(evidence.count ?? 0);
  const prior = Number(config?.prior_rating ?? ELO_INITIAL_RATING);
  const latestRating = !latest.error && latest.data && typeof latest.data === "object"
    ? ratingAfterForLeague(latest.data as LeagueHistoryRow, leagueId)
    : null;
  const rating = latestRating ?? (Number.isFinite(prior) ? prior : ELO_INITIAL_RATING);

  return {
    found:
      config !== null &&
      Number.isFinite(rating) &&
      Number.isFinite(evidenceMatches) &&
      evidenceMatches >= MIN_LEAGUE_EVIDENCE_MATCHES,
    leagueId: config ? Number(config.league_id) : null,
    rating,
    evidenceMatches: Number.isFinite(evidenceMatches) ? evidenceMatches : 0,
    config,
  };
}

/**
 * O snapshot histórico precisa reproduzir também as restrições estruturais
 * aplicadas no fim do rebuild: divisão inferior <= pai - 70 e divisões CORE de
 * nível 2+ <= menor Big Five - 25.
 */
async function leagueRatingAtHistory(leagueId: number, predictionAt: string): Promise<LeagueAt> {
  const base = await rawHistoricalLeagueRatingAt(leagueId, predictionAt);
  if (!base.config || base.leagueId === null) return base;

  let rating = base.rating;
  const divisionLevel = Number(base.config.division_level);

  if (base.config.parent_league_key) {
    const parentConfig = await leagueConfigByKey(base.config.parent_league_key);
    if (parentConfig) {
      const parent = await rawHistoricalLeagueRatingAt(Number(parentConfig.league_id), predictionAt);
      rating = Math.min(rating, parent.rating - 70);
    }
  }

  if (base.config.focus_role === "CORE" && Number.isFinite(divisionLevel) && divisionLevel >= 2) {
    const bigFive = await Promise.all(
      BIG_FIVE_LEAGUE_IDS.map((id) => rawHistoricalLeagueRatingAt(id, predictionAt)),
    );
    const bigFiveRatings = bigFive.map((row) => row.rating).filter(Number.isFinite);
    if (bigFiveRatings.length === BIG_FIVE_LEAGUE_IDS.length) {
      rating = Math.min(rating, Math.min(...bigFiveRatings) - 25);
    }
  }

  return {
    found: base.found && Number.isFinite(rating),
    leagueId: base.leagueId,
    rating: Number.isFinite(rating) ? rating : base.rating,
    evidenceMatches: base.evidenceMatches,
  };
}

/**
 * O rating de liga é point-in-time. Para previsão atual usamos o snapshot já
 * materializado; para reprocessamento histórico reconstruímos a partir do
 * ledger interligas, sem olhar qualquer fixture posterior ao prediction_at.
 */
async function leagueRatingAt(leagueId: number, predictionAt: string): Promise<LeagueAt> {
  const current = await leagueRatingAtCurrentSnapshot(leagueId, predictionAt);
  if (current.leagueId !== null) return current;
  return leagueRatingAtHistory(leagueId, predictionAt);
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
      leagueRatingAt(home.leagueId, input.predictionAt),
      leagueRatingAt(away.leagueId, input.predictionAt),
    ]);

    if (!homeLeagueRating.found || !awayLeagueRating.found) {
      return {
        applied: false as const,
        modelVersionSuffix: null,
        lambdaHome: input.lambdaHome,
        lambdaAway: input.lambdaAway,
        homeRating: home.rating,
        awayRating: away.rating,
        reason: `Elo de liga sem evidência interligas suficiente no prediction_at (mínimo ${MIN_LEAGUE_EVIDENCE_MATCHES}; casa ${homeLeagueRating.evidenceMatches}, fora ${awayLeagueRating.evidenceMatches}).`,
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
    homeLeagueEvidenceMatches: homeLeagueRating?.evidenceMatches ?? null,
    awayLeagueEvidenceMatches: awayLeagueRating?.evidenceMatches ?? null,
    homeGlobalRating: homeEffective,
    awayGlobalRating: awayEffective,
    eloScope: scope,
    eloDelta: adjusted.eloDelta,
    baseHomeShare: adjusted.baseHomeShare,
    adjustedHomeShare: adjusted.adjustedHomeShare,
    reason: null,
  };
}
