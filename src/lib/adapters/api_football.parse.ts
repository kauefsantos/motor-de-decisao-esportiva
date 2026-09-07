// Parsing e normalização determinística da API-Football (API-Sports v3).
// Módulo puro, sem rede e sem segredos.

import {
  goalsFromEvent,
  resolveEvent,
  type CsvMatchQuery,
  type MatchResolution,
  type MetricDefinition,
  type NormalizedStat,
  type ProviderEvent,
} from "./football.shared";

export type { ProviderEvent };

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

function mapStatus(short: string | null): string | null {
  if (!short) return null;
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["NS", "TBD"].includes(short)) return "notstarted";
  if (["PST", "CANC", "ABD", "AWD", "WO"].includes(short)) return "canceled";
  return "inprogress";
}

export function parseFixtures(payload: unknown): ProviderEvent[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.["response"]) ? (root!["response"] as unknown[]) : [];
  const out: ProviderEvent[] = [];

  for (const raw of list) {
    const item = asRecord(raw);
    if (!item) continue;
    const fixture = asRecord(item["fixture"]);
    const league = asRecord(item["league"]);
    const teams = asRecord(item["teams"]);
    const goals = asRecord(item["goals"]);
    const home = asRecord(teams?.["home"]);
    const away = asRecord(teams?.["away"]);

    const id = num(fixture?.["id"]);
    const homeName = str(home?.["name"]);
    const awayName = str(away?.["name"]);
    if (id === null || !homeName || !awayName) continue;

    const seasonRaw = league?.["season"];
    out.push({
      eventId: id,
      homeName,
      awayName,
      homeTeamId: num(home?.["id"]),
      awayTeamId: num(away?.["id"]),
      tournament: str(league?.["name"]) ?? "",
      category: str(league?.["country"]),
      season: seasonRaw === undefined || seasonRaw === null ? null : String(seasonRaw),
      startTimestamp: num(fixture?.["timestamp"]),
      statusType: mapStatus(str(asRecord(fixture?.["status"])?.["short"])),
      homeScore: num(goals?.["home"]),
      awayScore: num(goals?.["away"]),
    });
  }
  return out;
}

export function resolveFixture(query: CsvMatchQuery, events: ProviderEvent[]): MatchResolution {
  return resolveEvent(query, events);
}

export const API_FOOTBALL_DEFINITIONS: MetricDefinition[] = [
  {
    canonical: "corners_taken",
    sourceLabels: ["Corner Kicks"],
    contractCompatible: true,
    note: "Escanteios cobrados na partida; definição equivalente a corners_taken.",
  },
  {
    canonical: "shots_total",
    sourceLabels: ["Total Shots"],
    contractCompatible: false,
    note: "Total de finalizações sem detalhamento auditável de bloqueadas/fora; não libera contrato bet365 automaticamente.",
  },
  {
    canonical: "shots_on_target",
    sourceLabels: ["Shots on Goal"],
    contractCompatible: false,
    note: "Shots on Goal da fonte; a equivalência exata com o settlement bet365 ainda precisa ser validada.",
  },
  {
    canonical: "cards_yellow_raw",
    sourceLabels: ["Yellow Cards"],
    contractCompatible: false,
    note: "Não distingue segundo amarelo nem participantes excluídos pelo bookmaker.",
  },
  {
    canonical: "cards_red_raw",
    sourceLabels: ["Red Cards"],
    contractCompatible: false,
    note: "Contagem bruta de vermelhos; não autoriza pontuação de cartões sem regra de settlement validada.",
  },
];

export interface FixtureStatistic {
  teamId: number | null;
  label: string;
  value: number | null;
}

export function parseFixtureStatistics(payload: unknown): FixtureStatistic[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.["response"]) ? (root!["response"] as unknown[]) : [];
  const out: FixtureStatistic[] = [];

  for (const raw of list) {
    const block = asRecord(raw);
    if (!block) continue;
    const teamId = num(asRecord(block["team"])?.["id"]);
    const items = Array.isArray(block["statistics"]) ? (block["statistics"] as unknown[]) : [];
    for (const itemRaw of items) {
      const item = asRecord(itemRaw);
      const label = str(item?.["type"]);
      if (!label) continue;
      out.push({ teamId, label, value: num(item?.["value"]) });
    }
  }
  return out;
}

export function mapFixtureStatistics(
  payload: unknown,
  homeTeamId: number | null,
  awayTeamId: number | null,
): NormalizedStat[] {
  const out: NormalizedStat[] = [];
  for (const stat of parseFixtureStatistics(payload)) {
    const def = API_FOOTBALL_DEFINITIONS.find((d) => d.sourceLabels.includes(stat.label));
    if (!def || stat.value === null || stat.teamId === null) continue;
    const scope: "HOME" | "AWAY" | null =
      stat.teamId === homeTeamId ? "HOME" : stat.teamId === awayTeamId ? "AWAY" : null;
    if (!scope) continue;
    out.push({
      canonical: def.canonical,
      scope,
      value: stat.value,
      sourceLabel: stat.label,
      contractCompatible: def.contractCompatible,
      note: def.note,
    });
  }
  return out;
}

export function goalsFromFixture(event: ProviderEvent, predictionAtIso: string): NormalizedStat[] {
  return goalsFromEvent(event, predictionAtIso);
}
