// Adapters por fonte. Nenhum adapter simula dado real.
// Sem credencial/endpoint configurado => NOT_CONFIGURED. Falha de rede => UNAVAILABLE.

export type AdapterStatus = "OK" | "NOT_CONFIGURED" | "UNAVAILABLE";

export interface AdapterObservation {
  metric: string;
  rawValue: unknown;
  observedAt: string | null;
}

export interface AdapterResult {
  source: string;
  status: AdapterStatus;
  definitionVersion: string;
  observations: AdapterObservation[];
  errorMessage: string | null;
  httpStatus: number | null;
  fetchedAt: string;
}

export interface AdapterQuery {
  homeTeam: string | null;
  awayTeam: string | null;
  competition: string | null;
  kickoff: string | null;
  /** nunca usar informação posterior a este instante */
  predictionAt: string;
}

interface AdapterDefinition {
  source: string;
  definitionVersion: string;
  envKeys: string[];
  fetchStats: (query: AdapterQuery, secrets: Record<string, string>) => Promise<AdapterResult>;
}

function notConfigured(source: string, definitionVersion: string, missing: string[]): AdapterResult {
  return {
    source,
    status: "NOT_CONFIGURED",
    definitionVersion,
    observations: [],
    errorMessage: `Fonte não configurada (faltam: ${missing.join(", ")})`,
    httpStatus: null,
    fetchedAt: new Date().toISOString(),
  };
}

const definitions: AdapterDefinition[] = [
  {
    source: "ogol",
    definitionVersion: "ogol-v0",
    envKeys: ["OGOL_API_BASE", "OGOL_API_KEY"],
    fetchStats: async (_q, _s) => notConfigured("ogol", "ogol-v0", ["endpoint"]),
  },
  {
    source: "transfermarkt",
    definitionVersion: "transfermarkt-v0",
    envKeys: ["TRANSFERMARKT_API_BASE", "TRANSFERMARKT_API_KEY"],
    fetchStats: async (_q, _s) => notConfigured("transfermarkt", "transfermarkt-v0", ["endpoint"]),
  },
  {
    source: "opta",
    definitionVersion: "opta-v0",
    envKeys: ["OPTA_API_BASE", "OPTA_API_KEY"],
    // Opta jamais é simulado: sem licença configurada o adapter apenas bloqueia.
    fetchStats: async (_q, _s) => notConfigured("opta", "opta-v0", ["licença Opta"]),
  },
];

export async function collectFromSources(query: AdapterQuery): Promise<AdapterResult[]> {
  const results: AdapterResult[] = [];
  for (const def of definitions) {
    const secrets: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of def.envKeys) {
      const value = process.env[key];
      if (value) secrets[key] = value;
      else missing.push(key);
    }
    if (missing.length > 0) {
      results.push(notConfigured(def.source, def.definitionVersion, missing));
      continue;
    }
    try {
      results.push(await def.fetchStats(query, secrets));
    } catch (error) {
      results.push({
        source: def.source,
        status: "UNAVAILABLE",
        definitionVersion: def.definitionVersion,
        observations: [],
        errorMessage: error instanceof Error ? error.message : "Falha desconhecida",
        httpStatus: null,
        fetchedAt: new Date().toISOString(),
      });
    }
  }
  return results;
}

// sofascore é tratado pelo adapter dedicado (sofascore.server.ts) nas etapas RESOLVE/COLLECT.
export const adapterSources = ["sofascore", ...definitions.map((d) => d.source)];
