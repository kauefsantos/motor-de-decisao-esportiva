import { poissonDistribution } from "./corners";
import { goalOutcomeProbabilities } from "./goals";
import type { OneXTwoProbabilities } from "./one-x-two-ensemble";
import {
  formatBookmakerLine,
  quoteAnchorFor,
} from "./market-policy";
import type { ContractType } from "./types";

export type ExperimentalMarketFamily =
  | "CORNERS"
  | "CARDS"
  | "GOALS"
  | "TEAM_GOALS"
  | "1X2"
  | "DOUBLE_CHANCE"
  | "BTTS";

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
  line: number,
  side: "OVER" | "UNDER",
): number {
  let probability = 0;
  for (const [count, p] of distribution) {
    if (side === "OVER" ? count > line : count < line) probability += p;
  }
  return Math.min(1, Math.max(0, probability));
}

export function bookmakerLineForAbsoluteLimit(_side: string | null, line: number | null): number | null {
  return line;
}

function binary(
  family: GoalMarketProjection["family"],
  market: GoalMarketProjection["market"],
  marketLabel: string,
  side: string,
  probability: number,
  participant: string | null = null,
  line: number | null = null,
): GoalMarketProjection {
  return {
    family,
    market,
    marketLabel,
    participant,
    side,
    lineRaw: line === null ? null : String(line),
    lineCanonical: line,
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
  oneXTwoProbabilities?: OneXTwoProbabilities | null;
}): GoalMarketProjection[] {
  const poissonOutcomes = goalOutcomeProbabilities(input.lambdaHome, input.lambdaAway);
  const outcomes: OneXTwoProbabilities = input.oneXTwoProbabilities ?? {
    HOME: poissonOutcomes.home,
    DRAW: poissonOutcomes.draw,
    AWAY: poissonOutcomes.away,
  };
  const totalDist = poissonDistribution(input.lambdaHome + input.lambdaAway, 15);
  const projections: GoalMarketProjection[] = [];

  projections.push(
    binary("1X2", "1x2", `Vitória ${input.homeTeam}`, "HOME", outcomes.HOME),
    binary("1X2", "1x2", "Empate", "DRAW", outcomes.DRAW),
    binary("1X2", "1x2", `Vitória ${input.awayTeam}`, "AWAY", outcomes.AWAY),
    binary("DOUBLE_CHANCE", "double_chance", `${input.homeTeam} ou Empate (1X)`, "1X", outcomes.HOME + outcomes.DRAW),
    binary("DOUBLE_CHANCE", "double_chance", `Empate ou ${input.awayTeam} (X2)`, "X2", outcomes.DRAW + outcomes.AWAY),
    binary("DOUBLE_CHANCE", "double_chance", `${input.homeTeam} ou ${input.awayTeam} (12)`, "12", outcomes.HOME + outcomes.AWAY),
  );

  const anchor = quoteAnchorFor("goals_match_total");
  if (anchor !== null) {
    for (const side of ["OVER", "UNDER"] as const) {
      const probability = absoluteCountProbability(totalDist, anchor, side);
      projections.push(
        binary(
          "GOALS",
          "goals_match_total",
          `Gols da partida ${side === "OVER" ? "Mais de" : "Menos de"} ${formatBookmakerLine(anchor)}`,
          side,
          probability,
          null,
          anchor,
        ),
      );
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
