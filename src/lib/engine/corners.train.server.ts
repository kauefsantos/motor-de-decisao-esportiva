// Treinamento/validação temporal do modelo de escanteios a partir dos dados
// históricos REAIS já persistidos em raw_observations. Server-only.
// Não coleta nada novo, não altera adapters, não fabrica dados.

import {
  CORNERS_MODEL_VERSION,
  validateTemporally,
  type CornerMatchRow,
  type TrainingOutcome,
} from "./corners";

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Reconstrói partidas históricas (mandante x visitante) a partir das observações brutas. */
export function buildDataset(
  observations: { raw_value: Record<string, unknown> | null }[],
): CornerMatchRow[] {
  const byMatch = new Map<
    string,
    { date: string; league: string; home?: number; away?: number; homeTeam?: string; awayTeam?: string }
  >();

  for (const obs of observations) {
    const rv = obs.raw_value;
    if (!rv) continue;
    const mid = String(rv["externalMatchId"] ?? "");
    const scope = String(rv["statScope"] ?? "");
    const value = Number(rv["value"]);
    const date = String(rv["fixtureDate"] ?? "");
    if (!mid || !date || !Number.isFinite(value)) continue;
    if (scope !== "HOME" && scope !== "AWAY") continue;

    // externalMatchId = "<liga>:<data>:<mandante>-<visitante>"
    const [league = "", , pair = ""] = mid.split(":");
    const dash = pair.lastIndexOf("-");
    const homeTeam = dash > 0 ? pair.slice(0, dash) : pair;
    const awayTeam = dash > 0 ? pair.slice(dash + 1) : "";

    const cur = byMatch.get(mid) ?? { date, league, homeTeam, awayTeam };
    if (scope === "HOME") cur.home = value;
    else cur.away = value;
    byMatch.set(mid, cur);
  }

  const rows: CornerMatchRow[] = [];
  for (const m of byMatch.values()) {
    if (m.home === undefined || m.away === undefined) continue;
    if (!m.homeTeam || !m.awayTeam) continue;
    rows.push({
      date: m.date,
      league: m.league,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeCorners: m.home,
      awayCorners: m.away,
    });
  }
  return rows;
}

export interface CornersTrainingReport {
  outcome: TrainingOutcome;
  usableMatches: number;
  registeredValidationStatus: string;
  calibrationVersion: string | null;
}

export async function trainAndRegisterCornersModel(): Promise<CornersTrainingReport> {
  const db = await getDb();
  const { data } = await db
    .from("raw_observations")
    .select("raw_value")
    .ilike("metric", "%corners_taken")
    .limit(5000);

  const rows = buildDataset((data ?? []) as { raw_value: Record<string, unknown> | null }[]);
  const outcome = validateTemporally(rows);

  // calibração só existe se realmente executada e avaliada out-of-sample.
  const calibrationVersion: string | null = null;
  const validationStatus =
    outcome.status === "EVALUATED" ? outcome.validationStatus : "NOT_VALIDATED";

  await db.from("model_versions").insert({
    market_family: "CORNERS",
    model_version: CORNERS_MODEL_VERSION,
    calibration_version: calibrationVersion,
    validation_status: validationStatus,
    out_of_sample_metrics: JSON.parse(JSON.stringify(outcome)),
  });

  return {
    outcome,
    usableMatches: rows.length,
    registeredValidationStatus: validationStatus,
    calibrationVersion,
  };
}
