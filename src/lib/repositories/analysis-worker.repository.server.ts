import { adminDb } from "../admin-db";

export async function markAnalysisRunError(runId: string) {
  const db = await adminDb();
  return db
    .from("analysis_runs")
    .update({ status: "ERROR", updated_at: new Date().toISOString() })
    .eq("id", runId);
}
