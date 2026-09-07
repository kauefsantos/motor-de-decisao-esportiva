// Parsing determinístico dos payloads NATIVOS da 5DollarFootballAPI (v1).
// Módulo puro, sem rede e sem segredos.

import {
  goalsFromEvent,
  normalizeTeamName,
  resolveEvent,
  type CanonicalMetric,
  type CsvMatchQuery,
  type MatchResolution,
  type NormalizedStat,
  type ProviderEvent,
} from "./football.shared";

export type { ProviderEvent };

export const FIVE_DOLLAR_SOURCE = "five_dollar_football";
export const FIVE_DOLLAR_DEFINITION_VERSION = "five-dollar-v1";

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapStatus(status: string | null): string | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "finished") return "finished";
  if (s === "scheduled" || s === "notstarted" || s === "not_started") return "notstarted";
  if (s === "postponed" || s === "canceled" || s === "cancelled" || s === "abandoned") return "canceled";
  return "inprogress";
}

export interface FiveDollarFixture extends ProviderEvent {
  leagueId: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
  yellowHome: number | null;
  yellowAway: number | null;
  redHome: number | null;
  redAway: number | null;
  kickoffIso: string | null;
}

export function parseFixtures(payload: unknown): FiveDollarFixture[] {
  const root = asRecord(payload);
  const raw = root?.["data"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: FiveDollarFixture[] = [];

  for (const entry of list) {
    const item = asRecord(entry);
    if (!item) continue;
    const league = asRecord(item["league"]);
    const teams = asRecord(item["teams"]);
    const home = asRecord(teams?.["home"]);
    const away = asRecord(teams?.["away"]);
    const goals = asRecord(item["goals"]);
    const corners = asRecord(item["corners"]);
    const cards = asRecord(item["cards"]);
    const cardsHome = asRecord(cards?.["home"]);
    const cardsAway = asRecord(cards?.["away"]);

    const id = num(item["id"]);
    const homeName = str(home?.["name"]);
    const awayName = str(away?.["name"]);
    if (id === null || !homeName || !awayName) continue;

    out.push({
      eventId: id,
      homeName,
      awayName,
      homeTeamId: num(home?.["id"]),
      awayTeamId: num(away?.["id"]),
      tournament: str(league?.["name"]) ?? "",
      category: null,
      season: null,
      startTimestamp: num(item["kickoff_ts"]),
      statusType: mapStatus(str(item["status"])),
      homeScore: num(goals?.["home"]),
      awayScore: num(goals?.["away"]),
      leagueId: num(league?.["id"]),
      cornersHome: num(corners?.["home"]),
      cornersAway: num(corners?.["away"]),
      yellowHome: num(cardsHome?.["yellow"]),
      yellowAway: num(cardsAway?.["yellow"]),
      redHome: num(cardsHome?.["red"]),
      redAway: num(cardsAway?.["red"]),
      kickoffIso: str(item["kickoff_utc"]),
    });
  }
  return out;
}

export function resolveFixture(query: CsvMatchQuery, events: ProviderEvent[]): MatchResolution {
  return resolveEvent(query, events);
}

export function goalsFromFixture(event: ProviderEvent, predictionAtIso: string): NormalizedStat[] {
  return goalsFromEvent(event, predictionAtIso);
}

function slug(input: string): string {
  return normalizeTeamName(input).replace(/\s+/g, "-") || "na";
}

export function externalMatchKey(fixture: FiveDollarFixture): string {
  const date = fixture.startTimestamp
    ? new Date(fixture.startTimestamp * 1000).toISOString().slice(0, 10)
    : "na";
  return `${slug(fixture.tournament || "liga")}:${date}:${slug(fixture.homeName)}-${slug(fixture.awayName)}`;
}

export function isPreMatchFinished(fixture: FiveDollarFixture, predictionAtIso: string): boolean {
  if (fixture.statusType !== "finished") return false;
  if (!fixture.startTimestamp) return false;
  return fixture.startTimestamp * 1000 < Date.parse(predictionAtIso);
}

export function statsFromFixture(
  fixture: FiveDollarFixture,
  predictionAtIso: string,
): NormalizedStat[] {
  if (!isPreMatchFinished(fixture, predictionAtIso)) return [];
  const out: NormalizedStat[] = [];

  const push = (
    canonical: CanonicalMetric,
    scope: "HOME" | "AWAY",
    value: number | null,
    sourceLabel: string,
    contractCompatible: boolean,
    note: string,
  ) => {
    if (value === null) return;
    out.push({ canonical, scope, value, sourceLabel, contractCompatible, note });
  };

  const cornerNote = "Escanteios cobrados pela equipe na partida (corners.home/away); equivale a corners_taken.";
  push("corners_taken", "HOME", fixture.cornersHome, "corners.home", true, cornerNote);
  push("corners_taken", "AWAY", fixture.cornersAway, "corners.away", true, cornerNote);

  const yellowNote = "Total bruto de amarelos; não distingue segundo amarelo nem participantes excluídos pelo bookmaker.";
  push("cards_yellow_raw", "HOME", fixture.yellowHome, "cards.home.yellow", false, yellowNote);
  push("cards_yellow_raw", "AWAY", fixture.yellowAway, "cards.away.yellow", false, yellowNote);

  const redNote = "Total bruto de vermelhos; ainda não libera mercado de cartões.";
  push("cards_red_raw", "HOME", fixture.redHome, "cards.home.red", false, redNote);
  push("cards_red_raw", "AWAY", fixture.redAway, "cards.away.red", false, redNote);

  return out;
}

export type TeamRelativeMetric =
  | "goals_for"
  | "goals_against"
  | "corners_taken_for"
  | "corners_taken_against"
  | "cards_yellow_raw"
  | "cards_red_raw";

export interface TeamRelativeStat {
  canonical: TeamRelativeMetric;
  scope: "HOME" | "AWAY";
  value: number;
  sourceLabel: string;
  contractCompatible: boolean;
  note: string;
}

export interface TeamRelativeFixtureStats {
  stats: TeamRelativeStat[];
  side: "HOME" | "AWAY";
  opponentId: number | null;
  raw: {
    goalsHome: number | null;
    goalsAway: number | null;
    cornersHome: number | null;
    cornersAway: number | null;
  };
}

export function teamRelativeStats(
  fixture: FiveDollarFixture,
  teamId: number,
  predictionAtIso: string,
): TeamRelativeFixtureStats | null {
  if (!isPreMatchFinished(fixture, predictionAtIso)) return null;
  const isHome = fixture.homeTeamId === teamId;
  const isAway = fixture.awayTeamId === teamId;
  if (!isHome && !isAway) return null;

  const side: "HOME" | "AWAY" = isHome ? "HOME" : "AWAY";
  const mine = <T>(h: T, a: T): T => (isHome ? h : a);
  const theirs = <T>(h: T, a: T): T => (isHome ? a : h);
  const stats: TeamRelativeStat[] = [];
  const push = (
    canonical: TeamRelativeMetric,
    value: number | null,
    sourceLabel: string,
    contractCompatible: boolean,
    note: string,
  ) => {
    if (value === null) return;
    stats.push({ canonical, scope: side, value, sourceLabel, contractCompatible, note });
  };

  const goalNote = "Placar final da partida encerrada; horizonte 90min + acréscimos.";
  push("goals_for", mine(fixture.homeScore, fixture.awayScore), mine("goals.home", "goals.away"), true, goalNote);
  push("goals_against", theirs(fixture.homeScore, fixture.awayScore), theirs("goals.home", "goals.away"), true, goalNote);

  const cornerNote = "Escanteios cobrados pela equipe na partida; equivale a corners_taken.";
  push("corners_taken_for", mine(fixture.cornersHome, fixture.cornersAway), mine("corners.home", "corners.away"), true, cornerNote);
  push("corners_taken_against", theirs(fixture.cornersHome, fixture.cornersAway), theirs("corners.home", "corners.away"), true, cornerNote);

  const yellowNote = "Total bruto de amarelos; definição ainda incompatível com o settlement de cartões.";
  push("cards_yellow_raw", mine(fixture.yellowHome, fixture.yellowAway), mine("cards.home.yellow", "cards.away.yellow"), false, yellowNote);
  const redNote = "Total bruto de vermelhos; definição ainda incompatível com o settlement de cartões.";
  push("cards_red_raw", mine(fixture.redHome, fixture.redAway), mine("cards.home.red", "cards.away.red"), false, redNote);

  return {
    stats,
    side,
    opponentId: isHome ? fixture.awayTeamId : fixture.homeTeamId,
    raw: {
      goalsHome: fixture.homeScore,
      goalsAway: fixture.awayScore,
      cornersHome: fixture.cornersHome,
      cornersAway: fixture.cornersAway,
    },
  };
}

export function mapNativeStatistics(payload: unknown): NormalizedStat[] {
  const data = asRecord(asRecord(payload)?.["data"]);
  const stats = asRecord(data?.["statistics"]);
  if (!stats) return [];

  const out: NormalizedStat[] = [];
  const onTarget = asRecord(stats["shots_on_target"]);
  const offTarget = asRecord(stats["shots_off_target"]);
  const note = "Estatística oficial da fonte; a equivalência exata com o settlement bet365 ainda precisa ser validada antes de liberar o mercado.";

  for (const scope of ["HOME", "AWAY"] as const) {
    const key = scope === "HOME" ? "home" : "away";
    const on = num(onTarget?.[key]);
    const off = num(offTarget?.[key]);
    if (on !== null) {
      out.push({ canonical: "shots_on_target", scope, value: on, sourceLabel: `shots_on_target.${key}`, contractCompatible: false, note });
    }
    if (on !== null && off !== null) {
      out.push({ canonical: "shots_total", scope, value: on + off, sourceLabel: `shots_on_target+shots_off_target.${key}`, contractCompatible: false, note });
    }
  }
  return out;
}
