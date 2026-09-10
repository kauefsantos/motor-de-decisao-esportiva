from pathlib import Path

# 1) Rewrite the market catalogue around absolute binary counts.
Path('src/lib/engine/markets.ts').write_text(r'''// Catálogo modular de mercados. Props de jogador estão fora do escopo.
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
''')

# 2) Goal markets: absolute binary limits only, no Asian settlement.
Path('src/lib/engine/experimental-goal-markets.ts').write_text(r'''import { poissonDistribution } from "./corners";
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
''')

# 3) Card model: yellow-card counts, using the same shrinkage/Poisson count engine.
Path('src/lib/engine/cards.ts').write_text(r'''import {
  fitBaseline,
  predict,
  type CornerMatchRow,
  type CornersModelParams,
  type CornersPrediction,
} from "./corners";

export const CARDS_MODEL_VERSION = "cards-yellow-baseline-v1";

export interface CardMatchRow {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeCards: number;
  awayCards: number;
}

function asCountRows(rows: CardMatchRow[]): CornerMatchRow[] {
  return rows.map((row) => ({
    date: row.date,
    league: row.league,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homeCorners: row.homeCards,
    awayCorners: row.awayCards,
  }));
}

export function fitCardsBaseline(rows: CardMatchRow[]): CornersModelParams {
  return { ...fitBaseline(asCountRows(rows)), modelVersion: CARDS_MODEL_VERSION };
}

export function predictCards(
  params: CornersModelParams,
  input: { league: string; homeTeam: string; awayTeam: string },
): CornersPrediction {
  return predict(params, input);
}
''')

# 4) Experimental run: build card history and make goals/corners/cards binary absolute counts.
run_file = Path('src/lib/experimental-markets-run.functions.ts')
text = run_file.read_text()
old_import = '''  buildGoalMarketProjections,
  familyForMarket,
  type ExperimentalMarketFamily,
} from "./engine/experimental-goal-markets";
import {
  asianFairOdd,
  asianOutcomes,
  canonicalLine,
  pProfit,
} from "./engine/settlement";
'''
new_import = '''  absoluteCountProbability,
  buildGoalMarketProjections,
  familyForMarket,
  type ExperimentalMarketFamily,
} from "./engine/experimental-goal-markets";
'''
assert old_import in text
text = text.replace(old_import, new_import, 1)
text = text.replace(
    'import { CORNER_OVER_LINES, CORNER_UNDER_LINES } from "./engine/markets";\n',
    'import {\n  CARD_MATCH_OVER_LINES,\n  CARD_MATCH_UNDER_LINES,\n  CARD_TEAM_OVER_LINES,\n  CARD_TEAM_UNDER_LINES,\n  CORNER_OVER_LINES,\n  CORNER_UNDER_LINES,\n} from "./engine/markets";\nimport { CARDS_MODEL_VERSION, fitCardsBaseline, predictCards, type CardMatchRow } from "./engine/cards";\n',
)
text = text.replace('import type { AsianOutcomeProbabilities, ContractType } from "./engine/types";\n', 'import type { ContractType } from "./engine/types";\n')

