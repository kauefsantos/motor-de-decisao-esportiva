import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { executeStep } from "@/lib/pipeline.server";

const predictionAt = new Date().toISOString();
const { data: run, error } = await db.from("analysis_runs").insert({
  target_date: "2026-09-07", status: "CREATED", matches_total: 1,
  notes: { prediction_at: predictionAt },
}).select("id").single();
if (error) throw error;
const runId = run!.id;
await db.from("matches").insert({ run_id: runId, raw_partida: "Vitoria x Gremio", raw_horario: "20:00", raw_campeonato: "Brasileirão Série A" });
console.log("runId", runId, "predictionAt", predictionAt);
for (const step of ["RESOLVE","COLLECT","CLEAN","FEATURES","PROBABILITY","GATES","MARKETS"] as const) {
  const r = await executeStep(runId, step);
  console.log(step, JSON.stringify(r));
}
const { data: fetches } = await db.from("source_fetches").select("source,status,http_status,error_message").eq("run_id", runId);
console.log("FETCHES", JSON.stringify(fetches));
const { data: ids } = await db.from("match_external_ids").select("source,external_id").limit(20);
console.log("IDS", JSON.stringify(ids));
const { count: rawC } = await db.from("raw_observations").select("id",{count:"exact",head:true}).eq("run_id", runId);
const { data: norm } = await db.from("normalized_match_stats").select("scope,metric,normalized_value,sample_size").eq("run_id", runId);
console.log("RAW", rawC, "NORM", JSON.stringify(norm));
const { data: mc } = await db.from("market_candidates").select("market,market_family,block_reason,data_status,model_status").eq("run_id", runId).eq("market_family","CORNERS").limit(6);
console.log("CORNERS", JSON.stringify(mc));
