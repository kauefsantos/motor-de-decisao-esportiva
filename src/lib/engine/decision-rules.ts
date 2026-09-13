// Regras quantitativas canônicas compartilhadas entre os motores de oportunidade e valor.
// Alterar estes limites exige revisão explícita de regra de negócio e regressões de fronteira.

export const MIN_MODEL_PROBABILITY = 0.70;
export const MIN_ENTRY_ODD = 1.70;
export const EV_TARGET = 0.08;
export const MIN_EDGE = 0.05;
export const MAX_SELECTIONS = 3;

export function percentageLabel(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
