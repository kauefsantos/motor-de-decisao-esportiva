import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const valueTracking = readFileSync(
  `${root}/src/lib/application/experimental-markets/value-tracking.ts`,
  "utf8",
);
const bankroll = readFileSync(`${root}/src/lib/bankroll.functions.ts`, "utf8");
const openBets = readFileSync(`${root}/src/routes/open-bets.tsx`, "utf8");

describe("Stage 5 Asian value and settlement contract", () => {
  it("does not force totals through the binary value formula", () => {
    expect(valueTracking).toContain("executionValueContract");
    expect(valueTracking).toContain("contractType: contract.contractType");
    expect(valueTracking).toContain("outcomeDistribution: contract.outcomeDistribution");
    expect(valueTracking).not.toContain('contractType: "BINARY"');
  });

  it("accepts partial Asian financial outcomes server-side", () => {
    expect(bankroll).toContain('"HALF_WIN"');
    expect(bankroll).toContain('"PUSH"');
    expect(bankroll).toContain('"HALF_LOSS"');
  });

  it("shows only contract-compatible settlement choices in the open-bet UI", () => {
    expect(openBets).toContain("allowedFinancialSettlementOutcomes");
    expect(openBets).toContain("Odd executada");
  });
});
