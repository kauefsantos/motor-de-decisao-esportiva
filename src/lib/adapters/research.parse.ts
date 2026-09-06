// Desk Research adapter — módulo puro (client-safe, testável).
// Fonte: datasets públicos e abertos de resultados de futebol (formato football-data).
// Não há scraping de páginas protegidas, nem bypass de anti-bot/paywall/login.
// Nenhuma estatística é inventada: só entra o que está publicado na fonte.

import { nameSimilarity, normalizeTeamName } from "./sofascore.parse";

export const RESEARCH_SOURCE = "research_adapter";
export const RESEARCH_DEFINITION_VERSION = "research-v1";
export const RESEARCH_MODE_LABEL = "Desk Research / Dados Públicos";

/* ------------------------------------------------------------------ */
/* Catálogo de competições cobertas por dataset público                */
/* ------------------------------------------------------------------ */

export interface ResearchLeague {
  key: string;
  label: string;
  aliases: string[];
  /** Base pública do dataset aberto (mirror versionado, leitura normal). */
  datasetBase: string;
}

const DATASET_BASE =
  "https://raw.githubusercontent.com/datasets/football-datasets/main/datasets";

export const RESEARCH_LEAGUES: ResearchLeague[] = [
  {
    key: "premier-league",
    label: "Premier League",
    aliases: ["premier league", "inglaterra", "ingles", "campeonato ingles", "england", "epl"],
    datasetBase: `${DATASET_BASE}/premier-league`,
  },
  {
    key: "serie-a",
    label: "Serie A (ITA)",
    aliases: ["serie a", "italia", "italiano", "campeonato italiano", "calcio"],
    datasetBase: `${DATASET_BASE}/serie-a`,
  },
  {
    key: "la-liga",
    label: "LaLiga",
    aliases: ["laliga", "la liga", "espanha", "espanhol", "campeonato espanhol", "primera division"],
    datasetBase: `${DATASET_BASE}/la-liga`,
  },
  {
    key: "bundesliga",
    label: "Bundesliga",
    aliases: ["bundesliga", "alemanha", "alemao", "campeonato alemao"],
    datasetBase: `${DATASET_BASE}/bundesliga`,
  },
  {
    key: "ligue-1",
    label: "Ligue 1",
    aliases: ["ligue 1", "franca", "frances", "campeonato frances"],
    datasetBase: `${DATASET_BASE}/ligue-1`,
  },
];

function plain(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface LeagueMatch {
  league: ResearchLeague;
  similarity: number;
}

/** Identifica a competição do CSV dentro do catálogo público. Determinístico. */
export function matchLeague(competition: string | null): LeagueMatch | null {
  if (!competition) return null;
  const target = plain(competition);
  let best: LeagueMatch | null = null;
  for (const league of RESEARCH_LEAGUES) {
    for (const alias of [plain(league.label), ...league.aliases]) {
      const sim = alias === target ? 1 : nameSimilarity(alias, target);
      if (!best || sim > best.similarity) best = { league, similarity: Number(sim.toFixed(4)) };
    }
  }
  return best && best.similarity >= 0.6 ? best : null;
}

/** Temporadas candidatas (formato football-data: 2526 = 2025/26), da mais recente para trás. */
export function seasonCodes(predictionAtIso: string, count = 3): string[] {
  const d = new Date(predictionAtIso);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  // Temporada europeia começa em julho.
  let startYear = month >= 7 ? year : year - 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = String(startYear % 100).padStart(2, "0");
    const b = String((startYear + 1) % 100).padStart(2, "0");
    out.push(`${a}${b}`);
    startYear -= 1;
  }
  return out;
}

export function seasonUrl(league: ResearchLeague, season: string): string {
  return `${league.datasetBase}/season-${season}.csv`;
}

/* ------------------------------------------------------------------ */
/* Parsing do dataset público                                          */
/* ------------------------------------------------------------------ */

export interface ResearchFixture {
  /** chave estável do jogo histórico (liga + data + times normalizados) */
  key: string;
  leagueKey: string;
  season: string;
  sourceUrl: string;
  date: string; // ISO date (YYYY-MM-DD)
  homeTeam: string;
  awayTeam: string;
  /** rótulos exatamente como publicados na fonte */
  raw: Record<string, string>;
}

