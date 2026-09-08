import { describe, expect, it } from "vitest";

import { matchBet365Price } from "./bet365-odds.server";

const payload = {
  success: 1,
  data: {
    fixture_id: 3205317040,
    bookmakers: [
      {
        name: "Bet 365",
        slug: "bet365",
        odds: {
          "1x2": {
            opening: { home: 1.182, draw: 7.5, away: 15 },
            closing: { home: 1.083, draw: 11, away: 23 },
            inplay: null,
          },
          goal_line: {
            opening: { line: 3.75, over: 2, under: 1.85 },
            closing: { line: 4.25, over: 1.85, under: 2 },
            inplay: null,
          },
          corner_line: {
            opening: { line: 9.5, over: 2, under: 1.8 },
            closing: { line: 9.5, over: 2, under: 1.8 },
            inplay: null,
          },
          btts: {
            opening: { yes: 1.95, no: 1.8 },
            closing: { yes: 1.8, no: 1.95 },
            inplay: null,
          },
        },
      },
    ],
  },
};

describe("matchBet365Price", () => {
  it("uses latest pre-match 1X2 price", () => {
    const quote = matchBet365Price(
      { predictionId: "p1", market: "1x2", side: "HOME", lineCanonical: null },
      payload,
    );
    expect(quote.status).toBe("MATCHED");
    expect(quote.odd).toBe(1.083);
    expect(quote.stage).toBe("closing");
  });

  it("uses BTTS price", () => {
    const quote = matchBet365Price(
      { predictionId: "p2", market: "btts", side: "YES", lineCanonical: null },
      payload,
    );
    expect(quote.status).toBe("MATCHED");
    expect(quote.odd).toBe(1.8);
  });

  it("only fills totals when bookmaker line exactly matches model line", () => {
    const matched = matchBet365Price(
      { predictionId: "p3", market: "corners_match_total", side: "OVER", lineCanonical: 9.5 },
      payload,
    );
    expect(matched.status).toBe("MATCHED");
    expect(matched.odd).toBe(2);

    const mismatch = matchBet365Price(
      { predictionId: "p4", market: "goals_match_total", side: "OVER", lineCanonical: 2.5 },
      payload,
    );
    expect(mismatch.status).toBe("LINE_MISMATCH");
    expect(mismatch.offeredLine).toBe(4.25);
    expect(mismatch.odd).toBeNull();
  });

  it("does not synthesize unsupported bookmaker contracts", () => {
    const quote = matchBet365Price(
      { predictionId: "p5", market: "double_chance", side: "1X", lineCanonical: null },
      payload,
    );
    expect(quote.status).toBe("UNSUPPORTED");
    expect(quote.odd).toBeNull();
  });
});
