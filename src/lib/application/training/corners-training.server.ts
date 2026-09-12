import {
  CORNERS_MODEL_VERSION,
  validateTemporally,
  type CornerMatchRow,
  type TrainingOutcome,
} from "../../engine/corners";
import {
  loadCornerTrainingObservations,
  registerCornerModelValidation,
  type RawCornerObservation,
} from "../../repositories/corners-training.repository.server";

/** Reconstrói partidas históricas (mandante x visitante) a partir das observações brutas. */
export function buildDataset(observations: RawCornerObservation[]): CornerMatchRow[] {
  const byMatch = new Map<
    string,
    { date: string; league: string; home?: number; away?: number; homeTeam?: string; awayTeam?: string }
  >();

  for (const obs of observations) {
    const rv = obs.raw_value;
    if (!rv || typeof rv !== "object" || Array.isArray(rv)) continue;
    const record = rv as Record<string, unknown>;
    const mid = String(record["externalMatchId"] ?? "");
    const scope = String(record["statScope"] ?? "");
    const value = Number(record["value"]);
    const date = String(record["fixtureDate"] ?? "");
    if (!mid || !date || !Number.isFinite(value)) continue;
    if (scope !== "HOME" && scope !== "AWAY") continue;

    // externalMatchId = "<liga>:<data>:<mandante>-<visitante>"
    const [league = "", , pair = ""] = mid.split(":");
    const dash = pair.lastIndexOf("-");
    const homeTeam = dash > 0 ? pair.slice(0, dash) : pair;
    const awayTeam = dash > 0 ? pair.slice(dash + 1) : "";

    const current = byMatch.get(mid) ?? { date, league, homeTeam, awayTeam };
    if (scope === "HOME") current.home = value;
    else current.away = value;
    byMatch.set(mid, current);
  }

  const rows: CornerMatchRow[] = [];
  for (const match of byMatch.values()) {
    if (match.home === undefined || match.away === undefined) continue;
    if (!match.homeTeam || !match.awayTeam) continue;
    rows.push({
      date: match.date,
      league: match.league,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeCorners: match.home,
      awayCorners: match.away,
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
  const observations = await loadCornerTrainingObservations();
  const rows = buildDataset(observations);
  const outcome = validateTemporally(rows);

  // calibração só existe se realmente executada e avaliada out-of-sample.
  const calibrationVersion: string | null = null;
  const validationStatus = outcome.status === "EVALUATED" ? outcome.validationStatus : "NOT_VALIDATED";

  await registerCornerModelValidation({
    modelVersion: CORNERS_MODEL_VERSION,
    calibrationVersion,
    validationStatus,
    outcome,
  });

  return {
    outcome,
    usableMatches: rows.length,
    registeredValidationStatus: validationStatus,
    calibrationVersion,
  };
}
