import { adminDb } from "../../admin-db";
import { callRuntimeRpc } from "../../repositories/runtime-rpc.server";
import {
  STAGE6_GOALS_BASE_ARTIFACT,
  STAGE6_GOALS_ELO_ARTIFACT,
  runStage6GoalsWalkForward,
  type Stage6GoalRow,
  type Stage6GoalsArtifact,
  type Stage6GoalsFamily,
} from "./goals-walk-forward";

const PAGE_SIZE = 750;
const MAX_PAGES = 20;

type RawGoalValidationRow = {
  fixture_id: number | string;
  fixture_date: string;
  league: string;
  home_team_id: number | string;
  away_team_id: number | string;
  home_goals: number | string;
  away_goals: number | string;
  elo_home_rating_before: number | string | null;
  elo_away_rating_before: number | string | null;
  elo_model_version: string | null;
};

function finite(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStage6GoalRow(row: RawGoalValidationRow): Stage6GoalRow {
  const homeGoals = finite(row.home_goals);
  const awayGoals = finite(row.away_goals);
  if (homeGoals === null || awayGoals === null) throw new Error(`Invalid goal result for fixture ${row.fixture_id}`);
  return {
    fixtureId: String(row.fixture_id),
    date: row.fixture_date.slice(0, 10),
    league: row.league,
    homeTeamId: String(row.home_team_id),
    awayTeamId: String(row.away_team_id),
    homeGoals,
    awayGoals,
    eloHomeRatingBefore: finite(row.elo_home_rating_before),
    eloAwayRatingBefore: finite(row.elo_away_rating_before),
    eloModelVersion: row.elo_model_version,
  };
}

export async function loadStage6GoalsValidationRows(): Promise<Stage6GoalRow[]> {
  const db = await adminDb();
  const rows: Stage6GoalRow[] = [];
  const seen = new Set<string>();
  let afterDate: string | null = null;
  let afterFixtureId: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await callRuntimeRpc<RawGoalValidationRow[]>(db, "get_stage6_goals_validation_rows_page", {
      p_after_date: afterDate,
      p_after_fixture_id: afterFixtureId,
      p_limit: PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    for (const raw of batch) {
      const row = asStage6GoalRow(raw);
      if (seen.has(row.fixtureId)) throw new Error(`Duplicate canonical fixture in Stage 6 dataset: ${row.fixtureId}`);
      seen.add(row.fixtureId);
      rows.push(row);
    }
    if (batch.length < PAGE_SIZE) return rows;
    const last = batch[batch.length - 1];
    if (!last) return rows;
    afterDate = last.fixture_date.slice(0, 10);
    afterFixtureId = Number(last.fixture_id);
    if (!Number.isSafeInteger(afterFixtureId)) throw new Error("Invalid Stage 6 fixture pagination cursor.");
  }

  throw new Error(`Stage 6 validation exceeded defensive pagination limit (${MAX_PAGES} pages).`);
}

export function isStage6GoalsArtifact(value: string): value is Stage6GoalsArtifact {
  return value === STAGE6_GOALS_BASE_ARTIFACT || value === STAGE6_GOALS_ELO_ARTIFACT;
}

export function isStage6GoalsFamily(value: string): value is Stage6GoalsFamily {
  return value === "1X2" || value === "BTTS";
}

export async function runStage6GoalsValidation(family: string, modelVersion: string) {
  if (!isStage6GoalsFamily(family)) throw new Error(`Unsupported Stage 6 GOALS family: ${family}`);
  if (!isStage6GoalsArtifact(modelVersion)) throw new Error(`Unsupported Stage 6 GOALS artifact: ${modelVersion}`);
  const rows = await loadStage6GoalsValidationRows();
  return runStage6GoalsWalkForward(rows, family, modelVersion);
}
