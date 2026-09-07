import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv with required Data column", () => {
  it("accepts the daily mixed-delimiter format", () => {
    const csv = [
      "Data;Partida,Horário,Campeonato",
      "08/09/2026;Cuiabá x Athletic Club,19:00,Brasileirão Série B",
      "08/09/2026;Criciúma x Juventude,21:30,Brasileirão Série B",
    ].join("\n");

    const result = parseCsv(csv);

    expect(result.invalid).toEqual([]);
    expect(result.targetDate).toBe("2026-09-08");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      data: "2026-09-08",
      partida: "Cuiabá x Athletic Club",
      horario: "19:00",
      campeonato: "Brasileirão Série B",
    });
  });

  it("also accepts conventional comma-separated four-column CSV", () => {
    const result = parseCsv(
      "Data,Partida,Horário,Campeonato\n08/09/2026,Vitória x Grêmio,20:00,Brasileirão Série A",
    );

    expect(result.targetDate).toBe("2026-09-08");
    expect(result.rows).toHaveLength(1);
  });

  it("blocks a file with multiple match dates", () => {
    const result = parseCsv(
      [
        "Data;Partida,Horário,Campeonato",
        "08/09/2026;Vitória x Grêmio,20:00,Brasileirão Série A",
        "09/09/2026;Cuiabá x Athletic Club,19:00,Brasileirão Série B",
      ].join("\n"),
    );

    expect(result.rows).toEqual([]);
    expect(result.targetDate).toBeNull();
    expect(result.invalid.some((row) => row.reason.includes("mais de uma data"))).toBe(true);
  });
});
