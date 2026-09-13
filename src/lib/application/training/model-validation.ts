export const MODEL_VALIDATION_LOOKBACK_DAYS = 365;
export const MODEL_VALIDATION_MIN_OOS_SAMPLE = 200;
export const MODEL_VALIDATION_CALIBRATION_TOLERANCE = 0.1;

export type ValidationRowIdentity = {
  fixtureId: string;
  date: string;
};

export type CalibrationBin = {
  from: number;
  to: number;
  count: number;
  predicted: number;
  observed: number;
};

export type BinaryMetricInput = {
  probability: number;
  outcome: 0 | 1;
};

export type BinaryMetrics = {
  sampleSize: number;
  brier: number;
  logLoss: number;
  expectedCalibrationError: number;
  maxCalibrationGap: number;
  calibration: CalibrationBin[];
};

export type MulticlassLabel = "HOME" | "DRAW" | "AWAY";

export type MulticlassMetricInput = {
  probabilities: Record<MulticlassLabel, number>;
  outcome: MulticlassLabel;
};

export type MulticlassMetrics = {
  sampleSize: number;
  brier: number;
  logLoss: number;
  calibration: Record<MulticlassLabel, BinaryMetrics>;
  expectedCalibrationError: number;
  maxCalibrationGap: number;
};

function safeProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(1e-12, Math.min(1 - 1e-12, value));
}

function startDate(date: string, lookbackDays: number): string {
  const timestamp = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid validation date: ${date}`);
  return new Date(timestamp - lookbackDays * 86_400_000).toISOString().slice(0, 10);
}

export function assertUniqueFixtures<T extends ValidationRowIdentity>(rows: readonly T[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.fixtureId)) throw new Error(`Duplicate validation fixture: ${row.fixtureId}`);
    seen.add(row.fixtureId);
  }
}

export function temporalTrainingRows<T extends ValidationRowIdentity>(
  rows: readonly T[],
  targetDate: string,
  lookbackDays = MODEL_VALIDATION_LOOKBACK_DAYS,
): T[] {
  const lowerBound = startDate(targetDate, lookbackDays);
  return rows.filter((row) => row.date < targetDate && row.date >= lowerBound);
}

export function calibrationBins(inputs: readonly BinaryMetricInput[], binWidth = 0.1): CalibrationBin[] {
  if (inputs.length === 0) return [];
  const width = Math.max(0.01, Math.min(1, binWidth));
  const bins: CalibrationBin[] = [];
  for (let from = 0; from < 1 - 1e-12; from += width) {
    const to = Math.min(1, from + width);
    const bucket = inputs.filter(({ probability }) => {
      const p = Math.max(0, Math.min(1, probability));
      return p >= from && (to === 1 ? p <= to : p < to);
    });
    if (bucket.length === 0) continue;
    bins.push({
      from,
      to,
      count: bucket.length,
      predicted: bucket.reduce((sum, item) => sum + item.probability, 0) / bucket.length,
      observed: bucket.reduce((sum, item) => sum + item.outcome, 0) / bucket.length,
    });
  }
  return bins;
}

export function binaryMetrics(inputs: readonly BinaryMetricInput[]): BinaryMetrics {
  if (inputs.length === 0) {
    return {
      sampleSize: 0,
      brier: Number.NaN,
      logLoss: Number.NaN,
      expectedCalibrationError: Number.NaN,
      maxCalibrationGap: Number.NaN,
      calibration: [],
    };
  }
  const calibration = calibrationBins(inputs);
  const brier = inputs.reduce((sum, item) => sum + (item.probability - item.outcome) ** 2, 0) / inputs.length;
  const logLoss = -inputs.reduce((sum, item) => {
    const p = safeProbability(item.probability);
    return sum + (item.outcome === 1 ? Math.log(p) : Math.log(1 - p));
  }, 0) / inputs.length;
  const expectedCalibrationError = calibration.reduce(
    (sum, bin) => sum + (bin.count / inputs.length) * Math.abs(bin.predicted - bin.observed),
    0,
  );
  const maxCalibrationGap = calibration.reduce(
    (max, bin) => Math.max(max, Math.abs(bin.predicted - bin.observed)),
    0,
  );
  return { sampleSize: inputs.length, brier, logLoss, expectedCalibrationError, maxCalibrationGap, calibration };
}

export function multiclassMetrics(inputs: readonly MulticlassMetricInput[]): MulticlassMetrics {
  if (inputs.length === 0) {
    const empty = binaryMetrics([]);
    return {
      sampleSize: 0,
      brier: Number.NaN,
      logLoss: Number.NaN,
      calibration: { HOME: empty, DRAW: empty, AWAY: empty },
      expectedCalibrationError: Number.NaN,
      maxCalibrationGap: Number.NaN,
    };
  }
  const labels: MulticlassLabel[] = ["HOME", "DRAW", "AWAY"];
  const brier = inputs.reduce((sum, item) => {
    return sum + labels.reduce((inner, label) => {
      const observed = item.outcome === label ? 1 : 0;
      return inner + (item.probabilities[label] - observed) ** 2;
    }, 0);
  }, 0) / inputs.length;
  const logLoss = -inputs.reduce((sum, item) => sum + Math.log(safeProbability(item.probabilities[item.outcome])), 0) / inputs.length;
  const calibration = Object.fromEntries(
    labels.map((label) => [
      label,
      binaryMetrics(inputs.map((item) => ({
        probability: item.probabilities[label],
        outcome: item.outcome === label ? 1 : 0,
      }))),
    ]),
  ) as Record<MulticlassLabel, BinaryMetrics>;
  const expectedCalibrationError = labels.reduce(
    (sum, label) => sum + calibration[label].expectedCalibrationError,
    0,
  ) / labels.length;
  const maxCalibrationGap = labels.reduce(
    (max, label) => Math.max(max, calibration[label].maxCalibrationGap),
    0,
  );
  return { sampleSize: inputs.length, brier, logLoss, calibration, expectedCalibrationError, maxCalibrationGap };
}
