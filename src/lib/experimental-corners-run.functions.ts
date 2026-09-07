import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildContracts } from "./engine/markets";
import {
  CORNERS_MODEL_VERSION,
  fitBaseline,
  poissonDistribution,
  predict,
  type CornerMatchRow,
} from "./engine/corners";
import {
  asianFairOdd,
  asianOutcomes,
  canonicalLine,
  pProfit,
} from "./engine/settlement";
import { BASE_GATE } from "./engine/opportunity";
import { evaluateValue, finalSelection, type ValueInput } from "./engine/value";
import type { AsianOutcomeProbabilities } from "./engine/types";

export const EXPERIMENTAL_CORNERS_STATUS = "EXPERIMENTAL_CURRENT_SEASON" as const;
const PRODUCTION_STATUS = "MODEL_NOT_PRODUCTION_VALIDATED" as const;
const SOURCE = "five_dollar_football";
const MIN_EXPERIMENTAL_MATCHES = 3;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type RawValue = Record<string, unknown>;

type ExperimentalCandidate = {
  predictionId: string;
  matchId: string;
  matchLabel: string;
  competition: string;
  market: string;
  marketLabel: string;
  participant: string | null;
  side: string;
  lineRaw: string;
  lineCanonical: number;
  probabilityExperimental: number;
  fairOddExperimental: number | null;
  sampleSize: number;
  trainingMatches: number;
  gate: number;
  gateMet: boolean;
  modelStatus: typeof EXPERIMENTAL_CORNERS_STATUS;
  productionStatus: typeof PRODUCTION_STATUS;
  dataStatus: "OK";
};

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

/**
 * Reconstrói partidas históricas da 5Dollar usando os IDs dos times e o placar
 * bruto home/away persistido no lineage. Isso evita inferir nomes de times a
 * partir de slugs ambíguos e nunca mistura "for" com "against".
 */
function buildFiveDollarCornerDataset(observations: RawValue[]): CornerMatchRow[] {
  const rows = new Map<string, CornerMatchRow>();
  const conflicts = new Set<string>();

  for (const rv of observations) {
    const externalMatchId = String(rv["externalMatchId"] ?? "");
    const date = String(rv["fixtureDate"] ?? "");
    const raw = asRecord(rv["rawHomeAway"]);
    const teamId = String(rv["teamId"] ?? rv["teamExternalId"] ?? "");
    const opponentId = String(rv["opponentId"] ?? "");
    const side = String(rv["teamSideInFixture"] ?? "");
    const league = leagueFromExternalMatchId(externalMatchId);

    if (!externalMatchId || !date || !league || !raw || !teamId || !opponentId) continue;
    if (side !== "HOME" && side !== "AWAY") continue;

    const homeCorners = finiteNumber(raw["cornersHome"]);
    const awayCorners = finiteNumber(raw["cornersAway"]);
    if (homeCorners === null || awayCorners === null) continue;

    const homeTeam = side === "HOME" ? teamId : opponentId;
    const awayTeam = side === "HOME" ? opponentId : teamId;
    const next: CornerMatchRow = {
      date,
      league,
      homeTeam,
      awayTeam,
      homeCorners,
      awayCorners,
    };

    const previous = rows.get(externalMatchId);
    if (
      previous &&
      (previous.homeTeam !== next.homeTeam ||
        previous.awayTeam !== next.awayTeam ||
        previous.homeCorners !== next.homeCorners ||
        previous.awayCorners !== next.awayCorners)
    ) {
      conflicts.add(externalMatchId);
      continue;
    }
    rows.set(externalMatchId, next);
  }

  for (const id of conflicts) rows.delete(id);
  return [...rows.values()];
}

function seasonKey(date: string, league: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (league.toLowerCase().includes("brazil")) return year;
  return month >= 8 ? year : year - 1;
}

