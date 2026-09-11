import { describe, expect, it } from "vitest";

import { matchBet365OpeningPrice } from "./bet365-benchmark.server";

const payload = {
  data: {
    bookmakers: [{
      slug: "bet365",
      odds: {
        "1x2": { opening: { home: 2.4, draw: 3.2, away: 2.9 }, closing: { home: 2.2, draw: 3.3, away: 3.1 } },
        corner_line: { opening: { line: 9.5, over: 1.95, under: 1.85 }, closing: { line: 10.5, over: 1.9, under: 1.9 } },
      },
    }],
  },
};

describe("Bet365 opening benchmark", () => {
  it("reads 1X2 opening separately from closing", () => {
    const result = matchBet365OpeningPrice({ predictionId: "a", market: "1x2", side: "HOME", lineCanonical: null }, payload);
    expect(result.status).toBe("MATCHED");
    expect(result.odd).toBe(2.4);
    expect(result.stage).toBe("opening");
  });

  it("retains the opening total line even when closing moved", () => {
    const result = matchBet365OpeningPrice({ predictionId: "b", market: "corners_match_total", side: "OVER", lineCanonical: 9.5 }, payload);
    expect(result.status).toBe("MATCHED");
    expect(result.odd).toBe(1.95);
    expect(result.offeredLine).toBe(9.5);
  });
});
