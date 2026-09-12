import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("hierarchical Elo betting integration", () => {
  it("routes cross-league goal baselines through the shared Elo adjustment", () => {
    const predictionService = source("./lib/application/experimental-markets/prediction-service.ts");
    const crossBranch = predictionService.indexOf("if (crossLeague) {");
    const crossForecast = predictionService.indexOf("crossLeagueGoalForecast", crossBranch);
    const sharedElo = predictionService.indexOf("const eloForecast = await eloAdjustGoalForecast", crossForecast);
    const projections = predictionService.indexOf("const projections = buildGoalMarketProjections", sharedElo);

    expect(crossBranch).toBeGreaterThanOrEqual(0);
    expect(crossForecast).toBeGreaterThan(crossBranch);
    expect(sharedElo).toBeGreaterThan(crossForecast);
    expect(projections).toBeGreaterThan(sharedElo);
    expect(predictionService).not.toContain("Elo cross-country não aplicado sem normalização validada");
  });

  it("keeps the cross-league baseline suffix and appends the applied Elo suffix", () => {
    const predictionService = source("./lib/application/experimental-markets/prediction-service.ts");
    expect(predictionService).toContain("goalModelVersion = `${GOALS_MODEL_VERSION}+${CROSS_LEAGUE_MODEL_SUFFIX}`");
    expect(predictionService).toContain("goalModelVersion = `${goalModelVersion}+${eloForecast.modelVersionSuffix}`");
  });

  it("keeps Elo fail-closed when hierarchical evidence is unavailable", () => {
    const predictionService = source("./lib/application/experimental-markets/prediction-service.ts");
    expect(predictionService).toContain("if (!eloForecast.applied)");
    expect(predictionService).toContain("Mantido o baseline de gols sem ajuste Elo.");
  });
});
