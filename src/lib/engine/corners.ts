// MODELO 1 — ESCANTEIOS (corners-negbin-v2).
// Determinístico, puro e testável. Nenhuma odd de casa entra aqui (Motor 1).
// Técnica implementada e testada:
//   - taxas de ataque/defesa por time com encolhimento para a média da competição;
//   - lambda condicional preservado do baseline;
//   - dispersão NB2 total/home/away estimada apenas no treino;
//   - Binomial Negativa quando alpha>0, Poisson como limite alpha≈0;
//   - validação temporal com Brier, log loss, calibração e MAE.

export const CORNERS_MODEL_VERSION = "corners-negbin-v2";
export const MIN_TRAIN_MATCHES = 200;
export const MIN_TEST_MATCHES = 60;
export const SHRINKAGE_K = 5;
export const EVAL_LINE = 9.5;

export interface CornerMatchRow {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeCorners: number;
  awayCorners: number;
}

export interface CornersModelParams {
  modelVersion: string;
  leagueMeanHome: Record<string, number>;
  leagueMeanAway: Record<string, number>;
  globalMeanHome: number;
  globalMeanAway: number;
  attack: Record<string, { home: number; away: number }>;
  defense: Record<string, { home: number; away: number }>;
  sampleSizes: Record<string, number>;
  trainMatches: number;
  /** NB2 alphas: variance = mu + alpha*mu². Zero is the Poisson limit. */
  dispersionAlphaTotal: number;
  dispersionAlphaHome: number;
  dispersionAlphaAway: number;
}

export interface CalibrationBin {
  from: number;
  to: number;
  count: number;
  predicted: number;
  observed: number;
}

export interface ValidationMetrics {
  trainMatches: number;
  testMatches: number;
  evalLine: number;
  modelMae: number;
  baselineMae: number;
  modelBrier: number;
  baselineBrier: number;
  modelLogLoss: number;
  baselineLogLoss: number;
  calibration: CalibrationBin[];
  maxCalibrationGap: number;
}

export type TrainingOutcome =
  | { status: "INSUFFICIENT_MODEL_TRAINING_DATA"; usableMatches: number; trainMatches: number; testMatches: number; requiredTrain: number; requiredTest: number }
  | { status: "EVALUATED"; params: CornersModelParams; metrics: ValidationMetrics; validationStatus: "PRODUCTION_VALIDATED" | "VALIDATION_PENDING"; acceptance: AcceptanceChecks };

export interface AcceptanceChecks {
  beatsBaselineMae: boolean;
  beatsBaselineLogLoss: boolean;
  beatsBaselineBrier: boolean;
  calibrationWithinTolerance: boolean;
  tolerance: number;
}

const CALIBRATION_TOLERANCE = 0.1;

function teamKey(league: string, team: string) {
  return `${league}::${team}`;
}

