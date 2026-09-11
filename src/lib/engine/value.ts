// MOTOR 2 — ODDS / VALUE ENGINE + FINAL SELECTION.
// Recebe SOMENTE odds para contratos publicados pelo Motor 1.
// Nunca recalcula a probabilidade esportiva: se a linha mudou, exige reforecast.

import {
  asianEV,
  asianFairOdd,
  asianMinOdd,
  lEff,
  wEff,
} from "./settlement";
import type { AsianOutcomeProbabilities, ContractType } from "./types";

export const EV_TARGET = 0.02;
export const MIN_MODEL_PROBABILITY = 0.70;
export const MAX_SELECTIONS = 3;

export function passesModelProbabilityGate(probability: number | null | undefined) {
  return probability !== null && probability !== undefined && Number.isFinite(probability) && probability > MIN_MODEL_PROBABILITY && probability <= 1;
}

export type ProbabilityBasis =
  | "CONSERVATIVE_CALIBRATED"
  | "RAW_EXPERIMENTAL"
  | "OUTCOME_DISTRIBUTION";

export type RejectionReason =
  | "SEM_VALOR"
  | "MODEL_PROBABILITY_BELOW_THRESHOLD"
  | "PRICE_MOVED_NO_BET"
  | "REFORECAST_REQUIRED"
  | "MODEL_NOT_PRODUCTION_VALIDATED"
  | "DATA_DEFINITION_MISMATCH"
  | "INSUFFICIENT_DATA"
  | "INVALID_ODD"
  | "BOOKMAKER_MISMATCH";

export interface ValueInput {
  candidateId: string;
  predictionId: string;
  contractType: ContractType;
  bookmaker: string;
  odd: number;
  /** linha canônica no momento da digitação, para detectar mudança de linha */
  lineAtEntry: number | null;
  lineCanonical: number | null;
  /**
   * Probabilidade entregue pelo Motor 1 ao Motor 2 para a decisão.
   * Toda recomendação exige valor estritamente maior que 70%.
   */
  pCons: number | null;
  probabilityBasis?: ProbabilityBasis;
  outcomeDistribution: AsianOutcomeProbabilities | null;
  published: boolean;
  modelStatus: string;
  dataStatus: string;
}

export interface ValueResult {
  candidateId: string;
  predictionId: string;
  odd: number;
  impliedProbability: number | null;
  fairOdd: number | null;
  minOddTarget: number | null;
  /** Probabilidade efetivamente usada para decidir se o contrato pode seguir. */
  decisionProbability: number | null;
  probabilityBasis: ProbabilityBasis | null;
  edgeCons: number | null;
  evCons: number | null;
  wEff: number | null;
  lEff: number | null;
  probabilityStatus: "APROVADA" | "BLOQUEADA";
  valueStatus: "TEM_VALOR" | "SEM_VALOR" | "NAO_AVALIADO";
  executionStatus: "EXECUTAVEL" | "NAO_EXECUTAR";
  rejectionReason: RejectionReason | null;
}

const BOOKMAKER = "bet365_br";

function binaryProbabilityBasis(input: ValueInput): ProbabilityBasis {
  if (input.probabilityBasis && input.probabilityBasis !== "OUTCOME_DISTRIBUTION") {
    return input.probabilityBasis;
  }
  return input.modelStatus.startsWith("EXPERIMENTAL")
    ? "RAW_EXPERIMENTAL"
    : "CONSERVATIVE_CALIBRATED";
}

