import {
  normalizeOneXTwo,
  type OneXTwoCalibrationInput,
  type OneXTwoLabel,
  type OneXTwoProbabilities,
} from "./multiclass-calibration";

const LABELS: readonly OneXTwoLabel[] = ["HOME", "DRAW", "AWAY"];
const EPSILON = 1e-12;

export type IsotonicCurve = {
  x: number[];
  y: number[];
};

export type OneXTwoIsotonicParameters = {
  kind: "classwise_isotonic_blend";
  binCount: number;
  blend: number;
  curves: Record<OneXTwoLabel, IsotonicCurve>;
};

type WeightedPoint = { x: number; y: number; weight: number };
type PavBlock = { from: number; to: number; weight: number; weightedY: number };

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return EPSILON;
  return Math.max(EPSILON, Math.min(1 - EPSILON, value));
}

function validateBinCount(binCount: number): number {
  if (!Number.isInteger(binCount) || binCount < 5 || binCount > 100) {
    throw new Error("Isotonic bin count must be an integer between 5 and 100.");
  }
  return binCount;
}

function validateBlend(blend: number): number {
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) {
    throw new Error("Isotonic blend must be between 0 and 1.");
  }
  return blend;
}

function equalFrequencyBins(points: readonly { x: number; y: number }[], binCount: number): WeightedPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const bins = Math.min(binCount, sorted.length);
  const output: WeightedPoint[] = [];

  for (let index = 0; index < bins; index += 1) {
    const start = Math.floor((index * sorted.length) / bins);
    const end = Math.floor(((index + 1) * sorted.length) / bins);
    const slice = sorted.slice(start, Math.max(start + 1, end));
    const weight = slice.length;
    const x = slice.reduce((sum, point) => sum + point.x, 0) / weight;
    const y = slice.reduce((sum, point) => sum + point.y, 0) / weight;
    output.push({ x, y, weight });
  }
  return output;
}

function pooledAdjacentViolators(points: readonly WeightedPoint[]): IsotonicCurve {
  if (points.length === 0) throw new Error("Cannot fit isotonic curve without points.");
  const blocks: PavBlock[] = points.map((point, index) => ({
    from: index,
    to: index,
    weight: point.weight,
    weightedY: point.y * point.weight,
  }));

  let cursor = 0;
  while (cursor < blocks.length - 1) {
    const current = blocks[cursor];
    const next = blocks[cursor + 1];
    if (!current || !next) break;
    const currentMean = current.weightedY / current.weight;
    const nextMean = next.weightedY / next.weight;
    if (currentMean <= nextMean) {
      cursor += 1;
      continue;
    }
    const merged: PavBlock = {
      from: current.from,
      to: next.to,
      weight: current.weight + next.weight,
      weightedY: current.weightedY + next.weightedY,
    };
    blocks.splice(cursor, 2, merged);
    cursor = Math.max(0, cursor - 1);
  }

  const fitted = new Array<number>(points.length);
  for (const block of blocks) {
    const value = clampProbability(block.weightedY / block.weight);
    for (let index = block.from; index <= block.to; index += 1) fitted[index] = value;
  }
  return {
    x: points.map((point) => point.x),
    y: fitted,
  };
}

function interpolateCurve(curve: IsotonicCurve, value: number): number {
  if (curve.x.length === 0 || curve.x.length !== curve.y.length) {
    throw new Error("Invalid isotonic curve.");
  }
  const x = clampProbability(value);
  const firstX = curve.x[0];
  const firstY = curve.y[0];
  const lastX = curve.x[curve.x.length - 1];
  const lastY = curve.y[curve.y.length - 1];
  if (firstX === undefined || firstY === undefined || lastX === undefined || lastY === undefined) {
    throw new Error("Invalid isotonic curve boundaries.");
  }
  if (x <= firstX) return clampProbability(firstY);
  if (x >= lastX) return clampProbability(lastY);

  for (let index = 1; index < curve.x.length; index += 1) {
    const rightX = curve.x[index];
    const leftX = curve.x[index - 1];
    const rightY = curve.y[index];
    const leftY = curve.y[index - 1];
    if (rightX === undefined || leftX === undefined || rightY === undefined || leftY === undefined) continue;
    if (x > rightX) continue;
    if (rightX <= leftX) return clampProbability(rightY);
    const ratio = (x - leftX) / (rightX - leftX);
    return clampProbability(leftY + ratio * (rightY - leftY));
  }
  return clampProbability(lastY);
}

export function fitOneXTwoClasswiseIsotonic(
  inputs: readonly OneXTwoCalibrationInput[],
  binCount: number,
): Omit<OneXTwoIsotonicParameters, "blend"> {
  validateBinCount(binCount);
  if (inputs.length === 0) throw new Error("Cannot fit isotonic calibration without observations.");

  const curves = {} as Record<OneXTwoLabel, IsotonicCurve>;
  for (const label of LABELS) {
    const points = inputs.map((input) => {
      const probabilities = normalizeOneXTwo(input.probabilities);
      return { x: probabilities[label], y: input.outcome === label ? 1 : 0 };
    });
    curves[label] = pooledAdjacentViolators(equalFrequencyBins(points, binCount));
  }
  return { kind: "classwise_isotonic_blend", binCount, curves };
}

export function applyOneXTwoClasswiseIsotonic(
  probabilities: OneXTwoProbabilities,
  parameters: OneXTwoIsotonicParameters,
): OneXTwoProbabilities {
  validateBinCount(parameters.binCount);
  const blend = validateBlend(parameters.blend);
  const raw = normalizeOneXTwo(probabilities);
  const mapped: OneXTwoProbabilities = {
    HOME: interpolateCurve(parameters.curves.HOME, raw.HOME),
    DRAW: interpolateCurve(parameters.curves.DRAW, raw.DRAW),
    AWAY: interpolateCurve(parameters.curves.AWAY, raw.AWAY),
  };
  const blended: OneXTwoProbabilities = {
    HOME: (1 - blend) * raw.HOME + blend * mapped.HOME,
    DRAW: (1 - blend) * raw.DRAW + blend * mapped.DRAW,
    AWAY: (1 - blend) * raw.AWAY + blend * mapped.AWAY,
  };
  return normalizeOneXTwo(blended);
}

export function isOneXTwoIsotonicParameters(value: unknown): value is OneXTwoIsotonicParameters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OneXTwoIsotonicParameters>;
  if (candidate.kind !== "classwise_isotonic_blend") return false;
  if (!Number.isInteger(candidate.binCount) || Number(candidate.binCount) < 5 || Number(candidate.binCount) > 100) return false;
  if (!Number.isFinite(candidate.blend) || Number(candidate.blend) < 0 || Number(candidate.blend) > 1) return false;
  if (!candidate.curves || typeof candidate.curves !== "object") return false;
  return LABELS.every((label) => {
    const curve = candidate.curves?.[label];
    return Boolean(
      curve
      && Array.isArray(curve.x)
      && Array.isArray(curve.y)
      && curve.x.length >= 2
      && curve.x.length === curve.y.length
      && curve.x.every(Number.isFinite)
      && curve.y.every(Number.isFinite),
    );
  });
}
