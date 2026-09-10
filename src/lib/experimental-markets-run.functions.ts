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
  absoluteCountProbability,
  buildGoalMarketProjections,
  familyForMarket,
  type ExperimentalMarketFamily,
} from "./engine/experimental-goal-markets";
import {
  MODEL_LEAN_THRESHOLD,
  filterQuoteAnchorPredictions,
  formatBookmakerLine,
  quoteAnchorFor,
  referenceLinesFor,
} from "./engine/market-policy";
import { CARDS_MODEL_VERSION, fitCardsBaseline, predictCards, type CardMatchRow } from "./engine/cards";
import {
  EV_TARGET,
  evaluateValue,
  finalSelection,
  type ValueInput,
  type ValueResult,
} from "./engine/value";
import type { ContractType } from "./engine/types";
import { eloAdjustGoalForecast } from "./elo-feature.server";
import { isCrossLeagueCompetitionName, isCrossLeagueLeagueKey } from "./competition-kind";
import {
  CROSS_LEAGUE_MODEL_SUFFIX,
  crossLeagueCornersForecast,
  crossLeagueGoalForecast,
} from "./engine/cross-league";
import { loadFiveDollarRawValues, loadRunFiveDollarRawValues } from "./raw-observations.server";

export const EXPERIMENTAL_MARKETS_STATUS = "EXPERIMENTAL_CURRENT_SEASON" as const;
const PRODUCTION_STATUS = "MODEL_NOT_PRODUCTION_VALIDATED" as const;
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
  quoteAnchor: true;
  modelVersion: string;
  modelStatus: typeof EXPERIMENTAL_MARKETS_STATUS;
  productionStatus: typeof PRODUCTION_STATUS;
  dataStatus: "OK";
};

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
  direction:
    | "VALUE_OVER"
    | "VALUE_UNDER"
    | "MODEL_LEAN_OVER"
    | "MODEL_LEAN_UNDER"
    | "NEUTRAL";
  basis: "VALUE" | "MODEL_ONLY" | "NEUTRAL";
  overProbability: number;
  underProbability: number;
  bestValuePredictionId: string | null;
  referenceAlternatives: ReferenceAlternative[];
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
    const league = leagueFromExternalMatchId(String(rv?.["externalMatchId"] ?? ""));
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
  const cardParts = new Map<
    string,
    Partial<CardMatchRow> & {
      homeYellow?: number;
      homeRed?: number;
      awayYellow?: number;
      awayRed?: number;
    }
  >();
  const conflicts = new Set<string>();

  for (const rv of observations) {
    const externalMatchId = String(rv["externalMatchId"] ?? "");
    const date = String(rv["fixtureDate"] ?? "");
    const league = leagueFromExternalMatchId(externalMatchId);
    const raw = asRecord(rv["rawHomeAway"]);
    const teamId = String(rv["teamId"] ?? rv["teamExternalId"] ?? "");
    const opponentId = String(rv["opponentId"] ?? "");
    const side = String(rv["teamSideInFixture"] ?? "");
    if (!externalMatchId || !date || !league || !teamId || !opponentId) continue;
    if (side !== "HOME" && side !== "AWAY") continue;

    const homeTeam = side === "HOME" ? teamId : opponentId;
    const awayTeam = side === "HOME" ? opponentId : teamId;

    const metric = String(rv["metricLabelRaw"] ?? rv["sourceLabel"] ?? "");
    const cardValue = finiteNumber(rv["value"]);
    if (
      cardValue !== null &&
      (metric === "cards.home.yellow" ||
        metric === "cards.home.red" ||
        metric === "cards.away.yellow" ||
        metric === "cards.away.red")
    ) {
      const part = cardParts.get(externalMatchId) ?? { date, league, homeTeam, awayTeam };
      part.date = date;
      part.league = league;
      part.homeTeam = homeTeam;
      part.awayTeam = awayTeam;
      if (metric === "cards.home.yellow") part.homeYellow = cardValue;
      if (metric === "cards.home.red") part.homeRed = cardValue;
      if (metric === "cards.away.yellow") part.awayYellow = cardValue;
      if (metric === "cards.away.red") part.awayRed = cardValue;
      cardParts.set(externalMatchId, part);
    }

    if (!raw) continue;
    const homeCorners = finiteNumber(raw["cornersHome"]);
    const awayCorners = finiteNumber(raw["cornersAway"]);
    const homeGoals = finiteNumber(raw["goalsHome"]);
    const awayGoals = finiteNumber(raw["goalsAway"]);

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

  const cards: CardMatchRow[] = [];
  for (const [id, part] of cardParts) {
    if (conflicts.has(id)) continue;
    if (!part.date || !part.league || !part.homeTeam || !part.awayTeam) continue;
    if (
      part.homeYellow === undefined ||
      part.homeRed === undefined ||
      part.awayYellow === undefined ||
      part.awayRed === undefined
    ) {
      continue;
    }
    cards.push({
      date: part.date,
      league: part.league,
      homeTeam: part.homeTeam,
      awayTeam: part.awayTeam,
      homeCards: part.homeYellow + part.homeRed,
      awayCards: part.awayYellow + part.awayRed,
    });
  }

  for (const id of conflicts) {
    corners.delete(id);
    goals.delete(id);
  }
  return { corners: [...corners.values()], goals: [...goals.values()], cards };
}

