// Definição client-safe das etapas do pipeline (espelha pipeline.server.ts).

export const PIPELINE_STEPS = [
  { key: "RESOLVE", label: "Encontrando as partidas" },
  { key: "COLLECT", label: "Buscando as informações" },
  { key: "CLEAN", label: "Organizando as informações" },
  { key: "FEATURES", label: "Resumindo os dados dos times" },
  { key: "PROBABILITY", label: "Calculando as chances" },
  { key: "GATES", label: "Separando as melhores opções" },
  { key: "MARKETS", label: "Montando a lista para conferir" },
] as const;

export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]["key"];