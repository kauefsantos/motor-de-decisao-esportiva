import { describe, expect, it } from "vitest";
import {
  MIN_TRAIN_MATCHES,
  calibrationBins,
  fitBaseline,
  poissonDistribution,
  predict,
  probabilityOver,
  temporalSplit,
  validateTemporally,
  type CornerMatchRow,
} from "./corners";
import { buildDataset } from "./corners.train.server";

function synthetic(n: number): CornerMatchRow[] {
  const teams = ["A", "B", "C", "D", "E", "F"];
  const rows: CornerMatchRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const h = teams[i % teams.length]!;
    const a = teams[(i * 3 + 1) % teams.length]!;
    if (h === a) continue;
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String((Math.floor(i / 28) % 12) + 1).padStart(2, "0");
    rows.push({
      date: `2024-${month}-${day}`,
      league: "L1",
      homeTeam: h,
      awayTeam: a,
      homeCorners: 4 + (i % 5),
      awayCorners: 3 + (i % 4),
    });
  }
  return rows;
}

describe("poisson", () => {
  it("soma 1 e cresce com lambda", () => {
    const d = poissonDistribution(9.5);
    const total = [...d.values()].reduce((x, y) => x + y, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(probabilityOver(d, 9.5)).toBeGreaterThan(probabilityOver(poissonDistribution(6), 9.5));
  });
});

describe("split temporal", () => {
  it("nunca coloca partida futura no treino", () => {
    const { train, test } = temporalSplit(synthetic(100));
    const maxTrain = train.map((r) => r.date).sort().at(-1)!;
    const minTest = test.map((r) => r.date).sort()[0]!;
    expect(maxTrain <= minTest).toBe(true);
  });
});

describe("ajuste e previsão", () => {
  it("produz lambda positivo e amostra", () => {
    const rows = synthetic(120);
    const params = fitBaseline(rows);
    const p = predict(params, { league: "L1", homeTeam: "A", awayTeam: "B" });
    expect(p.lambdaTotal).toBeGreaterThan(0);
    expect(p.sampleSize).toBeGreaterThan(0);
  });
});

describe("validação", () => {
  it("bloqueia sem histórico suficiente", () => {
    const out = validateTemporally(synthetic(20));
    expect(out.status).toBe("INSUFFICIENT_MODEL_TRAINING_DATA");
    if (out.status === "INSUFFICIENT_MODEL_TRAINING_DATA") {
      expect(out.requiredTrain).toBe(MIN_TRAIN_MATCHES);
    }
  });

  it("avalia out-of-sample quando há histórico", () => {
    const out = validateTemporally(synthetic(600));
    expect(out.status).toBe("EVALUATED");
    if (out.status === "EVALUATED") {
      expect(out.metrics.testMatches).toBeGreaterThan(0);
      expect(out.metrics.calibration.length).toBe(5);
      expect(["PRODUCTION_VALIDATED", "VALIDATION_PENDING"]).toContain(out.validationStatus);
    }
  });
});

describe("calibração", () => {
  it("mede desvio entre previsto e observado", () => {
    const bins = calibrationBins([
      { p: 0.1, y: false },
      { p: 0.9, y: true },
    ]);
    expect(bins.at(0)!.count).toBe(1);
    expect(bins.at(-1)!.observed).toBe(1);
  });
});

describe("dataset a partir de observações reais", () => {
  it("só monta partida com os dois lados presentes", () => {
    const rows = buildDataset([
      {
        raw_value: {
          externalMatchId: "premier-league:2026-05-24:man city-aston villa",
          statScope: "HOME",
          value: 9,
          fixtureDate: "2026-05-24",
        },
      },
      {
        raw_value: {
          externalMatchId: "premier-league:2026-05-24:man city-aston villa",
          statScope: "AWAY",
          value: 4,
          fixtureDate: "2026-05-24",
        },
      },
      {
        raw_value: {
          externalMatchId: "premier-league:2026-05-19:bournemouth-man city",
          statScope: "HOME",
          value: 6,
          fixtureDate: "2026-05-19",
        },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      league: "premier-league",
      homeTeam: "man city",
      awayTeam: "aston villa",
      homeCorners: 9,
      awayCorners: 4,
    });
  });
});
