import {
  CARD_SETTLEMENT_PROXY_CAVEAT,
  CARDS_MODEL_VERSION,
  fitCardsBaseline,
  predictCards,
} from "../../engine/cards";
import {
  CORNERS_MODEL_VERSION,
  fitBaseline as fitCornersBaseline,
  predict as predictCorners,
} from "../../engine/corners";
import {
  chooseCountDistribution,
  countDistributionMetadata,
  type CountMarket,
} from "../../engine/count-market-distribution";
import {
  absoluteCountProbability,
  buildGoalMarketProjections,
} from "../../engine/experimental-goal-markets";
import {
  GOALS_MODEL_VERSION,
  fitGoalsBaseline,
  goalOutcomeProbabilities,
  predictGoals,
} from "../../engine/goals";
import {
  ONE_X_TWO_ENSEMBLE_MODEL_VERSION,
  pureElo60DavidsonFromGoalHistory,
  uncertaintyLinearOneXTwo,
  type OneXTwoProbabilities,
} from "../../engine/one-x-two-ensemble";
import {
  experimentalPredictionId,
  quoteAnchorFor,
} from "../../engine/market-policy";
import {
  CROSS_LEAGUE_MODEL_SUFFIX,
  crossLeagueCornersForecast,
  crossLeagueGoalForecast,
} from "../../engine/cross-league";
import { isCrossLeagueCompetitionName, isCrossLeagueLeagueKey } from "../../competition-kind";
import { eloAdjustGoalForecast } from "../../elo-feature.server";
import { mostFrequentLeague } from "./datasets";
import { labelFor } from "./value-tracking";
import type { ExperimentalDatasets } from "./datasets";
import {
  EXPERIMENTAL_MARKETS_STATUS,
  MIN_EXPERIMENTAL_MATCHES,
  PRODUCTION_STATUS,
  type ExperimentalCandidate,
  type ExperimentalMatch,
  type ExternalIdRow,
  type PredictionInsert,
  type RunRawRow,
} from "./contracts";

function addTotalQuotePair(input: {
  runId: string;
  matchId: string;
  matchLabel: string;
  competition: string;
  family: "CORNERS" | "CARDS";
  market: CountMarket;
  participant: string | null;
  lambda: number;
  dispersionAlpha: number | null;
  sampleSize: number;
  trainingMatches: number;
  modelVersion: string;
  predictionAt: string;
  predictionRows: PredictionInsert[];
  candidates: ExperimentalCandidate[];
}) {
  const anchor = quoteAnchorFor(input.market);
  if (anchor === null) return;

  const distributionPolicy = chooseCountDistribution({
    market: input.market,
    lambda: input.lambda,
    estimatedAlpha: input.dispersionAlpha,
    trainingMatches: input.trainingMatches,
  });
  const distribution = distributionPolicy.distribution;
  const outcomeDistribution = countDistributionMetadata({
    lambda: input.lambda,
    policy: distributionPolicy,
  });
  const modelVersion = `${input.modelVersion}+${distributionPolicy.kind === "negative_binomial" ? "nb2" : "poisson"}`;

  for (const side of ["OVER", "UNDER"] as const) {
    const probability = absoluteCountProbability(distribution, anchor, side);
    const predictionId = experimentalPredictionId({
      runId: input.runId,
      matchId: input.matchId,
      family: input.family,
      market: input.market,
      participant: input.participant,
      side,
      lineCanonical: anchor,
    });
    input.predictionRows.push({
      run_id: input.runId,
      match_id: input.matchId,
      prediction_id: predictionId,
      market: input.market,
      participant: input.participant,
      side,
      line_raw: String(anchor),
      line_canonical: anchor,
      model_probability: probability,
      p_cal: null,
      conservative_probability: null,
      outcome_distribution: outcomeDistribution,
      model_version: modelVersion,
      calibration_version: null,
      model_status: EXPERIMENTAL_MARKETS_STATUS,
      data_status: "OK",
      prediction_at: input.predictionAt,
    });
    input.candidates.push({
      predictionId,
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
      modelVersion,
      modelStatus: EXPERIMENTAL_MARKETS_STATUS,
      productionStatus: PRODUCTION_STATUS,
      dataStatus: "OK",
    });
  }
}

