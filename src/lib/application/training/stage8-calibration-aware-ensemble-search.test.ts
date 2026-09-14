import { describe, expect, it } from "vitest";

import type { Stage6GoalRow } from "./goals-walk-forward";
import {
  applyStage8CalibrationAwareCandidate,
  runStage8CalibrationAwareEnsembleSearch,
  stage8CalibrationAwareCandidates,
} from "./stage8-calibration-aware-ensemble-search";

function makeHistory(): Stage6GoalRow[] {
  const rows: Stage6GoalRow[] = [];
  const teams = ["A", "B", "C", "D", "E", "F"];
  let fixture = 1;
  for (let day = 0; day < 280; day += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    const homeTeamId = teams[day % teams.length] ?? "A";
    const awayTeamId = teams[(day + 2) % teams.length] ?? "C";
    rows.push({
      fixtureId: String(fixture++),
      date,
      league: "england-premier-league",
      homeTeamId,
      awayTeamId,
      homeGoals: day % 6 === 0 ? 0 : day % 5 === 0 ? 3 : 2,
      awayGoals: day % 7 === 0 ? 2 : day % 4 === 0 ? 0 : 1,
      eloHomeRatingBefore: 1500,
      eloAwayRatingBefore: 1500,
      eloModelVersion: "elo-v1-w020",
    });
  }
  return rows;
}

describe("Stage 8 calibration-aware ensemble search", () => {
  it("creates a broad deterministic grid", () => {
    const candidates = stage8CalibrationAwareCandidates();
    expect(candidates.length).toBe(732);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
  });

  it("keeps transformed probabilities normalized", () => {
    const base = { HOME: 0.72, DRAW: 0.18, AWAY: 0.1 };
    const elo = { HOME: 0.6, DRAW: 0.24, AWAY: 0.16 };
    for (const candidate of stage8CalibrationAwareCandidates().filter((_, index) => index % 37 === 0)) {
      const output = applyStage8CalibrationAwareCandidate(base, elo, candidate);
      expect(output.HOME + output.DRAW + output.AWAY).toBeCloseTo(1, 12);
      expect(output.HOME).toBeGreaterThan(0);
      expect(output.DRAW).toBeGreaterThan(0);
      expect(output.AWAY).toBeGreaterThan(0);
    }
  });

  it("caps an extreme maximum without changing total probability", () => {
    const base = { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 };
    const elo = { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 };
    const output = applyStage8CalibrationAwareCandidate(base, elo, {
      id: "cap-test",
      basis: { id: "linear-0", kind: "linear", weight: 0 },
      temperature: 1,
      uniformShrink: 0,
      capMax: 0.7,
    });
    expect(output.HOME).toBeCloseTo(0.7, 12);
    expect(output.HOME + output.DRAW + output.AWAY).toBeCloseTo(1, 12);
  });

  it("uses only pre-retrospective selection and keeps governance locked", () => {
    const report = runStage8CalibrationAwareEnsembleSearch(makeHistory(), "2026-06-01", "2026-09-14");
    expect(report.candidateCount).toBe(732);
    expect(report.selectionWindow.endExclusive).toBe("2026-06-01");
    expect(report.selectionWindow.sampleSize).toBeGreaterThan(0);
    expect(report.evaluationWindow.sampleSize).toBeGreaterThan(0);
    expect(report.selectedPrimary.candidate.id.length).toBeGreaterThan(0);
    expect(report.governance.finalHoldoutUsedForFeatureSelection).toBe(false);
    expect(report.governance.retrospectiveWindowUsedToSelectCandidate).toBe(false);
    expect(report.governance.promotionAttempted).toBe(false);
    expect(report.governance.productionValidated).toBe(false);
    expect(report.governance.calibrationTolerance).toBe(0.1);
    expect(report.governance.calibrationToleranceRelaxed).toBe(false);
    expect(report.governance.realStakeUnlocked).toBe(false);
  });
});
