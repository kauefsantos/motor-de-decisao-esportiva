import { isLikelyDomesticLeagueKey } from "../../competition-kind";
import { ELO_INITIAL_RATING, updateElo } from "../../engine/elo";
import {
  MODEL_VALIDATION_LOOKBACK_DAYS,
  assertUniqueFixtures,
  multiclassMetrics,
  temporalTrainingRows,
  type MulticlassLabel,
  type MulticlassMetricInput,
} from "./model-validation";
import {
  STAGE6_GOALS_ELO_ARTIFACT,
  buildStage6GoalsPredictions,
  type Stage6GoalRow,
} from "./goals-walk-forward";

export const STAGE8_ELO_PURE60_ADVANTAGE = 60;
export const STAGE8_ELO_PURE0_ADVANTAGE = 0;
export const STAGE8_ELO_PURE60_ARTIFACT = "stage8-elo-pure60-davidson-v1";
export const STAGE8_ELO_PURE0_ARTIFACT = "stage8-elo-pure0-davidson-v1";

const DAVIDSON_MIN_NU = 1e-4;
const DAVIDSON_MAX_NU = 4;
const DAVIDSON_BISECTION_STEPS = 60;

type TemporalGoalRow = Stage6GoalRow & { kickoffAt: number };
type IncumbentPrediction = ReturnType<typeof buildStage6GoalsPredictions>[number];

type RatingBefore = {
  homeRating: number;
  awayRating: number;
};

export type Stage8PureEloPrediction = {
  fixtureId: string;
  date: string;
  league: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  homeRatingBefore: number;
  awayRatingBefore: number;
  drawCoefficient: number;
  outcome1x2: MulticlassLabel;
};