export function sortChronologically(rows: CornerMatchRow[]): CornerMatchRow[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const ka = `${a.league}|${a.homeTeam}|${a.awayTeam}`;
    const kb = `${b.league}|${b.homeTeam}|${b.awayTeam}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function temporalSplit(rows: CornerMatchRow[], trainRatio = 0.7) {
  const sorted = sortChronologically(rows);
  const cut = Math.floor(sorted.length * trainRatio);
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}

function factor(agg: { sum: number; n: number } | undefined, base: number): number {
  if (!agg || agg.n === 0 || base <= 0) return 1;
  return (agg.sum + SHRINKAGE_K * base) / (agg.n * base + SHRINKAGE_K * base);
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

type ParamsWithoutDispersion = Omit<
  CornersModelParams,
  "dispersionAlphaTotal" | "dispersionAlphaHome" | "dispersionAlphaAway"
> & Partial<Pick<CornersModelParams, "dispersionAlphaTotal" | "dispersionAlphaHome" | "dispersionAlphaAway">>;

function predictLambdas(
  params: ParamsWithoutDispersion,
  input: { league: string; homeTeam: string; awayTeam: string },
) {
  const kh = teamKey(input.league, input.homeTeam);
  const ka = teamKey(input.league, input.awayTeam);
  const baseHome = params.leagueMeanHome[input.league] ?? params.globalMeanHome;
  const baseAway = params.leagueMeanAway[input.league] ?? params.globalMeanAway;
  const lambdaHome = Math.max(0.05, baseHome * (params.attack[kh]?.home ?? 1) * (params.defense[ka]?.away ?? 1));
  const lambdaAway = Math.max(0.05, baseAway * (params.attack[ka]?.away ?? 1) * (params.defense[kh]?.home ?? 1));
  return { kh, ka, lambdaHome, lambdaAway, lambdaTotal: lambdaHome + lambdaAway };
}

function alphaFromPairs(pairs: Array<{ actual: number; mu: number }>) {
  let numerator = 0;
  let denominator = 0;
  for (const { actual, mu } of pairs) {
    numerator += Math.max(0, (actual - mu) ** 2 - mu);
    denominator += mu ** 2;
  }
  if (!(denominator > 0)) return 0;
  const alpha = numerator / denominator;
  return Number.isFinite(alpha) ? Math.max(0, alpha) : 0;
}

/** All dispersion estimates use training outcomes only. */
export function estimateDispersionAlphas(train: CornerMatchRow[], params: ParamsWithoutDispersion) {
  const home: Array<{ actual: number; mu: number }> = [];
  const away: Array<{ actual: number; mu: number }> = [];
  const total: Array<{ actual: number; mu: number }> = [];
  for (const row of train) {
    const p = predictLambdas(params, row);
    home.push({ actual: row.homeCorners, mu: p.lambdaHome });
    away.push({ actual: row.awayCorners, mu: p.lambdaAway });
    total.push({ actual: row.homeCorners + row.awayCorners, mu: p.lambdaTotal });
  }
  return {
    total: alphaFromPairs(total),
    home: alphaFromPairs(home),
    away: alphaFromPairs(away),
  };
}

export function fitBaseline(train: CornerMatchRow[]): CornersModelParams {
  const leagueHome = new Map<string, { sum: number; n: number }>();
  const leagueAway = new Map<string, { sum: number; n: number }>();
  const forHome = new Map<string, { sum: number; n: number }>();
  const forAway = new Map<string, { sum: number; n: number }>();
  const agHome = new Map<string, { sum: number; n: number }>();
  const agAway = new Map<string, { sum: number; n: number }>();
  const bump = (m: Map<string, { sum: number; n: number }>, k: string, v: number) => {
    const cur = m.get(k) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    m.set(k, cur);
  };

  for (const r of train) {
    bump(leagueHome, r.league, r.homeCorners);
    bump(leagueAway, r.league, r.awayCorners);
    bump(forHome, teamKey(r.league, r.homeTeam), r.homeCorners);
    bump(agHome, teamKey(r.league, r.awayTeam), r.homeCorners);
    bump(forAway, teamKey(r.league, r.awayTeam), r.awayCorners);
    bump(agAway, teamKey(r.league, r.homeTeam), r.awayCorners);
  }

  const globalMeanHome = mean(train.map((r) => r.homeCorners));
  const globalMeanAway = mean(train.map((r) => r.awayCorners));
  const leagueMeanHome: Record<string, number> = {};
  const leagueMeanAway: Record<string, number> = {};
  for (const [k, v] of leagueHome) leagueMeanHome[k] = v.n ? v.sum / v.n : globalMeanHome;
  for (const [k, v] of leagueAway) leagueMeanAway[k] = v.n ? v.sum / v.n : globalMeanAway;

  const attack: Record<string, { home: number; away: number }> = {};
  const defense: Record<string, { home: number; away: number }> = {};
  const sampleSizes: Record<string, number> = {};
  const keys = new Set([...forHome.keys(), ...forAway.keys(), ...agHome.keys(), ...agAway.keys()]);
  for (const key of keys) {
    const league = key.split("::")[0] ?? "";
    const baseHome = leagueMeanHome[league] ?? globalMeanHome;
    const baseAway = leagueMeanAway[league] ?? globalMeanAway;
    attack[key] = { home: factor(forHome.get(key), baseHome), away: factor(forAway.get(key), baseAway) };
    defense[key] = { home: factor(agAway.get(key), baseAway), away: factor(agHome.get(key), baseHome) };
    sampleSizes[key] = (forHome.get(key)?.n ?? 0) + (forAway.get(key)?.n ?? 0);
  }

  const baseParams = {
    modelVersion: CORNERS_MODEL_VERSION,
    leagueMeanHome,
    leagueMeanAway,
    globalMeanHome,
    globalMeanAway,
    attack,
    defense,
    sampleSizes,
    trainMatches: train.length,
  };
  const dispersion = estimateDispersionAlphas(train, baseParams);
  return {
    ...baseParams,
    dispersionAlphaTotal: dispersion.total,
    dispersionAlphaHome: dispersion.home,
    dispersionAlphaAway: dispersion.away,
  };
}

export interface CornersPrediction {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  sampleSize: number;
  dispersionAlphaTotal: number;
  dispersionAlphaHome: number;
  dispersionAlphaAway: number;
}

export function predict(params: CornersModelParams, input: { league: string; homeTeam: string; awayTeam: string }): CornersPrediction {
  const values = predictLambdas(params, input);
  return {
    lambdaHome: values.lambdaHome,
    lambdaAway: values.lambdaAway,
    lambdaTotal: values.lambdaTotal,
    sampleSize: Math.min(params.sampleSizes[values.kh] ?? 0, params.sampleSizes[values.ka] ?? 0),
    dispersionAlphaTotal: Math.max(0, params.dispersionAlphaTotal ?? 0),
    dispersionAlphaHome: Math.max(0, params.dispersionAlphaHome ?? 0),
    dispersionAlphaAway: Math.max(0, params.dispersionAlphaAway ?? 0),
  };
}

export function poissonDistribution(lambda: number, maxCount = 40): Map<number, number> {
  const dist = new Map<number, number>();
  let term = Math.exp(-lambda);
  let total = 0;
  for (let k = 0; k <= maxCount; k += 1) {
    if (k > 0) term = (term * lambda) / k;
    dist.set(k, term);
    total += term;
  }
  if (total > 0) for (const [k, p] of dist) dist.set(k, p / total);
  return dist;
}

export function negativeBinomialDistribution(lambda: number, alpha: number, maxCount = 60): Map<number, number> {
  if (!(alpha > 1e-8) || !(lambda > 0)) return poissonDistribution(lambda, maxCount);
  const r = 1 / alpha;
  const p = r / (r + lambda);
  const q = 1 - p;
  const dist = new Map<number, number>();
  let term = p ** r;
  let total = 0;
  for (let k = 0; k <= maxCount; k += 1) {
    if (k > 0) term = term * ((k - 1 + r) / k) * q;
    dist.set(k, term);
    total += term;
  }
  if (total > 0) for (const [k, value] of dist) dist.set(k, value / total);
  return dist;
}

export function countDistribution(lambda: number, dispersionAlpha: number | null | undefined, maxCount = 60): Map<number, number> {
  return dispersionAlpha && dispersionAlpha > 1e-8
    ? negativeBinomialDistribution(lambda, dispersionAlpha, maxCount)
    : poissonDistribution(lambda, maxCount);
}

export function probabilityOver(dist: Map<number, number>, line: number): number {
  let p = 0;
  for (const [k, v] of dist) if (k > line) p += v;
  return Math.min(1, Math.max(0, p));
}

export function validateTemporally(rows: CornerMatchRow[], trainRatio = 0.7): TrainingOutcome {
  const usable = rows.filter((r) => Number.isFinite(r.homeCorners) && Number.isFinite(r.awayCorners));
  const { train, test } = temporalSplit(usable, trainRatio);
  if (train.length < MIN_TRAIN_MATCHES || test.length < MIN_TEST_MATCHES) {
    return { status: "INSUFFICIENT_MODEL_TRAINING_DATA", usableMatches: usable.length, trainMatches: train.length, testMatches: test.length, requiredTrain: MIN_TRAIN_MATCHES, requiredTest: MIN_TEST_MATCHES };
  }

  const params = fitBaseline(train);
  const baselineLambda = params.globalMeanHome + params.globalMeanAway;
  const baselineP = probabilityOver(poissonDistribution(baselineLambda), EVAL_LINE);
  const preds: { p: number; pBase: number; lambda: number; actual: number }[] = [];
  for (const r of test) {
    const pr = predict(params, r);
    const leagueBase = (params.leagueMeanHome[r.league] ?? params.globalMeanHome) + (params.leagueMeanAway[r.league] ?? params.globalMeanAway);
    preds.push({
      p: probabilityOver(countDistribution(pr.lambdaTotal, pr.dispersionAlphaTotal), EVAL_LINE),
      pBase: probabilityOver(poissonDistribution(leagueBase), EVAL_LINE) || baselineP,
      lambda: pr.lambdaTotal,
      actual: r.homeCorners + r.awayCorners,
    });
  }

  const leagueBaselineMae = mean(test.map((r) => {
    const base = (params.leagueMeanHome[r.league] ?? params.globalMeanHome) + (params.leagueMeanAway[r.league] ?? params.globalMeanAway);
    return Math.abs(r.homeCorners + r.awayCorners - base);
  }));

  const metrics: ValidationMetrics = {
    trainMatches: train.length,
    testMatches: test.length,
    evalLine: EVAL_LINE,
    modelMae: mean(preds.map((x) => Math.abs(x.actual - x.lambda))),
    baselineMae: leagueBaselineMae,
    modelBrier: mean(preds.map((x) => (x.p - (x.actual > EVAL_LINE ? 1 : 0)) ** 2)),
    baselineBrier: mean(preds.map((x) => (x.pBase - (x.actual > EVAL_LINE ? 1 : 0)) ** 2)),
    modelLogLoss: mean(preds.map((x) => logLoss(x.p, x.actual > EVAL_LINE))),
    baselineLogLoss: mean(preds.map((x) => logLoss(x.pBase, x.actual > EVAL_LINE))),
    calibration: calibrationBins(preds.map((x) => ({ p: x.p, y: x.actual > EVAL_LINE }))),
    maxCalibrationGap: 0,
  };
  metrics.maxCalibrationGap = metrics.calibration.reduce((m, b) => Math.max(m, Math.abs(b.predicted - b.observed)), 0);
  const acceptance: AcceptanceChecks = {
    beatsBaselineMae: metrics.modelMae < metrics.baselineMae,
    beatsBaselineLogLoss: metrics.modelLogLoss < metrics.baselineLogLoss,
    beatsBaselineBrier: metrics.modelBrier < metrics.baselineBrier,
    calibrationWithinTolerance: metrics.maxCalibrationGap <= CALIBRATION_TOLERANCE,
    tolerance: CALIBRATION_TOLERANCE,
  };
  const ok = acceptance.beatsBaselineMae && acceptance.beatsBaselineLogLoss && acceptance.beatsBaselineBrier && acceptance.calibrationWithinTolerance;
  return { status: "EVALUATED", params, metrics, acceptance, validationStatus: ok ? "PRODUCTION_VALIDATED" : "VALIDATION_PENDING" };
}

function logLoss(p: number, y: boolean) {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return y ? -Math.log(q) : -Math.log(1 - q);
}

export function calibrationBins(points: { p: number; y: boolean }[], bins = 5): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let i = 0; i < bins; i += 1) {
    const from = i / bins;
    const to = (i + 1) / bins;
    const inBin = points.filter((x) => (i === bins - 1 ? x.p >= from && x.p <= to : x.p >= from && x.p < to));
    out.push({ from, to, count: inBin.length, predicted: inBin.length ? mean(inBin.map((x) => x.p)) : 0, observed: inBin.length ? inBin.filter((x) => x.y).length / inBin.length : 0 });
  }
  return out;
}
