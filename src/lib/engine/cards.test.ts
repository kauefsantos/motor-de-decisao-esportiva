import { describe, expect, it } from "vitest";
import { CARDS_MODEL_VERSION, fitCardsBaseline, predictCards, type CardMatchRow } from "./cards";

const rows: CardMatchRow[] = [
  { date: "2026-08-01", league: "L1", homeTeam: "A", awayTeam: "B", homeCards: 3, awayCards: 2 },
  { date: "2026-08-02", league: "L1", homeTeam: "C", awayTeam: "A", homeCards: 2, awayCards: 4 },
  { date: "2026-08-03", league: "L1", homeTeam: "B", awayTeam: "C", homeCards: 1, awayCards: 3 },
  { date: "2026-08-04", league: "L1", homeTeam: "A", awayTeam: "C", homeCards: 4, awayCards: 2 },
];

describe("yellow-card count model", () => {
  it("fits and predicts positive count lambdas", () => {
    const params = fitCardsBaseline(rows);
    const forecast = predictCards(params, { league: "L1", homeTeam: "A", awayTeam: "B" });
    expect(params.modelVersion).toBe(CARDS_MODEL_VERSION);
    expect(forecast.lambdaTotal).toBeGreaterThan(0);
    expect(forecast.sampleSize).toBeGreaterThan(0);
  });
});
