import { createServerFn } from "@tanstack/react-start";

import {
  filterQuoteAnchorPredictions,
  passesExperimentalModelGate,
} from "./engine/market-policy";

const EXPERIMENTAL_STATUS = "EXPERIMENTAL_CURRENT_SEASON";
const EV_TARGET = 0.02;

// The strict >70% rule landed on main on 11/09/2026. Runs created before
// this instant are kept as legacy evidence and are never used to validate the
// new rule in production.
export const STRICT_GATE_EFFECTIVE_AT = "2026-09-11T20:53:00.000Z";

type RunRow = {
  id: string;
  target_date: string | null;
  created_at: string;
  status: string;
  current_step: string | null;
  matches_total: number | null;
  matches_resolved: number | null;
  matches_failed: number | null;
  selections_count: number | null;
};

type PredictionRow = {
  prediction_id: string;
  match_id: string | null;
  market: string;
  participant: string | null;
  side: string | null;
  line_canonical: number | string | null;
  model_probability: number | string | null;
  model_status: string;
};

type SnapshotRow = {
  prediction_id: string;
  status: string;
  odd: number | string | null;
  fetched_at: string | null;
};

type TrackingRow = {
  prediction_id: string;
  model_probability: number | string;
  expected_value: number | string | null;
  bet_status: string;
  result: string;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectionLimitForDate(isoDate: string | null): number {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 2;
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 3 : 2;
}

function emptyFunnel() {
  return {
    anchorPredictions: 0,
    above70: 0,
    rejectedAtOrBelow70: 0,
    bucket70To75: 0,
    bucket75To80: 0,
    bucket80To85: 0,
    bucket85Plus: 0,
    oddsSnapshots: 0,
    automaticPrices: 0,
    lineMismatch: 0,
    noPrice: 0,
    unsupported: 0,
    sourceUnavailable: 0,
    pricedAtOrBelow70: 0,
    automaticEvPass: 0,
    selected: 0,
    open: 0,
    settled: 0,
  };
}

async function buildFunnel(rawDb: { from: (table: string) => any }, run: RunRow) {
  const [{ data: predictionData }, { data: snapshotData }, { data: trackingData }] = await Promise.all([
    rawDb
      .from("model_predictions")
      .select("prediction_id,match_id,market,participant,side,line_canonical,model_probability,model_status")
      .eq("run_id", run.id)
      .eq("model_status", EXPERIMENTAL_STATUS),
    rawDb
      .from("experimental_odds_snapshots")
      .select("prediction_id,status,odd,fetched_at")
      .eq("run_id", run.id),
    rawDb
      .from("experimental_bet_tracking")
      .select("prediction_id,model_probability,expected_value,bet_status,result")
      .eq("run_id", run.id),
  ]);

  const predictions = (predictionData ?? []) as PredictionRow[];
  const snapshots = (snapshotData ?? []) as SnapshotRow[];
  const tracking = (trackingData ?? []) as TrackingRow[];
  const anchors = filterQuoteAnchorPredictions(predictions);
  const predictionById = new Map(anchors.map((row) => [row.prediction_id, row]));

  const probabilities = anchors
    .map((row) => numberOrNull(row.model_probability))
    .filter((value): value is number => value !== null);
  const above70 = probabilities.filter((value) => passesExperimentalModelGate(value)).length;
  const rejectedAtOrBelow70 = probabilities.length - above70;

  const matchedSnapshots = snapshots.filter(
    (row) => row.status === "MATCHED" && (numberOrNull(row.odd) ?? 0) > 1,
  );
  const pricedAtOrBelow70 = matchedSnapshots.filter((row) => {
    const prediction = predictionById.get(row.prediction_id);
    return !passesExperimentalModelGate(numberOrNull(prediction?.model_probability));
  }).length;
  const automaticEvPass = matchedSnapshots.filter((row) => {
    const prediction = predictionById.get(row.prediction_id);
    const probability = numberOrNull(prediction?.model_probability);
    const odd = numberOrNull(row.odd);
    return (
      probability !== null &&
      passesExperimentalModelGate(probability) &&
      odd !== null &&
      probability * odd - 1 >= EV_TARGET
    );
  }).length;

  return {
    anchorPredictions: anchors.length,
    above70,
    rejectedAtOrBelow70,
    bucket70To75: probabilities.filter((value) => value > 0.70 && value < 0.75).length,
    bucket75To80: probabilities.filter((value) => value >= 0.75 && value < 0.80).length,
    bucket80To85: probabilities.filter((value) => value >= 0.80 && value < 0.85).length,
    bucket85Plus: probabilities.filter((value) => value >= 0.85).length,
    oddsSnapshots: snapshots.length,
    automaticPrices: matchedSnapshots.length,
    lineMismatch: snapshots.filter((row) => row.status === "LINE_MISMATCH").length,
    noPrice: snapshots.filter((row) => row.status === "NO_PRICE").length,
    unsupported: snapshots.filter((row) => row.status === "UNSUPPORTED").length,
    sourceUnavailable: snapshots.filter((row) => row.status === "SOURCE_UNAVAILABLE").length,
    pricedAtOrBelow70,
    automaticEvPass,
    selected: tracking.length,
    open: tracking.filter((row) => row.bet_status === "OPEN" && row.result === "PENDING").length,
    settled: tracking.filter((row) => row.bet_status === "SETTLED" || row.result !== "PENDING").length,
  };
}

export const getDecisionObservability = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  const userId = context.userId;
  if (!userId) throw new Error("Usuário não autenticado.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rawDb = supabaseAdmin as unknown as { from: (table: string) => any };

  const { data: runData, error: runError } = await rawDb
    .from("analysis_runs")
    .select("id,target_date,created_at,status,current_step,matches_total,matches_resolved,matches_failed,selections_count")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (runError) throw new Error(`Falha ao carregar o funil de decisão: ${runError.message}`);

  const runs = (runData ?? []) as RunRow[];
  const latestRun = runs[0] ?? null;
  const strictRun = runs.find((run) => run.created_at >= STRICT_GATE_EFFECTIVE_AT) ?? null;
  const inspectedRun = strictRun ?? latestRun;
  const funnel = inspectedRun ? await buildFunnel(rawDb, inspectedRun) : emptyFunnel();
  const isStrictValidation = Boolean(strictRun && inspectedRun?.id === strictRun.id);
  const selectionLimit = selectionLimitForDate(inspectedRun?.target_date ?? null);

  const health = {
    strictRuleHasRealRun: isStrictValidation,
    noLowProbabilityPriceLeak: isStrictValidation ? funnel.pricedAtOrBelow70 === 0 : null,
    selectionCapRespected: funnel.selected <= selectionLimit,
    readyForValueValidation: funnel.automaticPrices > 0 || funnel.selected > 0,
  };

  return {
    effectiveAt: STRICT_GATE_EFFECTIVE_AT,
    inspectedRun,
    isStrictValidation,
    selectionLimit,
    funnel,
    health,
    recentRuns: runs.map((run) => ({
      id: run.id,
      targetDate: run.target_date,
      createdAt: run.created_at,
      status: run.status,
      matchesTotal: run.matches_total ?? 0,
      afterStrictGate: run.created_at >= STRICT_GATE_EFFECTIVE_AT,
    })),
    note: isStrictValidation
      ? "Esta análise foi iniciada depois da ativação da regra estrita >70%."
      : "Ainda não existe uma análise iniciada depois da ativação da regra estrita >70%; os números exibidos são apenas referência histórica.",
  };
});
