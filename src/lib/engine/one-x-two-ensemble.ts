import { ELO_INITIAL_RATING, updateElo } from "./elo";
import type { GoalMatchRow } from "./goals";

export const ONE_X_TWO_ENSEMBLE_WEIGHT = 0.4;
export const ONE_X_TWO_HOME_ADVANTAGE = 60;
export const ONE_X_TWO_ENSEMBLE_MODEL_VERSION = "1x2-uncertainty-linear-v1-w040";

const DAVIDSON_MIN_NU = 1e-4;
const DAVIDSON_MAX_NU = 4;
const DAVIDSON_BISECTION_STEPS = 32;
const EPS = 1e-12;

export type OneXTwoProbabilities = {
  HOME: number;
  DRAW: number;
  AWAY: number;
};

type DavidsonTrainingTerm = {
  homeRating: number;
  awayRating: number;
  homeGoals: number;
  awayGoals: number;
};

function normalize(probabilities: OneXTwoProbabilities): OneXTwoProbabilities {
  const home = Math.max(EPS, probabilities.HOME);
  const draw = Math.max(EPS, probabilities.DRAW);
  const away = Math.max(EPS, probabilities.AWAY);
  const total = home + draw + away;
  return { HOME: home / total, DRAW: draw / total, AWAY: away / total };
}

export function oneXTwoUncertainty(probabilities: OneXTwoProbabilities): number {
  const sorted = [probabilities.HOME, probabilities.DRAW, probabilities.AWAY].sort((a, b) => b - a);
  const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  return Math.max(0, Math.min(1, 1 - margin));
}

/**
 * Stage 8 winner used for the governed runtime candidate.
 * The auxiliary Elo share is 40% only at maximum uncertainty; confident base
 * forecasts retain more of the goals+Elo distribution.
 */
export function uncertaintyLinearOneXTwo(
  base: OneXTwoProbabilities,
  pureElo: OneXTwoProbabilities,
  weight = ONE_X_TWO_ENSEMBLE_WEIGHT,
): OneXTwoProbabilities {
  const effectiveWeight = Math.max(0, Math.min(1, weight)) * oneXTwoUncertainty(base);
  return normalize({
    HOME: base.HOME * (1 - effectiveWeight) + pureElo.HOME * effectiveWeight,
    DRAW: base.DRAW * (1 - effectiveWeight) + pureElo.DRAW * effectiveWeight,
    AWAY: base.AWAY * (1 - effectiveWeight) + pureElo.AWAY * effectiveWeight,
  });
}

function davidsonTerms(homeRating: number, awayRating: number, homeAdvantage: number) {
  const homeStrength = 10 ** ((homeRating + homeAdvantage - awayRating) / 400);
  const drawBase = Math.sqrt(homeStrength);
  return { homeStrength, drawBase };
}

export function davidsonOneXTwoProbabilities(
  homeRating: number,
  awayRating: number,
  nu: number,
  homeAdvantage = ONE_X_TWO_HOME_ADVANTAGE,
): OneXTwoProbabilities {
  const safeNu = Math.max(DAVIDSON_MIN_NU, Math.min(DAVIDSON_MAX_NU, nu));
  const { homeStrength, drawBase } = davidsonTerms(homeRating, awayRating, homeAdvantage);
  const drawStrength = safeNu * drawBase;
  const denominator = homeStrength + 1 + drawStrength;
  return normalize({
    HOME: homeStrength / denominator,
    DRAW: drawStrength / denominator,
    AWAY: 1 / denominator,
  });
}

function davidsonDerivative(
  nu: number,
  training: readonly DavidsonTrainingTerm[],
  homeAdvantage: number,
): number {
  let draws = 0;
  let denominatorTerm = 0;
  for (const row of training) {
    const { homeStrength, drawBase } = davidsonTerms(row.homeRating, row.awayRating, homeAdvantage);
    if (row.homeGoals === row.awayGoals) draws += 1;
    denominatorTerm += drawBase / (homeStrength + 1 + nu * drawBase);
  }
  if (training.length === 0) return 0;
  return draws / nu - denominatorTerm;
}