function parseDate(value: string): string | null {
  const iso = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const m = iso.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const yy = m[3]!.length === 2 ? Number(m[3]) + 2000 : Number(m[3]);
  return `${yy}-${m[2]}-${m[1]}`;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Converte o CSV público em fixtures. Ignora linhas sem data ou sem times. */
export function parseFootballDataCsv(
  text: string,
  context: { leagueKey: string; season: string; sourceUrl: string },
): ResearchFixture[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!);
  const fixtures: ResearchFixture[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) raw[h] = cells[i] ?? "";
    });
    const date = parseDate(raw["Date"] ?? "");
    const home = (raw["HomeTeam"] ?? "").trim();
    const away = (raw["AwayTeam"] ?? "").trim();
    if (!date || !home || !away) continue;
    fixtures.push({
      key: `${context.leagueKey}:${date}:${normalizeTeamName(home)}-${normalizeTeamName(away)}`,
      leagueKey: context.leagueKey,
      season: context.season,
      sourceUrl: context.sourceUrl,
      date,
      homeTeam: home,
      awayTeam: away,
      raw,
    });
  }
  return fixtures;
}

/* ------------------------------------------------------------------ */
/* Resolução determinística de time / partida                          */
/* ------------------------------------------------------------------ */

export const RESEARCH_THRESHOLDS = { accept: 0.78, consider: 0.55, minGap: 0.08 } as const;

export interface TeamResolution {
  status: "MATCH_RESOLVED" | "MATCH_AMBIGUOUS" | "MATCH_NOT_FOUND";
  team: string | null;
  confidence: number;
  reason: string;
  candidates: Array<{ team: string; score: number }>;
}

/** Times distintos publicados na fonte para a competição. */
export function teamRoster(fixtures: ResearchFixture[]): string[] {
  const set = new Set<string>();
  for (const f of fixtures) {
    set.add(f.homeTeam);
    set.add(f.awayTeam);
  }
  return [...set].sort();
}