function labelFor(
  market: string,
  participant: string | null,
  side: string | null,
  lineRaw: string | null,
) {
  const numericLine = lineRaw === null ? null : finiteNumber(lineRaw);
  const lineLabel = numericLine === null ? "" : formatBookmakerLine(numericLine);
  if (market === "corners_match_total") {
    return `Escanteios da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  }
  if (market === "corners_team_total") {
    return `Escanteios ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  }
  if (market === "cards_match_total") {
    return `Cartões da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  }
  if (market === "cards_team_total") {
    return `Cartões ${participant ?? "time"} ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  }
  if (market === "goals_match_total") {
    return `Gols da partida ${side === "UNDER" ? "Menos de" : "Mais de"} ${lineLabel}`.trim();
  }
  if (market === "1x2") {
    return side === "HOME"
      ? "Vitória mandante"
      : side === "AWAY"
        ? "Vitória visitante"
        : "Empate";
  }
  if (market === "double_chance") {
    return side === "1X"
      ? "Dupla chance: 1X"
      : side === "X2"
        ? "Dupla chance: X2"
        : "Dupla chance: 12";
  }
  return market;
}

function addTotalQuotePair(input: {
  runId: string;
  matchId: string;
  matchLabel: string;
  competition: string;
  family: "CORNERS" | "CARDS";
  market: "corners_match_total" | "corners_team_total" | "cards_match_total" | "cards_team_total";
  participant: string | null;
  lambda: number;
  sampleSize: number;
  trainingMatches: number;
  modelVersion: string;
  predictionAt: string;
  startOrdinal: number;
  predictionRows: Record<string, unknown>[];
  candidates: ExperimentalCandidate[];
}): number {
  const anchor = quoteAnchorFor(input.market);
  if (anchor === null) return input.startOrdinal;
  const dist = poissonDistribution(input.lambda);
  let ordinal = input.startOrdinal;

  for (const side of ["OVER", "UNDER"] as const) {
    ordinal += 1;
    const probability = absoluteCountProbability(dist, anchor, side);
    const id = predictionId(input.runId, input.matchId, input.family, ordinal);
    input.predictionRows.push({
      run_id: input.runId,
      match_id: input.matchId,
      prediction_id: id,
      market: input.market,
      participant: input.participant,
      side,
      line_raw: String(anchor),
      line_canonical: anchor,
      model_probability: probability,
      p_cal: null,
      conservative_probability: null,
      outcome_distribution: { lambda: input.lambda },
      model_version: input.modelVersion,
      calibration_version: null,
      model_status: EXPERIMENTAL_MARKETS_STATUS,
      data_status: "OK",
      prediction_at: input.predictionAt,
    });
    input.candidates.push({
      predictionId: id,
      matchId: input.matchId,
      matchLabel: input.matchLabel,
      competition: input.competition,
      family: input.family,
      market: input.market,
      marketLabel: labelFor(input.market, input.participant, side, String(anchor)),
      participant: input.participant,
      side,
      lineRaw: String(anchor),
      lineCanonical: anchor,
      contractType: "BINARY",
      probabilityExperimental: probability,
      fairOddExperimental: probability > 0 ? 1 / probability : null,
      sampleSize: input.sampleSize,
      trainingMatches: input.trainingMatches,
      quoteAnchor: true,
      modelVersion: input.modelVersion,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
      dataStatus: "OK",
    });
  }

  return ordinal;
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

    const [{ data: externalIds }, runRaws, historicalRaws] = await Promise.all([
      supabase
        .from("match_external_ids")
        .select("match_id, source, external_id")
        .in("match_id", matchIds),
      loadRunFiveDollarRawValues(supabase, data.runId),
      loadFiveDollarRawValues(supabase, predictionAt, 365),
    ]);

    const datasets = buildDatasets(
      historicalRaws
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
      const leagueIdRaw = (externalIds ?? []).find(
        (x) => x.match_id === match.id && x.source === "five_dollar_league",
      )?.external_id;
      const leagueId =
        leagueIdRaw && Number.isFinite(Number(leagueIdRaw)) ? Number(leagueIdRaw) : null;
      const league = mostFrequentLeague(
        runRaws as { match_id: string | null; raw_value: unknown }[],
        match.id,
      );
      const matchLabel =
        match.home_team && match.away_team
          ? `${match.home_team} x ${match.away_team}`
          : match.raw_partida;
      const competition = match.competition ?? "";

      if (!homeId || !awayId || !league) {
        issues.push(`${matchLabel}: sem IDs/league 5Dollar suficientes para inferência experimental.`);
        continue;
      }

      const rollingStartDate = new Date(
        Date.parse(predictionDate + "T00:00:00Z") - 365 * 86400_000,
      )
        .toISOString()
        .slice(0, 10);
      const crossLeague =
        isCrossLeagueCompetitionName(match.competition) || isCrossLeagueLeagueKey(league);

      const rollingCorners = datasets.corners.filter(
        (r) => r.date < predictionDate && r.date >= rollingStartDate,
      );
      let cornerForecast: {
        lambdaHome: number;
        lambdaAway: number;
        lambdaTotal: number;
        sampleSize: number;
      } | null = null;
      let cornerTrainingMatches = 0;
      let cornerModelVersion = CORNERS_MODEL_VERSION;

      if (crossLeague) {
        const forecast = crossLeagueCornersForecast(rollingCorners, {
          homeTeam: String(homeId),
          awayTeam: String(awayId),
        });
        if (forecast) {
          cornerForecast = forecast;
          cornerTrainingMatches = forecast.trainingMatches;
          cornerModelVersion = `${CORNERS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`;
        } else {
          issues.push(`${matchLabel}: escanteios continentais sem amostra doméstica suficiente para os dois clubes.`);
        }
      } else {
        const training = rollingCorners.filter((r) => r.league === league);
        if (training.length >= MIN_EXPERIMENTAL_MATCHES) {
          const params = fitCornersBaseline(training);
          const forecast = predictCorners(params, {
            league,
            homeTeam: String(homeId),
            awayTeam: String(awayId),
          });
          if (forecast.sampleSize > 0) {
            cornerForecast = forecast;
            cornerTrainingMatches = training.length;
          }
        }
      }

      if (cornerForecast && cornerForecast.sampleSize > 0) {
        let ordinal = 0;
        ordinal = addTotalQuotePair({
          runId: data.runId,
          matchId: match.id,
          matchLabel,
          competition,
          family: "CORNERS",
          market: "corners_match_total",
          participant: null,
          lambda: cornerForecast.lambdaTotal,
          sampleSize: cornerForecast.sampleSize,
          trainingMatches: cornerTrainingMatches,
          modelVersion: cornerModelVersion,
          predictionAt,
          startOrdinal: ordinal,
          predictionRows,
          candidates,
        });
        ordinal = addTotalQuotePair({
          runId: data.runId,
          matchId: match.id,
          matchLabel,
          competition,
          family: "CORNERS",
          market: "corners_team_total",
          participant: match.home_team ?? "Mandante",
          lambda: cornerForecast.lambdaHome,
          sampleSize: cornerForecast.sampleSize,
          trainingMatches: cornerTrainingMatches,
          modelVersion: cornerModelVersion,
          predictionAt,
          startOrdinal: ordinal,
          predictionRows,
          candidates,
        });
        addTotalQuotePair({
          runId: data.runId,
          matchId: match.id,
          matchLabel,
          competition,
          family: "CORNERS",
          market: "corners_team_total",
          participant: match.away_team ?? "Visitante",
          lambda: cornerForecast.lambdaAway,
          sampleSize: cornerForecast.sampleSize,
          trainingMatches: cornerTrainingMatches,
          modelVersion: cornerModelVersion,
          predictionAt,
          startOrdinal: ordinal,
          predictionRows,
          candidates,
        });
      }

      const rollingCards = datasets.cards.filter(
        (r) => r.date < predictionDate && r.date >= rollingStartDate,
      );
      if (crossLeague) {
        issues.push(`${matchLabel}: cartões continentais aguardam normalização entre ligas; mercado não publicado nesta partida.`);
      } else {
        const cardTraining = rollingCards.filter((r) => r.league === league);
        if (cardTraining.length >= MIN_EXPERIMENTAL_MATCHES) {
          const params = fitCardsBaseline(cardTraining);
          const forecast = predictCards(params, {
            league,
            homeTeam: String(homeId),
            awayTeam: String(awayId),
          });
          if (forecast.sampleSize > 0) {
            let ordinal = 0;
            ordinal = addTotalQuotePair({
              runId: data.runId,
              matchId: match.id,
              matchLabel,
              competition,
              family: "CARDS",
              market: "cards_match_total",
              participant: null,
              lambda: forecast.lambdaTotal,
              sampleSize: forecast.sampleSize,
              trainingMatches: cardTraining.length,
              modelVersion: CARDS_MODEL_VERSION,
              predictionAt,
              startOrdinal: ordinal,
              predictionRows,
              candidates,
            });
            ordinal = addTotalQuotePair({
              runId: data.runId,
              matchId: match.id,
              matchLabel,
              competition,
              family: "CARDS",
              market: "cards_team_total",
              participant: match.home_team ?? "Mandante",
              lambda: forecast.lambdaHome,
              sampleSize: forecast.sampleSize,
              trainingMatches: cardTraining.length,
              modelVersion: CARDS_MODEL_VERSION,
              predictionAt,
              startOrdinal: ordinal,
              predictionRows,
              candidates,
            });
            addTotalQuotePair({
              runId: data.runId,
              matchId: match.id,
              matchLabel,
              competition,
              family: "CARDS",
              market: "cards_team_total",
              participant: match.away_team ?? "Visitante",
              lambda: forecast.lambdaAway,
              sampleSize: forecast.sampleSize,
              trainingMatches: cardTraining.length,
              modelVersion: CARDS_MODEL_VERSION,
              predictionAt,
              startOrdinal: ordinal,
              predictionRows,
              candidates,
            });
          }
        }
      }

      const rollingGoals = datasets.goals.filter(
        (r) => r.date < predictionDate && r.date >= rollingStartDate,
      );
      let goalForecast: {
        lambdaHome: number;
        lambdaAway: number;
        lambdaTotal: number;
        sampleSize: number;
      } | null = null;
      let goalTrainingMatches = 0;
      let adjustedLambdaHome = 0;
      let adjustedLambdaAway = 0;
      let goalModelVersion = GOALS_MODEL_VERSION;

      if (crossLeague) {
        const forecast = crossLeagueGoalForecast(rollingGoals, {
          homeTeam: String(homeId),
          awayTeam: String(awayId),
          referenceDate: predictionDate,
        });
        if (!forecast) {
          issues.push(`${matchLabel}: gols continentais sem pelo menos ${MIN_EXPERIMENTAL_MATCHES} partidas domésticas válidas para cada clube nos últimos 365 dias.`);
          continue;
        }
        goalForecast = forecast;
        goalTrainingMatches = forecast.trainingMatches;
        adjustedLambdaHome = forecast.lambdaHome;
        adjustedLambdaAway = forecast.lambdaAway;
        goalModelVersion = `${GOALS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`;
        issues.push(`${matchLabel}: baseline continental usa histórico doméstico (${forecast.homeDomesticLeague} x ${forecast.awayDomesticLeague}); Elo cross-country não aplicado sem normalização validada.`);
      } else {
        const goalTraining = rollingGoals.filter((r) => r.league === league);
        if (goalTraining.length < MIN_EXPERIMENTAL_MATCHES) {
          issues.push(`${matchLabel}: gols com ${goalTraining.length} partida(s) nos últimos 365 dias; mínimo experimental ${MIN_EXPERIMENTAL_MATCHES}.`);
          continue;
        }
        const goalParams = fitGoalsBaseline(goalTraining, predictionDate);
        goalForecast = predictGoals(goalParams, {
          league,
          homeTeam: String(homeId),
          awayTeam: String(awayId),
        });
        goalTrainingMatches = goalTraining.length;
        if (goalForecast.sampleSize < 1) {
          issues.push(`${matchLabel}: pelo menos um time não possui partida própria de gols nos últimos 365 dias.`);
          continue;
        }

        const eloForecast = await eloAdjustGoalForecast({
          runId: data.runId,
          matchId: match.id,
          leagueKey: league,
          leagueId,
          homeTeamId: Number(homeId),
          awayTeamId: Number(awayId),
          predictionAt,
          lambdaHome: goalForecast.lambdaHome,
          lambdaAway: goalForecast.lambdaAway,
        });
        adjustedLambdaHome = eloForecast.lambdaHome;
        adjustedLambdaAway = eloForecast.lambdaAway;
        if (!eloForecast.applied) {
          issues.push(`${matchLabel}: ${eloForecast.reason} Mantido o baseline de gols sem ajuste Elo.`);
        } else if (eloForecast.modelVersionSuffix) {
          goalModelVersion = `${GOALS_MODEL_VERSION}+${eloForecast.modelVersionSuffix}`;
        }
      }

      if (!goalForecast) continue;

      const projections = buildGoalMarketProjections({
        homeTeam: match.home_team ?? "Mandante",
        awayTeam: match.away_team ?? "Visitante",
        lambdaHome: adjustedLambdaHome,
        lambdaAway: adjustedLambdaAway,
      });
      const familyOrdinals = new Map<ExperimentalMarketFamily, number>();

      for (const projection of projections) {
        const ordinal = (familyOrdinals.get(projection.family) ?? 0) + 1;
        familyOrdinals.set(projection.family, ordinal);
        const id = predictionId(data.runId, match.id, projection.family, ordinal);
        const isGoalTotal = projection.market === "goals_match_total";
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
          outcome_distribution: isGoalTotal
            ? { lambda: adjustedLambdaHome + adjustedLambdaAway }
            : {},
          model_version: goalModelVersion,
          calibration_version: null,
          model_status: EXPERIMENTAL_MARKETS_STATUS,
          data_status: "OK",
          prediction_at: predictionAt,
        });
        candidates.push({
          predictionId: id,
          matchId: match.id,
          matchLabel,
          competition,
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
          trainingMatches: goalTrainingMatches,
          quoteAnchor: true,
          modelVersion: goalModelVersion,
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
    .max(1000),
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

function lambdaFromPrediction(row: PredictionForAnalysis): number | null {
  const distribution = asRecord(row.outcome_distribution);
  return finiteNumber(distribution?.["lambda"]);
}

function buildDirectionAssessments(
  predictions: PredictionForAnalysis[],
  evaluations: EnrichedValueResult[],
): DirectionAssessment[] {
  const totals = predictions.filter(
    (row) =>
      row.match_id &&
      quoteAnchorFor(row.market) !== null &&
      (row.side === "OVER" || row.side === "UNDER"),
  );
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
    const evaluated = [
      resultByPrediction.get(over.prediction_id),
      resultByPrediction.get(under.prediction_id),
    ].filter((row): row is EnrichedValueResult => Boolean(row));
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
    } else if (overProbability >= MODEL_LEAN_THRESHOLD) {
      selectedSide = "OVER";
      direction = "MODEL_LEAN_OVER";
      basis = "MODEL_ONLY";
    } else if (underProbability >= MODEL_LEAN_THRESHOLD) {
      selectedSide = "UNDER";
      direction = "MODEL_LEAN_UNDER";
      basis = "MODEL_ONLY";
    }

    const source = selectedSide === "OVER" ? over : selectedSide === "UNDER" ? under : null;
    const lambda = source ? lambdaFromPrediction(source) : null;
    const referenceAlternatives: ReferenceAlternative[] = [];
    if (selectedSide && source && lambda !== null) {
      const dist = poissonDistribution(lambda);
      for (const line of referenceLinesFor(source.market, selectedSide)) {
        const probability = absoluteCountProbability(dist, line, selectedSide);
        referenceAlternatives.push({
          matchId: over.match_id,
          market: source.market,
          participant: source.participant,
          side: selectedSide,
          lineCanonical: line,
          marketLabel: labelFor(source.market, source.participant, selectedSide, String(line)),
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

export const analyzeExperimentalMarketsOdds = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => oddsSchema.parse(input))
  .handler(async ({ data }) => {
    const supabase = await db();
    const [{ data: predictions }, { data: run }] = await Promise.all([
      supabase
        .from("model_predictions")
        .select(
          "prediction_id, market, participant, side, line_raw, line_canonical, model_probability, outcome_distribution, model_status, data_status, match_id, model_version",
        )
        .eq("run_id", data.runId)
        .eq("model_status", EXPERIMENTAL_MARKETS_STATUS),
      supabase.from("analysis_runs").select("target_date").eq("id", data.runId).single(),
    ]);

    const quotePredictions = filterQuoteAnchorPredictions(
      (predictions ?? []) as PredictionForAnalysis[],
    );
    const byId = new Map(quotePredictions.map((p) => [p.prediction_id, p]));
    const results: EnrichedValueResult[] = [];

    for (const entry of data.entries) {
      const p = byId.get(entry.predictionId);
      if (!p) continue;
      const modelProbability = finiteNumber(p.model_probability) ?? 0;
      const input: ValueInput = {
        candidateId: p.prediction_id,
        predictionId: p.prediction_id,
        contractType: "BINARY",
        bookmaker: "bet365_br",
        odd: entry.odd,
        lineAtEntry: entry.lineAtEntry,
        lineCanonical: p.line_canonical === null ? null : Number(p.line_canonical),
        pCons: modelProbability,
        outcomeDistribution: null,
        // Experimental quotes are eligible for pricing whenever the experimental
        // probability exists. A raw probability threshold must not pre-block EV.
        published: true,
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
    const directionAssessments = buildDirectionAssessments(quotePredictions, results);
    const referenceAlternatives = directionAssessments.flatMap(
      (assessment) => assessment.referenceAlternatives,
    );

    return {
      evaluations: results.map((r) => ({ ...r, selected: selectedIds.has(r.predictionId) })),
      selections: selected,
      directionAssessments,
      referenceAlternatives,
      selectionLimit,
      targetDate,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
    };
  });
