// Definição client-safe das etapas do pipeline (espelha pipeline.server.ts).

export const PIPELINE_STEPS = [
  { key: "RESOLVE", label: "Identificando partidas" },
  { key: "COLLECT", label: "Coletando estatísticas" },
  { key: "CLEAN", label: "Higienizando e compatibilizando definições" },
  { key: "FEATURES", label: "Construindo features" },
  { key: "PROBABILITY", label: "Estimando probabilidades" },
  { key: "GATES", label: "Aplicando gates" },
  { key: "MARKETS", label: "Selecionando mercados" },
] as const;

export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]["key"];
