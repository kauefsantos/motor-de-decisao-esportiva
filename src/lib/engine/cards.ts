import {
  fitBaseline,
  predict,
  type CornerMatchRow,
  type CornersModelParams,
  type CornersPrediction,
} from "./corners";

export const CARDS_MODEL_VERSION = "cards-bet365-points-proxy-v2";
export const CARDS_SETTLEMENT_PROXY_VERSION = "bet365-yellow1-red2-aggregate-v1";

/**
 * Bet365's match-card points count a yellow as 1 and a red as 2.
 *
 * The 5Dollar aggregate does not identify second-yellow dismissals or whether a
 * card was shown to a non-player, so this is deliberately called a proxy rather
 * than exact bookmaker settlement. The experimental model may use it, but it
 * must not be represented as production-validated settlement equivalence.
 */
export function bet365CardPointsProxy(yellow: number, red: number): number {
  return Math.max(0, yellow) + 2 * Math.max(0, red);
}

export const CARD_SETTLEMENT_PROXY_CAVEAT =
  "5Dollar fornece amarelos/vermelhos agregados; não há identidade suficiente para remover com certeza segundo amarelo e cartões de não-jogadores conforme o settlement da Bet365.";

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
