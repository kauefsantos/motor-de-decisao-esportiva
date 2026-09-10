import { describe, expect, it } from "vitest";

import {
  bet365ListOfferedLine,
  matchBet365List1x2,
  matchBet365Price,
} from "./bet365-odds.server";

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
          card_line: {
            opening: { line: 4.5, over: 1.95, under: 1.75 },
            closing: { line: 4.5, over: 1.9, under: 1.8 },
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

const listOdds = {
  "1x2": {
    opening: { home: 1.182, draw: 7.5, away: 15 },
    closing: { home: 1.083, draw: 11, away: 23 },
    inplay: null,
  },
  goal_line: { opening: 3.75, closing: 4.25, inplay: null },
  corner_line: { opening: 9.5, closing: 9.5, inplay: null },
  card_line: { opening: 4.5, closing: 4.5, inplay: null },
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

  it("uses Bet365 match card-line price when the 4.5 anchor matches", () => {
    const over = matchBet365Price(
      { predictionId: "p-card-over", market: "cards_match_total", side: "OVER", lineCanonical: 4.5 },
      payload,
    );
    const under = matchBet365Price(
      { predictionId: "p-card-under", market: "cards_match_total", side: "UNDER", lineCanonical: 4.5 },
      payload,
    );
    expect(over.status).toBe("MATCHED");
    expect(over.odd).toBe(1.9);
    expect(over.apiMarket).toBe("card_line");
    expect(under.status).toBe("MATCHED");
    expect(under.odd).toBe(1.8);
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

describe("Pro day odds preflight", () => {
  it("reads 1X2 prices directly from the expanded day feed", () => {
    const quote = matchBet365List1x2(
      { predictionId: "p6", market: "1x2", side: "AWAY", lineCanonical: null },
      listOdds,
    );
    expect(quote.status).toBe("MATCHED");
    expect(quote.odd).toBe(23);
  });

  it("reads current total lines without pretending the list feed contains prices", () => {
    expect(bet365ListOfferedLine(listOdds, "goals_match_total")).toBe(4.25);
    expect(bet365ListOfferedLine(listOdds, "corners_match_total")).toBe(9.5);
    expect(bet365ListOfferedLine(listOdds, "cards_match_total")).toBe(4.5);
  });
});
