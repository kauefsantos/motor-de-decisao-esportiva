import { poissonDistribution } from "./corners";
import { goalOutcomeProbabilities } from "./goals";
import { asianFairOdd, asianOutcomes, canonicalLine, pProfit } from "./settlement";
import type { AsianOutcomeProbabilities, ContractType } from "./types";

export type ExperimentalMarketFamily =
  | "CORNERS"
  | "GOALS"
  | "TEAM_GOALS"
  | "1X2"
  | "DOUBLE_CHANCE"
  | "BTTS";

export interface GoalMarketProjection {
  family: Exclude<ExperimentalMarketFamily, "CORNERS">;
  market: "goals_match_total" | "team_goals_total" | "1x2" | "double_chance" | "btts";
  marketLabel: string;
  participant: string | null;
  side: string;
  lineRaw: string | null;
  lineCanonical: number | null;
  contractType: ContractType;
  probability: number;
  fairOdd: number | null;
  outcomeDistribution: AsianOutcomeProbabilities | null;
}

function binary(
  family: GoalMarketProjection["family"],
  market: GoalMarketProjection["market"],
  marketLabel: string,
  side: string,
  probability: number,
): GoalMarketProjection {
  return {
    family,
    market,
    marketLabel,
    participant: null,
    side,
    lineRaw: null,
    lineCanonical: null,
    contractType: "BINARY",
    probability,
    fairOdd: probability > 0 ? 1 / probability : null,
    outcomeDistribution: null,
  };
}

function asian(
  family: "GOALS" | "TEAM_GOALS",
  market: "goals_match_total" | "team_goals_total",
  marketLabel: string,
  participant: string | null,
  side: "OVER" | "UNDER",
  lineRaw: string,
  distribution: Map<number, number>,
): GoalMarketProjection {
  const lineCanonical = canonicalLine(lineRaw);
  const outcomeDistribution = asianOutcomes(distribution, lineCanonical, side);
  return {
    family,
    market,
    marketLabel,
    participant,
    side,
    lineRaw,
    lineCanonical,
    contractType: "ASIAN",
    probability: pProfit(outcomeDistribution),
    fairOdd: asianFairOdd(outcomeDistribution),
    outcomeDistribution,
  };
}

/**
 * Mercado derivado unicamente da distribuição de gols do goals-baseline-v1.
 * Não usa odds como feature e não cria uma segunda estimativa probabilística.
 */
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

  for (const lineRaw of ["1.5", "2.5", "3.5"]) {
    for (const side of ["OVER", "UNDER"] as const) {
      projections.push(
        asian(
          "GOALS",
          "goals_match_total",
          `Gols da partida ${side === "OVER" ? "Mais de" : "Menos de"} ${lineRaw}`,
          null,
          side,
          lineRaw,
          totalDist,
        ),
      );
    }
  }

  for (const [participant, dist] of [
    [input.homeTeam, homeDist],
    [input.awayTeam, awayDist],
  ] as const) {
    for (const lineRaw of ["0.5", "1.5"]) {
      for (const side of ["OVER", "UNDER"] as const) {
        projections.push(
          asian(
            "TEAM_GOALS",
            "team_goals_total",
            `Gols ${participant} ${side === "OVER" ? "Mais de" : "Menos de"} ${lineRaw}`,
            participant,
            side,
            lineRaw,
            dist,
          ),
        );
      }
    }
  }

  return projections;
}

export function familyForMarket(market: string): ExperimentalMarketFamily {
  if (market.startsWith("corners_")) return "CORNERS";
  if (market === "goals_match_total") return "GOALS";
  if (market === "team_goals_total") return "TEAM_GOALS";
  if (market === "1x2") return "1X2";
  if (market === "double_chance") return "DOUBLE_CHANCE";
  if (market === "btts") return "BTTS";
  return "GOALS";
}