start = text.index('function buildDatasets(observations: RawValue[]) {')
end = text.index('\nfunction labelFor(', start)
text = text[:start] + r'''function buildDatasets(observations: RawValue[]) {
  const corners = new Map<string, CornerMatchRow>();
  const goals = new Map<string, GoalMatchRow>();
  const cardParts = new Map<string, Partial<CardMatchRow>>();
  const conflicts = new Set<string>();

  for (const rv of observations) {
    const externalMatchId = String(rv["externalMatchId"] ?? "");
    const date = String(rv["fixtureDate"] ?? "");
    const league = leagueFromExternalMatchId(externalMatchId);
    const raw = asRecord(rv["rawHomeAway"]);
    const teamId = String(rv["teamId"] ?? rv["teamExternalId"] ?? "");
    const opponentId = String(rv["opponentId"] ?? "");
    const side = String(rv["teamSideInFixture"] ?? "");
    if (!externalMatchId || !date || !league || !teamId || !opponentId) continue;
    if (side !== "HOME" && side !== "AWAY") continue;

    const homeTeam = side === "HOME" ? teamId : opponentId;
    const awayTeam = side === "HOME" ? opponentId : teamId;

    const metric = String(rv["metricLabelRaw"] ?? rv["sourceLabel"] ?? "");
    const cardValue = finiteNumber(rv["value"]);
    if (cardValue !== null && (metric === "cards.home.yellow" || metric === "cards.away.yellow")) {
      const part = cardParts.get(externalMatchId) ?? { date, league, homeTeam, awayTeam };
      part.date = date;
      part.league = league;
      part.homeTeam = homeTeam;
      part.awayTeam = awayTeam;
      if (metric === "cards.home.yellow") part.homeCards = cardValue;
      if (metric === "cards.away.yellow") part.awayCards = cardValue;
      cardParts.set(externalMatchId, part);
    }

    if (!raw) continue;
    const homeCorners = finiteNumber(raw["cornersHome"]);
    const awayCorners = finiteNumber(raw["cornersAway"]);
    const homeGoals = finiteNumber(raw["goalsHome"]);
    const awayGoals = finiteNumber(raw["goalsAway"]);

    if (homeCorners !== null && awayCorners !== null) {
      const next: CornerMatchRow = { date, league, homeTeam, awayTeam, homeCorners, awayCorners };
      const prev = corners.get(externalMatchId);
      if (prev && (prev.homeTeam !== next.homeTeam || prev.awayTeam !== next.awayTeam || prev.homeCorners !== next.homeCorners || prev.awayCorners !== next.awayCorners)) conflicts.add(externalMatchId);
      else corners.set(externalMatchId, next);
    }

    if (homeGoals !== null && awayGoals !== null) {
      const next: GoalMatchRow = { date, league, homeTeam, awayTeam, homeGoals, awayGoals };
      const prev = goals.get(externalMatchId);
      if (prev && (prev.homeTeam !== next.homeTeam || prev.awayTeam !== next.awayTeam || prev.homeGoals !== next.homeGoals || prev.awayGoals !== next.awayGoals)) conflicts.add(externalMatchId);
      else goals.set(externalMatchId, next);
    }
  }

  const cards: CardMatchRow[] = [];
  for (const [id, part] of cardParts) {
    if (conflicts.has(id)) continue;
    if (!part.date || !part.league || !part.homeTeam || !part.awayTeam) continue;
    if (part.homeCards === undefined || part.awayCards === undefined) continue;
    cards.push(part as CardMatchRow);
  }

  for (const id of conflicts) {
    corners.delete(id);
    goals.delete(id);
  }
  return { corners: [...corners.values()], goals: [...goals.values()], cards };
}
''' + text[end:]

label_anchor = '  if (market === "goals_match_total") {\n'
assert label_anchor in text
text = text.replace(label_anchor, '''  if (market === "cards_match_total") {\n    return `Cartões amarelos da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();\n  }\n  if (market === "cards_team_total") {\n    return `Cartões amarelos ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();\n  }\n''' + label_anchor, 1)

