export const MANUAL_QUOTE_BATCH_FIELDS = 12;

export type FunnelCandidate = {
  predictionId: string;
  matchId: string;
  family: string;
  market: string;
  participant: string | null;
  side: string;
  probabilityExperimental: number;
  sampleSize: number;
  trainingMatches: number;
};

export type QuoteGroup = {
  key: string;
  matchId: string;
  family: string;
  market: string;
  participant: string | null;
  predictionIds: string[];
  fieldCount: number;
  priorityScore: number;
};

function groupKey(candidate: FunnelCandidate) {
  return `${candidate.matchId}|${candidate.market}|${candidate.participant ?? "MATCH"}`;
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Operational ordering only — never a value gate.
 *
 * The score combines how informative the model direction is with how much data
 * supported it. It only decides which missing bookmaker prices are requested
 * first; every deferred group remains available through the next batch.
 */
export function quotePriorityScore(rows: FunnelCandidate[]): number {
  if (rows.length === 0) return 0;
  const maxSignal = Math.max(
    ...rows.map((row) => Math.abs(finite(row.probabilityExperimental) - 0.5)),
  );
  const sample = Math.max(...rows.map((row) => Math.max(0, finite(row.sampleSize))));
  const training = Math.max(...rows.map((row) => Math.max(0, finite(row.trainingMatches))));
  const sampleReliability = Math.min(1, sample / 10);
  const trainingReliability = Math.min(1, training / 30);
  const reliability = 0.5 * sampleReliability + 0.5 * trainingReliability;
  return maxSignal * (0.5 + 0.5 * reliability);
}

export function buildManualQuoteGroups(
  candidates: FunnelCandidate[],
  automaticallyPricedPredictionIds: Iterable<string>,
): QuoteGroup[] {
  const priced = new Set(automaticallyPricedPredictionIds);
  const grouped = new Map<string, FunnelCandidate[]>();

  for (const candidate of candidates) {
    if (priced.has(candidate.predictionId)) continue;
    const key = groupKey(candidate);
    const rows = grouped.get(key) ?? [];
    rows.push(candidate);
    grouped.set(key, rows);
  }

  return [...grouped.entries()]
    .map(([key, rows]) => ({
      key,
      matchId: rows[0]!.matchId,
      family: rows[0]!.family,
      market: rows[0]!.market,
      participant: rows[0]!.participant,
      predictionIds: rows.map((row) => row.predictionId),
      fieldCount: rows.length,
      priorityScore: quotePriorityScore(rows),
    }))
    .sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        a.matchId.localeCompare(b.matchId) ||
        a.key.localeCompare(b.key),
    );
}

/**
 * Builds whole-market batches (never splits an O/U or outcome group). The first
 * pass favours one group per match before returning to the same match, so a
 * large CSV does not make the first screen a wall of prices from one fixture.
 */
export function buildManualQuoteBatches(
  candidates: FunnelCandidate[],
  automaticallyPricedPredictionIds: Iterable<string>,
  fieldBudget = MANUAL_QUOTE_BATCH_FIELDS,
): string[][] {
  const budget = Math.max(1, Math.floor(fieldBudget));
  const groups = buildManualQuoteGroups(candidates, automaticallyPricedPredictionIds);
  const remaining = [...groups];
  const ordered: QuoteGroup[] = [];
  const seenMatches = new Set<string>();

  for (let i = 0; i < remaining.length; ) {
    const group = remaining[i]!;
    if (!seenMatches.has(group.matchId)) {
      seenMatches.add(group.matchId);
      ordered.push(group);
      remaining.splice(i, 1);
    } else {
      i += 1;
    }
  }
  ordered.push(...remaining);

  const batches: string[][] = [];
  let current: string[] = [];
  let currentFields = 0;
  for (const group of ordered) {
    if (current.length > 0 && currentFields + group.fieldCount > budget) {
      batches.push(current);
      current = [];
      currentFields = 0;
    }
    current.push(...group.predictionIds);
    currentFields += group.fieldCount;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
