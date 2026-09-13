import {
  absoluteCountProbability,
  familyForMarket,
} from "../../engine/experimental-goal-markets";
import {
  MODEL_LEAN_THRESHOLD,
  formatBookmakerLine,
  quoteAnchorFor,
  referenceLinesFor,
} from "../../engine/market-policy";
import { distributionFromStoredOutcome } from "../../engine/count-market-distribution";
import { executionValueContract } from "../../engine/execution-value";
import { EV_TARGET, evaluateValue } from "../../engine/value";
import { finiteNumber } from "./datasets";
import {
  EXPERIMENTAL_MARKETS_STATUS,
  PRODUCTION_STATUS,
  type DirectionAssessment,
  type EnrichedValueResult,
  type ExperimentalMatch,
  type PredictionForAnalysis,
  type TrackingInsert,
} from "./contracts";

export function labelFor(
  market: string,
  participant: string | null,
  side: string | null,
  lineRaw: string | null,
) {
  const numericLine = lineRaw === null ? null : finiteNumber(lineRaw);
  const lineLabel = numericLine === null ? "" : formatBookmakerLine(numericLine);
  if (market === "corners_match_total") return `Escanteios da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  if (market === "corners_team_total") return `Escanteios ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  if (market === "cards_match_total") return `Cartões da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  if (market === "cards_team_total") return `Cartões ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  if (market === "goals_match_total") return `Gols da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  if (market === "1x2") return side === "HOME" ? "Vitória mandante" : side === "AWAY" ? "Vitória visitante" : "Empate";
  if (market === "double_chance") return side === "1X" ? "Dupla chance: 1X" : side === "X2" ? "Dupla chance: X2" : "Dupla chance: 12";
  return market;
}

export type OddsEntry = {
  predictionId: string;
  odd: number;
  lineAtEntry: number | null;
};

export function evaluateExperimentalEntries(
  predictions: PredictionForAnalysis[],
  entries: OddsEntry[],
): EnrichedValueResult[] {
  const byId = new Map(predictions.map((prediction) => [prediction.prediction_id, prediction]));
  const results: EnrichedValueResult[] = [];

  for (const entry of entries) {
    const prediction = byId.get(entry.predictionId);
    if (!prediction) continue;
    const modelProbability = finiteNumber(prediction.model_probability) ?? 0;
    const lineCanonical = prediction.line_canonical === null ? null : Number(prediction.line_canonical);
    const contract = executionValueContract({
      market: prediction.market,
      side: prediction.side,
      lineCanonical,
      storedOutcomeDistribution: prediction.outcome_distribution,
    });
    const result = evaluateValue({
      candidateId: prediction.prediction_id,
      predictionId: prediction.prediction_id,
      contractType: contract.contractType,
      bookmaker: "bet365_br",
      odd: entry.odd,
      lineAtEntry: entry.lineAtEntry,
      lineCanonical,
      pCons: modelProbability,
      outcomeDistribution: contract.outcomeDistribution,
      published: true,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      dataStatus: prediction.data_status,
    });
    results.push({
      ...result,
      matchId: prediction.match_id,
      market: prediction.market,
      marketLabel: labelFor(prediction.market, prediction.participant, prediction.side, prediction.line_raw),
      participant: prediction.participant,
      side: prediction.side,
      lineCanonical,
      probabilityExperimental: modelProbability,
      modelVersion: prediction.model_version,
      family: familyForMarket(prediction.market),
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
    });
  }

  return results;
}

export function buildDirectionAssessments(
  predictions: PredictionForAnalysis[],
  evaluations: EnrichedValueResult[],
): DirectionAssessment[] {
  const totals = predictions.filter(
    (row) => row.match_id && quoteAnchorFor(row.market) !== null && (row.side === "OVER" || row.side === "UNDER"),
  );
  const resultByPrediction = new Map(evaluations.map((row) => [row.predictionId, row]));
  const groups = new Map<string, PredictionForAnalysis[]>();
  for (const row of totals) {
    const key = `${row.match_id}|${row.market}|${row.participant ?? "MATCH"}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const assessments: DirectionAssessment[] = [];
  for (const group of groups.values()) {
    const over = group.find((row) => row.side === "OVER");
    const under = group.find((row) => row.side === "UNDER");
    if (!over || !under || !over.match_id) continue;
    const anchor = quoteAnchorFor(over.market);
    if (anchor === null) continue;
    const overProbability = finiteNumber(over.model_probability) ?? 0;
    const underProbability = finiteNumber(under.model_probability) ?? 0;
    const evaluated = [resultByPrediction.get(over.prediction_id), resultByPrediction.get(under.prediction_id)]
      .filter((row): row is EnrichedValueResult => Boolean(row));
    const valueRows = evaluated
      .filter((row) => row.valueStatus === "TEM_VALOR" && row.executionStatus === "EXECUTAVEL")
      .sort((a, b) => (b.evCons ?? -Infinity) - (a.evCons ?? -Infinity));

    let direction: DirectionAssessment["direction"] = "NEUTRAL";
    let basis: DirectionAssessment["basis"] = "NEUTRAL";
    let selectedSide: "OVER" | "UNDER" | null = null;
    const bestValue = valueRows[0] ?? null;
    if (bestValue && (bestValue.side === "OVER" || bestValue.side === "UNDER")) {
      selectedSide = bestValue.side;
      direction = selectedSide === "OVER" ? "VALUE_OVER" : "VALUE_UNDER";
      basis = "VALUE";
    } else if (overProbability >= MODEL_LEAN_THRESHOLD) {
      selectedSide = "OVER";
      direction = "MODEL_LEAN_OVER";
      basis = "MODEL_ONLY";
    } else if (underProbability >= MODEL_LEAN_THRESHOLD) {
      selectedSide = "UNDER";
      direction = "MODEL_LEAN_UNDER";
      basis = "MODEL_ONLY";
    }

    const source = selectedSide === "OVER" ? over : selectedSide === "UNDER" ? under : null;
    const distribution = source ? distributionFromStoredOutcome(source.outcome_distribution) : null;
    const referenceAlternatives: DirectionAssessment["referenceAlternatives"] = [];
    if (selectedSide && source && distribution) {
      for (const line of referenceLinesFor(source.market, selectedSide)) {
        const probability = absoluteCountProbability(distribution, line, selectedSide);
        referenceAlternatives.push({
          matchId: over.match_id,
          market: source.market,
          participant: source.participant,
          side: selectedSide,
          lineCanonical: line,
          marketLabel: labelFor(source.market, source.participant, selectedSide, String(line)),
          probabilityExperimental: probability,
          fairOdd: probability > 0 ? 1 / probability : null,
          minOddTarget: probability > 0 ? (1 + EV_TARGET) / probability : null,
          requiresRealOdd: true,
          valueStatus: "NAO_AVALIADO",
        });
      }
    }

    assessments.push({
      matchId: over.match_id,
      market: over.market,
      participant: over.participant,
      anchorLine: anchor,
      direction,
      basis,
      overProbability,
      underProbability,
      bestValuePredictionId: bestValue?.predictionId ?? null,
      referenceAlternatives,
    });
  }

  return assessments;
}

