// Contratos e utilitários compartilhados exclusivamente pelos dois provedores
// suportados no projeto: 5DollarFootballAPI e API-Football (API-Sports).
// Sem rede, sem segredos e sem dependência entre provedores.

export interface ProviderEvent {
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
  sourceLabels: string[];
  contractCompatible: boolean;
  note: string;
}

export interface NormalizedStat {
  canonical: CanonicalMetric;
  scope: "HOME" | "AWAY";
  value: number;
  sourceLabel: string;
  contractCompatible: boolean;
  note: string;
}

const NOISE_TOKENS = new Set([
  "fc", "cf", "sc", "ac", "cd", "ud", "ss", "as", "afc", "club", "clube",
  "de", "do", "da", "the", "calcio", "futebol", "football", "esporte", "esportivo",
  "atletico", "sociedad", "deportivo",
]);

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
  "athletic club mg": "athletic club",
  "athletic mg": "athletic club",
  "charlton athletic": "charlton",
  "queens park rangers": "qpr",
  "queens park rangers fc": "qpr",
  "derby county": "derby",
  "derby county fc": "derby",
  "west bromwich albion": "west brom",
  "west bromwich albion fc": "west brom",
  "norwich city": "norwich",
  "norwich city fc": "norwich",
  "birmingham city": "birmingham",
  "birmingham city fc": "birmingham",
  "atletico mg": "atletico mineiro",
  "atletico mineiro mg": "atletico mineiro",
  "clube atletico mineiro": "atletico mineiro",
  "estudiantes": "estudiantes lp",
  "estudiantes de la plata": "estudiantes lp",
  "vfb stuttgart": "stuttgart",
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
  const tokens = aliased.split(" ").filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
  return (tokens.length > 0 ? tokens.join(" ") : aliased).trim();
}

function bigrams(s: string): string[] {
  const clean = s.replace(/\s/g, "");
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

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
      hits += 1;
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

export function kickoffProximity(expectedIso: string | null, startTimestamp: number | null): number {
  if (!expectedIso || !startTimestamp) return 0;
  const expected = Date.parse(expectedIso);
  if (Number.isNaN(expected)) return 0;
  const diffMin = Math.abs(expected - startTimestamp * 1000) / 60000;
  if (diffMin <= 15) return 1;
  if (diffMin >= 180) return 0;
  return Number((1 - (diffMin - 15) / 165).toFixed(4));
}

export const RESOLUTION_THRESHOLDS = { accept: 0.78, minGap: 0.08, consider: 0.55 } as const;

export function scoreCandidate(query: CsvMatchQuery, event: ProviderEvent): CandidateScore {
  const homeSimilarity = query.homeTeam ? nameSimilarity(query.homeTeam, event.homeName) : 0;
  const awaySimilarity = query.awayTeam ? nameSimilarity(query.awayTeam, event.awayName) : 0;
  const kickoffScore = kickoffProximity(query.kickoff, event.startTimestamp);
  const competitionSimilarity = query.competition ? nameSimilarity(query.competition, event.tournament) : 0;
  const score = Number((0.35 * homeSimilarity + 0.35 * awaySimilarity + 0.2 * kickoffScore + 0.1 * competitionSimilarity).toFixed(4));
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

export function resolveEvent(query: CsvMatchQuery, events: ProviderEvent[]): MatchResolution {
  if (events.length === 0) {
    return { status: "MATCH_NOT_FOUND", eventId: null, confidence: 0, reason: "Nenhum evento retornado pela fonte para a data consultada.", candidates: [] };
  }
  const scored = events.map((e) => scoreCandidate(query, e)).sort((a, b) => b.score - a.score).slice(0, 5);
  const best = scored[0]!;
  const second = scored[1];
  const gap = second ? Number((best.score - second.score).toFixed(4)) : 1;
  if (best.score < RESOLUTION_THRESHOLDS.consider) {
    return { status: "MATCH_NOT_FOUND", eventId: null, confidence: best.score, reason: `Melhor candidato ficou em ${best.score.toFixed(2)}, abaixo do mínimo ${RESOLUTION_THRESHOLDS.consider}.`, candidates: scored };
  }
  if (best.score < RESOLUTION_THRESHOLDS.accept || gap < RESOLUTION_THRESHOLDS.minGap) {
    return {
      status: "MATCH_AMBIGUOUS",
      eventId: null,
      confidence: best.score,
      reason: gap < RESOLUTION_THRESHOLDS.minGap
        ? `Dois candidatos com pontuação próxima (diferença ${gap.toFixed(2)}); nenhuma escolha automática.`
        : `Confiança ${best.score.toFixed(2)} abaixo do limite de aceitação ${RESOLUTION_THRESHOLDS.accept}.`,
      candidates: scored,
    };
  }
  return { status: "MATCH_RESOLVED", eventId: best.eventId, confidence: best.score, reason: `Correspondência aceita com confiança ${best.score.toFixed(2)} e folga ${gap.toFixed(2)} sobre o segundo candidato.`, candidates: scored };
}

export function goalsFromEvent(event: ProviderEvent, predictionAtIso: string): NormalizedStat[] {
  if (event.statusType !== "finished") return [];
  if (event.homeScore === null || event.awayScore === null) return [];
  if (!event.startTimestamp || event.startTimestamp * 1000 >= Date.parse(predictionAtIso)) return [];
  const base = {
    sourceLabel: "goals.full_time",
    contractCompatible: true,
    note: "Placar final da partida encerrada; horizonte 90min + acréscimos.",
  };
  return [
    { canonical: "goals_scored", scope: "HOME", value: event.homeScore, ...base },
    { canonical: "goals_conceded", scope: "HOME", value: event.awayScore, ...base },
    { canonical: "goals_scored", scope: "AWAY", value: event.awayScore, ...base },
    { canonical: "goals_conceded", scope: "AWAY", value: event.homeScore, ...base },
  ];
}
