// Catálogo modular de mercados. Props de jogador estão fora do escopo.
// Apenas apostas simples: sem múltiplas, Bet Builder, boost ou promoção.

import type { MarketContract } from "./types";

export const SETTLEMENT_HORIZON = "90min + acréscimos (tempo regulamentar)";

interface TeamNames {
  home: string;
  away: string;
}

function corners(scope: "MATCH" | "TEAM", participant: string | null, line: string): MarketContract[] {
  const base = scope === "MATCH" ? "Escanteios da partida" : `Escanteios ${participant}`;
  return (["OVER", "UNDER"] as const).map((side) => ({
    family: "CORNERS" as const,
    scope,
    contractType: "ASIAN" as const,
    market: scope === "MATCH" ? "corners_match_total" : "corners_team_total",
    label: `${base} ${side === "OVER" ? "Mais de" : "Menos de"} ${line}`,
    side,
    participant,
    lineRaw: line,
    settlementDefinition: `corners_taken, ${SETTLEMENT_HORIZON}`,
    requiredMetrics:
      scope === "MATCH"
        ? ["corners_taken_for", "corners_taken_against"]
        : ["corners_taken_for"],
  }));
}

function cards(scope: "MATCH" | "TEAM", participant: string | null, line: string): MarketContract[] {
  const base = scope === "MATCH" ? "Cartões da partida" : `Cartões ${participant}`;
  return (["OVER", "UNDER"] as const).map((side) => ({
    family: "CARDS" as const,
    scope,
    contractType: "ASIAN" as const,
    market: scope === "MATCH" ? "cards_match_points" : "cards_team_points",
    label: `${base} ${side === "OVER" ? "Mais de" : "Menos de"} ${line}`,
    side,
    participant,
    lineRaw: line,
    settlementDefinition: `pontos de cartão (amarelo=1, vermelho=2; segundo amarelo não conta como amarelo adicional; apenas jogadores em campo), ${SETTLEMENT_HORIZON}`,
    requiredMetrics: ["card_points_for", "card_points_against", "referee_card_profile"],
  }));
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

  // 1X2
  (
    [
      ["HOME", `Vitória ${home}`],
      ["DRAW", "Empate"],
      ["AWAY", `Vitória ${away}`],
    ] as const
  ).forEach(([side, label]) => {
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

  // BTTS — derivado da distribuição conjunta de gols
  (
    [
      ["YES", "Ambas marcam: Sim"],
      ["NO", "Ambas marcam: Não"],
    ] as const
  ).forEach(([side, label]) => {
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

  out.push(...corners("MATCH", null, "9.5"));
  out.push(...corners("MATCH", null, "10.5"));
  out.push(...corners("TEAM", home, "4.5"));
  out.push(...corners("TEAM", away, "4.5"));

  out.push(...cards("MATCH", null, "4.5"));
  out.push(...cards("TEAM", home, "2.5"));
  out.push(...cards("TEAM", away, "2.5"));

  out.push(...shots("SHOTS", "MATCH", null, "24.5"));
  out.push(...shots("SHOTS", "TEAM", home, "12.5"));
  out.push(...shots("SHOTS_ON_TARGET", "MATCH", null, "8.5"));
  out.push(...shots("SHOTS_ON_TARGET", "TEAM", home, "4.5"));

  return out;
}