export function buildTrackingRows(
  runId: string,
  targetDate: string | null,
  selected: EnrichedValueResult[],
  matches: ExperimentalMatch[],
): TrackingInsert[] {
  const matchById = new Map(matches.map((match) => [match.id, match]));
  return selected.map((row) => {
    const match = row.matchId ? matchById.get(row.matchId) : null;
    const matchLabel = match
      ? match.home_team && match.away_team
        ? `${match.home_team} x ${match.away_team}`
        : match.raw_partida
      : "—";
    return {
      run_id: runId,
      match_id: row.matchId,
      prediction_id: row.predictionId,
      target_date: targetDate,
      match_label: matchLabel,
      competition: match?.competition ?? null,
      market_family: row.family,
      market: row.market,
      market_label: row.marketLabel,
      participant: row.participant,
      side: row.side,
      line_canonical: row.lineCanonical,
      model_version: row.modelVersion ?? "unknown",
      model_status: EXPERIMENTAL_MARKETS_STATUS,
      model_probability: row.probabilityExperimental,
      fair_odd: row.fairOdd,
      entry_odd: row.odd,
      min_odd_target: row.minOddTarget,
      edge: row.edgeCons,
      expected_value: row.evCons,
      result: "PENDING",
      updated_at: new Date().toISOString(),
    };
  });
}