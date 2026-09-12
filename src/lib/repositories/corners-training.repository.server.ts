import type { Database } from "@/integrations/supabase/database.types";

export type RawCornerObservation = Pick<
  Database["public"]["Tables"]["raw_observations"]["Row"],
  "raw_value"
>;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadCornerTrainingObservations(): Promise<RawCornerObservation[]> {
  const supabase = await db();
  const pageSize = 1000;
  const rows: RawCornerObservation[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("raw_observations")
      .select("raw_value")
      .ilike("metric", "%corners_taken")
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Falha ao carregar dados de treino de escanteios: ${error.message}`);
    const page = (data ?? []) as RawCornerObservation[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

export async function registerCornerModelValidation(input: {
  modelVersion: string;
  calibrationVersion: string | null;
  validationStatus: string;
  outcome: unknown;
}) {
  const supabase = await db();
  const { error } = await supabase.from("model_versions").insert({
    market_family: "CORNERS",
    model_version: input.modelVersion,
    calibration_version: input.calibrationVersion,
    validation_status: input.validationStatus,
    out_of_sample_metrics: JSON.parse(JSON.stringify(input.outcome)),
  });
  if (error) throw new Error(`Falha ao registrar validação de escanteios: ${error.message}`);
}
