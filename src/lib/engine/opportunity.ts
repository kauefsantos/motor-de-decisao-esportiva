// MOTOR 1 — OPPORTUNITY ENGINE. Independente de preço.
// A odd da casa NUNCA entra como feature aqui.

import { canonicalLine, AmbiguousLineError, asianOutcomes, pProfit } from "./settlement";
import type {
  BlockReason,
  DataStatus,
  MarketContract,
  ModelStatus,
  OpportunityOutput,
} from "./types";

export const BASE_GATE = 0.65;

export interface NormalizedFeature {
  metric: string;
  value: number;
  sampleSize: number;
  source: string;
  definitionVersion: string;
  definitionCompatible: boolean;
}

export interface ModelRegistryEntry {
  family: string;
  modelVersion: string;
  calibrationVersion: string | null;
  validationStatus: string;
}

export interface MatchContext {
  matchId: string;
  matchLabel: string;
  league: string;
  kickoff: string | null;
  predictionAt: string;
  features: Map<string, NormalizedFeature>;
  /** distribuição de contagem por métrica, quando o modelo estiver validado */
  countDistributions: Map<string, Map<number, number>>;
  binaryProbabilities: Map<string, number>;
  sources: string[];
}

export interface OpportunityEvaluation extends OpportunityOutput {}

function shortId(index: number) {
  return String(index + 1).padStart(2, "0");
}

export function buildPredictionId(kickoff: string | null, league: string, index: number) {
  const d = kickoff ? new Date(kickoff) : new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
  const slug =
    league
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 6) || "LIGA";
  return `${ymd}-${slug}-${shortId(index)}`;
}

/**
 * Avalia um contrato. Se calibração/validação/dados necessários não existirem,
 * NÃO inventa probabilidade: bloqueia com status honesto.
 */
export function evaluateContract(
  ctx: MatchContext,
  contract: MarketContract,
  registry: Map<string, ModelRegistryEntry>,
  index: number,
): OpportunityEvaluation {
  const predictionId = buildPredictionId(ctx.kickoff, ctx.league, index);

  let lineCanonical: number | null = null;
  if (contract.lineRaw) {
    try {
      lineCanonical = canonicalLine(contract.lineRaw);
    } catch (err) {
      if (err instanceof AmbiguousLineError) {
        return blocked(ctx, contract, predictionId, null, "OK", "OK", "AMBIGUOUS_LINE",
          "Rótulo de linha ambíguo; contrato não publicado.");
      }
      throw err;
    }
  }

  // 1) Definições de dados compatíveis?
  const mismatched = contract.requiredMetrics.filter((m) => {
    const f = ctx.features.get(m);
    return f ? !f.definitionCompatible : false;
  });
  if (mismatched.length > 0) {
    return blocked(ctx, contract, predictionId, lineCanonical, "OK", "DATA_DEFINITION_MISMATCH",
      "DATA_DEFINITION_MISMATCH",
      `Definição incompatível para: ${mismatched.join(", ")}.`);
  }

  // 2) Campos essenciais presentes?
  const missing = contract.requiredMetrics.filter((m) => !ctx.features.has(m));
  if (missing.length > 0) {
    return blocked(ctx, contract, predictionId, lineCanonical, "OK", "INSUFFICIENT_DATA",
      "INSUFFICIENT_DATA",
      `Dados essenciais ausentes: ${missing.join(", ")}. Nenhuma probabilidade foi estimada.`);
  }

  // 3) Modelo validado em produção?
  const model = registry.get(contract.family);
  if (!model || model.validationStatus !== "PRODUCTION_VALIDATED" || !model.calibrationVersion) {
    return blocked(ctx, contract, predictionId, lineCanonical, "MODEL_NOT_PRODUCTION_VALIDATED", "OK",
      "MODEL_NOT_PRODUCTION_VALIDATED",
      "Modelo/calibração ainda não validados out-of-sample para este mercado.");
  }

  // 4) Probabilidade (somente quando existe modelo calibrado real)
  if (contract.contractType === "ASIAN") {
    const key = `${contract.market}:${contract.participant ?? "MATCH"}`;
    const dist = ctx.countDistributions.get(key);
    if (!dist || lineCanonical === null) {
      return blocked(ctx, contract, predictionId, lineCanonical, "OK", "INSUFFICIENT_DATA",
        "INSUFFICIENT_DATA", "Distribuição de contagem indisponível.");
    }
    const outcomes = asianOutcomes(dist, lineCanonical, contract.side === "UNDER" ? "UNDER" : "OVER");
    const pProfitCal = pProfit(outcomes);
    const quality = scoreQuality(ctx, contract);
    const pCons = Math.max(0, pProfitCal - quality.uncertainty);
    const published = pProfitCal >= BASE_GATE;
    return {
      ...shell(ctx, contract, predictionId, lineCanonical),
      modelProbability: pProfitCal,
      pCal: pProfitCal,
      pCons,
      outcomeDistribution: outcomes,
      fairOddInfo: pCons > 0 ? 1 / pCons : null,
      ...quality,
      marketScore: pProfitCal * quality.confidenceScore,
      modelStatus: "OK",
      dataStatus: "OK",
      published,
      blockReason: published ? null : "BASE_GATE_NOT_MET",
      reasonShort: published
        ? "Suporte quantitativo suficiente no gate-base asiático."
        : `p_profit_cal ${(pProfitCal * 100).toFixed(1)}% abaixo do gate de 65%.`,
    };
  }

  const key = `${contract.market}:${contract.side}`;
  const pCal = ctx.binaryProbabilities.get(key);
  if (pCal === undefined) {
    return blocked(ctx, contract, predictionId, lineCanonical, "OK", "INSUFFICIENT_DATA",
      "INSUFFICIENT_DATA", "Probabilidade calibrada indisponível para o contrato.");
  }
  const quality = scoreQuality(ctx, contract);
  const pCons = Math.max(0, pCal - quality.uncertainty);
  const published = pCal >= BASE_GATE;
  return {
    ...shell(ctx, contract, predictionId, lineCanonical),
    modelProbability: pCal,
    pCal,
    pCons,
    outcomeDistribution: null,
    fairOddInfo: pCons > 0 ? 1 / pCons : null,
    ...quality,
    marketScore: pCal * quality.confidenceScore,
    modelStatus: "OK",
    dataStatus: "OK",
    published,
    blockReason: published ? null : "BASE_GATE_NOT_MET",
    reasonShort: published
      ? "Suporte quantitativo suficiente no gate-base binário."
      : `p_cal ${(pCal * 100).toFixed(1)}% abaixo do gate de 65%.`,
  };
}

