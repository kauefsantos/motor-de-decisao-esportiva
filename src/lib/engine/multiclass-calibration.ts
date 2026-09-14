export type OneXTwoLabel = "HOME" | "DRAW" | "AWAY";

export type OneXTwoProbabilities = Record<OneXTwoLabel, number>;

export type OneXTwoCalibrationInput = {
  probabilities: OneXTwoProbabilities;
  outcome: OneXTwoLabel;
};

const LABELS: readonly OneXTwoLabel[] = ["HOME", "DRAW", "AWAY"];
const EPSILON = 1e-12;
const MIN_TEMPERATURE = 0.25;
const MAX_TEMPERATURE = 4;

function finiteProbability(value: number): number {
  if (!Number.isFinite(value)) return EPSILON;
  return Math.max(EPSILON, Math.min(1 - EPSILON, value));
}

export function normalizeOneXTwo(probabilities: OneXTwoProbabilities): OneXTwoProbabilities {
  const raw = LABELS.map((label) => finiteProbability(probabilities[label]));
  const total = raw.reduce((sum, value) => sum + value, 0);
  return {
    HOME: raw[0] / total,
    DRAW: raw[1] / total,
    AWAY: raw[2] / total,
  };
}

/**
 * Temperature scaling over log-probabilities. T=1 is the identity after
 * normalization. T>1 softens over-confident forecasts; T<1 sharpens them.
 */
export function applyOneXTwoTemperature(
  probabilities: OneXTwoProbabilities,
  temperature: number,
): OneXTwoProbabilities {
  if (!Number.isFinite(temperature) || temperature <= 0) {
    throw new Error("Temperature must be a finite positive number.");
  }
  const normalized = normalizeOneXTwo(probabilities);
  const logits = LABELS.map((label) => Math.log(finiteProbability(normalized[label])) / temperature);
  const maxLogit = Math.max(...logits);
  const weights = logits.map((logit) => Math.exp(logit - maxLogit));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return {
    HOME: weights[0] / total,
    DRAW: weights[1] / total,
    AWAY: weights[2] / total,
  };
}

export function oneXTwoLogLoss(
  inputs: readonly OneXTwoCalibrationInput[],
  temperature = 1,
): number {
  if (inputs.length === 0) return Number.NaN;
  return -inputs.reduce((sum, input) => {
    const calibrated = applyOneXTwoTemperature(input.probabilities, temperature);
    return sum + Math.log(finiteProbability(calibrated[input.outcome]));
  }, 0) / inputs.length;
}

/**
 * Fits a single temperature on the calibration window only. The search happens
 * in log-temperature space so sharpening/softening receive symmetric coverage.
 * No holdout observation is accepted by this function.
 */
export function fitOneXTwoTemperature(inputs: readonly OneXTwoCalibrationInput[]) {
  if (inputs.length === 0) throw new Error("Cannot fit temperature without calibration observations.");

  const lower = Math.log(MIN_TEMPERATURE);
  const upper = Math.log(MAX_TEMPERATURE);
  const coarseSteps = 160;
  let bestLogT = 0;
  let bestLoss = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= coarseSteps; index += 1) {
    const logT = lower + ((upper - lower) * index) / coarseSteps;
    const temperature = Math.exp(logT);
    const loss = oneXTwoLogLoss(inputs, temperature);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestLogT = logT;
    }
  }

  const coarseWidth = (upper - lower) / coarseSteps;
  const fineLower = Math.max(lower, bestLogT - coarseWidth);
  const fineUpper = Math.min(upper, bestLogT + coarseWidth);
  const fineSteps = 200;
  for (let index = 0; index <= fineSteps; index += 1) {
    const logT = fineLower + ((fineUpper - fineLower) * index) / fineSteps;
    const temperature = Math.exp(logT);
    const loss = oneXTwoLogLoss(inputs, temperature);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestLogT = logT;
    }
  }

  const temperature = Math.exp(bestLogT);
  return {
    method: "temperature_scaling" as const,
    temperature,
    bounds: { minimum: MIN_TEMPERATURE, maximum: MAX_TEMPERATURE },
    sampleSize: inputs.length,
    logLossBefore: oneXTwoLogLoss(inputs, 1),
    logLossAfter: bestLoss,
  };
}
