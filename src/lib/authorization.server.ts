type DbError = { message?: string } | null;

type QueryResult<T> = {
  data: T | null;
  error: DbError;
};

type Db = {
  from: (table: string) => any;
};

function forbidden(message = "Você não tem autorização para acessar este recurso."): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 403;
  throw error;
}

export async function assertRunOwner(db: Db, userId: string | undefined, runId: string) {
  if (!userId) forbidden("Usuário não autenticado.");

  const { data, error } = (await db
    .from("analysis_runs")
    .select("id")
    .eq("id", runId)
    .eq("owner_id", userId)
    .maybeSingle()) as QueryResult<{ id: string }>;

  if (error) throw new Error(`Falha ao validar autorização da análise: ${error.message ?? "erro desconhecido"}`);
  if (!data) forbidden();
  return data;
}

export async function assertTrackingOwner(db: Db, userId: string | undefined, trackingId: string) {
  if (!userId) forbidden("Usuário não autenticado.");

  const { data, error } = (await db
    .from("experimental_bet_tracking")
    .select("id,run_id")
    .eq("id", trackingId)
    .maybeSingle()) as QueryResult<{ id: string; run_id: string }>;

  if (error) throw new Error(`Falha ao validar autorização da seleção: ${error.message ?? "erro desconhecido"}`);
  if (!data) forbidden();
  await assertRunOwner(db, userId, data.run_id);
  return data;
}

export async function ownedRunIds(db: Db, userId: string | undefined) {
  if (!userId) forbidden("Usuário não autenticado.");
  const { data, error } = await db
    .from("analysis_runs")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao carregar análises autorizadas: ${error.message ?? "erro desconhecido"}`);
  return (data ?? []).map((row: { id: string }) => row.id);
}
