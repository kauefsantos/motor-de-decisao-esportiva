import { poissonDistribution } from "./corners";
import { goalOutcomeProbabilities } from "./goals";
import type { ContractType } from "./types";

export type ExperimentalMarketFamily =
  | "CORNERS"
  | "CARDS"
  | "GOALS"
  | "TEAM_GOALS"
  | "1X2"
  | "DOUBLE_CHANCE"
  | "BTTS";

export const GOAL_OVER_LIMITS = [0, 1, 2, 3] as const;
export const GOAL_UNDER_LIMITS = [4, 3, 2, 1] as const;

export interface GoalMarketProjection {
  family: Exclude<ExperimentalMarketFamily, "CORNERS" | "CARDS">;
  market: "goals_match_total" | "team_goals_total" | "1x2" | "double_chance" | "btts";
  marketLabel: string;
  participant: string | null;
  side: string;
  lineRaw: string | null;
  lineCanonical: number | null;
  contractType: ContractType;
  probability: number;
  fairOdd: number | null;
  outcomeDistribution: null;
}

export function absoluteCountProbability(
  distribution: Map<number, number>,
  limit: number,
  side: "OVER" | "UNDER",
): number {
  let probability = 0;
  for (const [count, p] of distribution) {
    if (side === "OVER" ? count > limit : count < limit) probability += p;
  }
  return Math.min(1, Math.max(0, probability));
}

export function bookmakerLineForAbsoluteLimit(side: string | null, limit: number | null): number | null {
  if (limit === null) return null;
  if (side === "OVER") return limit + 0.5;
  if (side === "UNDER") return limit - 0.5;
  return limit;
}

function binary(
  family: GoalMarketProjection["family"],
  market: GoalMarketProjection["market"],
  marketLabel: string,
  side: string,
  probability: number,
  participant: string | null = null,
  limit: number | null = null,
): GoalMarketProjection {
  return {
    family,
    market,
    marketLabel,
    participant,
    side,
    lineRaw: limit === null ? null : String(limit),
    lineCanonical: limit,
    contractType: "BINARY",
    probability,
    fairOdd: probability > 0 ? 1 / probability : null,
    outcomeDistribution: null,
  };
}

export function buildGoalMarketProjections(input: {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
}): GoalMarketProjection[] {
  const outcomes = goalOutcomeProbabilities(input.lambdaHome, input.lambdaAway);
  const totalDist = poissonDistribution(input.lambdaHome + input.lambdaAway, 15);
  const homeDist = poissonDistribution(input.lambdaHome, 15);
  const awayDist = poissonDistribution(input.lambdaAway, 15);
  const projections: GoalMarketProjection[] = [];

  projections.push(
    binary("1X2", "1x2", `Vitória ${input.homeTeam}`, "HOME", outcomes.home),
    binary("1X2", "1x2", "Empate", "DRAW", outcomes.draw),
    binary("1X2", "1x2", `Vitória ${input.awayTeam}`, "AWAY", outcomes.away),
    binary("BTTS", "btts", "Ambas marcam: Sim", "YES", outcomes.bttsYes),
    binary("BTTS", "btts", "Ambas marcam: Não", "NO", outcomes.bttsNo),
    binary("DOUBLE_CHANCE", "double_chance", `${input.homeTeam} ou Empate (1X)`, "1X", outcomes.home + outcomes.draw),
    binary("DOUBLE_CHANCE", "double_chance", `Empate ou ${input.awayTeam} (X2)`, "X2", outcomes.draw + outcomes.away),
    binary("DOUBLE_CHANCE", "double_chance", `${input.homeTeam} ou ${input.awayTeam} (12)`, "12", outcomes.home + outcomes.away),
  );

  for (const limit of GOAL_OVER_LIMITS) {
    const probability = absoluteCountProbability(totalDist, limit, "OVER");
    projections.push(binary("GOALS", "goals_match_total", `Gols da partida Mais de ${limit}`, "OVER", probability, null, limit));
  }
  for (const limit of GOAL_UNDER_LIMITS) {
    const probability = absoluteCountProbability(totalDist, limit, "UNDER");
    projections.push(binary("GOALS", "goals_match_total", `Gols da partida Menos de ${limit}`, "UNDER", probability, null, limit));
  }

  for (const [participant, dist] of [[input.homeTeam, homeDist], [input.awayTeam, awayDist]] as const) {
    for (const limit of GOAL_OVER_LIMITS) {
      const probability = absoluteCountProbability(dist, limit, "OVER");
      projections.push(binary("TEAM_GOALS", "team_goals_total", `Gols ${participant} Mais de ${limit}`, "OVER", probability, participant, limit));
    }
    for (const limit of GOAL_UNDER_LIMITS) {
      const probability = absoluteCountProbability(dist, limit, "UNDER");
      projections.push(binary("TEAM_GOALS", "team_goals_total", `Gols ${participant} Menos de ${limit}`, "UNDER", probability, participant, limit));
    }
  }

  return projections;
}

export function familyForMarket(market: string): ExperimentalMarketFamily {
  if (market.startsWith("corners_")) return "CORNERS";
  if (market.startsWith("cards_")) return "CARDS";
  if (market === "goals_match_total") return "GOALS";
  if (market === "team_goals_total") return "TEAM_GOALS";
  if (market === "1x2") return "1X2";
  if (market === "double_chance") return "DOUBLE_CHANCE";
  if (market === "btts") return "BTTS";
  return "GOALS";
}
