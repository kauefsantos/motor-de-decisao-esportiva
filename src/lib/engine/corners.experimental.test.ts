import { describe, expect, it } from "vitest";

import type { CornerMatchRow } from "./corners";
import {
  EXPERIMENTAL_STATUS,
  MIN_EXPERIMENTAL_MATCHES,
  experimentalSplit,
  validateExperimentalCurrentSeason,
} from "./corners.experimental";
import { currentSeasonRows, seasonOf } from "./corners.season";

function rows(n: number): CornerMatchRow[] {
  const teams = ["A", "B", "C", "D"];
  const out: CornerMatchRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const h = teams[i % teams.length]!;
    const a = teams[(i + 1) % teams.length]!;
    const day = String((i % 28) + 1).padStart(2, "0");
    out.push({
      date: `2026-03-${day}`,
      league: "L1",
      homeTeam: h,
      awayTeam: a,
      homeCorners: 4 + (i % 3),
      awayCorners: 3 + (i % 2),
    });
  }
  return out;
}

describe("validação experimental da temporada atual", () => {
  it("bloqueia com amostra abaixo do mínimo experimental", () => {
    const out = validateExperimentalCurrentSeason(rows(MIN_EXPERIMENTAL_MATCHES - 1));
    expect(out.status).toBe("INSUFFICIENT_MODEL_TRAINING_DATA");
  });

  it("mantém pelo menos uma partida final no teste e ordem cronológica", () => {
    const { train, test } = experimentalSplit(rows(6));
    expect(train.length).toBe(5);
    expect(test.length).toBe(1);
    expect(train[train.length - 1]!.date <= test[0]!.date).toBe(true);
  });

  it("roda com amostra pequena e marca métricas probabilísticas como insuficientes", () => {
    const out = validateExperimentalCurrentSeason(rows(8));
    if (out.status !== EXPERIMENTAL_STATUS) throw new Error("esperado experimental");
    expect(out.productionStatus).toBe("MODEL_NOT_PRODUCTION_VALIDATED");
    expect(out.metrics.modelBrier).toBe("INSUFFICIENT_SAMPLE");
    expect(out.metrics.calibration).toBe("INSUFFICIENT_SAMPLE");
    expect(Number.isFinite(out.metrics.modelRmse)).toBe(true);
    expect(out.predictions.length).toBe(out.metrics.testMatches);
  });

  it("nunca reporta PRODUCTION_VALIDATED", () => {
    const out = validateExperimentalCurrentSeason(rows(40));
    expect(JSON.stringify(out)).not.toContain("PRODUCTION_VALIDATED\"");
  });

  it("mantém apenas a temporada mais recente", () => {
    expect(seasonOf("2026-03-10")).toBe(2025);
    expect(seasonOf("2026-09-10")).toBe(2026);
    const mixed: CornerMatchRow[] = [
      { date: "2024-09-01", league: "L1", homeTeam: "A", awayTeam: "B", homeCorners: 5, awayCorners: 4 },
      ...rows(4),
    ];
    expect(currentSeasonRows(mixed).length).toBe(4);
  });
});
