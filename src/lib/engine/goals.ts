// MODELO EXPERIMENTAL DE GOLS — goals-baseline-v2-recency.
// Determinístico e sem odds como feature. Usa apenas placares históricos pré-prediction_at.
// Implementa ataque/defesa por mando com shrinkage para a média da competição,
// ponderação temporal por meia-vida e distribuição de gols por Poisson independente.

import { poissonDistribution } from "./corners";

export const GOALS_MODEL_VERSION = "goals-baseline-v2-recency";
export const GOALS_SHRINKAGE_K = 5;
export const GOALS_RECENCY_HALF_LIFE_DAYS = 120;

export interface GoalMatchRow {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
}

export interface GoalsModelParams {
  modelVersion: string;
  leagueMeanHome: Record<string, number>;
  leagueMeanAway: Record<string, number>;
  globalMeanHome: number;
  globalMeanAway: number;
  attack: Record<string, { home: number; away: number }>;
  defense: Record<string, { home: number; away: number }>;
  // Audit-only Stage 8 counterfactual. These pooled fields intentionally remove venue
  // information while preserving the same training rows, shrinkage and recency weights.
  leagueMeanNeutral: Record<string, number>;
  globalMeanNeutral: number;
  neutralAttack: Record<string, number>;
  neutralDefense: Record<string, number>;
  sampleSizes: Record<string, number>;
  trainMatches: number;
  referenceDate: string;
}

interface WeightedAgg {
  sum: number;
  weight: number;
  n: number;
}

function teamKey(league: string, team: string) {
  return `${league}::${team}`;
}

function dayDiff(referenceDate: string, date: string): number {
  const ref = Date.parse(`${referenceDate.slice(0, 10)}T00:00:00Z`);
  const d = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ref) || !Number.isFinite(d)) return 0;
  return Math.max(0, (ref - d) / 86400_000);
}

export function recencyWeight(ageDays: number, halfLifeDays = GOALS_RECENCY_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return 0.5 ** (ageDays / halfLifeDays);
}

function weightedMean(rows: Array<{ value: number; weight: number }>) {
  const den = rows.reduce((a, r) => a + r.weight, 0);
  return den > 0 ? rows.reduce((a, r) => a + r.value * r.weight, 0) / den : 0;
}

function factor(agg: WeightedAgg | undefined, base: number): number {
  if (!agg || agg.weight <= 0 || base <= 0) return 1;
  const priorWeight = GOALS_SHRINKAGE_K;
  const observed = agg.sum;
  const expected = agg.weight * base;
  return (observed + priorWeight * base) / (expected + priorWeight * base);
}

export function fitGoalsBaseline(train: GoalMatchRow[], referenceDate?: string): GoalsModelParams {
  const inferredReference = referenceDate ?? [...train].sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? new Date(0).toISOString().slice(0, 10);
  const leagueHome = new Map<string, WeightedAgg>();
  const leagueAway = new Map<string, WeightedAgg>();
  const leagueNeutral = new Map<string, WeightedAgg>();
  const forHome = new Map<string, WeightedAgg>();
  const forAway = new Map<string, WeightedAgg>();
  const agHome = new Map<string, WeightedAgg>();
  const agAway = new Map<string, WeightedAgg>();
  const forNeutral = new Map<string, WeightedAgg>();
  const agNeutral = new Map<string, WeightedAgg>();

  const bump = (m: Map<string, WeightedAgg>, k: string, v: number, weight: number) => {
    const cur = m.get(k) ?? { sum: 0, weight: 0, n: 0 };
    cur.sum += v * weight;
    cur.weight += weight;
    cur.n += 1;
    m.set(k, cur);
  };

  const weightedRows = train.map((row) => ({ row, weight: recencyWeight(dayDiff(inferredReference, row.date)) }));
  for (const { row, weight } of weightedRows) {
    const homeKey = teamKey(row.league, row.homeTeam);
    const awayKey = teamKey(row.league, row.awayTeam);
    bump(leagueHome, row.league, row.homeGoals, weight);
    bump(leagueAway, row.league, row.awayGoals, weight);
    bump(leagueNeutral, row.league, row.homeGoals, weight);
    bump(leagueNeutral, row.league, row.awayGoals, weight);
    bump(forHome, homeKey, row.homeGoals, weight);
    bump(agHome, awayKey, row.homeGoals, weight);
    bump(forAway, awayKey, row.awayGoals, weight);
    bump(agAway, homeKey, row.awayGoals, weight);
    bump(forNeutral, homeKey, row.homeGoals, weight);
    bump(forNeutral, awayKey, row.awayGoals, weight);
    bump(agNeutral, homeKey, row.awayGoals, weight);
    bump(agNeutral, awayKey, row.homeGoals, weight);
  }

  const globalMeanHome = weightedMean(weightedRows.map(({ row, weight }) => ({ value: row.homeGoals, weight })));
  const globalMeanAway = weightedMean(weightedRows.map(({ row, weight }) => ({ value: row.awayGoals, weight })));
  const globalMeanNeutral = weightedMean(weightedRows.flatMap(({ row, weight }) => [
    { value: row.homeGoals, weight },
    { value: row.awayGoals, weight },
  ]));
  const leagueMeanHome: Record<string, number> = {};
  const leagueMeanAway: Record<string, number> = {};
  const leagueMeanNeutral: Record<string, number> = {};
  for (const [league, agg] of leagueHome) leagueMeanHome[league] = agg.weight > 0 ? agg.sum / agg.weight : globalMeanHome;
  for (const [league, agg] of leagueAway) leagueMeanAway[league] = agg.weight > 0 ? agg.sum / agg.weight : globalMeanAway;
  for (const [league, agg] of leagueNeutral) leagueMeanNeutral[league] = agg.weight > 0 ? agg.sum / agg.weight : globalMeanNeutral;

  const attack: GoalsModelParams["attack"] = {};
  const defense: GoalsModelParams["defense"] = {};
  const neutralAttack: Record<string, number> = {};
  const neutralDefense: Record<string, number> = {};
  const sampleSizes: Record<string, number> = {};
  const keys = new Set([...forHome.keys(), ...forAway.keys(), ...agHome.keys(), ...agAway.keys()]);

  for (const key of keys) {
    const league = key.split("::")[0] ?? "";
    const baseHome = leagueMeanHome[league] ?? globalMeanHome;
    const baseAway = leagueMeanAway[league] ?? globalMeanAway;
    const baseNeutral = leagueMeanNeutral[league] ?? globalMeanNeutral;
    attack[key] = {
      home: factor(forHome.get(key), baseHome),
      away: factor(forAway.get(key), baseAway),
    };
    defense[key] = {
      home: factor(agAway.get(key), baseAway),
      away: factor(agHome.get(key), baseHome),
    };
    neutralAttack[key] = factor(forNeutral.get(key), baseNeutral);
    neutralDefense[key] = factor(agNeutral.get(key), baseNeutral);
    sampleSizes[key] = (forHome.get(key)?.n ?? 0) + (forAway.get(key)?.n ?? 0);
  }

  return {
    modelVersion: GOALS_MODEL_VERSION,
    leagueMeanHome,
    leagueMeanAway,
    globalMeanHome,
    globalMeanAway,
    attack,
    defense,
    leagueMeanNeutral,
    globalMeanNeutral,
    neutralAttack,
    neutralDefense,
    sampleSizes,
    trainMatches: train.length,
    referenceDate: inferredReference,
  };
}

