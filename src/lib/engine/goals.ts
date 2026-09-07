// MODELO EXPERIMENTAL DE GOLS — goals-baseline-v1.
// Determinístico e sem odds como feature. Usa apenas placares históricos pré-prediction_at.
// Implementa ataque/defesa por mando com shrinkage para a média da competição e
// distribuição de gols por Poisson independente para mandante/visitante.

import { poissonDistribution } from "./corners";

export const GOALS_MODEL_VERSION = "goals-baseline-v1";
export const GOALS_SHRINKAGE_K = 5;

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
  sampleSizes: Record<string, number>;
  trainMatches: number;
}

function teamKey(league: string, team: string) {
  return `${league}::${team}`;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function factor(agg: { sum: number; n: number } | undefined, base: number): number {
  if (!agg || agg.n === 0 || base <= 0) return 1;
  const observed = agg.sum;
  const expected = agg.n * base;
  return (observed + GOALS_SHRINKAGE_K * base) / (expected + GOALS_SHRINKAGE_K * base);
}

export function fitGoalsBaseline(train: GoalMatchRow[]): GoalsModelParams {
  const leagueHome = new Map<string, { sum: number; n: number }>();
  const leagueAway = new Map<string, { sum: number; n: number }>();
  const forHome = new Map<string, { sum: number; n: number }>();
  const forAway = new Map<string, { sum: number; n: number }>();
  const agHome = new Map<string, { sum: number; n: number }>();
  const agAway = new Map<string, { sum: number; n: number }>();

  const bump = (m: Map<string, { sum: number; n: number }>, k: string, v: number) => {
    const cur = m.get(k) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    m.set(k, cur);
  };

  for (const row of train) {
    bump(leagueHome, row.league, row.homeGoals);
    bump(leagueAway, row.league, row.awayGoals);
    bump(forHome, teamKey(row.league, row.homeTeam), row.homeGoals);
    bump(agHome, teamKey(row.league, row.awayTeam), row.homeGoals);
    bump(forAway, teamKey(row.league, row.awayTeam), row.awayGoals);
    bump(agAway, teamKey(row.league, row.homeTeam), row.awayGoals);
  }

  const globalMeanHome = mean(train.map((r) => r.homeGoals));
  const globalMeanAway = mean(train.map((r) => r.awayGoals));
  const leagueMeanHome: Record<string, number> = {};
  const leagueMeanAway: Record<string, number> = {};
  for (const [league, agg] of leagueHome) leagueMeanHome[league] = agg.sum / agg.n;
  for (const [league, agg] of leagueAway) leagueMeanAway[league] = agg.sum / agg.n;

  const attack: GoalsModelParams["attack"] = {};
  const defense: GoalsModelParams["defense"] = {};
  const sampleSizes: Record<string, number> = {};
  const keys = new Set([...forHome.keys(), ...forAway.keys(), ...agHome.keys(), ...agAway.keys()]);

  for (const key of keys) {
    const league = key.split("::")[0] ?? "";
    const baseHome = leagueMeanHome[league] ?? globalMeanHome;
    const baseAway = leagueMeanAway[league] ?? globalMeanAway;
    attack[key] = {
      home: factor(forHome.get(key), baseHome),
      away: factor(forAway.get(key), baseAway),
    };
    defense[key] = {
      home: factor(agAway.get(key), baseAway),
      away: factor(agHome.get(key), baseHome),
    };
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
    sampleSizes,
    trainMatches: train.length,
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
  const lambdaHome = Math.max(
    0.05,
    baseHome * (params.attack[kh]?.home ?? 1) * (params.defense[ka]?.away ?? 1),
  );
  const lambdaAway = Math.max(
    0.05,
    baseAway * (params.attack[ka]?.away ?? 1) * (params.defense[kh]?.home ?? 1),
  );
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

export function goalOutcomeProbabilities(
  lambdaHome: number,
  lambdaAway: number,
): MatchOutcomeProbabilities {
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