function conservativeKickoffCutoff(date: string): number {
  const timestamp = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid Stage 8 pure Elo fixture date: ${date}`);
  return timestamp;
}

function ratingKey(league: string, teamId: string): string {
  return `${league}::${teamId}`;
}

function fixtureKey(row: Pick<Stage6GoalRow, "league" | "fixtureId">): string {
  return `${row.league}::${row.fixtureId}`;
}

function outcomeFor(row: Stage6GoalRow): MulticlassLabel {
  if (row.homeGoals > row.awayGoals) return "HOME";
  if (row.homeGoals === row.awayGoals) return "DRAW";
  return "AWAY";
}

function domesticRows(sourceRows: readonly Stage6GoalRow[]): TemporalGoalRow[] {
  return sourceRows
    .filter((row) => isLikelyDomesticLeagueKey(row.league))
    .map((row) => ({ ...row, kickoffAt: conservativeKickoffCutoff(row.date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.fixtureId.localeCompare(b.fixtureId));
}

/**
 * Replays Elo chronologically with a fixed home advantage while preserving the
 * same conservative calendar-day snapshot rule used by the Stage 8 challengers.
 * The replay uses only W/D/L information through updateElo; goal-model lambdas
 * and Poisson probabilities are never used by this challenger.
 */
export function buildStage8PureEloRatingsBefore(
  sourceRows: readonly Stage6GoalRow[],
  homeAdvantage: number,
): Map<string, RatingBefore> {
  assertUniqueFixtures(sourceRows);
  const rows = domesticRows(sourceRows);
  const ratings = new Map<string, number>();
  const beforeByFixture = new Map<string, RatingBefore>();

  let index = 0;
  while (index < rows.length) {
    const date = rows[index]?.date;
    if (!date) break;
    const dayRows: TemporalGoalRow[] = [];
    while (index < rows.length && rows[index]?.date === date) {
      const row = rows[index];
      if (row) dayRows.push(row);
      index += 1;
    }

    for (const row of dayRows) {
      const homeKey = ratingKey(row.league, row.homeTeamId);
      const awayKey = ratingKey(row.league, row.awayTeamId);
      beforeByFixture.set(fixtureKey(row), {
        homeRating: ratings.get(homeKey) ?? ELO_INITIAL_RATING,
        awayRating: ratings.get(awayKey) ?? ELO_INITIAL_RATING,
      });
    }

    const dayDeltas = new Map<string, number>();
    for (const row of dayRows) {
      const homeKey = ratingKey(row.league, row.homeTeamId);
      const awayKey = ratingKey(row.league, row.awayTeamId);
      const homeRating = ratings.get(homeKey) ?? ELO_INITIAL_RATING;
      const awayRating = ratings.get(awayKey) ?? ELO_INITIAL_RATING;
      const updated = updateElo({
        homeRating,
        awayRating,
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
        homeAdvantage,
      });
      dayDeltas.set(homeKey, (dayDeltas.get(homeKey) ?? 0) + updated.delta);
      dayDeltas.set(awayKey, (dayDeltas.get(awayKey) ?? 0) - updated.delta);
    }

    for (const [key, delta] of dayDeltas) {
      ratings.set(key, (ratings.get(key) ?? ELO_INITIAL_RATING) + delta);
    }
  }

  return beforeByFixture;
}

function davidsonTerms(homeRating: number, awayRating: number, homeAdvantage: number) {
  const homeStrength = 10 ** ((homeRating + homeAdvantage - awayRating) / 400);
  const drawBase = Math.sqrt(homeStrength);
  return { homeStrength, drawBase };
}

/**
 * Converts Elo strengths into proper 1X2 probabilities with Davidson's draw
 * term. Conditional on a decisive result, HOME/AWAY odds remain exactly the Elo
 * odds. nu controls only the draw mass.
 */
export function davidsonEloProbabilities(
  homeRating: number,
  awayRating: number,
  homeAdvantage: number,
  nu: number,
) {
  const safeNu = Math.max(DAVIDSON_MIN_NU, Math.min(DAVIDSON_MAX_NU, nu));
  const { homeStrength, drawBase } = davidsonTerms(homeRating, awayRating, homeAdvantage);
  const drawStrength = safeNu * drawBase;
  const denominator = homeStrength + 1 + drawStrength;
  return {
    home: homeStrength / denominator,
    draw: drawStrength / denominator,
    away: 1 / denominator,
  };
}

function davidsonDerivative(
  nu: number,
  training: readonly TemporalGoalRow[],
  ratingsBefore: ReadonlyMap<string, RatingBefore>,
  homeAdvantage: number,
): number {
  let draws = 0;
  let denominatorTerm = 0;
  let eligible = 0;

  for (const row of training) {
    const before = ratingsBefore.get(fixtureKey(row));
    if (!before) continue;
    const { homeStrength, drawBase } = davidsonTerms(
      before.homeRating,
      before.awayRating,
      homeAdvantage,
    );
    if (row.homeGoals === row.awayGoals) draws += 1;
    denominatorTerm += drawBase / (homeStrength + 1 + nu * drawBase);
    eligible += 1;
  }

  if (eligible === 0) return 0;
  return draws / nu - denominatorTerm;
}

/**
 * Fits only Davidson's scalar draw coefficient on prior league fixtures by
 * maximum likelihood. The fit is point-in-time: every row uses its rating as it
 * stood before that fixture, and the target fixture is never part of training.
 */
export function fitDavidsonDrawCoefficient(
  training: readonly TemporalGoalRow[],
  ratingsBefore: ReadonlyMap<string, RatingBefore>,
  homeAdvantage: number,
): number {
  if (training.length === 0) return DAVIDSON_MIN_NU;

  let low = DAVIDSON_MIN_NU;
  let high = DAVIDSON_MAX_NU;
  const lowDerivative = davidsonDerivative(low, training, ratingsBefore, homeAdvantage);
  if (lowDerivative <= 0) return low;
  const highDerivative = davidsonDerivative(high, training, ratingsBefore, homeAdvantage);
  if (highDerivative >= 0) return high;

  for (let step = 0; step < DAVIDSON_BISECTION_STEPS; step += 1) {
    const mid = (low + high) / 2;
    const derivative = davidsonDerivative(mid, training, ratingsBefore, homeAdvantage);
    if (derivative > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function buildStage8PureEloPredictions(
  sourceRows: readonly Stage6GoalRow[],
  homeAdvantage: number,
): Stage8PureEloPrediction[] {
  assertUniqueFixtures(sourceRows);
  const rows = domesticRows(sourceRows);
  const ratingsBefore = buildStage8PureEloRatingsBefore(sourceRows, homeAdvantage);
  const predictions: Stage8PureEloPrediction[] = [];

  for (const target of rows) {
    const training = temporalTrainingRows(rows, target.date, MODEL_VALIDATION_LOOKBACK_DAYS)
      .filter((row) => row.league === target.league && row.kickoffAt < target.kickoffAt);
    if (training.length < 3) continue;

    const before = ratingsBefore.get(fixtureKey(target));
    if (!before) continue;

    const drawCoefficient = fitDavidsonDrawCoefficient(training, ratingsBefore, homeAdvantage);
    const probabilities = davidsonEloProbabilities(
      before.homeRating,
      before.awayRating,
      homeAdvantage,
      drawCoefficient,
    );

    predictions.push({
      fixtureId: target.fixtureId,
      date: target.date,
      league: target.league,
      homeProbability: probabilities.home,
      drawProbability: probabilities.draw,
      awayProbability: probabilities.away,
      homeRatingBefore: before.homeRating,
      awayRatingBefore: before.awayRating,
      drawCoefficient,
      outcome1x2: outcomeFor(target),
    });
  }

  return predictions;
}

function challengerMetricInputs(rows: readonly Stage8PureEloPrediction[]): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: {
      HOME: row.homeProbability,
      DRAW: row.drawProbability,
      AWAY: row.awayProbability,
    },
    outcome: row.outcome1x2,
  }));
}

function incumbentMetricInputs(rows: readonly IncumbentPrediction[]): MulticlassMetricInput[] {
  return rows.map((row) => ({
    probabilities: {
      HOME: row.homeProbability,
      DRAW: row.drawProbability,
      AWAY: row.awayProbability,
    },
    outcome: row.outcome1x2,
  }));
}

function pairedDiagnosticMetrics(
  challengerRows: readonly Stage8PureEloPrediction[],
  incumbentRows: readonly IncumbentPrediction[],
) {
  const fixtureKeys = new Set(challengerRows.map(fixtureKey));
  const incumbentSlice = incumbentRows.filter((row) => fixtureKeys.has(fixtureKey(row)));
  if (incumbentSlice.length !== challengerRows.length) {
    throw new Error(
      `Stage 8 pure Elo diagnostic pairing mismatch: incumbent=${incumbentSlice.length} challenger=${challengerRows.length}`,
    );
  }

  const incumbentMetrics = multiclassMetrics(incumbentMetricInputs(incumbentSlice));
  const challengerMetrics = multiclassMetrics(challengerMetricInputs(challengerRows));
  return {
    sampleSize: challengerRows.length,
    incumbentBrier: incumbentMetrics.brier,
    challengerBrier: challengerMetrics.brier,
    brierDelta: challengerMetrics.brier - incumbentMetrics.brier,
    incumbentLogLoss: incumbentMetrics.logLoss,
    challengerLogLoss: challengerMetrics.logLoss,
    logLossDelta: challengerMetrics.logLoss - incumbentMetrics.logLoss,
    incumbentExpectedCalibrationError: incumbentMetrics.expectedCalibrationError,
    challengerExpectedCalibrationError: challengerMetrics.expectedCalibrationError,
    expectedCalibrationErrorDelta:
      challengerMetrics.expectedCalibrationError - incumbentMetrics.expectedCalibrationError,
    incumbentMaxCalibrationGap: incumbentMetrics.maxCalibrationGap,
    challengerMaxCalibrationGap: challengerMetrics.maxCalibrationGap,
    maxCalibrationGapDelta: challengerMetrics.maxCalibrationGap - incumbentMetrics.maxCalibrationGap,
  };
}

function runPureEloVariant(
  sourceRows: readonly Stage6GoalRow[],
  startInclusive: string,
  endExclusive: string,
  homeAdvantage: number,
  challengerArtifact: string,
) {
  const incumbentAll = buildStage6GoalsPredictions(sourceRows, STAGE6_GOALS_ELO_ARTIFACT);
  const incumbentByFixture = new Map(
    incumbentAll
      .filter((row) => row.date >= startInclusive && row.date < endExclusive)
      .map((row) => [fixtureKey(row), row] as const),
  );
  const challengerAll = buildStage8PureEloPredictions(sourceRows, homeAdvantage);
  const challenger = challengerAll.filter((row) => (
    row.date >= startInclusive
    && row.date < endExclusive
    && incumbentByFixture.has(fixtureKey(row))
  ));
  const incumbent = challenger
    .map((row) => incumbentByFixture.get(fixtureKey(row)))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);

  const incumbentMetrics = multiclassMetrics(incumbentMetricInputs(incumbent));
  const challengerMetrics = multiclassMetrics(challengerMetricInputs(challenger));

  const monthKeys = [...new Set(challenger.map((row) => row.date.slice(0, 7)))].sort();
  const stabilityByMonth = monthKeys.map((month) => ({
    month,
    ...pairedDiagnosticMetrics(
      challenger.filter((row) => row.date.startsWith(month)),
      incumbent,
    ),
  }));

  const leagueKeys = [...new Set(challenger.map((row) => row.league))].sort();
  const stabilityByLeague = leagueKeys.map((league) => ({
    league,
    ...pairedDiagnosticMetrics(
      challenger.filter((row) => row.league === league),
      incumbent,
    ),
  }));

  const averageDrawCoefficient = challenger.length === 0
    ? Number.NaN
    : challenger.reduce((sum, row) => sum + row.drawCoefficient, 0) / challenger.length;

  return {
    challengerArtifact,
    methodology: "pure-elo-davidson-prior-only-league-draw-fit",
    homeAdvantagePoints: homeAdvantage,
    pairedSampleSize: challenger.length,
    averageDrawCoefficient,
    incumbent: incumbentMetrics,
    challenger: challengerMetrics,
    deltas: {
      brier: challengerMetrics.brier - incumbentMetrics.brier,
      logLoss: challengerMetrics.logLoss - incumbentMetrics.logLoss,
      expectedCalibrationError:
        challengerMetrics.expectedCalibrationError - incumbentMetrics.expectedCalibrationError,
      maxCalibrationGap: challengerMetrics.maxCalibrationGap - incumbentMetrics.maxCalibrationGap,
    },
    homeCalibration: {
      incumbent: incumbentMetrics.calibration.HOME.calibration,
      challenger: challengerMetrics.calibration.HOME.calibration,
    },
    stabilityByMonth,
    stabilityByLeague,
    governance: {
      benchmarkFrozen: true,
      challengerFormulaChanged: true,
      incumbentModified: false,
      finalHoldoutUsedForFeatureSelection: false,
      promotionAttempted: false,
      productionValidated: false,
      realStakeUnlocked: false,
    },
  };
}

export function runStage8PureEloChallengers(
  sourceRows: readonly Stage6GoalRow[],
  startInclusive: string,
  endExclusive: string,
) {
  return {
    eloPure60: runPureEloVariant(
      sourceRows,
      startInclusive,
      endExclusive,
      STAGE8_ELO_PURE60_ADVANTAGE,
      STAGE8_ELO_PURE60_ARTIFACT,
    ),
    eloPure0: runPureEloVariant(
      sourceRows,
      startInclusive,
      endExclusive,
      STAGE8_ELO_PURE0_ADVANTAGE,
      STAGE8_ELO_PURE0_ARTIFACT,
    ),
  };
}
