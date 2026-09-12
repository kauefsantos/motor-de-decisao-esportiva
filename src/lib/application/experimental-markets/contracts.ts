import type { Database } from "@/integrations/supabase/database.types";
import type { ExperimentalMarketFamily } from "../../engine/experimental-goal-markets";
import type { ContractType } from "../../engine/types";
import type { ValueResult } from "../../engine/value";

export const EXPERIMENTAL_MARKETS_STATUS = "EXPERIMENTAL_CURRENT_SEASON" as const;
export const PRODUCTION_STATUS = "MODEL_NOT_PRODUCTION_VALIDATED" as const;
export const MIN_EXPERIMENTAL_MATCHES = 3;

export type RawValue = Record<string, unknown>;
export type PredictionInsert = Database["public"]["Tables"]["model_predictions"]["Insert"];
export type TrackingInsert = Database["public"]["Tables"]["experimental_bet_tracking"]["Insert"];

export type ExperimentalCandidate = {
  predictionId: string;
  matchId: string;
  matchLabel: string;
  competition: string;
  family: ExperimentalMarketFamily;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string;
  lineRaw: string | null;
  lineCanonical: number | null;
  contractType: ContractType;
  probabilityExperimental: number;
  fairOddExperimental: number | null;
  sampleSize: number;
  trainingMatches: number;
  quoteAnchor: true;
  modelVersion: string;
  modelStatus: typeof EXPERIMENTAL_MARKETS_STATUS;
  productionStatus: typeof PRODUCTION_STATUS;
  dataStatus: "OK";
};

export type PredictionForAnalysis = {
  prediction_id: string;
  match_id: string | null;
  market: string;
  participant: string | null;
  side: string | null;
  line_raw: string | null;
  line_canonical: number | string | null;
  model_probability: number | string | null;
  outcome_distribution: unknown;
  model_status: string;
  data_status: string;
  model_version: string | null;
};

export type ReferenceAlternative = {
  matchId: string;
  market: string;
  participant: string | null;
  side: "OVER" | "UNDER";
  lineCanonical: number;
  marketLabel: string;
  probabilityExperimental: number;
  fairOdd: number | null;
  minOddTarget: number | null;
  requiresRealOdd: true;
  valueStatus: "NAO_AVALIADO";
};

export type DirectionAssessment = {
  matchId: string;
  market: string;
  participant: string | null;
  anchorLine: number;
  direction: "VALUE_OVER" | "VALUE_UNDER" | "MODEL_LEAN_OVER" | "MODEL_LEAN_UNDER" | "NEUTRAL";
  basis: "VALUE" | "MODEL_ONLY" | "NEUTRAL";
  overProbability: number;
  underProbability: number;
  bestValuePredictionId: string | null;
  referenceAlternatives: ReferenceAlternative[];
};

export type EnrichedValueResult = ValueResult & {
  matchId: string | null;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string | null;
  lineCanonical: number | null;
  probabilityExperimental: number;
  modelVersion: string | null;
  family: ExperimentalMarketFamily;
  modelStatus: typeof EXPERIMENTAL_MARKETS_STATUS;
  productionStatus: typeof PRODUCTION_STATUS;
};

export type ExperimentalMatch = {
  id: string;
  raw_partida: string;
  home_team: string | null;
  away_team: string | null;
  competition: string | null;
  kickoff_local?: string | null;
};

export type ExternalIdRow = {
  match_id: string;
  source: string;
  external_id: string;
};

export type RunRawRow = { match_id: string | null; raw_value: unknown };
