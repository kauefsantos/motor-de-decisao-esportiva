// Catálogo modular de mercados. Props de jogador estão fora do escopo.
// Apenas apostas simples: sem múltiplas, Bet Builder, boost ou promoção.

import type { MarketContract } from "./types";

export const SETTLEMENT_HORIZON = "90min + acréscimos (tempo regulamentar)";

export const CORNER_OVER_LINES = ["4", "5", "6", "7", "8", "9", "10"] as const;
export const CORNER_UNDER_LINES = ["10", "9", "8", "7", "6", "5"] as const;
export const CARD_MATCH_OVER_LINES = ["2", "3", "4", "5", "6"] as const;
export const CARD_MATCH_UNDER_LINES = ["7", "6", "5", "4", "3"] as const;
export const CARD_TEAM_OVER_LINES = ["0", "1", "2", "3"] as const;
export const CARD_TEAM_UNDER_LINES = ["4", "3", "2", "1"] as const;

interface TeamNames {
  home: string;
  away: string;
}

function absoluteCountContract(
  family: "CORNERS" | "CARDS",
  scope: "MATCH" | "TEAM",
  participant: string | null,
  line: string,
  side: "OVER" | "UNDER",
): MarketContract {
  const isCorners = family === "CORNERS";
  const noun = isCorners ? "Escanteios" : "Cartões amarelos";
  const base = scope === "MATCH" ? `${noun} da partida` : `${noun} ${participant}`;
  return {
    family,
    scope,
    contractType: "BINARY",
    market: isCorners
      ? scope === "MATCH" ? "corners_match_total" : "corners_team_total"
      : scope === "MATCH" ? "cards_match_total" : "cards_team_total",
    label: `${base} ${side === "OVER" ? "Mais de" : "Menos de"} ${line}`,
    side,
    participant,
    lineRaw: line,
    settlementDefinition: `${noun.toLowerCase()} em contagem inteira; Mais de N = N+1 ou mais; Menos de N = N-1 ou menos; ${SETTLEMENT_HORIZON}`,
    requiredMetrics: isCorners
      ? scope === "MATCH"
        ? ["corners_taken_for", "corners_taken_against"]
        : ["corners_taken_for"]
      : ["cards_yellow_raw"],
  };
}

function shots(
  family: "SHOTS" | "SHOTS_ON_TARGET",
  scope: "MATCH" | "TEAM",
  participant: string | null,
  line: string,
): MarketContract[] {
  const metric = family === "SHOTS" ? "shots" : "shots_on_target";
  const nome = family === "SHOTS" ? "Finalizações" : "Chutes ao gol";
  const base = scope === "MATCH" ? `${nome} da partida` : `${nome} ${participant}`;
  return (["OVER", "UNDER"] as const).map((side) => ({
    family,
    scope,
    contractType: "ASIAN" as const,
    market: `${metric}_${scope.toLowerCase()}_total`,
    label: `${base} ${side === "OVER" ? "Mais de" : "Menos de"} ${line}`,
    side,
    participant,
    lineRaw: line,
    settlementDefinition: `${metric} conforme definição Opta/bet365 compatível, ${SETTLEMENT_HORIZON}`,
    requiredMetrics: [`${metric}_for`, `${metric}_against`, `${metric}_definition_match`],
  }));
}

export function buildContracts(teams: TeamNames): MarketContract[] {
  const { home, away } = teams;
  const out: MarketContract[] = [];

  ([
    ["HOME", `Vitória ${home}`],
    ["DRAW", "Empate"],
    ["AWAY", `Vitória ${away}`],
  ] as const).forEach(([side, label]) => {
    out.push({
      family: "1X2",
      scope: "MATCH",
      contractType: "BINARY",
      market: "1x2",
      label,
      side,
      participant: null,
      lineRaw: null,
      settlementDefinition: `resultado em ${SETTLEMENT_HORIZON}`,
      requiredMetrics: ["goals_for", "goals_against", "xg_for", "xg_against"],
    });
  });

  ([
    ["YES", "Ambas marcam: Sim"],
    ["NO", "Ambas marcam: Não"],
  ] as const).forEach(([side, label]) => {
    out.push({
      family: "BTTS",
      scope: "MATCH",
      contractType: "BINARY",
      market: "btts",
      label,
      side,
      participant: null,
      lineRaw: null,
      settlementDefinition: `distribuição conjunta de gols, ${SETTLEMENT_HORIZON}`,
      requiredMetrics: ["goals_for", "goals_against", "xg_for", "xg_against"],
    });
  });

  for (const line of CORNER_OVER_LINES) {
    out.push(absoluteCountContract("CORNERS", "MATCH", null, line, "OVER"));
    out.push(absoluteCountContract("CORNERS", "TEAM", home, line, "OVER"));
    out.push(absoluteCountContract("CORNERS", "TEAM", away, line, "OVER"));
  }
  for (const line of CORNER_UNDER_LINES) {
    out.push(absoluteCountContract("CORNERS", "MATCH", null, line, "UNDER"));
    out.push(absoluteCountContract("CORNERS", "TEAM", home, line, "UNDER"));
    out.push(absoluteCountContract("CORNERS", "TEAM", away, line, "UNDER"));
  }

  for (const line of CARD_MATCH_OVER_LINES) out.push(absoluteCountContract("CARDS", "MATCH", null, line, "OVER"));
  for (const line of CARD_MATCH_UNDER_LINES) out.push(absoluteCountContract("CARDS", "MATCH", null, line, "UNDER"));
  for (const line of CARD_TEAM_OVER_LINES) {
    out.push(absoluteCountContract("CARDS", "TEAM", home, line, "OVER"));
    out.push(absoluteCountContract("CARDS", "TEAM", away, line, "OVER"));
  }
  for (const line of CARD_TEAM_UNDER_LINES) {
    out.push(absoluteCountContract("CARDS", "TEAM", home, line, "UNDER"));
    out.push(absoluteCountContract("CARDS", "TEAM", away, line, "UNDER"));
  }

  out.push(...shots("SHOTS", "MATCH", null, "24.5"));
  out.push(...shots("SHOTS", "TEAM", home, "12.5"));
  out.push(...shots("SHOTS_ON_TARGET", "MATCH", null, "8.5"));
  out.push(...shots("SHOTS_ON_TARGET", "TEAM", home, "4.5"));

  return out;
}
