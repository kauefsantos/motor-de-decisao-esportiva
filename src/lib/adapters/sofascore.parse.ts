// Parsing e normalização determinística de payloads SofaScore.
// Módulo puro (sem rede, sem segredos): usado pelo adapter server-side e pelos testes.

export interface SofascoreEvent {
  eventId: number;
  homeName: string;
  awayName: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  tournament: string;
  category: string | null;
  season: string | null;
  startTimestamp: number | null;
  statusType: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface CsvMatchQuery {
  homeTeam: string | null;
  awayTeam: string | null;
  competition: string | null;
  /** ISO 8601 com offset */
  kickoff: string | null;
}

export type MatchResolutionStatus = "MATCH_RESOLVED" | "MATCH_AMBIGUOUS" | "MATCH_NOT_FOUND";

export interface CandidateScore {
  eventId: number;
  label: string;
  score: number;
  homeSimilarity: number;
  awaySimilarity: number;
  kickoffScore: number;
  competitionSimilarity: number;
}

export interface MatchResolution {
  status: MatchResolutionStatus;
  eventId: number | null;
  confidence: number;
  reason: string;
  candidates: CandidateScore[];
}

/* ------------------------------------------------------------------ */
/* Normalização de nomes                                               */
/* ------------------------------------------------------------------ */

const NOISE_TOKENS = new Set([
  "fc",
  "cf",
  "sc",
  "ac",
  "cd",
  "ud",
  "ss",
  "as",
  "afc",
  "club",
  "clube",
  "de",
  "do",
  "da",
  "the",
  "calcio",
  "futebol",
  "football",
  "esporte",
  "esportivo",
  "atletico",
  "sociedad",
  "deportivo",
]);

/** Aliases explícitos e auditáveis (nunca heurística silenciosa). */
const ALIASES: Record<string, string> = {
  "celta de vigo": "celta",
  "rc celta": "celta",
  "real sociedad": "real sociedad",
  gremio: "gremio",
  "gremio fbpa": "gremio",
  "vitoria ba": "vitoria",
  "ec vitoria": "vitoria",
  "inter milan": "internazionale",
  "internazionale milano": "internazionale",
};

export function normalizeTeamName(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliased = ALIASES[base] ?? base;
  // Tokens de 1 caractere são iniciais residuais de siglas pontuadas (ex.: "F.B.P.A.").
  const tokens = aliased.split(" ").filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
  // Se a remoção de ruído esvaziar o nome (ex.: "Atletico"), preserva o original.
  return (tokens.length > 0 ? tokens.join(" ") : aliased).trim();
}

function bigrams(s: string): string[] {
  const clean = s.replace(/\s/g, "");
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

/** Dice coefficient sobre bigramas + bônus por token exato. Determinístico, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ga = bigrams(na);
  const gb = bigrams(nb);
  if (ga.length === 0 || gb.length === 0) return 0;
  const pool = [...gb];
  let hits = 0;
  for (const g of ga) {
    const idx = pool.indexOf(g);
    if (idx >= 0) {
      hits++;
      pool.splice(idx, 1);
    }
  }
  const dice = (2 * hits) / (ga.length + gb.length);

  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const tokenScore = shared / Math.max(ta.size, tb.size);

  return Math.min(1, 0.65 * dice + 0.35 * tokenScore);
}

/** 1 quando o kickoff bate em até 15 min; decai linearmente até 0 em 180 min. */
export function kickoffProximity(expectedIso: string | null, startTimestamp: number | null): number {
  if (!expectedIso || !startTimestamp) return 0;
  const expected = Date.parse(expectedIso);
  if (Number.isNaN(expected)) return 0;
  const diffMin = Math.abs(expected - startTimestamp * 1000) / 60000;
  if (diffMin <= 15) return 1;
  if (diffMin >= 180) return 0;
  return Number((1 - (diffMin - 15) / 165).toFixed(4));
}

/* ------------------------------------------------------------------ */
/* Parsing de payload                                                  */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Aceita { events: [...] } ou um array cru. Ignora entradas sem id/times. */
export function parseScheduledEvents(payload: unknown): SofascoreEvent[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.["events"])
      ? (root!["events"] as unknown[])
      : [];

  const out: SofascoreEvent[] = [];
  for (const raw of list) {
    const e = asRecord(raw);
    if (!e) continue;
    const id = num(e["id"]);
    const home = str(asRecord(e["homeTeam"])?.["name"]);
    const away = str(asRecord(e["awayTeam"])?.["name"]);
    if (id === null || !home || !away) continue;

    const tournamentRec = asRecord(e["tournament"]);
    const uniqueRec = asRecord(tournamentRec?.["uniqueTournament"]);
    const categoryRec = asRecord(tournamentRec?.["category"]);
    const statusRec = asRecord(e["status"]);

    out.push({
      eventId: id,
      homeName: home,
      awayName: away,
      homeTeamId: num(asRecord(e["homeTeam"])?.["id"]),
      awayTeamId: num(asRecord(e["awayTeam"])?.["id"]),
      tournament: str(uniqueRec?.["name"]) ?? str(tournamentRec?.["name"]) ?? "",
      category: str(categoryRec?.["name"]),
      season: str(asRecord(e["season"])?.["year"]) ?? null,
      startTimestamp: num(e["startTimestamp"]),
      statusType: str(statusRec?.["type"]),
      homeScore: num(asRecord(e["homeScore"])?.["current"]),
      awayScore: num(asRecord(e["awayScore"])?.["current"]),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Resolução determinística                                            */
/* ------------------------------------------------------------------ */

export const RESOLUTION_THRESHOLDS = {
  accept: 0.78,
  minGap: 0.08,
  consider: 0.55,
} as const;

export function scoreCandidate(query: CsvMatchQuery, event: SofascoreEvent): CandidateScore {
  const homeSimilarity = query.homeTeam ? nameSimilarity(query.homeTeam, event.homeName) : 0;
  const awaySimilarity = query.awayTeam ? nameSimilarity(query.awayTeam, event.awayName) : 0;
  const kickoffScore = kickoffProximity(query.kickoff, event.startTimestamp);
  const competitionSimilarity = query.competition
    ? nameSimilarity(query.competition, event.tournament)
    : 0;

  const score = Number(
    (
      0.35 * homeSimilarity +
      0.35 * awaySimilarity +
      0.2 * kickoffScore +
      0.1 * competitionSimilarity
    ).toFixed(4),
  );

  return {
    eventId: event.eventId,
    label: `${event.homeName} x ${event.awayName}`,
    score,
    homeSimilarity: Number(homeSimilarity.toFixed(4)),
    awaySimilarity: Number(awaySimilarity.toFixed(4)),
    kickoffScore,
    competitionSimilarity: Number(competitionSimilarity.toFixed(4)),
  };
}

export function resolveEvent(query: CsvMatchQuery, events: SofascoreEvent[]): MatchResolution {
  if (events.length === 0) {
    return {
      status: "MATCH_NOT_FOUND",
      eventId: null,
      confidence: 0,
      reason: "Nenhum evento retornado pela fonte para a data consultada.",
      candidates: [],
    };
  }

  const scored = events
    .map((e) => scoreCandidate(query, e))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const best = scored[0]!;
  const second = scored[1];
  const gap = second ? Number((best.score - second.score).toFixed(4)) : 1;

  if (best.score < RESOLUTION_THRESHOLDS.consider) {
    return {
      status: "MATCH_NOT_FOUND",
      eventId: null,
      confidence: best.score,
      reason: `Melhor candidato ficou em ${best.score.toFixed(2)}, abaixo do mínimo ${RESOLUTION_THRESHOLDS.consider}.`,
      candidates: scored,
    };
  }

  if (best.score < RESOLUTION_THRESHOLDS.accept || gap < RESOLUTION_THRESHOLDS.minGap) {
    return {
      status: "MATCH_AMBIGUOUS",
      eventId: null,
      confidence: best.score,
      reason:
        gap < RESOLUTION_THRESHOLDS.minGap
          ? `Dois candidatos com pontuação próxima (diferença ${gap.toFixed(2)}); nenhuma escolha automática.`
          : `Confiança ${best.score.toFixed(2)} abaixo do limite de aceitação ${RESOLUTION_THRESHOLDS.accept}.`,
      candidates: scored,
    };
  }

  return {
    status: "MATCH_RESOLVED",
    eventId: best.eventId,
    confidence: best.score,
    reason: `Correspondência aceita com confiança ${best.score.toFixed(2)} e folga ${gap.toFixed(2)} sobre o segundo candidato.`,
    candidates: scored,
  };
}

/* ------------------------------------------------------------------ */
/* Definition gates                                                    */
/* ------------------------------------------------------------------ */

export type CanonicalMetric =
  | "goals_scored"
  | "goals_conceded"
  | "corners_taken"
  | "shots_total"
  | "shots_on_target"
  | "cards_yellow_raw"
  | "cards_red_raw";

export interface MetricDefinition {
  canonical: CanonicalMetric;
  /** rótulos SofaScore aceitos para este campo */
  sourceLabels: string[];
  /** true somente quando a definição da fonte comprovadamente casa com o contrato bet365 */
  contractCompatible: boolean;
  note: string;
}

export const SOFASCORE_DEFINITIONS: MetricDefinition[] = [
  {
    canonical: "corners_taken",
    sourceLabels: ["Corner kicks", "Corners"],
    contractCompatible: true,
    note: "Escanteios cobrados na partida; definição equivalente a corners_taken.",
  },
  {
    canonical: "shots_total",
    sourceLabels: ["Total shots"],
    contractCompatible: false,
    note: "Contagem total de finalizações sem detalhamento de bloqueadas/fora; incompatível com a definição Opta/bet365 implementada.",
  },
  {
    canonical: "shots_on_target",
    sourceLabels: ["Shots on target"],
    contractCompatible: false,
    note: "Não é possível demonstrar tratamento idêntico de bloqueios e traves; mantido como observação, sem liberar mercado.",
  },
  {
    canonical: "cards_yellow_raw",
    sourceLabels: ["Yellow cards"],
    contractCompatible: false,
    note: "Não distingue segundo amarelo nem exclui comissão técnica/reservas; incompatível com o contrato de cartões.",
  },
  {
    canonical: "cards_red_raw",
    sourceLabels: ["Red cards"],
    contractCompatible: false,
    note: "Mesma limitação dos amarelos; não autoriza pontuação de cartões.",
  },
];

export interface NormalizedStat {
  canonical: CanonicalMetric;
  scope: "HOME" | "AWAY";
  value: number;
  sourceLabel: string;
  contractCompatible: boolean;
  note: string;
}

/** Converte o payload de estatísticas (período ALL) em métricas canônicas com gate de definição. */
export function mapStatistics(payload: unknown): NormalizedStat[] {
  const root = asRecord(payload);
  const groupsRoot = Array.isArray(root?.["statistics"]) ? (root!["statistics"] as unknown[]) : [];
  const out: NormalizedStat[] = [];

  for (const periodRaw of groupsRoot) {
    const period = asRecord(periodRaw);
    if (!period || str(period["period"]) !== "ALL") continue;
    const groups = Array.isArray(period["groups"]) ? (period["groups"] as unknown[]) : [];
    for (const groupRaw of groups) {
      const group = asRecord(groupRaw);
      const items = Array.isArray(group?.["statisticsItems"])
        ? (group!["statisticsItems"] as unknown[])
        : [];
      for (const itemRaw of items) {
        const item = asRecord(itemRaw);
        if (!item) continue;
        const label = str(item["name"]);
        if (!label) continue;
        const def = SOFASCORE_DEFINITIONS.find((d) => d.sourceLabels.includes(label));
        if (!def) continue;
        const home = num(item["homeValue"]);
        const away = num(item["awayValue"]);
        if (home !== null) {
          out.push({
            canonical: def.canonical,
            scope: "HOME",
            value: home,
            sourceLabel: label,
            contractCompatible: def.contractCompatible,
            note: def.note,
          });
        }
        if (away !== null) {
          out.push({
            canonical: def.canonical,
            scope: "AWAY",
            value: away,
            sourceLabel: label,
            contractCompatible: def.contractCompatible,
            note: def.note,
          });
        }
      }
    }
  }
  return out;
}

/** Gols a partir do placar final de um evento encerrado. Nunca usa evento posterior ao prediction_at. */
export function goalsFromEvent(
  event: SofascoreEvent,
  predictionAtIso: string,
): NormalizedStat[] {
  if (event.statusType !== "finished") return [];
  if (event.homeScore === null || event.awayScore === null) return [];
  if (!event.startTimestamp) return [];
  if (event.startTimestamp * 1000 >= Date.parse(predictionAtIso)) return [];

  return [
    {
      canonical: "goals_scored",
      scope: "HOME",
      value: event.homeScore,
      sourceLabel: "homeScore.current",
      contractCompatible: true,
      note: "Placar final oficial do evento encerrado.",
    },
    {
      canonical: "goals_scored",
      scope: "AWAY",
      value: event.awayScore,
      sourceLabel: "awayScore.current",
      contractCompatible: true,
      note: "Placar final oficial do evento encerrado.",
    },
  ];
}
