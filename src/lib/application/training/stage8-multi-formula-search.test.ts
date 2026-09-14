import { describe, expect, it } from "vitest";

import type { Stage6GoalRow } from "./goals-walk-forward";
import {
  applyStage8FormulaCandidate,
  runStage8MultiFormulaSearch,
  stage8FormulaCandidates,
} from "./stage8-multi-formula-search";

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

describe("Stage 8 multi-formula search", () => {
  it("builds a broad but finite candidate family", () => {
    const candidates = stage8FormulaCandidates();
    expect(candidates.length).toBeGreaterThan(30);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
    expect(candidates.some((candidate) => candidate.kind === "linear")).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === "log_pool")).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === "draw_only")).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === "uncertainty_linear")).toBe(true);
  });

  it("keeps probabilities normalized for every candidate", () => {
    const base = { HOME: 0.52, DRAW: 0.27, AWAY: 0.21 };
    const elo = { HOME: 0.46, DRAW: 0.3, AWAY: 0.24 };
    for (const candidate of stage8FormulaCandidates()) {
      const output = applyStage8FormulaCandidate(base, elo, candidate);
      expect(output.HOME + output.DRAW + output.AWAY).toBeCloseTo(1, 12);
      expect(output.HOME).toBeGreaterThan(0);
      expect(output.DRAW).toBeGreaterThan(0);
      expect(output.AWAY).toBeGreaterThan(0);
    }
  });

  it("draw-only blending preserves the incumbent decisive HOME/AWAY ratio", () => {
    const base = { HOME: 0.5, DRAW: 0.25, AWAY: 0.25 };
    const elo = { HOME: 0.4, DRAW: 0.35, AWAY: 0.25 };
    const output = applyStage8FormulaCandidate(base, elo, {
      id: "test-draw",
      kind: "draw_only",
      weight: 1,
    });
    expect(output.DRAW).toBeCloseTo(0.35, 12);
    expect(output.HOME / output.AWAY).toBeCloseTo(base.HOME / base.AWAY, 12);
  });

  it("selects only on the pre-retrospective window and keeps governance locked", () => {
    const report = runStage8MultiFormulaSearch(makeHistory(), "2026-06-01", "2026-09-14");
    expect(report.candidateCount).toBeGreaterThan(30);
    expect(report.selectionWindow.endExclusive).toBe("2026-06-01");
    expect(report.selectionWindow.sampleSize).toBeGreaterThan(0);
    expect(report.evaluationWindow.sampleSize).toBeGreaterThan(0);
    expect(report.selectionTop10.length).toBeGreaterThan(0);
    expect(report.selectedCandidate.candidate.id.length).toBeGreaterThan(0);
    expect(report.governance.finalHoldoutUsedForFeatureSelection).toBe(false);
    expect(report.governance.retrospectiveWindowUsedToSelectCandidate).toBe(false);
    expect(report.governance.promotionAttempted).toBe(false);
    expect(report.governance.productionValidated).toBe(false);
    expect(report.governance.realStakeUnlocked).toBe(false);
    expect(report.governance.calibrationTolerance).toBe(0.1);
  });
});
