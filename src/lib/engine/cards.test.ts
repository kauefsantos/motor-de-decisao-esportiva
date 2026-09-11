import { describe, expect, it } from "vitest";
import {
  CARDS_MODEL_VERSION,
  CARDS_SETTLEMENT_PROXY_VERSION,
  bet365CardPointsProxy,
  fitCardsBaseline,
  predictCards,
  type CardMatchRow,
} from "./cards";

const rows: CardMatchRow[] = [
  { date: "2026-08-01", league: "L1", homeTeam: "A", awayTeam: "B", homeCards: 3, awayCards: 2 },
  { date: "2026-08-02", league: "L1", homeTeam: "C", awayTeam: "A", homeCards: 2, awayCards: 4 },
  { date: "2026-08-03", league: "L1", homeTeam: "B", awayTeam: "C", homeCards: 1, awayCards: 3 },
  { date: "2026-08-04", league: "L1", homeTeam: "A", awayTeam: "C", homeCards: 4, awayCards: 2 },
];

describe("Bet365 card-points proxy model", () => {
  it("weights yellow as one and red as two", () => {
    expect(bet365CardPointsProxy(3, 1)).toBe(5);
    expect(bet365CardPointsProxy(2, 0)).toBe(2);
    expect(bet365CardPointsProxy(0, 2)).toBe(4);
  });

  it("fits and predicts positive count lambdas with a versioned hybrid proxy", () => {
    const params = fitCardsBaseline(rows);
    const forecast = predictCards(params, { league: "L1", homeTeam: "A", awayTeam: "B" });
    expect(params.modelVersion).toBe(CARDS_MODEL_VERSION);
    expect(CARDS_MODEL_VERSION).toBe("cards-bet365-points-proxy-hybrid-v3");
    expect(CARDS_SETTLEMENT_PROXY_VERSION).toBe("bet365-yellow1-red2-aggregate-v1");
    expect(forecast.lambdaTotal).toBeGreaterThan(0);
    expect(forecast.sampleSize).toBeGreaterThan(0);
    expect(forecast.dispersionAlphaTotal).toBeGreaterThanOrEqual(0);
    expect(forecast.dispersionAlphaHome).toBeGreaterThanOrEqual(0);
    expect(forecast.dispersionAlphaAway).toBeGreaterThanOrEqual(0);
  });
});