function scoreQuality(ctx: MatchContext, contract: MarketContract) {
  const feats = contract.requiredMetrics
    .map((m) => ctx.features.get(m))
    .filter((f): f is NormalizedFeature => Boolean(f));
  const minSample = feats.length ? Math.min(...feats.map((f) => f.sampleSize)) : 0;
  const sampleReliability = Math.min(1, minSample / 20);
  const dataQualityScore = feats.length ? feats.length / contract.requiredMetrics.length : 0;
  const uncertainty = Math.max(0.01, 0.12 * (1 - sampleReliability));
  const stability = sampleReliability;
  const confidenceScore = Math.max(0, dataQualityScore * sampleReliability * (1 - uncertainty));
  return { sampleReliability, dataQualityScore, uncertainty, stability, confidenceScore };
}

function shell(
  ctx: MatchContext,
  contract: MarketContract,
  predictionId: string,
  lineCanonical: number | null,
): OpportunityOutput {
  return {
    predictionId,
    matchId: ctx.matchId,
    matchLabel: ctx.matchLabel,
    league: ctx.league,
    kickoff: ctx.kickoff,
    family: contract.family,
    contractType: contract.contractType,
    market: contract.market,
    marketLabel: contract.label,
    participant: contract.participant ?? null,
    side: contract.side ?? null,
    lineRaw: contract.lineRaw ?? null,
    lineCanonical,
    modelProbability: null,
    pCal: null,
    pCons: null,
    outcomeDistribution: null,
    fairOddInfo: null,
    confidenceScore: null,
    dataQualityScore: null,
    sampleReliability: null,
    uncertainty: null,
    stability: null,
    marketScore: null,
    settlementDefinition: contract.settlementDefinition,
    modelStatus: "OK",
    dataStatus: "OK",
    published: false,
    blockReason: null,
    reasonShort: "",
    sources: ctx.sources,
  };
}

function blocked(
  ctx: MatchContext,
  contract: MarketContract,
  predictionId: string,
  lineCanonical: number | null,
  modelStatus: ModelStatus,
  dataStatus: DataStatus,
  blockReason: BlockReason,
  reasonShort: string,
): OpportunityOutput {
  return {
    ...shell(ctx, contract, predictionId, lineCanonical),
    modelStatus,
    dataStatus,
    published: false,
    blockReason,
    reasonShort,
  };
}
