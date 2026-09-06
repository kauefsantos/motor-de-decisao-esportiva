// Tipos compartilhados entre MOTOR 1 (oportunidade, sem preço) e MOTOR 2 (preço/valor).
// Nenhum tipo aqui carrega odd de casa para dentro do Motor 1.

export type MarketFamily =
  | "1X2"
  | "BTTS"
  | "CORNERS"
  | "CARDS"
  | "SHOTS"
  | "SHOTS_ON_TARGET";

export type MarketScope = "MATCH" | "TEAM";

export type ContractType = "BINARY" | "ASIAN";

export type ModelStatus =
  | "OK"
  | "MODEL_NOT_PRODUCTION_VALIDATED"
  | "CALIBRATION_MISSING";

export type DataStatus =
  | "OK"
  | "INSUFFICIENT_DATA"
  | "DATA_DEFINITION_MISMATCH"
  | "SOURCE_NOT_CONFIGURED"
  | "SOURCE_UNAVAILABLE";

export type BlockReason =
  | "MODEL_NOT_PRODUCTION_VALIDATED"
  | "DATA_DEFINITION_MISMATCH"
  | "INSUFFICIENT_DATA"
  | "SOURCE_NOT_CONFIGURED"
  | "SOURCE_UNAVAILABLE"
  | "BASE_GATE_NOT_MET"
  | "AMBIGUOUS_LINE";

/** Contrato definido pelo catálogo de mercados, antes de qualquer estimativa. */
export interface MarketContract {
  family: MarketFamily;
  scope: MarketScope;
  contractType: ContractType;
  market: string;
  label: string;
  side?: "OVER" | "UNDER" | "HOME" | "DRAW" | "AWAY" | "YES" | "NO";
  participant?: string | null;
  lineRaw?: string | null;
  settlementDefinition: string;
  /** métricas normalizadas obrigatórias para o contrato ser modelável */
  requiredMetrics: string[];
}

/** Saída do MOTOR 1. Nunca contém odd de bookmaker. */
export interface OpportunityOutput {
  predictionId: string;
  matchId: string;
  matchLabel: string;
  league: string;
  kickoff: string | null;
  family: MarketFamily;
  contractType: ContractType;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string | null;
  lineRaw: string | null;
  lineCanonical: number | null;
  modelProbability: number | null;
  pCal: number | null;
  pCons: number | null;
  /** decomposição asiática, quando aplicável */
  outcomeDistribution: AsianOutcomeProbabilities | null;
  fairOddInfo: number | null;
  confidenceScore: number | null;
  dataQualityScore: number | null;
  sampleReliability: number | null;
  uncertainty: number | null;
  stability: number | null;
  marketScore: number | null;
  settlementDefinition: string;
  modelStatus: ModelStatus;
  dataStatus: DataStatus;
  published: boolean;
  blockReason: BlockReason | null;
  reasonShort: string;
  sources: string[];
}

export interface AsianOutcomeProbabilities {
  FULL_WIN: number;
  HALF_WIN: number;
  PUSH: number;
  HALF_LOSS: number;
  FULL_LOSS: number;
}