export async function buildExperimentalPredictions(input: {
  runId: string;
  predictionAt: string;
  predictionDate: string;
  matches: ExperimentalMatch[];
  externalIds: ExternalIdRow[];
  runRaws: RunRawRow[];
  datasets: ExperimentalDatasets;
}) {
  const predictionRows: PredictionInsert[] = [];
  const candidates: ExperimentalCandidate[] = [];
  const issues: string[] = [];
  if (input.datasets.cards.length > 0) {
    issues.push(`Cartões experimentais: ${CARD_SETTLEMENT_PROXY_CAVEAT}`);
  }

  for (const match of input.matches) {
    const homeId = input.externalIds.find(
      (row) => row.match_id === match.id && row.source === "five_dollar_team_home",
    )?.external_id;
    const awayId = input.externalIds.find(
      (row) => row.match_id === match.id && row.source === "five_dollar_team_away",
    )?.external_id;
    const leagueIdRaw = input.externalIds.find(
      (row) => row.match_id === match.id && row.source === "five_dollar_league",
    )?.external_id;
    const leagueId = leagueIdRaw && Number.isFinite(Number(leagueIdRaw)) ? Number(leagueIdRaw) : null;
    const league = mostFrequentLeague(input.runRaws, match.id);
    const matchLabel = match.home_team && match.away_team
      ? `${match.home_team} x ${match.away_team}`
      : match.raw_partida;
    const competition = match.competition ?? "";

    if (!homeId || !awayId || !league) {
      issues.push(`${matchLabel}: sem IDs/league 5Dollar suficientes para inferência experimental.`);
      continue;
    }

    const rollingStartDate = new Date(
      Date.parse(input.predictionDate + "T00:00:00Z") - 365 * 86400_000,
    ).toISOString().slice(0, 10);
    const crossLeague = isCrossLeagueCompetitionName(match.competition) || isCrossLeagueLeagueKey(league);

    const rollingCorners = input.datasets.corners.filter(
      (row) => row.date < input.predictionDate && row.date >= rollingStartDate,
    );
    let cornerForecast: {
      lambdaHome: number;
      lambdaAway: number;
      lambdaTotal: number;
      sampleSize: number;
      dispersionAlphaTotal?: number;
      dispersionAlphaHome?: number;
      dispersionAlphaAway?: number;
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
      const training = rollingCorners.filter((row) => row.league === league);
      if (training.length >= MIN_EXPERIMENTAL_MATCHES) {
        const forecast = predictCorners(fitCornersBaseline(training), {
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
      for (const spec of [
        {
          market: "corners_match_total" as const,
          participant: null,
          lambda: cornerForecast.lambdaTotal,
          dispersionAlpha: cornerForecast.dispersionAlphaTotal ?? null,
        },
        {
          market: "corners_team_total" as const,
          participant: match.home_team ?? "Mandante",
          lambda: cornerForecast.lambdaHome,
          dispersionAlpha: cornerForecast.dispersionAlphaHome ?? null,
        },
        {
          market: "corners_team_total" as const,
          participant: match.away_team ?? "Visitante",
          lambda: cornerForecast.lambdaAway,
          dispersionAlpha: cornerForecast.dispersionAlphaAway ?? null,
        },
      ]) {
        addTotalQuotePair({
          runId: input.runId,
          matchId: match.id,
          matchLabel,
          competition,
          family: "CORNERS",
          ...spec,
          sampleSize: cornerForecast.sampleSize,
          trainingMatches: cornerTrainingMatches,
          modelVersion: cornerModelVersion,
          predictionAt: input.predictionAt,
          predictionRows,
          candidates,
        });
      }
    }

    const rollingCards = input.datasets.cards.filter(
      (row) => row.date < input.predictionDate && row.date >= rollingStartDate,
    );
    if (crossLeague) {
      issues.push(`${matchLabel}: cartões continentais aguardam normalização entre ligas; mercado não publicado nesta partida.`);
    } else {
      const cardTraining = rollingCards.filter((row) => row.league === league);
      if (cardTraining.length >= MIN_EXPERIMENTAL_MATCHES) {
        const forecast = predictCards(fitCardsBaseline(cardTraining), {
          league,
          homeTeam: String(homeId),
          awayTeam: String(awayId),
        });
        if (forecast.sampleSize > 0) {
          for (const spec of [
            {
              market: "cards_match_total" as const,
              participant: null,
              lambda: forecast.lambdaTotal,
              dispersionAlpha: forecast.dispersionAlphaTotal,
            },
            {
              market: "cards_team_total" as const,
              participant: match.home_team ?? "Mandante",
              lambda: forecast.lambdaHome,
              dispersionAlpha: forecast.dispersionAlphaHome,
            },
            {
              market: "cards_team_total" as const,
              participant: match.away_team ?? "Visitante",
              lambda: forecast.lambdaAway,
              dispersionAlpha: forecast.dispersionAlphaAway,
            },
          ]) {
            addTotalQuotePair({
              runId: input.runId,
              matchId: match.id,
              matchLabel,
              competition,
              family: "CARDS",
              ...spec,
              sampleSize: forecast.sampleSize,
              trainingMatches: cardTraining.length,
              modelVersion: CARDS_MODEL_VERSION,
              predictionAt: input.predictionAt,
              predictionRows,
              candidates,
            });
          }
        }
      }
    }

    const allPriorGoals = input.datasets.goals.filter((row) => row.date < input.predictionDate);
    const rollingGoals = allPriorGoals.filter((row) => row.date >= rollingStartDate);
    let goalForecast: {
      lambdaHome: number;
      lambdaAway: number;
      lambdaTotal: number;
      sampleSize: number;
    } | null = null;
    let goalTrainingMatches = 0;
    let goalModelVersion = GOALS_MODEL_VERSION;
    if (crossLeague) {
      const forecast = crossLeagueGoalForecast(rollingGoals, {
        homeTeam: String(homeId),
        awayTeam: String(awayId),
        referenceDate: input.predictionDate,
      });
      if (!forecast) {
        issues.push(`${matchLabel}: gols continentais sem pelo menos ${MIN_EXPERIMENTAL_MATCHES} partidas domésticas válidas para cada clube nos últimos 365 dias.`);
        continue;
      }
      goalForecast = forecast;
      goalTrainingMatches = forecast.trainingMatches;
      goalModelVersion = `${GOALS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`;
    } else {
      const goalTraining = rollingGoals.filter((row) => row.league === league);
      if (goalTraining.length < MIN_EXPERIMENTAL_MATCHES) {
        issues.push(`${matchLabel}: gols com ${goalTraining.length} partida(s) nos últimos 365 dias; mínimo experimental ${MIN_EXPERIMENTAL_MATCHES}.`);
        continue;
      }
      goalForecast = predictGoals(fitGoalsBaseline(goalTraining, input.predictionDate), {
        league,
        homeTeam: String(homeId),
        awayTeam: String(awayId),
      });
      goalTrainingMatches = goalTraining.length;
      if (goalForecast.sampleSize < 1) {
        issues.push(`${matchLabel}: pelo menos um time não possui partida própria de gols nos últimos 365 dias.`);
        continue;
      }
    }
    if (!goalForecast) continue;

    const eloForecast = await eloAdjustGoalForecast({
      runId: input.runId,
      matchId: match.id,
      leagueKey: league,
      leagueId,
      homeTeamId: Number(homeId),
      awayTeamId: Number(awayId),
      predictionAt: input.predictionAt,
      lambdaHome: goalForecast.lambdaHome,
      lambdaAway: goalForecast.lambdaAway,
    });
    const adjustedLambdaHome = eloForecast.lambdaHome;
    const adjustedLambdaAway = eloForecast.lambdaAway;
    if (!eloForecast.applied) {
      issues.push(`${matchLabel}: ${eloForecast.reason} Mantido o baseline de gols sem ajuste Elo.`);
    } else if (eloForecast.modelVersionSuffix) {
      goalModelVersion = `${goalModelVersion}+${eloForecast.modelVersionSuffix}`;
    }

    let oneXTwoProbabilities: OneXTwoProbabilities | null = null;
    let oneXTwoModelVersion = goalModelVersion;
    if (!crossLeague) {
      const pureElo = pureElo60DavidsonFromGoalHistory({
        rows: allPriorGoals,
        league,
        homeTeam: String(homeId),
        awayTeam: String(awayId),
        drawWindowStart: rollingStartDate,
      });
      if (pureElo) {
        const base = goalOutcomeProbabilities(adjustedLambdaHome, adjustedLambdaAway);
        oneXTwoProbabilities = uncertaintyLinearOneXTwo(
          { HOME: base.home, DRAW: base.draw, AWAY: base.away },
          pureElo.probabilities,
        );
        oneXTwoModelVersion = `${goalModelVersion}+${ONE_X_TWO_ENSEMBLE_MODEL_VERSION}`;
      } else {
        issues.push(`${matchLabel}: 1X2 uncertainty-linear 40% sem histórico Elo-Davidson suficiente; mantido 1X2 do modelo de gols.`);
      }
    } else {
      issues.push(`${matchLabel}: 1X2 uncertainty-linear 40% ainda não é aplicado a confronto interligas; mantido 1X2 hierárquico atual.`);
    }

    const projections = buildGoalMarketProjections({
      homeTeam: match.home_team ?? "Mandante",
      awayTeam: match.away_team ?? "Visitante",
      lambdaHome: adjustedLambdaHome,
      lambdaAway: adjustedLambdaAway,
      oneXTwoProbabilities,
    });
    for (const projection of projections) {
      const predictionId = experimentalPredictionId({
        runId: input.runId,
        matchId: match.id,
        family: projection.family,
        market: projection.market,
        participant: projection.participant,
        side: projection.side,
        lineCanonical: projection.lineCanonical,
      });
      const isGoalTotal = projection.market === "goals_match_total";
      const usesOneXTwoModel = projection.market === "1x2" || projection.market === "double_chance";
      const projectionModelVersion = usesOneXTwoModel ? oneXTwoModelVersion : goalModelVersion;
      predictionRows.push({
        run_id: input.runId,
        match_id: match.id,
        prediction_id: predictionId,
        market: projection.market,
        participant: projection.participant,
        side: projection.side,
        line_raw: projection.lineRaw,
        line_canonical: projection.lineCanonical,
        model_probability: projection.probability,
        p_cal: null,
        conservative_probability: null,
        outcome_distribution: isGoalTotal ? { lambda: adjustedLambdaHome + adjustedLambdaAway } : {},
        model_version: projectionModelVersion,
        calibration_version: null,
        model_status: EXPERIMENTAL_MARKETS_STATUS,
        data_status: "OK",
        prediction_at: input.predictionAt,
      });
      candidates.push({
        predictionId,
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
        modelVersion: projectionModelVersion,
        modelStatus: EXPERIMENTAL_MARKETS_STATUS,
        productionStatus: PRODUCTION_STATUS,
        dataStatus: "OK",
      });
    }
  }

  return { predictionRows, candidates, issues };
}