corner_start = text.index('      if (cornerForecast && cornerForecast.sampleSize > 0) {')
goal_start = text.index('      const rollingGoals = datasets.goals.filter(', corner_start)
new_corner_cards = r'''      if (cornerForecast && cornerForecast.sampleSize > 0) {
        const scopes = [
          { market: "corners_match_total", participant: null, dist: poissonDistribution(cornerForecast.lambdaTotal) },
          { market: "corners_team_total", participant: match.home_team ?? "Mandante", dist: poissonDistribution(cornerForecast.lambdaHome) },
          { market: "corners_team_total", participant: match.away_team ?? "Visitante", dist: poissonDistribution(cornerForecast.lambdaAway) },
        ];
        const lineSpecs = [
          ...CORNER_OVER_LINES.map((line) => ({ side: "OVER" as const, line })),
          ...CORNER_UNDER_LINES.map((line) => ({ side: "UNDER" as const, line })),
        ];
        let ordinal = 0;
        for (const spec of scopes) {
          for (const lineSpec of lineSpecs) {
            ordinal += 1;
            const side = lineSpec.side;
            const lineRaw = lineSpec.line;
            const line = Number(lineRaw);
            const p = absoluteCountProbability(spec.dist, line, side);
            const id = predictionId(data.runId, match.id, "CORNERS", ordinal);
            predictionRows.push({ run_id: data.runId, match_id: match.id, prediction_id: id, market: spec.market, participant: spec.participant, side, line_raw: lineRaw, line_canonical: line, model_probability: p, p_cal: null, conservative_probability: null, outcome_distribution: {}, model_version: cornerModelVersion, calibration_version: null, model_status: EXPERIMENTAL_MARKETS_STATUS, data_status: "OK", prediction_at: predictionAt });
            candidates.push({ predictionId: id, matchId: match.id, matchLabel: label, competition: match.competition ?? "", family: "CORNERS", market: spec.market, marketLabel: labelFor(spec.market, spec.participant, side, lineRaw), participant: spec.participant, side, lineRaw, lineCanonical: line, contractType: "BINARY", probabilityExperimental: p, fairOddExperimental: p > 0 ? 1 / p : null, sampleSize: cornerForecast.sampleSize, trainingMatches: cornerTrainingMatches, gate: BASE_GATE, gateMet: p >= BASE_GATE, modelVersion: cornerModelVersion, modelStatus: EXPERIMENTAL_MARKETS_STATUS, productionStatus: PRODUCTION_STATUS, dataStatus: "OK" });
          }
        }
      }

      const rollingCards = datasets.cards.filter((r) => r.date < predictionDate && r.date >= rollingStartDate);
      if (crossLeague) {
        issues.push(`${label}: cartões amarelos continentais aguardam normalização entre ligas; mercado não publicado nesta partida.`);
      } else {
        const cardTraining = rollingCards.filter((r) => r.league === league);
        if (cardTraining.length >= MIN_EXPERIMENTAL_MATCHES) {
          const params = fitCardsBaseline(cardTraining);
          const forecast = predictCards(params, { league, homeTeam: String(homeId), awayTeam: String(awayId) });
          if (forecast.sampleSize > 0) {
            const cardScopes = [
              { market: "cards_match_total", participant: null, dist: poissonDistribution(forecast.lambdaTotal), overs: CARD_MATCH_OVER_LINES, unders: CARD_MATCH_UNDER_LINES },
              { market: "cards_team_total", participant: match.home_team ?? "Mandante", dist: poissonDistribution(forecast.lambdaHome), overs: CARD_TEAM_OVER_LINES, unders: CARD_TEAM_UNDER_LINES },
              { market: "cards_team_total", participant: match.away_team ?? "Visitante", dist: poissonDistribution(forecast.lambdaAway), overs: CARD_TEAM_OVER_LINES, unders: CARD_TEAM_UNDER_LINES },
            ];
            let cardOrdinal = 0;
            for (const spec of cardScopes) {
              const specs = [...spec.overs.map((line) => ({ side: "OVER" as const, line })), ...spec.unders.map((line) => ({ side: "UNDER" as const, line }))];
              for (const lineSpec of specs) {
                cardOrdinal += 1;
                const line = Number(lineSpec.line);
                const p = absoluteCountProbability(spec.dist, line, lineSpec.side);
                const id = predictionId(data.runId, match.id, "CARDS", cardOrdinal);
                predictionRows.push({ run_id: data.runId, match_id: match.id, prediction_id: id, market: spec.market, participant: spec.participant, side: lineSpec.side, line_raw: lineSpec.line, line_canonical: line, model_probability: p, p_cal: null, conservative_probability: null, outcome_distribution: {}, model_version: CARDS_MODEL_VERSION, calibration_version: null, model_status: EXPERIMENTAL_MARKETS_STATUS, data_status: "OK", prediction_at: predictionAt });
                candidates.push({ predictionId: id, matchId: match.id, matchLabel: label, competition: match.competition ?? "", family: "CARDS", market: spec.market, marketLabel: labelFor(spec.market, spec.participant, lineSpec.side, lineSpec.line), participant: spec.participant, side: lineSpec.side, lineRaw: lineSpec.line, lineCanonical: line, contractType: "BINARY", probabilityExperimental: p, fairOddExperimental: p > 0 ? 1 / p : null, sampleSize: forecast.sampleSize, trainingMatches: cardTraining.length, gate: BASE_GATE, gateMet: p >= BASE_GATE, modelVersion: CARDS_MODEL_VERSION, modelStatus: EXPERIMENTAL_MARKETS_STATUS, productionStatus: PRODUCTION_STATUS, dataStatus: "OK" });
              }
            }
          }
        }
      }

'''
text = text[:corner_start] + new_corner_cards + text[goal_start:]
assert 'const contractType: ContractType = p.line_canonical === null ? "BINARY" : "ASIAN";' in text
text = text.replace('const contractType: ContractType = p.line_canonical === null ? "BINARY" : "ASIAN";', 'const contractType: ContractType = "BINARY";', 1)
old_outcome = '''        pCons: contractType === "BINARY" ? modelProbability : null,
        outcomeDistribution:
          contractType === "ASIAN"
            ? (p.outcome_distribution as unknown as AsianOutcomeProbabilities | null)
            : null,
'''
assert old_outcome in text
text = text.replace(old_outcome, '        pCons: modelProbability,\n        outcomeDistribution: null,\n', 1)
text = text.replace('.max(1500),', '.max(3000),', 1)
run_file.write_text(text)

