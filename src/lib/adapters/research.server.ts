// Desk Research adapter — camada de rede (server-only).
// Somente leitura de datasets públicos e abertos, com timeout, retry limitado,
// rate limiting conservador e cache de payload bruto.
// Nunca contorna anti-bot, paywall, login, CAPTCHA ou rate limit.
// Se a fonte bloquear acesso automatizado: SOURCE_UNAVAILABLE e segue adiante.

import {
  RESEARCH_DEFINITION_VERSION,
  RESEARCH_SOURCE,
  matchLeague,
  observationsForTeam,
  parseFootballDataCsv,
  resolveResearchMatch,
  seasonCodes,
  seasonUrl,
  selectHistory,
  type MatchResolutionResearch,
  type ResearchFixture,
  type ResearchObservation,
} from "./research.parse";

export {
  RESEARCH_DEFINITION_VERSION,
  RESEARCH_SOURCE,
  RESEARCH_MODE_LABEL,
} from "./research.parse";

const TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 3;
const MIN_INTERVAL_MS = 800;
const CACHE_TTL_MS = 30 * 60 * 1000;

export type ResearchFetchStatus = "OK" | "UNAVAILABLE";

export interface ResearchFetch {
  url: string;
  status: ResearchFetchStatus;
  httpStatus: number | null;
  errorMessage: string | null;
  fetchedAt: string;
  fromCache: boolean;
  rows: number;
}

interface CacheEntry {
  text: string;
  httpStatus: number | null;
  fetchedAt: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let lastCallAt = 0;

async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

interface TextFetch {
  status: ResearchFetchStatus;
  text: string | null;
  httpStatus: number | null;
  errorMessage: string | null;
  fetchedAt: string;
  fromCache: boolean;
}

async function getText(url: string): Promise<TextFetch> {
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) {
    return {
      status: "OK",
      text: hit.text,
      httpStatus: hit.httpStatus,
      errorMessage: null,
      fetchedAt: hit.fetchedAt,
      fromCache: true,
    };
  }

  let lastError = "Falha desconhecida";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "text/csv,text/plain,*/*",
          // Identificação honesta: nenhum spoofing de navegador.
          "User-Agent": "BetValueEngine/2.1.1 (desk research, public open data)",
        },
      });
      lastStatus = res.status;

      if (res.status === 401 || res.status === 403 || res.status === 429) {
        // Controle de acesso ou rate limit da fonte: não insistir, não contornar.
        return {
          status: "UNAVAILABLE",
          text: null,
          httpStatus: res.status,
          errorMessage: `Fonte pública restringiu o acesso automatizado (HTTP ${res.status}). Nenhuma tentativa de contorno foi feita.`,
          fetchedAt: new Date().toISOString(),
          fromCache: false,
        };
      }
      if (res.status === 404) {
        return {
          status: "UNAVAILABLE",
          text: null,
          httpStatus: 404,
          errorMessage: "Recurso público inexistente (HTTP 404).",
          fetchedAt: new Date().toISOString(),
          fromCache: false,
        };
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status} ao ler ${url}.`;
      } else {
        const text = await res.text();
        const fetchedAt = new Date().toISOString();
        cache.set(url, {
          text,
          httpStatus: res.status,
          fetchedAt,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return {
          status: "OK",
          text,
          httpStatus: res.status,
          errorMessage: null,
          fetchedAt,
          fromCache: false,
        };
      }
    } catch (error) {
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? `Timeout de ${TIMEOUT_MS} ms em ${url}.`
          : error instanceof Error
            ? error.message
            : "Falha de rede desconhecida.";
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }

  return {
    status: "UNAVAILABLE",
    text: null,
    httpStatus: lastStatus,
    errorMessage: lastError,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
}

export interface ResearchDataset {
  fixtures: ResearchFixture[];
  fetches: ResearchFetch[];
  leagueKey: string | null;
  leagueLabel: string | null;
  leagueSimilarity: number;
}

/** Baixa as temporadas públicas necessárias da competição do CSV. */
export async function researchDataset(
  competition: string | null,
  predictionAtIso: string,
  seasons = 2,
): Promise<ResearchDataset> {
  const league = matchLeague(competition);
  if (!league) {
    return {
      fixtures: [],
      fetches: [],
      leagueKey: null,
      leagueLabel: null,
      leagueSimilarity: 0,
    };
  }

  const fixtures: ResearchFixture[] = [];
  const fetches: ResearchFetch[] = [];

  for (const season of seasonCodes(predictionAtIso, seasons)) {
    const url = seasonUrl(league.league, season);
    const res = await getText(url);
    const parsed =
      res.status === "OK" && res.text
        ? parseFootballDataCsv(res.text, {
            leagueKey: league.league.key,
            season,
            sourceUrl: url,
          })
        : [];
    fixtures.push(...parsed);
    fetches.push({
      url,
      status: res.status,
      httpStatus: res.httpStatus,
      errorMessage: res.errorMessage,
      fetchedAt: res.fetchedAt,
      fromCache: res.fromCache,
      rows: parsed.length,
    });
  }

  return {
    fixtures,
    fetches,
    leagueKey: league.league.key,
    leagueLabel: league.league.label,
    leagueSimilarity: league.similarity,
  };
}

export interface ResearchResolution {
  dataset: ResearchDataset;
  resolution: MatchResolutionResearch | null;
}

export async function researchResolveMatch(
  query: {
    homeTeam: string | null;
    awayTeam: string | null;
    competition: string | null;
    kickoff: string | null;
  },
  predictionAtIso: string,
): Promise<ResearchResolution> {
  const dataset = await researchDataset(query.competition, predictionAtIso);
  if (dataset.fixtures.length === 0) return { dataset, resolution: null };
  return {
    dataset,
    resolution: resolveResearchMatch(query, dataset.fixtures, dataset.leagueSimilarity),
  };
}

export interface ResearchHistory {
  team: string;
  observations: ResearchObservation[];
  historyStatus: "OK" | "INSUFFICIENT_HISTORY";
  fixturesUsed: Array<{ key: string; date: string; opponent: string; sourceUrl: string }>;
  requested: number;
  found: number;
}

/** Histórico pré-jogo do time: só jogos estritamente anteriores a prediction_at. */
export function researchTeamHistory(
  team: string,
  dataset: ResearchDataset,
  predictionAtIso: string,
  limit = 5,
): ResearchHistory {
  const selection = selectHistory(team, dataset.fixtures, predictionAtIso, limit);
  const observations: ResearchObservation[] = [];
  for (const fixture of selection.fixtures) {
    observations.push(...observationsForTeam(fixture, team));
  }
  return {
    team,
    observations,
    historyStatus: selection.status,
    fixturesUsed: selection.fixtures.map((f) => ({
      key: f.key,
      date: f.date,
      opponent: f.homeTeam === team ? f.awayTeam : f.homeTeam,
      sourceUrl: f.sourceUrl,
    })),
    requested: selection.requested,
    found: selection.found,
  };
}

export const RESEARCH_ADAPTER_INFO = {
  source: RESEARCH_SOURCE,
  definitionVersion: RESEARCH_DEFINITION_VERSION,
} as const;
