// Leitura paginada do histórico bruto usado pelos modelos experimentais.
// Evita truncar silenciosamente raw_observations quando a base cresce com o plano Pro.

type DbError = { message: string } | null;
type RawRow = { raw_value: unknown };
type QueryResult = { data: RawRow[] | null; error: DbError };

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

export async function loadFiveDollarRawValues(
  supabase: unknown,
  predictionAt: string,
  lookbackDays = 365,
): Promise<RawRow[]> {
  const db = supabase as RawDb;
  const cutoffMs = Date.parse(predictionAt);
  if (!Number.isFinite(cutoffMs)) throw new Error("prediction_at inválido ao carregar histórico bruto.");
  const startIso = new Date(cutoffMs - lookbackDays * 86_400_000).toISOString();
  const pageSize = 1000;
  const rows: RawRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const res = await db
      .from("raw_observations")
      .select("raw_value")
      .eq("source", "five_dollar_football")
      .gte("observed_at", startIso)
      .lt("observed_at", predictionAt)
      .order("observed_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (res.error) throw new Error(`Falha ao paginar raw_observations: ${res.error.message}`);
    const page = res.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}