# 5) Alternate selection is binary for all active experimental markets.
q = Path('src/lib/qualified-alternates.functions.ts')
text = q.read_text()
text = text.replace('import type { AsianOutcomeProbabilities, ContractType } from "./engine/types";', 'import type { ContractType } from "./engine/types";')
text = text.replace('const contractType: ContractType = prediction.line_canonical === null ? "BINARY" : "ASIAN";', 'const contractType: ContractType = "BINARY";')
old = '''      pCons: contractType === "BINARY" ? modelProbability : null,
      outcomeDistribution:
        contractType === "ASIAN"
          ? (prediction.outcome_distribution as AsianOutcomeProbabilities | null)
          : null,
'''
assert old in text
text = text.replace(old, '      pCons: modelProbability,\n      outcomeDistribution: null,\n', 1)
q.write_text(text)

# 6) Automatic Bet365 line matching translates absolute limits at the bookmaker boundary.
a = Path('src/lib/auto-bet365-odds.functions.ts')
text = a.read_text()
old = '''function candidateFromRow(row: PredictionRow): AutoOddsCandidate {
  return {
    predictionId: row.prediction_id,
    market: row.market,
    side: row.side,
    lineCanonical: row.line_canonical === null ? null : Number(row.line_canonical),
  };
}
'''
new = '''function candidateFromRow(row: PredictionRow): AutoOddsCandidate {
  const absoluteLimit = row.line_canonical === null ? null : Number(row.line_canonical);
  const translatedLine =
    absoluteLimit !== null && (row.market === "goals_match_total" || row.market === "corners_match_total")
      ? row.side === "OVER"
        ? absoluteLimit + 0.5
        : row.side === "UNDER"
          ? absoluteLimit - 0.5
          : absoluteLimit
      : absoluteLimit;
  return { predictionId: row.prediction_id, market: row.market, side: row.side, lineCanonical: translatedLine };
}
'''
assert old in text
text = text.replace(old, new, 1)
a.write_text(text)

