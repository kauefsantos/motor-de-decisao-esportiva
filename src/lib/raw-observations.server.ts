// Leituras do histórico bruto usadas pelos modelos experimentais.
// O histórico de inferência é reduzido e deduplicado no Lovable Cloud antes de
// chegar ao runtime; a paginação direta permanece apenas para a própria run.

type DbError = { message: string } | null;
export type RawObservationValueRow = { match_id?: string | null; raw_value: unknown };
export type RawCacheRow = {
  cache_key: string;
  metric: string;
  raw_value: unknown;
  observed_at: string;
  fetched_at: string;
};
type QueryResult = { data: RawObservationValueRow[] | null; error: DbError };

interface RawQuery extends PromiseLike<QueryResult> {
  select(columns: string): RawQuery;
  eq(column: string, value: unknown): RawQuery;
  order(column: string, options?: { ascending?: boolean }): RawQuery;
  range(from: number, to: number): RawQuery;
}

interface RawDb {
  from(table: string): RawQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
}

const PAGE_SIZE = 1000;
const MAX_MODEL_HISTORY_DAYS = 730;

export async function loadFiveDollarCacheRows(
  supabase: unknown,
  source: string,
  definitionVersion: string,
  cacheKeys: string[],
): Promise<RawCacheRow[]> {
  if (!cacheKeys.length) return [];
  const db = supabase as RawDb;
  const { data, error } = await db.rpc("get_raw_observation_cache_rows", {
    p_source: source,
    p_definition_version: definitionVersion,
    p_cache_keys: [...new Set(cacheKeys)],
  });
  if (error) throw new Error(`Falha ao consultar cache bruto indexado: ${error.message}`);
  return (Array.isArray(data) ? data : []) as RawCacheRow[];
}

export async function loadFiveDollarRawValues(
  supabase: unknown,
  predictionAt: string,
  lookbackDays = 365,
): Promise<RawObservationValueRow[]> {
  const cutoffMs = Date.parse(predictionAt);
  if (!Number.isFinite(cutoffMs)) throw new Error("prediction_at inválido ao carregar histórico bruto.");
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > MAX_MODEL_HISTORY_DAYS) {
    throw new Error(`Janela histórica inválida: ${lookbackDays}.`);
  }

  const db = supabase as RawDb;
  const { data, error } = await db.rpc("get_five_dollar_model_history_rows", {
    p_prediction_at: predictionAt,
    p_lookback_days: lookbackDays,
  });
  if (error) throw new Error(`Falha ao carregar histórico de modelagem deduplicado: ${error.message}`);
  return (Array.isArray(data) ? data : []) as RawObservationValueRow[];
}

export async function loadRunFiveDollarRawValues(
  supabase: unknown,
  runId: string,
): Promise<RawObservationValueRow[]> {
  const db = supabase as RawDb;
  const rows: RawObservationValueRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await db
      .from("raw_observations")
      .select("match_id,raw_value")
      .eq("source", "five_dollar_football")
      .eq("run_id", runId)
      .order("observed_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) throw new Error(`Falha ao paginar observações da run: ${res.error.message}`);
    const page = res.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}
