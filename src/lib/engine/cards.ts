import {
  fitBaseline,
  predict,
  type CornerMatchRow,
  type CornersModelParams,
  type CornersPrediction,
} from "./corners";

export const CARDS_MODEL_VERSION = "cards-yellow-baseline-v1";

export interface CardMatchRow {
  date: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeCards: number;
  awayCards: number;
}

function asCountRows(rows: CardMatchRow[]): CornerMatchRow[] {
  return rows.map((row) => ({
    date: row.date,
    league: row.league,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    homeCorners: row.homeCards,
    awayCorners: row.awayCards,
  }));
}

export function fitCardsBaseline(rows: CardMatchRow[]): CornersModelParams {
  return { ...fitBaseline(asCountRows(rows)), modelVersion: CARDS_MODEL_VERSION };
}

export function predictCards(
  params: CornersModelParams,
  input: { league: string; homeTeam: string; awayTeam: string },
): CornersPrediction {
  return predict(params, input);
}
