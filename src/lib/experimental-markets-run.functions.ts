import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  CORNERS_MODEL_VERSION,
  fitBaseline as fitCornersBaseline,
  poissonDistribution,
  predict as predictCorners,
  type CornerMatchRow,
} from "./engine/corners";
import {
  GOALS_MODEL_VERSION,
  fitGoalsBaseline,
  predictGoals,
  type GoalMatchRow,
} from "./engine/goals";
import {
  buildGoalMarketProjections,
  familyForMarket,
  type ExperimentalMarketFamily,
} from "./engine/experimental-goal-markets";
import {
  asianFairOdd,
  asianOutcomes,
  canonicalLine,
  pProfit,
} from "./engine/settlement";
import { BASE_GATE } from "./engine/opportunity";
import { evaluateValue, finalSelection, type ValueInput, type ValueResult } from "./engine/value";
import type { AsianOutcomeProbabilities, ContractType } from "./engine/types";

export const EXPERIMENTAL_MARKETS_STATUS = "EXPERIMENTAL_CURRENT_SEASON" as const;
const PRODUCTION_STATUS = "MODEL_NOT_PRODUCTION_VALIDATED" as const;
const SOURCE = "five_dollar_football";
const MIN_EXPERIMENTAL_MATCHES = 3;

type RawValue = Record<string, unknown>;

type ExperimentalCandidate = {
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
  gate: number;
  gateMet: boolean;
  modelVersion: string;
  modelStatus: typeof EXPERIMENTAL_MARKETS_STATUS;
  productionStatus: typeof PRODUCTION_STATUS;
  dataStatus: "OK";
};

type TrackingTable = {
  upsert: (
    values: Record<string, unknown>[],
    options?: { onConflict?: string },
  ) => PromiseLike<{ error: { message: string } | null }>;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function trackingTable(supabase: Awaited<ReturnType<typeof db>>) {
  return (supabase as unknown as { from: (name: string) => TrackingTable }).from(
    "experimental_bet_tracking",
  );
}

function asRecord(value: unknown): RawValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RawValue)
    : null;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function leagueFromExternalMatchId(externalMatchId: string): string {
  return externalMatchId.split(":")[0] ?? "";
}

function seasonKey(date: string, league: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (league.toLowerCase().includes("brazil")) return year;
  return month >= 8 ? year : year - 1;
}

function predictionId(runId: string, matchId: string, family: string, ordinal: number) {
  return `EXP-${family}-${runId.slice(0, 6)}-${matchId.slice(0, 6)}-${String(ordinal).padStart(2, "0")}`;
}

function selectionLimitForDate(isoDate: string | null): number {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return 2;
  const [year, month, day] = isoDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 || weekday === 6 ? 3 : 2;
}