function mostFrequentLeague(raws: { match_id: string | null; raw_value: unknown }[], matchId: string) {
  const counts = new Map<string, number>();
  for (const row of raws) {
    if (row.match_id !== matchId) continue;
    const rv = asRecord(row.raw_value);
    const externalMatchId = String(rv?.["externalMatchId"] ?? "");
    const league = leagueFromExternalMatchId(externalMatchId);
    if (!league) continue;
    counts.set(league, (counts.get(league) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function experimentalPredictionId(
  runId: string,
  matchId: string,
  ordinal: number,
): string {
  return `EXP-${runId.slice(0, 8)}-${matchId.slice(0, 8)}-${String(ordinal).padStart(2, "0")}`;
}

function contractLabel(
  market: string,
  participant: string | null,
  side: string | null,
  lineRaw: string | null,
) {
  const direction = side === "UNDER" ? "Menos de" : "Mais de";
  if (market === "corners_match_total") return `Escanteios da partida ${direction} ${lineRaw ?? ""}`.trim();
  return `Escanteios ${participant ?? "time"} ${direction} ${lineRaw ?? ""}`.trim();
}

const prepareSchema = z.object({ runId: z.string().uuid() });

/**
 * Prepara somente o piloto experimental de CORNERS. Produção permanece
 * intocada: não publica market_candidates e não altera model_versions.
 */
export const prepareExperimentalCornersRun = createServerFn({ method: "POST" })
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
      return { candidates: [] as ExperimentalCandidate[], issues: ["Nenhuma partida encontrada na run."], predictionAt };
    }

    const [{ data: externalIds }, { data: runRaws }, { data: historicalRaws }] = await Promise.all([
      supabase
        .from("match_external_ids")
        .select("match_id, source, external_id")
        .in("match_id", matchIds),
      supabase
        .from("raw_observations")
        .select("match_id, raw_value")
        .eq("run_id", data.runId)
        .eq("source", SOURCE)
        .ilike("metric", "%corners_taken%")
        .limit(5000),
      supabase
        .from("raw_observations")
        .select("raw_value")
        .eq("source", SOURCE)
        .ilike("metric", "%corners_taken%")
        .limit(10000),
    ]);

    const dataset = buildFiveDollarCornerDataset(
      (historicalRaws ?? [])
        .map((r) => asRecord(r.raw_value))
        .filter((r): r is RawValue => Boolean(r)),
    );

    await supabase
      .from("model_predictions")
      .delete()
      .eq("run_id", data.runId)
      .eq("model_status", EXPERIMENTAL_CORNERS_STATUS);

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
      const league = mostFrequentLeague((runRaws ?? []) as { match_id: string | null; raw_value: unknown }[], match.id);
      const label =
        match.home_team && match.away_team
          ? `${match.home_team} x ${match.away_team}`
          : match.raw_partida;

      if (!homeId || !awayId || !league) {
        issues.push(`${label}: sem IDs/league 5Dollar suficientes para inferência experimental.`);
        continue;
      }

      const targetSeason = seasonKey(predictionDate, league);
      const training = dataset.filter(
        (row) =>
          row.league === league &&
          row.date < predictionDate &&
          seasonKey(row.date, league) === targetSeason,
      );

      if (training.length < MIN_EXPERIMENTAL_MATCHES) {
        issues.push(
          `${label}: ${training.length} partida(s) da temporada atual; mínimo experimental ${MIN_EXPERIMENTAL_MATCHES}.`,
        );
        continue;
      }

      const params = fitBaseline(training);
      const forecast = predict(params, {
        league,
        homeTeam: String(homeId),
        awayTeam: String(awayId),
      });

      if (forecast.sampleSize < 1) {
        issues.push(`${label}: os dois times ainda não têm amostra própria na temporada atual.`);
        continue;
      }

      const totalDist = poissonDistribution(forecast.lambdaTotal);
      const homeDist = poissonDistribution(forecast.lambdaHome);
      const awayDist = poissonDistribution(forecast.lambdaAway);
      const contracts = buildContracts({
        home: match.home_team ?? "Mandante",
        away: match.away_team ?? "Visitante",
      }).filter((c) => c.family === "CORNERS");

      let ordinal = 0;
      for (const contract of contracts) {
        ordinal += 1;
        if (!contract.lineRaw || (contract.side !== "OVER" && contract.side !== "UNDER")) continue;
        const line = canonicalLine(contract.lineRaw);
        const countDist =
          contract.market === "corners_match_total"
            ? totalDist
            : contract.participant === (match.home_team ?? "Mandante")
              ? homeDist
              : awayDist;
        const outcomes = asianOutcomes(countDist, line, contract.side);
        const probabilityExperimental = pProfit(outcomes);
        const fairOddExperimental = asianFairOdd(outcomes);
        const predictionId = experimentalPredictionId(data.runId, match.id, ordinal);

        predictionRows.push({
          run_id: data.runId,
          match_id: match.id,
          prediction_id: predictionId,
          market: contract.market,
          participant: contract.participant ?? null,
          side: contract.side,
          line_raw: contract.lineRaw,
          line_canonical: line,
          model_probability: probabilityExperimental,
          p_cal: null,
          conservative_probability: null,
          outcome_distribution: outcomes,
          model_version: CORNERS_MODEL_VERSION,
          calibration_version: null,
          model_status: EXPERIMENTAL_CORNERS_STATUS,
          data_status: "OK",
          prediction_at: predictionAt,
        });

        candidates.push({
          predictionId,
          matchId: match.id,
          matchLabel: label,
          competition: match.competition ?? "",
          market: contract.market,
          marketLabel: contract.label,
          participant: contract.participant ?? null,
          side: contract.side,
          lineRaw: contract.lineRaw,
          lineCanonical: line,
          probabilityExperimental,
          fairOddExperimental,
          sampleSize: forecast.sampleSize,
          trainingMatches: training.length,
          gate: BASE_GATE,
          gateMet: probabilityExperimental >= BASE_GATE,
          modelStatus: EXPERIMENTAL_CORNERS_STATUS,
          productionStatus: PRODUCTION_STATUS,
          dataStatus: "OK",
        });
      }
    }

    for (let i = 0; i < predictionRows.length; i += 200) {
      const { error } = await supabase
        .from("model_predictions")
        .insert(predictionRows.slice(i, i + 200) as never[]);
      if (error) throw new Error(`Falha ao gravar model_predictions experimentais: ${error.message}`);
    }

    return {
      candidates,
      issues,
      predictionAt,
      modelVersion: CORNERS_MODEL_VERSION,
      modelStatus: EXPERIMENTAL_CORNERS_STATUS,
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
        lineAtEntry: z.number().finite(),
      }),
    )
    .min(1)
    .max(100),
});