export function fitDavidsonNu(
  training: readonly DavidsonTrainingTerm[],
  homeAdvantage = ONE_X_TWO_HOME_ADVANTAGE,
): number {
  if (training.length === 0) return DAVIDSON_MIN_NU;
  let low = DAVIDSON_MIN_NU;
  let high = DAVIDSON_MAX_NU;
  if (davidsonDerivative(low, training, homeAdvantage) <= 0) return low;
  if (davidsonDerivative(high, training, homeAdvantage) >= 0) return high;
  for (let step = 0; step < DAVIDSON_BISECTION_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (davidsonDerivative(mid, training, homeAdvantage) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function ratingKey(league: string, team: string): string {
  return `${league}::${team}`;
}

/**
 * Replays fixed +60 Elo chronologically from the available pre-prediction goal
 * history. Same-date matches share the pre-date snapshot, matching Stage 8's
 * conservative no-same-day-leakage rule. Davidson nu is fitted only on the
 * requested draw window while Elo ratings may use all available prior history.
 */
export function pureElo60DavidsonFromGoalHistory(input: {
  rows: readonly GoalMatchRow[];
  league: string;
  homeTeam: string;
  awayTeam: string;
  drawWindowStart: string;
}): { probabilities: OneXTwoProbabilities; drawCoefficient: number; trainingMatches: number } | null {
  const rows = input.rows
    .filter((row) => row.league === input.league)
    .sort((a, b) => a.date.localeCompare(b.date) || a.homeTeam.localeCompare(b.homeTeam) || a.awayTeam.localeCompare(b.awayTeam));
  if (rows.length < 3) return null;

  const ratings = new Map<string, number>();
  const terms: DavidsonTrainingTerm[] = [];
  let index = 0;
  while (index < rows.length) {
    const date = rows[index]?.date;
    if (!date) break;
    const dayRows: GoalMatchRow[] = [];
    while (index < rows.length && rows[index]?.date === date) {
      const row = rows[index];
      if (row) dayRows.push(row);
      index += 1;
    }

    const before = dayRows.map((row) => ({
      row,
      homeRating: ratings.get(ratingKey(row.league, row.homeTeam)) ?? ELO_INITIAL_RATING,
      awayRating: ratings.get(ratingKey(row.league, row.awayTeam)) ?? ELO_INITIAL_RATING,
    }));

    for (const snapshot of before) {
      if (snapshot.row.date >= input.drawWindowStart) {
        terms.push({
          homeRating: snapshot.homeRating,
          awayRating: snapshot.awayRating,
          homeGoals: snapshot.row.homeGoals,
          awayGoals: snapshot.row.awayGoals,
        });
      }
    }

    const dayDeltas = new Map<string, number>();
    for (const snapshot of before) {
      const updated = updateElo({
        homeRating: snapshot.homeRating,
        awayRating: snapshot.awayRating,
        homeGoals: snapshot.row.homeGoals,
        awayGoals: snapshot.row.awayGoals,
        homeAdvantage: ONE_X_TWO_HOME_ADVANTAGE,
      });
      const homeKey = ratingKey(snapshot.row.league, snapshot.row.homeTeam);
      const awayKey = ratingKey(snapshot.row.league, snapshot.row.awayTeam);
      dayDeltas.set(homeKey, (dayDeltas.get(homeKey) ?? 0) + updated.delta);
      dayDeltas.set(awayKey, (dayDeltas.get(awayKey) ?? 0) - updated.delta);
    }
    for (const [key, delta] of dayDeltas) {
      ratings.set(key, (ratings.get(key) ?? ELO_INITIAL_RATING) + delta);
    }
  }

  if (terms.length < 3) return null;
  const homeKey = ratingKey(input.league, input.homeTeam);
  const awayKey = ratingKey(input.league, input.awayTeam);
  if (!ratings.has(homeKey) || !ratings.has(awayKey)) return null;

  const drawCoefficient = fitDavidsonNu(terms);
  return {
    probabilities: davidsonOneXTwoProbabilities(
      ratings.get(homeKey) ?? ELO_INITIAL_RATING,
      ratings.get(awayKey) ?? ELO_INITIAL_RATING,
      drawCoefficient,
    ),
    drawCoefficient,
    trainingMatches: terms.length,
  };
}
