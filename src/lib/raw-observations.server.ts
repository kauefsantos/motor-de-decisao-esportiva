// Leitura paginada do histórico bruto usado pelos modelos experimentais.
// Evita truncar silenciosamente raw_observations quando a base cresce com o plano Pro.

type DbError = { message: string } | null;
export type RawObservationValueRow = { match_id?: string | null; raw_value: unknown };
type QueryResult = { data: RawObservationValueRow[] | null; error: DbError };

interface RawQuery extends PromiseLike<QueryResult> {
  select(columns: string): RawQuery;
  eq(column: string, value: unknown): RawQuery;
  gte(column: string, value: unknown): RawQuery;
  lt(column: string, value: unknown): RawQuery;
  order(column: string, options?: { ascending?: boolean }): RawQuery;
  range(from: number, to: number): RawQuery;
}

interface RawDb {
  from(table: string): RawQuery;
}

const PAGE_SIZE = 1000;

export async function loadFiveDollarRawValues(
  supabase: unknown,
  predictionAt: string,
  lookbackDays = 365,
): Promise<RawObservationValueRow[]> {
  const db = supabase as RawDb;
  const cutoffMs = Date.parse(predictionAt);
  if (!Number.isFinite(cutoffMs)) throw new Error("prediction_at inválido ao carregar histórico bruto.");
  const startIso = new Date(cutoffMs - lookbackDays * 86_400_000).toISOString();
  const rows: RawObservationValueRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const res = await db
      .from("raw_observations")
      .select("raw_value")
      .eq("source", "five_dollar_football")
      .gte("observed_at", startIso)
      .lt("observed_at", predictionAt)
      .order("observed_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (res.error) throw new Error(`Falha ao paginar raw_observations: ${res.error.message}`);
    const page = res.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
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
