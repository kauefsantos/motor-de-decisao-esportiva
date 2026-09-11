import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("hierarchical Elo betting integration", () => {
  it("routes cross-league goal baselines through the shared Elo adjustment", () => {
    const run = source("./lib/experimental-markets-run.functions.ts");
    const crossBranch = run.indexOf("if (crossLeague) {");
    const crossForecast = run.indexOf("crossLeagueGoalForecast", crossBranch);
    const sharedElo = run.indexOf("const eloForecast = await eloAdjustGoalForecast", crossForecast);
    const projections = run.indexOf("const projections = buildGoalMarketProjections", sharedElo);

    expect(crossBranch).toBeGreaterThanOrEqual(0);
    expect(crossForecast).toBeGreaterThan(crossBranch);
    expect(sharedElo).toBeGreaterThan(crossForecast);
    expect(projections).toBeGreaterThan(sharedElo);
    expect(run).not.toContain("Elo cross-country não aplicado sem normalização validada");
  });

  it("keeps the cross-league baseline suffix and appends the applied Elo suffix", () => {
    const run = source("./lib/experimental-markets-run.functions.ts");
    expect(run).toContain("goalModelVersion = `${GOALS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`");
    expect(run).toContain("goalModelVersion = `${goalModelVersion}+${eloForecast.modelVersionSuffix}`");
  });

  it("keeps Elo fail-closed when hierarchical evidence is unavailable", () => {
    const run = source("./lib/experimental-markets-run.functions.ts");
    expect(run).toContain("if (!eloForecast.applied)");
    expect(run).toContain("Mantido o baseline de gols sem ajuste Elo.");
  });
});
