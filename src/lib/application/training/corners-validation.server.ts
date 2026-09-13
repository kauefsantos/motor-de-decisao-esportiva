import { isLikelyDomesticLeagueKey } from "../../competition-kind";
import { callAdminRuntimeRpc } from "../../repositories/runtime-rpc.server";
import { evaluateCornersWalkForward, type Stage4CornerRow } from "./corners-walk-forward";

type CanonicalCornerValidationRow = {
  fixture_id: number | string;
  fixture_date: string;
  league: string;
  home_team_id: number | string;
  away_team_id: number | string;
  home_corners: number | string;
  away_corners: number | string;
};

const VALIDATION_PAGE_SIZE = 750;
const MAX_VALIDATION_PAGES = 20;

function numberValue(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Linha canônica de validação contém valor numérico inválido.");
  return parsed;
}

async function loadAllCanonicalCornersRows(): Promise<CanonicalCornerValidationRow[]> {
  const rows: CanonicalCornerValidationRow[] = [];
  const fixtureIds = new Set<string>();
  let afterDate: string | null = null;
  let afterFixtureId: number | string | null = null;

  for (let page = 0; page < MAX_VALIDATION_PAGES; page += 1) {
    const { data, error } = await callAdminRuntimeRpc<CanonicalCornerValidationRow[]>(
      "get_stage4_corners_validation_rows_page",
      {
        p_after_date: afterDate,
        p_after_fixture_id: afterFixtureId,
        p_limit: VALIDATION_PAGE_SIZE,
      },
    );
    if (error) throw new Error(`Falha ao carregar histórico canônico da Etapa 4: ${error.message}`);
    const batch = data ?? [];
    if (batch.length === 0) break;

    for (const row of batch) {
      const fixtureId = String(row.fixture_id);
      if (fixtureIds.has(fixtureId)) {
        throw new Error(`Fixture duplicado durante paginação da Etapa 4: ${fixtureId}`);
      }
      fixtureIds.add(fixtureId);
      rows.push(row);
    }

    const last = batch[batch.length - 1];
    if (!last) break;
    afterDate = String(last.fixture_date).slice(0, 10);
    afterFixtureId = last.fixture_id;
    if (batch.length < VALIDATION_PAGE_SIZE) break;

    if (page === MAX_VALIDATION_PAGES - 1) {
      throw new Error("Histórico canônico excedeu o limite defensivo de paginação da Etapa 4.");
    }
  }

  return rows;
}

export async function runStage4CornersValidation() {
  const canonicalRows = await loadAllCanonicalCornersRows();
  const rows: Stage4CornerRow[] = canonicalRows
    .filter((row) => row.league && isLikelyDomesticLeagueKey(row.league))
    .map((row) => ({
      fixtureId: String(row.fixture_id),
      date: String(row.fixture_date).slice(0, 10),
      league: row.league,
      homeTeam: String(row.home_team_id),
      awayTeam: String(row.away_team_id),
      homeCorners: numberValue(row.home_corners),
      awayCorners: numberValue(row.away_corners),
    }));

  if (rows.length === 0) throw new Error("Nenhuma partida doméstica canônica disponível para validação de escanteios.");
  return evaluateCornersWalkForward(rows);
}