function mostFrequentLeague(
  raws: { match_id: string | null; raw_value: unknown }[],
  matchId: string,
) {
  const counts = new Map<string, number>();
  for (const row of raws) {
    if (row.match_id !== matchId) continue;
    const rv = asRecord(row.raw_value);
    const league = leagueFromExternalMatchId(String(rv?.externalMatchId ?? ""));
    if (!league) continue;
    counts.set(league, (counts.get(league) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]?.[0] ?? null;
}

function buildDatasets(observations: RawValue[]) {
  const corners = new Map<string, CornerMatchRow>();
  const goals = new Map<string, GoalMatchRow>();
  const conflicts = new Set<string>();

  for (const rv of observations) {
    const externalMatchId = String(rv.externalMatchId ?? "");
    const date = String(rv.fixtureDate ?? "");
    const league = leagueFromExternalMatchId(externalMatchId);
    const raw = asRecord(rv.rawHomeAway);
    const teamId = String(rv.teamId ?? rv.teamExternalId ?? "");
    const opponentId = String(rv.opponentId ?? "");
    const side = String(rv.teamSideInFixture ?? "");
    if (!externalMatchId || !date || !league || !raw || !teamId || !opponentId) continue;
    if (side !== "HOME" && side !== "AWAY") continue;

    const homeTeam = side === "HOME" ? teamId : opponentId;
    const awayTeam = side === "HOME" ? opponentId : teamId;
    const homeCorners = finiteNumber(raw.cornersHome);
    const awayCorners = finiteNumber(raw.cornersAway);
    const homeGoals = finiteNumber(raw.goalsHome);
    const awayGoals = finiteNumber(raw.goalsAway);

    if (homeCorners !== null && awayCorners !== null) {
      const next: CornerMatchRow = {
        date,
        league,
        homeTeam,
        awayTeam,
        homeCorners,
        awayCorners,
      };
      const prev = corners.get(externalMatchId);
      if (
        prev &&
        (prev.homeTeam !== next.homeTeam ||
          prev.awayTeam !== next.awayTeam ||
          prev.homeCorners !== next.homeCorners ||
          prev.awayCorners !== next.awayCorners)
      ) {
        conflicts.add(externalMatchId);
      } else {
        corners.set(externalMatchId, next);
      }
    }

    if (homeGoals !== null && awayGoals !== null) {
      const next: GoalMatchRow = {
        date,
        league,
        homeTeam,
        awayTeam,
        homeGoals,
        awayGoals,
      };
      const prev = goals.get(externalMatchId);
      if (
        prev &&
        (prev.homeTeam !== next.homeTeam ||
          prev.awayTeam !== next.awayTeam ||
          prev.homeGoals !== next.homeGoals ||
          prev.awayGoals !== next.awayGoals)
      ) {
        conflicts.add(externalMatchId);
      } else {
        goals.set(externalMatchId, next);
      }
    }
  }

  for (const id of conflicts) {
    corners.delete(id);
    goals.delete(id);
  }
  return { corners: [...corners.values()], goals: [...goals.values()] };
}

function labelFor(
  market: string,
  participant: string | null,
  side: string | null,
  lineRaw: string | null,
) {
  if (market === "corners_match_total") {
    return `Escanteios da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "corners_team_total") {
    return `Escanteios ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "goals_match_total") {
    return `Gols da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "team_goals_total") {
    return `Gols ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineRaw ?? ""}`.trim();
  }
  if (market === "1x2") {
    return side === "HOME" ? "Vitória mandante" : side === "AWAY" ? "Vitória visitante" : "Empate";
  }
  if (market === "double_chance") {
    return side === "1X" ? "Dupla chance: 1X" : side === "X2" ? "Dupla chance: X2" : "Dupla chance: 12";
  }
  if (market === "btts") return side === "YES" ? "Ambas marcam: Sim" : "Ambas marcam: Não";
  return market;
}

const prepareSchema = z.object({ runId: z.string().uuid() });

export const prepareExperimentalMarketsRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => prepareSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const { data: run } = await supabase
      .from("analysis_runs")
      .select("notes, created_at")
      .eq("id", data.runId)
      .single();
    const storedPredictionAt = (run?.notes as { prediction_at?: unknown } | null)?.prediction_at;
    const predictionAt =
      typeof storedPredictionAt === "string" && Number.isFinite(Date.parse(storedPredictionAt))
        ? storedPredictionAt
        : run?.created_at ?? new Date().toISOString();
    const predictionDate = predictionAt.slice(0, 10);

    const { data: matches } = await supabase
      .from("matches")
      .select("id, raw_partida, home_team, away_team, competition, kickoff_local")
      .eq("run_id", data.runId)
      .order("kickoff_local", { ascending: true });
    const matchIds = (matches ?? []).map((m) => m.id);
    if (matchIds.length === 0) {
      return {
        candidates: [] as ExperimentalCandidate[],
        issues: ["Nenhuma partida encontrada na run."],
        predictionAt,
      };
    }

    const [{ data: externalIds }, { data: runRaws }, { data: historicalRaws }] =
      await Promise.all([
        supabase
          .from("match_external_ids")
          .select("match_id, source, external_id")
          .in("match_id", matchIds),
        supabase
          .from("raw_observations")
          .select("match_id, raw_value")
          .eq("run_id", data.runId)
          .eq("source", SOURCE)
          .limit(5000),
        supabase
          .from("raw_observations")
          .select("raw_value")
          .eq("source", SOURCE)
          .limit(10000),
      ]);

    const datasets = buildDatasets(
      (historicalRaws ?? [])
        .map((r) => asRecord(r.raw_value))
        .filter((r): r is RawValue => Boolean(r)),
    );

    await supabase
      .from("model_predictions")
      .delete()
      .eq("run_id", data.runId)
      .eq("model_status", EXPERIMENTAL_MARKETS_STATUS);

    const predictionRows: Record<string, unknown>[] = [];
    const candidates: ExperimentalCandidate[] = [];
    const issues: string[] = [];

    for (const match of matches ?? []) {
      const homeId = (externalIds ?? []).find(
        (x) => x.match_id === match.id && x.source === "five_dollar_team_home",
      )?.external_id;
      const awayId = (externalIds ?? []).find(
        (x) => x.match_id === match.id && x.source === "five_dollar_team_away",
      )?.external_id;
      const league = mostFrequentLeague(
        (runRaws ?? []) as { match_id: string | null; raw_value: unknown }[],
        match.id,
      );
      const label =
        match.home_team && match.away_team
          ? `${match.home_team} x ${match.away_team}`
          : match.raw_partida;
      if (!homeId || !awayId || !league) {
        issues.push(`${label}: sem IDs/league 5Dollar suficientes para inferência experimental.`);
        continue;
      }
      const targetSeason = seasonKey(predictionDate, league);

      const cornerTraining = datasets.corners.filter(
        (r) =>
          r.league === league &&
          r.date < predictionDate &&
          seasonKey(r.date, league) === targetSeason,
      );
      if (cornerTraining.length >= MIN_EXPERIMENTAL_MATCHES) {
        const params = fitCornersBaseline(cornerTraining);
        const forecast = predictCorners(params, {
          league,
          homeTeam: String(homeId),
          awayTeam: String(awayId),
        });
        if (forecast.sampleSize > 0) {
          const specs = [
            {
              market: "corners_match_total",
              participant: null,
              line: "9.5",
              dist: poissonDistribution(forecast.lambdaTotal),
            },
            {
              market: "corners_match_total",
              participant: null,
              line: "10.5",
              dist: poissonDistribution(forecast.lambdaTotal),
            },
            {
              market: "corners_team_total",
              participant: match.home_team ?? "Mandante",
              line: "4.5",
              dist: poissonDistribution(forecast.lambdaHome),
            },
            {
              market: "corners_team_total",
              participant: match.away_team ?? "Visitante",
              line: "4.5",
              dist: poissonDistribution(forecast.lambdaAway),
            },
          ];
          let ordinal = 0;
          for (const spec of specs) {
            for (const side of ["OVER", "UNDER"] as const) {
              ordinal += 1;
              const line = canonicalLine(spec.line);
              const outcomes = asianOutcomes(spec.dist, line, side);
              const p = pProfit(outcomes);
              const id = predictionId(data.runId, match.id, "CORNERS", ordinal);
              predictionRows.push({
                run_id: data.runId,
                match_id: match.id,
                prediction_id: id,
                market: spec.market,
                participant: spec.participant,
                side,
                line_raw: spec.line,
                line_canonical: line,
                model_probability: p,
                p_cal: null,
                conservative_probability: null,
                outcome_distribution: outcomes,
                model_version: CORNERS_MODEL_VERSION,
                calibration_version: null,
                model_status: EXPERIMENTAL_MARKETS_STATUS,
                data_status: "OK",
                prediction_at: predictionAt,
              });
              candidates.push({
                predictionId: id,
                matchId: match.id,
                matchLabel: label,
                competition: match.competition ?? "",
                family: "CORNERS",
                market: spec.market,
                marketLabel: labelFor(spec.market, spec.participant, side, spec.line),
                participant: spec.participant,
                side,
                lineRaw: spec.line,
                lineCanonical: line,
                contractType: "ASIAN",
                probabilityExperimental: p,
                fairOddExperimental: asianFairOdd(outcomes),
                sampleSize: forecast.sampleSize,
                trainingMatches: cornerTraining.length,
                gate: BASE_GATE,
                gateMet: p >= BASE_GATE,
                modelVersion: CORNERS_MODEL_VERSION,
                modelStatus: EXPERIMENTAL_MARKETS_STATUS,
                productionStatus: PRODUCTION_STATUS,
                dataStatus: "OK",
              });
            }
          }
        }
      }

      const goalTraining = datasets.goals.filter(
        (r) =>
          r.league === league &&
          r.date < predictionDate &&
          seasonKey(r.date, league) === targetSeason,
      );
      if (goalTraining.length < MIN_EXPERIMENTAL_MATCHES) {
        issues.push(
          `${label}: gols com ${goalTraining.length} partida(s) da temporada atual; mínimo experimental ${MIN_EXPERIMENTAL_MATCHES}.`,
        );
        continue;
      }
      const goalParams = fitGoalsBaseline(goalTraining);
      const goalForecast = predictGoals(goalParams, {
        league,
        homeTeam: String(homeId),
        awayTeam: String(awayId),
      });
      if (goalForecast.sampleSize < 1) {
        issues.push(`${label}: times ainda sem amostra própria suficiente de gols na temporada atual.`);
        continue;
      }

      const projections = buildGoalMarketProjections({
        homeTeam: match.home_team ?? "Mandante",
        awayTeam: match.away_team ?? "Visitante",
        lambdaHome: goalForecast.lambdaHome,
        lambdaAway: goalForecast.lambdaAway,
      });
      const familyOrdinals = new Map<ExperimentalMarketFamily, number>();

      for (const projection of projections) {
        const ordinal = (familyOrdinals.get(projection.family) ?? 0) + 1;
        familyOrdinals.set(projection.family, ordinal);
        const id = predictionId(data.runId, match.id, projection.family, ordinal);
        predictionRows.push({
          run_id: data.runId,
          match_id: match.id,
          prediction_id: id,
          market: projection.market,
          participant: projection.participant,
          side: projection.side,
          line_raw: projection.lineRaw,
          line_canonical: projection.lineCanonical,
          model_probability: projection.probability,
          p_cal: null,
          conservative_probability: null,
          outcome_distribution: projection.outcomeDistribution ?? {},
          model_version: GOALS_MODEL_VERSION,
          calibration_version: null,
          model_status: EXPERIMENTAL_MARKETS_STATUS,
          data_status: "OK",
          prediction_at: predictionAt,
        });
        candidates.push({
          predictionId: id,
          matchId: match.id,
          matchLabel: label,
          competition: match.competition ?? "",
          family: projection.family,
          market: projection.market,
          marketLabel: projection.marketLabel,
          participant: projection.participant,
          side: projection.side,
          lineRaw: projection.lineRaw,
          lineCanonical: projection.lineCanonical,
          contractType: projection.contractType,
          probabilityExperimental: projection.probability,
          fairOddExperimental: projection.fairOdd,
          sampleSize: goalForecast.sampleSize,
          trainingMatches: goalTraining.length,
          gate: BASE_GATE,
          gateMet: projection.probability >= BASE_GATE,
          modelVersion: GOALS_MODEL_VERSION,
          modelStatus: EXPERIMENTAL_MARKETS_STATUS,
          productionStatus: PRODUCTION_STATUS,
          dataStatus: "OK",
        });
      }
    }

    for (let i = 0; i < predictionRows.length; i += 200) {
      const { error } = await supabase
        .from("model_predictions")
        .insert(predictionRows.slice(i, i + 200) as never[]);
      if (error) {
        throw new Error(`Falha ao gravar model_predictions experimentais: ${error.message}`);
      }
    }

    return {
      candidates,
      issues,
      predictionAt,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
      calibrationVersion: null,
    };
  });

const oddsSchema = z.object({
  runId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        predictionId: z.string().min(1).max(180),
        odd: z.number().finite().gt(1).lt(1000),
        lineAtEntry: z.number().finite().nullable(),
      }),
    )
    .min(1)
    .max(300),
});

type EnrichedValueResult = ValueResult & {
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

export const analyzeExperimentalMarketsOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const ids = data.entries.map((e) => e.predictionId);
    const [{ data: predictions }, { data: run }] = await Promise.all([
      supabase
        .from("model_predictions")
        .select(
          "prediction_id, market, participant, side, line_raw, line_canonical, model_probability, outcome_distribution, model_status, data_status, match_id, model_version",
        )
        .eq("run_id", data.runId)
        .eq("model_status", EXPERIMENTAL_MARKETS_STATUS)
        .in("prediction_id", ids),
      supabase.from("analysis_runs").select("target_date").eq("id", data.runId).single(),
    ]);
    const byId = new Map((predictions ?? []).map((p) => [p.prediction_id, p]));
    const results: EnrichedValueResult[] = [];

    for (const entry of data.entries) {
      const p = byId.get(entry.predictionId);
      if (!p) continue;
      const modelProbability = p.model_probability === null ? 0 : Number(p.model_probability);
      const contractType: ContractType = p.line_canonical === null ? "BINARY" : "ASIAN";
      const input: ValueInput = {
        candidateId: p.prediction_id,
        predictionId: p.prediction_id,
        contractType,
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: p.line_canonical === null ? null : Number(p.line_canonical),
        pCons: contractType === "BINARY" ? modelProbability : null,
        outcomeDistribution:
          contractType === "ASIAN"
            ? (p.outcome_distribution as unknown as AsianOutcomeProbabilities | null)
            : null,
        published: modelProbability >= BASE_GATE,
        modelStatus: EXPERIMENTAL_MARKETS_STATUS,
        dataStatus: p.data_status,
      };
      const result = evaluateValue(input);
      results.push({
        ...result,
        matchId: p.match_id,
        market: p.market,
        marketLabel: labelFor(p.market, p.participant, p.side, p.line_raw),
        participant: p.participant,
        side: p.side,
        lineCanonical: p.line_canonical === null ? null : Number(p.line_canonical),
        probabilityExperimental: modelProbability,
        modelVersion: p.model_version,
        family: familyForMarket(p.market),
        modelStatus: EXPERIMENTAL_MARKETS_STATUS,
        productionStatus: PRODUCTION_STATUS,
      });
    }

    const targetDate = run?.target_date ?? null;
    const selectionLimit = selectionLimitForDate(targetDate);
    const selected = finalSelection(results).slice(0, selectionLimit) as EnrichedValueResult[];

    if (selected.length > 0) {
      const selectedMatchIds = selected
        .map((r) => r.matchId)
        .filter((id): id is string => Boolean(id));
      const { data: matches } = await supabase
        .from("matches")
        .select("id, raw_partida, home_team, away_team, competition")
        .in("id", selectedMatchIds);
      const matchById = new Map((matches ?? []).map((m) => [m.id, m]));
      const trackingRows = selected.map((r) => {
        const match = r.matchId ? matchById.get(r.matchId) : null;
        const matchLabel = match
          ? match.home_team && match.away_team
            ? `${match.home_team} x ${match.away_team}`
            : match.raw_partida
          : "—";
        return {
          run_id: data.runId,
          match_id: r.matchId,
          prediction_id: r.predictionId,
          target_date: targetDate,
          match_label: matchLabel,
          competition: match?.competition ?? null,
          market_family: r.family,
          market: r.market,
          market_label: r.marketLabel,
          participant: r.participant,
          side: r.side,
          line_canonical: r.lineCanonical,
          model_version: r.modelVersion ?? "unknown",
          model_status: EXPERIMENTAL_MARKETS_STATUS,
          model_probability: r.probabilityExperimental,
          fair_odd: r.fairOdd,
          entry_odd: r.odd,
          min_odd_target: r.minOddTarget,
          edge: r.edgeCons,
          expected_value: r.evCons,
          result: "PENDING",
          updated_at: new Date().toISOString(),
        };
      });
      const { error } = await trackingTable(supabase).upsert(trackingRows, {
        onConflict: "run_id,prediction_id",
      });
      if (error) throw new Error(`Falha ao registrar ledger experimental: ${error.message}`);
    }

    const selectedIds = new Set(selected.map((r) => r.predictionId));
    return {
      evaluations: results.map((r) => ({ ...r, selected: selectedIds.has(r.predictionId) })),
      selections: selected,
      selectionLimit,
      targetDate,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
    };
  });
