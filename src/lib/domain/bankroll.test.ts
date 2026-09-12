import { describe, expect, it } from "vitest";

import { buildStakeSuggestion, type BankrollTrackingRow } from "./bankroll";

function row(modelStatus: string): BankrollTrackingRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    run_id: "00000000-0000-4000-8000-000000000002",
    prediction_id: "P1",
    target_date: "2026-09-30",
    match_label: "A x B",
    competition: "Liga",
    market_family: "CORNERS",
    market_label: "Mais de 9.5",
    model_status: modelStatus,
    model_probability: 0.75,
    entry_odd: 2,
    expected_value: 0.5,
    edge: 0.25,
    stake_brl: null,
    profit_brl: null,
    result: "PENDING",
    bet_status: "PROPOSED",
    selection_rank: 1,
    accepted_at: null,
  };
}

describe("validated bankroll sizing", () => {
  it("keeps experimental rows observation-only even with a large apparent EV", () => {
    const result = buildStakeSuggestion(row("EXPERIMENTAL_CURRENT_SEASON"), 100, 0.05, 0.25, 0.5);
    expect(result.suggestedStake).toBe(0);
    expect(result.stakePolicy).toBe("OBSERVATION_ONLY");
  });

  it("allows fractional Kelly only for production-validated rows", () => {
    const result = buildStakeSuggestion(row("PRODUCTION_VALIDATED"), 100, 0.05, 0.25, 0.5);
    expect(result.suggestedStake).toBeGreaterThan(0);
    expect(result.suggestedStake).toBeLessThanOrEqual(5);
    expect(result.stakePolicy).toBe("VALIDATED_KELLY");
  });
});