export function resolveTeam(name: string | null, roster: string[]): TeamResolution {
  if (!name || roster.length === 0) {
    return {
      status: "MATCH_NOT_FOUND",
      team: null,
      confidence: 0,
      reason: "Sem nome de time ou sem elenco publicado na fonte.",
      candidates: [],
    };
  }
  const scored = roster
    .map((team) => ({ team, score: Number(nameSimilarity(name, team).toFixed(4)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const best = scored[0]!;
  const gap = scored[1] ? Number((best.score - scored[1].score).toFixed(4)) : 1;

  if (best.score < RESEARCH_THRESHOLDS.consider) {
    return {
      status: "MATCH_NOT_FOUND",
      team: null,
      confidence: best.score,
      reason: `Melhor candidato "${best.team}" ficou em ${best.score.toFixed(2)}, abaixo de ${RESEARCH_THRESHOLDS.consider}.`,
      candidates: scored,
    };
  }
  if (best.score < RESEARCH_THRESHOLDS.accept || gap < RESEARCH_THRESHOLDS.minGap) {
    return {
      status: "MATCH_AMBIGUOUS",
      team: null,
      confidence: best.score,
      reason:
        gap < RESEARCH_THRESHOLDS.minGap
          ? `Candidatos próximos ("${best.team}" e "${scored[1]?.team}"); nenhuma escolha automática.`
          : `Confiança ${best.score.toFixed(2)} abaixo do limite ${RESEARCH_THRESHOLDS.accept}.`,
      candidates: scored,
    };
  }
  return {
    status: "MATCH_RESOLVED",
    team: best.team,
    confidence: best.score,
    reason: `Time reconhecido na fonte pública com confiança ${best.score.toFixed(2)}.`,
    candidates: scored,
  };
}

export interface MatchResolutionResearch {
  status: "MATCH_RESOLVED" | "MATCH_AMBIGUOUS" | "MATCH_NOT_FOUND";
  home: TeamResolution;
  away: TeamResolution;
  confidence: number;
  reason: string;
  /** id externo do jogo, quando a própria partida já consta publicada */
  fixtureKey: string | null;
}

export function resolveResearchMatch(
  query: { homeTeam: string | null; awayTeam: string | null; competition: string | null; kickoff: string | null },
  fixtures: ResearchFixture[],
  leagueSimilarity: number,
): MatchResolutionResearch {
  const roster = teamRoster(fixtures);
  const home = resolveTeam(query.homeTeam, roster);
  const away = resolveTeam(query.awayTeam, roster);

  const both = home.status === "MATCH_RESOLVED" && away.status === "MATCH_RESOLVED";
  const confidence = Number(
    (0.4 * home.confidence + 0.4 * away.confidence + 0.2 * leagueSimilarity).toFixed(4),
  );

  const targetDate = query.kickoff ? query.kickoff.slice(0, 10) : null;
  const fixture =
    both && targetDate
      ? (fixtures.find(
          (f) => f.date === targetDate && f.homeTeam === home.team && f.awayTeam === away.team,
        ) ?? null)
      : null;

  if (!both) {
    const ambiguous = home.status === "MATCH_AMBIGUOUS" || away.status === "MATCH_AMBIGUOUS";
    return {
      status: ambiguous ? "MATCH_AMBIGUOUS" : "MATCH_NOT_FOUND",
      home,
      away,
      confidence,
      reason: `Mandante: ${home.reason} Visitante: ${away.reason}`,
      fixtureKey: null,
    };
  }

  return {
    status: "MATCH_RESOLVED",
    home,
    away,
    confidence,
    reason: fixture
      ? `Partida publicada na fonte pública (${fixture.date}); confiança ${confidence.toFixed(2)}.`
      : `Times e competição reconhecidos na fonte pública; a partida ainda não consta publicada. Confiança ${confidence.toFixed(2)}.`,
    fixtureKey: fixture?.key ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Histórico pré-jogo                                                  */
/* ------------------------------------------------------------------ */

export interface HistorySelection {
  fixtures: ResearchFixture[];
  status: "OK" | "INSUFFICIENT_HISTORY";
  requested: number;
  found: number;
}

/** Últimos N jogos do time estritamente anteriores a prediction_at. */
export function selectHistory(
  team: string,
  fixtures: ResearchFixture[],
  predictionAtIso: string,
  limit = 5,
): HistorySelection {
  const cutoff = Date.parse(predictionAtIso);
  const list = fixtures
    .filter((f) => f.homeTeam === team || f.awayTeam === team)
    .filter((f) => Date.parse(`${f.date}T23:59:59Z`) < cutoff)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
  return {
    fixtures: list,
    status: list.length >= limit ? "OK" : "INSUFFICIENT_HISTORY",
    requested: limit,
    found: list.length,
  };
}

/* ------------------------------------------------------------------ */
/* Normalização e definition gates                                     */
/* ------------------------------------------------------------------ */

export type ResearchCanonical =
  | "goals_scored"
  | "goals_conceded"
  | "corners_taken"
  | "shots_total"
  | "shots_on_target"
  | "cards_yellow_raw"
  | "cards_red_raw"
  | "fouls_committed";

export interface ResearchMetricDefinition {
  canonical: ResearchCanonical;
  /** rótulo publicado na fonte para o time da casa / visitante */
  homeColumn: string;
  awayColumn: string;
  label: string;
  contractCompatible: boolean;
  note: string;
}

export const RESEARCH_DEFINITIONS: ResearchMetricDefinition[] = [
  {
    canonical: "goals_scored",
    homeColumn: "FTHG",
    awayColumn: "FTAG",
    label: "Full Time Goals",
    contractCompatible: true,
    note: "Gols no tempo regulamentar (90'+acréscimos), compatível com o contrato.",
  },
  {
    canonical: "corners_taken",
    homeColumn: "HC",
    awayColumn: "AC",
    label: "Corners",
    contractCompatible: true,
    note: "Escanteios cobrados (corners_taken), sem proxy de ataques ou cruzamentos.",
  },
  {
    canonical: "shots_total",
    homeColumn: "HS",
    awayColumn: "AS",
    label: "Shots",
    contractCompatible: false,
    note: "DATA_DEFINITION_MISMATCH: a fonte não documenta se bloqueados entram no total (Opta/bet365).",
  },
  {
    canonical: "shots_on_target",
    homeColumn: "HST",
    awayColumn: "AST",
    label: "Shots on Target",
    contractCompatible: false,
    note: "DATA_DEFINITION_MISMATCH: definição de chute ao gol não verificável frente a Opta/bet365.",
  },
  {
    canonical: "cards_yellow_raw",
    homeColumn: "HY",
    awayColumn: "AY",
    label: "Yellow Cards",
    contractCompatible: false,
    note: "DATA_DEFINITION_MISMATCH: a fonte não distingue segundo amarelo do vermelho direto.",
  },
  {
    canonical: "cards_red_raw",
    homeColumn: "HR",
    awayColumn: "AR",
    label: "Red Cards",
    contractCompatible: false,
    note: "DATA_DEFINITION_MISMATCH: vermelho por segundo amarelo não é separável nesta fonte.",
  },
  {
    canonical: "fouls_committed",
    homeColumn: "HF",
    awayColumn: "AF",
    label: "Fouls Committed",
    contractCompatible: false,
    note: "Métrica secundária; sem contrato de mercado associado.",
  },
];

export interface ResearchObservation {
  canonical: ResearchCanonical;
  /** HOME/AWAY do jogo histórico (mando do time observado naquele jogo) */
  venue: "HOME" | "AWAY";
  metricLabelRaw: string;
  valueRaw: string;
  value: number;
  unit: string;
  period: string;
  contractCompatible: boolean;
  note: string;
  sourceUrl: string;
  fixtureKey: string;
  fixtureDate: string;
  opponent: string;
}

function toNumber(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Extrai as observações do time em um jogo histórico. Nunca cria valor ausente. */
export function observationsForTeam(fixture: ResearchFixture, team: string): ResearchObservation[] {
  const isHome = fixture.homeTeam === team;
  if (!isHome && fixture.awayTeam !== team) return [];
  const venue: "HOME" | "AWAY" = isHome ? "HOME" : "AWAY";
  const opponent = isHome ? fixture.awayTeam : fixture.homeTeam;
  const out: ResearchObservation[] = [];

  for (const def of RESEARCH_DEFINITIONS) {
    const own = isHome ? def.homeColumn : def.awayColumn;
    const raw = fixture.raw[own];
    const value = toNumber(raw);
    if (value === null) continue;
    out.push({
      canonical: def.canonical,
      venue,
      metricLabelRaw: `${def.label} (${own})`,
      valueRaw: raw!,
      value,
      unit: "count",
      period: "FULL_TIME",
      contractCompatible: def.contractCompatible,
      note: def.note,
      sourceUrl: fixture.sourceUrl,
      fixtureKey: fixture.key,
      fixtureDate: fixture.date,
      opponent,
    });

    // gols sofridos derivam do mesmo registro de placar (definição idêntica)
    if (def.canonical === "goals_scored") {
      const against = toNumber(fixture.raw[isHome ? def.awayColumn : def.homeColumn]);
      if (against !== null) {
        out.push({
          canonical: "goals_conceded",
          venue,
          metricLabelRaw: `${def.label} (${isHome ? def.awayColumn : def.homeColumn})`,
          valueRaw: String(against),
          value: against,
          unit: "count",
          period: "FULL_TIME",
          contractCompatible: true,
          note: "Gols sofridos no tempo regulamentar, mesmo registro de placar.",
          sourceUrl: fixture.sourceUrl,
          fixtureKey: fixture.key,
          fixtureDate: fixture.date,
          opponent,
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cross-check entre fontes                                            */
/* ------------------------------------------------------------------ */

export type CrossCheckStatus = "SINGLE_SOURCE" | "CROSS_SOURCE_CONFIRMED" | "SOURCE_CONFLICT";

/** Compara médias por fonte. Tolerância relativa de 2% (ou 0.01 absoluto). */
export function crossCheck(perSource: Array<{ source: string; value: number }>): CrossCheckStatus {
  if (perSource.length < 2) return "SINGLE_SOURCE";
  const values = perSource.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const tolerance = Math.max(0.01, Math.abs(max) * 0.02);
  return max - min <= tolerance ? "CROSS_SOURCE_CONFIRMED" : "SOURCE_CONFLICT";
}
