import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { absoluteCountProbability, familyForMarket } from "./engine/experimental-goal-markets";
import { distributionFromStoredOutcome } from "./engine/count-market-distribution";
import {
  filterQuoteAnchorPredictions,
  formatBookmakerLine,
  passesExperimentalModelGate,
  quoteAnchorFor,
  referenceLinesFor,
} from "./engine/market-policy";
import { EV_TARGET, evaluateValue, type ValueResult } from "./engine/value";
import { selectExperimentalPortfolio } from "./engine/portfolio-selection";
import { persistExperimentalResult, type PersistedExperimentalResult } from "./experimental-result-ledger.functions";
import { EXPERIMENTAL_MARKETS_STATUS } from "./experimental-markets-run.functions";

const PRODUCTION_STATUS = "MODEL_NOT_PRODUCTION_VALIDATED" as const;

const oddsSchema = z.object({
  runId: z.string().uuid(),
  entries: z.array(z.object({
    predictionId: z.string().min(1).max(180),
    odd: z.number().finite().gt(1).lt(1000),
    lineAtEntry: z.number().finite().nullable(),
  })).min(1).max(1000),
});

type PredictionForAnalysis = {
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

type ExperimentalMatchRow = {
  id: string;
  raw_partida: string;
  home_team: string | null;
  away_team: string | null;
  competition: string | null;
};

type ReferenceAlternative = {
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

type DirectionAssessment = {
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

type EnrichedValueResult = ValueResult & {
  matchId: string | null;
  matchLabel: string;
  competition: string;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string | null;
  lineCanonical: number | null;
  probabilityExperimental: number;
  modelVersion: string | null;
  family: ReturnType<typeof familyForMarket>;
  modelStatus: typeof EXPERIMENTAL_MARKETS_STATUS;
  productionStatus: typeof PRODUCTION_STATUS;
  sampleSize: number;
  trainingMatches: number;
};

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function selectionLimitForDate(_isoDate: string | null): number {
  return 3;
}

function dayTypeForDate(isoDate: string | null): "WEEKDAY" | "WEEKEND" {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return "WEEKDAY";
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? "WEEKEND" : "WEEKDAY";
}

function labelFor(market: string, participant: string | null, side: string | null, lineRaw: string | null) {
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

export function strictDirectionFromProbabilities(overProbability: number, underProbability: number) {
  if (passesExperimentalModelGate(overProbability)) return "OVER" as const;
  if (passesExperimentalModelGate(underProbability)) return "UNDER" as const;
  return null;
}

function buildDirectionAssessments(predictions: PredictionForAnalysis[], evaluations: EnrichedValueResult[]): DirectionAssessment[] {
  const totals = predictions.filter((row) => row.match_id && quoteAnchorFor(row.market) !== null && (row.side === "OVER" || row.side === "UNDER"));
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
    } else {
      selectedSide = strictDirectionFromProbabilities(overProbability, underProbability);
      if (selectedSide) {
        direction = selectedSide === "OVER" ? "MODEL_LEAN_OVER" : "MODEL_LEAN_UNDER";
        basis = "MODEL_ONLY";
      }
    }

    const source = selectedSide === "OVER" ? over : selectedSide === "UNDER" ? under : null;
    const dist = source ? distributionFromStoredOutcome(source.outcome_distribution) : null;
    const referenceAlternatives: ReferenceAlternative[] = [];
    if (selectedSide && source && dist) {
      for (const referenceLine of referenceLinesFor(source.market, selectedSide)) {
        const probability = absoluteCountProbability(dist, referenceLine, selectedSide);
        referenceAlternatives.push({
          matchId: over.match_id,
          market: source.market,
          participant: source.participant,
          side: selectedSide,
          lineCanonical: referenceLine,
          marketLabel: labelFor(source.market, source.participant, selectedSide, String(referenceLine)),
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

export const analyzeExperimentalMarketsOddsPersisted = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin;
    const { assertRunOwner } = await import("./authorization.server");
    await assertRunOwner(supabase, context.userId, data.runId);

    const [{ data: predictions }, { data: run }, { data: matches }] = await Promise.all([
      supabase.from("model_predictions")
        .select("prediction_id, market, participant, side, line_raw, line_canonical, model_probability, outcome_distribution, model_status, data_status, match_id, model_version")
        .eq("run_id", data.runId)
        .eq("model_status", EXPERIMENTAL_MARKETS_STATUS),
      supabase.from("analysis_runs").select("target_date").eq("id", data.runId).single(),
      supabase.from("matches").select("id, raw_partida, home_team, away_team, competition").eq("run_id", data.runId),
    ]);

    const matchById = new Map(((matches ?? []) as ExperimentalMatchRow[]).map((match) => [match.id, match]));
    const quotePredictions = filterQuoteAnchorPredictions((predictions ?? []) as PredictionForAnalysis[]);
    const byId = new Map(quotePredictions.map((prediction) => [prediction.prediction_id, prediction]));
    const results: EnrichedValueResult[] = [];

    for (const entry of data.entries) {
      const prediction = byId.get(entry.predictionId);
      if (!prediction) continue;
      const modelProbability = finiteNumber(prediction.model_probability) ?? 0;
      const evaluated = evaluateValue({
        candidateId: prediction.prediction_id,
        predictionId: prediction.prediction_id,
        contractType: "BINARY",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
        pCons: modelProbability,
        outcomeDistribution: null,
        published: true,
        modelStatus: EXPERIMENTAL_MARKETS_STATUS,
        dataStatus: prediction.data_status,
      });
      const match = prediction.match_id ? matchById.get(prediction.match_id) : null;
      const matchLabel = match
        ? match.home_team && match.away_team ? `${match.home_team} x ${match.away_team}` : match.raw_partida
        : "—";
      results.push({
        ...evaluated,
        matchId: prediction.match_id,
        matchLabel,
        competition: match?.competition ?? "",
        market: prediction.market,
        marketLabel: labelFor(prediction.market, prediction.participant, prediction.side, prediction.line_raw),
        participant: prediction.participant,
        side: prediction.side,
        lineCanonical: prediction.line_canonical === null ? null : Number(prediction.line_canonical),
        probabilityExperimental: modelProbability,
        modelVersion: prediction.model_version,
        family: familyForMarket(prediction.market),
        modelStatus: EXPERIMENTAL_MARKETS_STATUS,
        productionStatus: PRODUCTION_STATUS,
        sampleSize: 0,
        trainingMatches: 0,
      });
    }

    const targetDate = run?.target_date ?? null;
    const selectionLimit = selectionLimitForDate(targetDate);
    const portfolio = selectExperimentalPortfolio(results, selectionLimit);
    const selected = portfolio.selected as EnrichedValueResult[];
    const selectedIds = new Set(selected.map((row) => row.predictionId));

    if (selected.length > 0) {
      const trackingRows = selected.map((row) => ({
        run_id: data.runId,
        match_id: row.matchId,
        prediction_id: row.predictionId,
        target_date: targetDate,
        match_label: row.matchLabel,
        competition: row.competition || null,
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
      }));
      const { error } = await supabase.from("experimental_bet_tracking")
        .upsert(trackingRows, { onConflict: "run_id,prediction_id" });
      if (error) throw new Error(`Falha ao registrar sugestões experimentais: ${error.message}`);
    }

    const directionAssessments = buildDirectionAssessments(quotePredictions, results);
    const analyzedAt = new Date().toISOString();
    const evaluations = results.map((row) => ({ ...row, selected: selectedIds.has(row.predictionId) }));
    const persisted: PersistedExperimentalResult = {
      runId: data.runId,
      analyzedAt,
      targetDate,
      dayType: dayTypeForDate(targetDate),
      selectionLimit,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
      evaluations,
      selectionOrder: selected.map((row) => row.predictionId),
      directionAssessments,
      referenceAlternatives: directionAssessments.flatMap((assessment) => assessment.referenceAlternatives),
      correlatedAlternates: portfolio.correlatedAlternates,
    };

    await persistExperimentalResult(supabase, persisted);
    return {
      evaluations,
      selections: selected,
      correlatedAlternates: portfolio.correlatedAlternates,
      directionAssessments,
      referenceAlternatives: persisted.referenceAlternatives,
      selectionLimit,
      targetDate,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
      analyzedAt,
    };
  });