/**
 * Motor 2 experimental: usa exatamente evaluateValue/finalSelection existentes.
 * Não persiste odd, avaliação ou seleção como recomendação de produção.
 */
export const analyzeExperimentalCornersOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const ids = data.entries.map((e) => e.predictionId);
    const { data: predictions } = await supabase
      .from("model_predictions")
      .select(
        "prediction_id, market, participant, side, line_raw, line_canonical, model_probability, outcome_distribution, model_status, data_status, match_id",
      )
      .eq("run_id", data.runId)
      .eq("model_status", EXPERIMENTAL_CORNERS_STATUS)
      .in("prediction_id", ids);

    const byId = new Map((predictions ?? []).map((p) => [p.prediction_id, p]));
    const results = [];

    for (const entry of data.entries) {
      const p = byId.get(entry.predictionId);
      if (!p) continue;
      const probabilityExperimental = p.model_probability === null ? 0 : Number(p.model_probability);
      const input: ValueInput = {
        candidateId: p.prediction_id,
        predictionId: p.prediction_id,
        contractType: "ASIAN",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: p.line_canonical === null ? null : Number(p.line_canonical),
        pCons: null,
        outcomeDistribution: (p.outcome_distribution ?? null) as unknown as AsianOutcomeProbabilities | null,
        published: probabilityExperimental >= BASE_GATE,
        modelStatus: EXPERIMENTAL_CORNERS_STATUS,
        dataStatus: p.data_status,
      };
      const result = evaluateValue(input);
      results.push({
        ...result,
        matchId: p.match_id,
        market: p.market,
        marketLabel: contractLabel(p.market, p.participant, p.side, p.line_raw),
        probabilityExperimental,
        modelStatus: EXPERIMENTAL_CORNERS_STATUS,
        productionStatus: PRODUCTION_STATUS,
      });
    }

    const selected = finalSelection(results);
    const selectedIds = new Set(selected.map((r) => r.predictionId));

    return {
      evaluations: results.map((r) => ({ ...r, selected: selectedIds.has(r.predictionId) })),
      selections: selected,
      modelStatus: EXPERIMENTAL_CORNERS_STATUS,
      productionStatus: PRODUCTION_STATUS,
    };
  });