export function evaluateValue(input: ValueInput): ValueResult {
  const base: ValueResult = {
    candidateId: input.candidateId,
    predictionId: input.predictionId,
    odd: input.odd,
    impliedProbability: null,
    fairOdd: null,
    minOddTarget: null,
    decisionProbability: input.pCons,
    probabilityBasis: null,
    edgeCons: null,
    evCons: null,
    wEff: null,
    lEff: null,
    probabilityStatus: "BLOQUEADA",
    valueStatus: "NAO_AVALIADO",
    executionStatus: "NAO_EXECUTAR",
    rejectionReason: null,
  };

  if (input.bookmaker !== BOOKMAKER) {
    return { ...base, rejectionReason: "BOOKMAKER_MISMATCH" };
  }
  if (!Number.isFinite(input.odd) || input.odd <= 1) {
    return { ...base, rejectionReason: "INVALID_ODD" };
  }
  if (!input.published) {
    const reason = (
      ["MODEL_NOT_PRODUCTION_VALIDATED", "DATA_DEFINITION_MISMATCH", "INSUFFICIENT_DATA"] as const
    ).find((r) => input.modelStatus === r || input.dataStatus === r);
    return { ...base, rejectionReason: reason ?? "INSUFFICIENT_DATA" };
  }
  if (
    input.lineAtEntry !== null &&
    input.lineCanonical !== null &&
    Math.abs(input.lineAtEntry - input.lineCanonical) > 1e-9
  ) {
    return { ...base, rejectionReason: "REFORECAST_REQUIRED" };
  }

  if (!passesModelProbabilityGate(input.pCons)) {
    return {
      ...base,
      rejectionReason: input.pCons === null || !Number.isFinite(input.pCons) || input.pCons <= 0 || input.pCons > 1
        ? "INSUFFICIENT_DATA"
        : "MODEL_PROBABILITY_BELOW_THRESHOLD",
    };
  }

  // Só depois do gate estrito >70% o Motor 2 avalia preço/value.
  if (input.contractType === "ASIAN") {
    const dist = input.outcomeDistribution;
    if (!dist) return { ...base, rejectionReason: "INSUFFICIENT_DATA" };
    const w = wEff(dist);
    const l = lEff(dist);
    const ev = asianEV(dist, input.odd);
    const fair = asianFairOdd(dist);
    const minOdd = asianMinOdd(dist, EV_TARGET);
    const implied = 1 / input.odd;
    const hasValue = ev >= EV_TARGET;
    return {
      ...base,
      impliedProbability: implied,
      fairOdd: fair,
      minOddTarget: minOdd,
      probabilityBasis: "OUTCOME_DISTRIBUTION",
      edgeCons: w - implied,
      evCons: ev,
      wEff: w,
      lEff: l,
      probabilityStatus: "APROVADA",
      valueStatus: hasValue ? "TEM_VALOR" : "SEM_VALOR",
      executionStatus: hasValue ? "EXECUTAVEL" : "NAO_EXECUTAR",
      rejectionReason: hasValue ? null : "SEM_VALOR",
    };
  }

  const p = input.pCons;
  const implied = 1 / input.odd;
  const ev = p * input.odd - 1;
  const hasValue = ev >= EV_TARGET;
  return {
    ...base,
    impliedProbability: implied,
    fairOdd: 1 / p,
    minOddTarget: (1 + EV_TARGET) / p,
    decisionProbability: p,
    probabilityBasis: binaryProbabilityBasis(input),
    edgeCons: p - implied,
    evCons: ev,
    probabilityStatus: "APROVADA",
    valueStatus: hasValue ? "TEM_VALOR" : "SEM_VALOR",
    executionStatus: hasValue ? "EXECUTAVEL" : "NAO_EXECUTAR",
    rejectionReason: hasValue ? null : "SEM_VALOR",
  };
}

/**
 * Seleção final: 0 a no máximo 3. Nunca força 3.
 * Ordena pelo EV de decisão e desempata por edge.
 */
export function finalSelection(results: ValueResult[]): ValueResult[] {
  return results
    .filter((r) => r.probabilityStatus === "APROVADA" && r.valueStatus === "TEM_VALOR" && r.executionStatus === "EXECUTAVEL")
    .sort((a, b) => (b.evCons ?? 0) - (a.evCons ?? 0) || (b.edgeCons ?? 0) - (a.edgeCons ?? 0))
    .slice(0, MAX_SELECTIONS);
}

/** Módulo opcional de banca — separado da decisão de valor. Nunca arredonda para cima. */
export function stakeSuggestion(bankroll: number, odd: number, pCons: number) {
  const hardCap = bankroll * 0.02;
  const b = odd - 1;
  const kelly = b > 0 ? (pCons * b - (1 - pCons)) / b : 0;
  const fractional = Math.max(0, kelly * 0.25) * bankroll;
  const stake = Math.min(hardCap, fractional);
  return { hardCap, kellyFraction: kelly, stake: Math.floor(stake * 100) / 100 };
}
