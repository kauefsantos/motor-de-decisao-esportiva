import type { AdminDb } from "./admin-db";
import { BackendError } from "./backend-contract";

function forbidden(message = "Você não tem autorização para acessar este recurso."): never {
  throw new BackendError("FORBIDDEN", message, 403);
}

export async function assertRunOwner(db: AdminDb, userId: string | undefined, runId: string) {
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);

  const { data, error } = await db
    .from("analysis_runs")
    .select("id")
    .eq("id", runId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw new BackendError("INTERNAL_ERROR", "Falha ao validar autorização da análise.", 500);
  if (!data) forbidden();
  return data;
}

export async function assertTrackingOwner(db: AdminDb, userId: string | undefined, trackingId: string) {
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);

  const { data, error } = await db
    .from("experimental_bet_tracking")
    .select("id,run_id")
    .eq("id", trackingId)
    .maybeSingle();

  if (error) throw new BackendError("INTERNAL_ERROR", "Falha ao validar autorização da seleção.", 500);
  if (!data) forbidden();
  await assertRunOwner(db, userId, data.run_id);
  return data;
}

export async function ownedRunIds(db: AdminDb, userId: string | undefined) {
  if (!userId) throw new BackendError("UNAUTHENTICATED", "Faça login para continuar.", 401);
  const { data, error } = await db
    .from("analysis_runs")
    .select("id")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new BackendError("INTERNAL_ERROR", "Falha ao carregar análises autorizadas.", 500);
  return (data ?? []).map((row) => row.id);
}
