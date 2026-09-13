import { isCrossLeagueLeagueKey } from "../../competition-kind";
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

function numberValue(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Linha canônica de validação contém valor numérico inválido.");
  return parsed;
}

export async function runStage4CornersValidation() {
  const { data, error } = await callAdminRuntimeRpc<CanonicalCornerValidationRow[]>(
    "get_stage4_corners_validation_rows",
  );
  if (error) throw new Error(`Falha ao carregar histórico canônico da Etapa 4: ${error.message}`);

  const rows: Stage4CornerRow[] = (data ?? [])
    .filter((row) => row.league && !isCrossLeagueLeagueKey(row.league))
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
