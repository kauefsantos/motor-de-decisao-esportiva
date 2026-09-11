import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const loadSchema = z.object({ runId: z.string().uuid() });

type Db = {
  from: (table: string) => any;
};

export type PersistedExperimentalEvaluation = {
  predictionId: string;
  matchId: string | null;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string | null;
  lineCanonical: number | null;
  odd: number;
  probabilityExperimental: number;
  decisionProbability: number | null;
  fairOdd: number | null;
  minOddTarget: number | null;
  edgeCons: number | null;
  evCons: number | null;
  probabilityStatus: string;
  valueStatus: string;
  executionStatus: string;
  rejectionReason: string | null;
  selected: boolean;
  modelVersion: string | null;
  family: string;
  modelStatus: string;
  productionStatus: string;
  matchLabel?: string;
  competition?: string;
  sampleSize?: number;
  trainingMatches?: number;
};

export type PersistedExperimentalResult = {
  runId: string;
  analyzedAt: string;
  targetDate: string | null;
  dayType: "WEEKDAY" | "WEEKEND";
  selectionLimit: number;
  modelStatus: string;
  productionStatus: string;
  evaluations: PersistedExperimentalEvaluation[];
  selectionOrder: string[];
  directionAssessments: unknown[];
  referenceAlternatives: unknown[];
  correlatedAlternates: unknown[];
};

function fingerprint(input: {
  predictionId: string;
  odd: number;
  lineCanonical: number | null;
  decisionProbability: number | null;
}) {
  const parts = [
    input.predictionId,
    input.odd.toFixed(8),
    input.lineCanonical === null ? "NO_LINE" : input.lineCanonical.toFixed(8),
    input.decisionProbability === null ? "NO_PROB" : input.decisionProbability.toFixed(12),
  ];
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function persistExperimentalResult(
  rawDb: Db,
  input: PersistedExperimentalResult,
) {
  const evaluationRows = input.evaluations.map((row) => ({
    run_id: input.runId,
    prediction_id: row.predictionId,
    match_id: row.matchId,
    market: row.market,
    market_label: row.marketLabel,
    participant: row.participant,
    side: row.side,
    line_canonical: row.lineCanonical,
    bookmaker: "bet365_br",
    price_source: "USER_OR_AUTOMATIC_INPUT",
    odd: row.odd,
    model_probability: row.probabilityExperimental,
    decision_probability: row.decisionProbability,
    fair_odd: row.fairOdd,
    min_odd_target: row.minOddTarget,
    edge: row.edgeCons,
    expected_value: row.evCons,
    probability_status: row.probabilityStatus,
    value_status: row.valueStatus,
    execution_status: row.executionStatus,
    rejection_reason: row.rejectionReason,
    selected: row.selected,
    model_version: row.modelVersion,
    model_status: row.modelStatus,
    production_status: row.productionStatus,
    market_family: row.family,
    evaluation_fingerprint: fingerprint({
      predictionId: row.predictionId,
      odd: row.odd,
      lineCanonical: row.lineCanonical,
      decisionProbability: row.decisionProbability,
    }),
    evaluated_at: input.analyzedAt,
  }));

  if (evaluationRows.length > 0) {
    const { error } = await rawDb.from("experimental_value_evaluations").upsert(
      evaluationRows,
      { onConflict: "run_id,prediction_id,evaluation_fingerprint", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Falha ao persistir ledger de value: ${error.message}`);
  }

  const { error: snapshotError } = await rawDb.from("experimental_analysis_results").upsert({
    run_id: input.runId,
    result_payload: input,
    analyzed_at: input.analyzedAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "run_id" });
  if (snapshotError) throw new Error(`Falha ao persistir resultado experimental: ${snapshotError.message}`);
}

export const getPersistedExperimentalResult = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => loadSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("experimental_analysis_results")
      .select("result_payload, analyzed_at")
      .eq("run_id", data.runId)
      .maybeSingle();

    if (error) throw new Error(`Não foi possível recuperar o resultado experimental: ${error.message}`);
    if (!row?.result_payload) return { result: null as PersistedExperimentalResult | null };

    const result = row.result_payload as PersistedExperimentalResult;
    if (result.runId !== data.runId) {
      throw new Error("O snapshot persistido não corresponde à rodada solicitada.");
    }
    return { result };
  });
