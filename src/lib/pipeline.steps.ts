// Definição client-safe das etapas do pipeline (espelha pipeline.server.ts).

export const PIPELINE_STEPS = [
  { key: "RESOLVE", label: "Encontrando as partidas" },
  { key: "COLLECT", label: "Buscando os dados" },
  { key: "CLEAN", label: "Organizando as informações" },
  { key: "FEATURES", label: "Preparando os indicadores" },
  { key: "PROBABILITY", label: "Calculando as chances" },
  { key: "GATES", label: "Filtrando o que faz sentido" },
  { key: "MARKETS", label: "Montando a lista para conferir" },
] as const;

export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]["key"];
