import {
  normalizeOneXTwo,
  type OneXTwoCalibrationInput,
  type OneXTwoLabel,
  type OneXTwoProbabilities,
} from "./multiclass-calibration";

const LABELS: readonly OneXTwoLabel[] = ["HOME", "DRAW", "AWAY"];
const EPSILON = 1e-12;

export type JointCalibrationFamily = "vector_scaling" | "dirichlet";
export type OneXTwoVector = Record<OneXTwoLabel, number>;
export type OneXTwoMatrix = Record<OneXTwoLabel, OneXTwoVector>;

export type OneXTwoJointCalibrationParameters = {
  kind: "joint_multiclass_logit";
  family: JointCalibrationFamily;
  lambda: number;
  blend: number;
  iterations: number;
  learningRate: number;
  scales: OneXTwoVector;
  weights: OneXTwoMatrix;
  bias: OneXTwoVector;
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function vector(home = 0, draw = 0, away = 0): OneXTwoVector {
  return { HOME: home, DRAW: draw, AWAY: away };
}

function identityMatrix(): OneXTwoMatrix {
  return {
    HOME: vector(1, 0, 0),
    DRAW: vector(0, 1, 0),
    AWAY: vector(0, 0, 1),
  };
}

function zeroMatrix(): OneXTwoMatrix {
  return {
    HOME: vector(),
    DRAW: vector(),
    AWAY: vector(),
  };
}

function logFeatures(probabilities: OneXTwoProbabilities): OneXTwoVector {
  const normalized = normalizeOneXTwo(probabilities);
  return {
    HOME: Math.log(Math.max(EPSILON, normalized.HOME)),
    DRAW: Math.log(Math.max(EPSILON, normalized.DRAW)),
    AWAY: Math.log(Math.max(EPSILON, normalized.AWAY)),
  };
}

function softmax(logits: OneXTwoVector): OneXTwoProbabilities {
  const maximum = Math.max(logits.HOME, logits.DRAW, logits.AWAY);
  const home = Math.exp(logits.HOME - maximum);
  const draw = Math.exp(logits.DRAW - maximum);
  const away = Math.exp(logits.AWAY - maximum);
  const total = home + draw + away;
  return { HOME: home / total, DRAW: draw / total, AWAY: away / total };
}

function jointProbabilities(
  probabilities: OneXTwoProbabilities,
  parameters: OneXTwoJointCalibrationParameters,
): OneXTwoProbabilities {
  const features = logFeatures(probabilities);
  if (parameters.family === "vector_scaling") {
    return softmax({
      HOME: parameters.scales.HOME * features.HOME + parameters.bias.HOME,
      DRAW: parameters.scales.DRAW * features.DRAW + parameters.bias.DRAW,
      AWAY: parameters.scales.AWAY * features.AWAY + parameters.bias.AWAY,
    });
  }

  return softmax({
    HOME:
      parameters.weights.HOME.HOME * features.HOME
      + parameters.weights.HOME.DRAW * features.DRAW
      + parameters.weights.HOME.AWAY * features.AWAY
      + parameters.bias.HOME,
    DRAW:
      parameters.weights.DRAW.HOME * features.HOME
      + parameters.weights.DRAW.DRAW * features.DRAW
      + parameters.weights.DRAW.AWAY * features.AWAY
      + parameters.bias.DRAW,
    AWAY:
      parameters.weights.AWAY.HOME * features.HOME
      + parameters.weights.AWAY.DRAW * features.DRAW
      + parameters.weights.AWAY.AWAY * features.AWAY
      + parameters.bias.AWAY,
  });
}

export function applyOneXTwoJointCalibration(
  probabilities: OneXTwoProbabilities,
  parameters: OneXTwoJointCalibrationParameters,
): OneXTwoProbabilities {
  const raw = normalizeOneXTwo(probabilities);
  const joint = jointProbabilities(raw, parameters);
  const blend = clamp(parameters.blend, 0, 1);
  return normalizeOneXTwo({
    HOME: raw.HOME * (1 - blend) + joint.HOME * blend,
    DRAW: raw.DRAW * (1 - blend) + joint.DRAW * blend,
    AWAY: raw.AWAY * (1 - blend) + joint.AWAY * blend,
  });
}

function logLoss(
  inputs: readonly OneXTwoCalibrationInput[],
  parameters: OneXTwoJointCalibrationParameters,
): number {
  if (inputs.length === 0) return Number.NaN;
  let total = 0;
  for (const input of inputs) {
    const calibrated = applyOneXTwoJointCalibration(input.probabilities, parameters);
    total -= Math.log(Math.max(EPSILON, calibrated[input.outcome]));
  }
  return total / inputs.length;
}

export function fitOneXTwoJointCalibration(
  inputs: readonly OneXTwoCalibrationInput[],
  family: JointCalibrationFamily,
  lambda: number,
  options: { iterations?: number; learningRate?: number } = {},
) {
  if (inputs.length === 0) throw new Error("Cannot fit joint calibration without observations.");
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error("Joint calibration lambda must be finite and non-negative.");

  const iterations = Math.max(50, Math.min(800, Math.trunc(options.iterations ?? 320)));
  const learningRate = options.learningRate ?? (family === "vector_scaling" ? 0.045 : 0.025);
  if (!Number.isFinite(learningRate) || learningRate <= 0) throw new Error("Joint calibration learning rate must be positive.");

  const scales = vector(1, 1, 1);
  const weights = identityMatrix();
  const bias = vector();

  const initial: OneXTwoJointCalibrationParameters = {
    kind: "joint_multiclass_logit",
    family,
    lambda,
    blend: 1,
    iterations,
    learningRate,
    scales: { ...scales },
    weights: {
      HOME: { ...weights.HOME },
      DRAW: { ...weights.DRAW },
      AWAY: { ...weights.AWAY },
    },
    bias: { ...bias },
  };
  const logLossBefore = logLoss(inputs, initial);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const scaleGradient = vector();
    const weightGradient = zeroMatrix();
    const biasGradient = vector();

    for (const input of inputs) {
      const features = logFeatures(input.probabilities);
      const parameters: OneXTwoJointCalibrationParameters = {
        kind: "joint_multiclass_logit",
        family,
        lambda,
        blend: 1,
        iterations,
        learningRate,
        scales,
        weights,
        bias,
      };
      const predicted = jointProbabilities(input.probabilities, parameters);

      for (const output of LABELS) {
        const error = predicted[output] - (input.outcome === output ? 1 : 0);
        biasGradient[output] += error;
        if (family === "vector_scaling") {
          scaleGradient[output] += error * features[output];
        } else {
          for (const feature of LABELS) {
            weightGradient[output][feature] += error * features[feature];
          }
        }
      }
    }

    const count = inputs.length;
    const decay = 1 / Math.sqrt(1 + iteration / 80);
    const step = learningRate * decay;

    for (const output of LABELS) {
      biasGradient[output] = biasGradient[output] / count + lambda * bias[output];
      bias[output] = clamp(bias[output] - step * biasGradient[output], -3, 3);

      if (family === "vector_scaling") {
        scaleGradient[output] = scaleGradient[output] / count + lambda * (scales[output] - 1);
        scales[output] = clamp(scales[output] - step * scaleGradient[output], 0.05, 5);
      } else {
        for (const feature of LABELS) {
          const target = output === feature ? 1 : 0;
          weightGradient[output][feature] =
            weightGradient[output][feature] / count + lambda * (weights[output][feature] - target);
          weights[output][feature] = clamp(
            weights[output][feature] - step * weightGradient[output][feature],
            -4,
            4,
          );
        }
      }
    }
  }

  const parameters: OneXTwoJointCalibrationParameters = {
    kind: "joint_multiclass_logit",
    family,
    lambda,
    blend: 1,
    iterations,
    learningRate,
    scales: {
      HOME: finite(scales.HOME),
      DRAW: finite(scales.DRAW),
      AWAY: finite(scales.AWAY),
    },
    weights: {
      HOME: { HOME: finite(weights.HOME.HOME), DRAW: finite(weights.HOME.DRAW), AWAY: finite(weights.HOME.AWAY) },
      DRAW: { HOME: finite(weights.DRAW.HOME), DRAW: finite(weights.DRAW.DRAW), AWAY: finite(weights.DRAW.AWAY) },
      AWAY: { HOME: finite(weights.AWAY.HOME), DRAW: finite(weights.AWAY.DRAW), AWAY: finite(weights.AWAY.AWAY) },
    },
    bias: {
      HOME: finite(bias.HOME),
      DRAW: finite(bias.DRAW),
      AWAY: finite(bias.AWAY),
    },
  };

  return {
    parameters,
    logLossBefore,
    logLossAfter: logLoss(inputs, parameters),
    sampleSize: inputs.length,
  };
}

function validVector(value: unknown): value is OneXTwoVector {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OneXTwoVector>;
  return LABELS.every((label) => Number.isFinite(candidate[label]));
}

function validMatrix(value: unknown): value is OneXTwoMatrix {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OneXTwoMatrix>;
  return LABELS.every((label) => validVector(candidate[label]));
}

export function isOneXTwoJointCalibrationParameters(value: unknown): value is OneXTwoJointCalibrationParameters {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OneXTwoJointCalibrationParameters>;
  return candidate.kind === "joint_multiclass_logit"
    && (candidate.family === "vector_scaling" || candidate.family === "dirichlet")
    && Number.isFinite(candidate.lambda)
    && Number(candidate.lambda) >= 0
    && Number.isFinite(candidate.blend)
    && Number(candidate.blend) >= 0
    && Number(candidate.blend) <= 1
    && Number.isFinite(candidate.iterations)
    && Number.isFinite(candidate.learningRate)
    && validVector(candidate.scales)
    && validMatrix(candidate.weights)
    && validVector(candidate.bias);
}