export interface GoalsPrediction {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  sampleSize: number;
}

export function predictGoals(
  params: GoalsModelParams,
  input: { league: string; homeTeam: string; awayTeam: string },
): GoalsPrediction {
  const kh = teamKey(input.league, input.homeTeam);
  const ka = teamKey(input.league, input.awayTeam);
  const baseHome = params.leagueMeanHome[input.league] ?? params.globalMeanHome;
  const baseAway = params.leagueMeanAway[input.league] ?? params.globalMeanAway;
  const lambdaHome = Math.max(0.05, baseHome * (params.attack[kh]?.home ?? 1) * (params.defense[ka]?.away ?? 1));
  const lambdaAway = Math.max(0.05, baseAway * (params.attack[ka]?.away ?? 1) * (params.defense[kh]?.home ?? 1));
  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
    sampleSize: Math.min(params.sampleSizes[kh] ?? 0, params.sampleSizes[ka] ?? 0),
  };
}

// Stage 8 counterfactual only: same teams, history, recency and shrinkage as the incumbent,
// but every goal observation is pooled across venues. No home/away mean or venue-specific
// team factor is allowed to influence the forecast.
export function predictGoalsNeutralVenue(
  params: GoalsModelParams,
  input: { league: string; homeTeam: string; awayTeam: string },
): GoalsPrediction {
  const kh = teamKey(input.league, input.homeTeam);
  const ka = teamKey(input.league, input.awayTeam);
  const base = params.leagueMeanNeutral[input.league] ?? params.globalMeanNeutral;
  const lambdaHome = Math.max(0.05, base * (params.neutralAttack[kh] ?? 1) * (params.neutralDefense[ka] ?? 1));
  const lambdaAway = Math.max(0.05, base * (params.neutralAttack[ka] ?? 1) * (params.neutralDefense[kh] ?? 1));
  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal: lambdaHome + lambdaAway,
    sampleSize: Math.min(params.sampleSizes[kh] ?? 0, params.sampleSizes[ka] ?? 0),
  };
}

export interface MatchOutcomeProbabilities {
  home: number;
  draw: number;
  away: number;
  bttsYes: number;
  bttsNo: number;
}

export function goalOutcomeProbabilities(lambdaHome: number, lambdaAway: number): MatchOutcomeProbabilities {
  const homeDist = poissonDistribution(lambdaHome, 15);
  const awayDist = poissonDistribution(lambdaAway, 15);
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  let total = 0;

  for (const [hg, ph] of homeDist) {
    for (const [ag, pa] of awayDist) {
      const p = ph * pa;
      total += p;
      if (hg > ag) home += p;
      else if (hg === ag) draw += p;
      else away += p;
      if (hg > 0 && ag > 0) bttsYes += p;
    }
  }

  if (total > 0) {
    home /= total;
    draw /= total;
    away /= total;
    bttsYes /= total;
  }
  const bttsNo = Math.max(0, 1 - bttsYes);
  return { home, draw, away, bttsYes, bttsNo };
}