# 7) UI grouping knows the new card family.
ui = Path('src/components/ExperimentalMarketsPilot.tsx')
text = ui.read_text()
text = text.replace('const FAMILY_ORDER = ["CORNERS", "GOALS", "TEAM_GOALS", "1X2", "DOUBLE_CHANCE", "BTTS"] as const;', 'const FAMILY_ORDER = ["CORNERS", "CARDS", "GOALS", "TEAM_GOALS", "1X2", "DOUBLE_CHANCE", "BTTS"] as const;')
text = text.replace('  CORNERS: "Escanteios",\n', '  CORNERS: "Escanteios",\n  CARDS: "Cartões amarelos",\n', 1)
ui.write_text(text)

# 8) Tests.
Path('src/lib/engine/markets.test.ts').write_text(r'''import { describe, expect, it } from "vitest";
import { CARD_MATCH_OVER_LINES, CARD_MATCH_UNDER_LINES, CARD_TEAM_OVER_LINES, CARD_TEAM_UNDER_LINES, CORNER_OVER_LINES, CORNER_UNDER_LINES, buildContracts } from "./markets";

describe("absolute count market catalogue", () => {
  it("restricts corner limits and makes them binary", () => {
    expect(CORNER_OVER_LINES).toEqual(["4", "5", "6", "7", "8", "9", "10"]);
    expect(CORNER_UNDER_LINES).toEqual(["10", "9", "8", "7", "6", "5"]);
    const corners = buildContracts({ home: "Casa", away: "Fora" }).filter((contract) => contract.family === "CORNERS");
    expect(corners).toHaveLength(39);
    expect(corners.every((contract) => contract.contractType === "BINARY")).toBe(true);
  });

  it("opens yellow-card totals and team markets with restricted limits", () => {
    expect(CARD_MATCH_OVER_LINES).toEqual(["2", "3", "4", "5", "6"]);
    expect(CARD_MATCH_UNDER_LINES).toEqual(["7", "6", "5", "4", "3"]);
    expect(CARD_TEAM_OVER_LINES).toEqual(["0", "1", "2", "3"]);
    expect(CARD_TEAM_UNDER_LINES).toEqual(["4", "3", "2", "1"]);
    const cards = buildContracts({ home: "Casa", away: "Fora" }).filter((contract) => contract.family === "CARDS");
    expect(cards).toHaveLength(26);
    expect(cards.every((contract) => contract.contractType === "BINARY")).toBe(true);
  });
});
''')

Path('src/lib/engine/experimental-goal-markets.test.ts').write_text(r'''import { describe, expect, it } from "vitest";
import { GOAL_OVER_LIMITS, GOAL_UNDER_LIMITS, absoluteCountProbability, bookmakerLineForAbsoluteLimit, buildGoalMarketProjections, familyForMarket } from "./experimental-goal-markets";

const markets = buildGoalMarketProjections({ homeTeam: "Time A", awayTeam: "Time B", lambdaHome: 1.55, lambdaAway: 1.05 });

describe("experimental goal market projections", () => {
  it("uses only requested absolute binary goal limits", () => {
    expect(GOAL_OVER_LIMITS).toEqual([0, 1, 2, 3]);
    expect(GOAL_UNDER_LIMITS).toEqual([4, 3, 2, 1]);
    const totals = markets.filter((m) => m.market === "goals_match_total");
    expect(totals).toHaveLength(8);
    expect(totals.every((m) => m.contractType === "BINARY" && m.outcomeDistribution === null)).toBe(true);
    expect(totals.filter((m) => m.side === "OVER").map((m) => m.lineCanonical)).toEqual([0, 1, 2, 3]);
    expect(totals.filter((m) => m.side === "UNDER").map((m) => m.lineCanonical)).toEqual([4, 3, 2, 1]);
  });

  it("applies strict integer thresholds without push semantics", () => {
    const dist = new Map([[0, 0.1], [1, 0.2], [2, 0.3], [3, 0.4]]);
    expect(absoluteCountProbability(dist, 1, "OVER")).toBeCloseTo(0.7);
    expect(absoluteCountProbability(dist, 3, "UNDER")).toBeCloseTo(0.6);
    expect(bookmakerLineForAbsoluteLimit("OVER", 4)).toBe(4.5);
    expect(bookmakerLineForAbsoluteLimit("UNDER", 10)).toBe(9.5);
  });

  it("keeps 1X2 exhaustive and maps cards family", () => {
    const oneXtwo = markets.filter((m) => m.market === "1x2");
    expect(oneXtwo.reduce((sum, m) => sum + m.probability, 0)).toBeCloseTo(1, 8);
    expect(familyForMarket("cards_match_total")).toBe("CARDS");
  });
});
''')

