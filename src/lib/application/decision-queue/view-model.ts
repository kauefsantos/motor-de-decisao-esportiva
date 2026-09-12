import { passesExperimentalModelGate } from "../../engine/market-policy";

export const DECISION_FAMILY_LABELS: Record<string, string> = {
  CORNERS: "Escanteios",
  CARDS: "Cartões",
  GOALS: "Gols",
  "1X2": "Resultado",
  DOUBLE_CHANCE: "Dupla chance",
};

export type DecisionQueueState = "AVAILABLE" | "SHOWN" | "ACCEPTED" | "DECLINED" | "BLOCKED_CORRELATED";

export type DecisionQueueRow = {
  id: string;
  queue_state: DecisionQueueState;
  rank_global: number;
  match_label: string;
  competition: string | null;
  market_family: string;
  market_label: string;
  model_probability: number | string;
  entry_odd: number | string;
  fair_odd?: number | string | null;
  min_odd_target?: number | string | null;
  edge: number | string | null;
  expected_value: number | string | null;
};

export type DecisionQueueHistory = {
  rows: DecisionQueueRow[];
  acceptedCount: number;
  exhausted: boolean;
  selectionFinalized: boolean;
  decisionQueueEvaluated: boolean;
  canProceedToStake: boolean;
  dailySelectionLimit: number;
};

export function formatDecisionPercent(value: unknown, digits = 1) {
  return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatDecisionDecimal(value: unknown) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(2);
}

export function eligiblePredictionIds(
  candidates: Array<{ predictionId: string; probabilityExperimental: number }>,
) {
  return candidates
    .filter((candidate) => passesExperimentalModelGate(candidate.probabilityExperimental))
    .map((candidate) => candidate.predictionId);
}

export function fallbackDecisionBatches(
  candidates: Array<{ predictionId: string; probabilityExperimental: number }>,
  size = 10,
) {
  const ids = eligiblePredictionIds(candidates);
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
  return batches;
}