e2e = Path('src/lib/engine/experimental-pilot.e2e.test.ts')
text = e2e.read_text()
text = text.replace('p.family === "GOALS" && p.lineRaw === "1.5" && p.side === "OVER"', 'p.family === "GOALS" && p.lineRaw === "0" && p.side === "OVER" && p.contractType === "BINARY"')
e2e.write_text(text)

Path('src/lib/engine/cards.test.ts').write_text(r'''import { describe, expect, it } from "vitest";
import { CARDS_MODEL_VERSION, fitCardsBaseline, predictCards, type CardMatchRow } from "./cards";

const rows: CardMatchRow[] = [
  { date: "2026-08-01", league: "L1", homeTeam: "A", awayTeam: "B", homeCards: 3, awayCards: 2 },
  { date: "2026-08-02", league: "L1", homeTeam: "C", awayTeam: "A", homeCards: 2, awayCards: 4 },
  { date: "2026-08-03", league: "L1", homeTeam: "B", awayTeam: "C", homeCards: 1, awayCards: 3 },
  { date: "2026-08-04", league: "L1", homeTeam: "A", awayTeam: "C", homeCards: 4, awayCards: 2 },
];

describe("yellow-card count model", () => {
  it("fits and predicts positive count lambdas", () => {
    const params = fitCardsBaseline(rows);
    const forecast = predictCards(params, { league: "L1", homeTeam: "A", awayTeam: "B" });
    expect(params.modelVersion).toBe(CARDS_MODEL_VERSION);
    expect(forecast.lambdaTotal).toBeGreaterThan(0);
    expect(forecast.sampleSize).toBeGreaterThan(0);
  });
});
''')

# 9) Core Motor 1: binary count contracts use their count distribution + strict absolute limit.
opp = Path('src/lib/engine/opportunity.ts')
text = opp.read_text()
marker = '  const key = `${contract.market}:${contract.side}`;\n  const pCal = ctx.binaryProbabilities.get(key);\n'
replacement = '''  let pCal: number | undefined;\n  if (lineCanonical !== null && (contract.side === "OVER" || contract.side === "UNDER")) {\n    const countKey = `${contract.market}:${contract.participant ?? "MATCH"}`;\n    const dist = ctx.countDistributions.get(countKey);\n    if (dist) {\n      let probability = 0;\n      for (const [count, p] of dist) {\n        if (contract.side === "OVER" ? count > lineCanonical : count < lineCanonical) probability += p;\n      }\n      pCal = Math.min(1, Math.max(0, probability));\n    }\n  }\n  if (pCal === undefined) {\n    const keyWithLine = lineCanonical === null ? `${contract.market}:${contract.side}` : `${contract.market}:${contract.side}:${lineCanonical}`;\n    pCal = ctx.binaryProbabilities.get(keyWithLine) ?? ctx.binaryProbabilities.get(`${contract.market}:${contract.side}`);\n  }\n'''
assert marker in text
text = text.replace(marker, replacement, 1)
opp.write_text(text)
