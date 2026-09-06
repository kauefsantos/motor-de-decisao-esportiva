import { describe, expect, it } from "vitest";

import {
  goalsFromEvent,
  kickoffProximity,
  mapStatistics,
  nameSimilarity,
  normalizeTeamName,
  parseScheduledEvents,
  resolveEvent,
} from "./sofascore.parse";
import {
  TEST_FIXTURE_EVENT_STATISTICS,
  TEST_FIXTURE_FINISHED_EVENTS,
  TEST_FIXTURE_SCHEDULED_EVENTS,
} from "./sofascore.test-fixtures";

describe("normalização de nomes", () => {
  it("remove acentos, pontuação e tokens de ruído", () => {
    expect(normalizeTeamName("Grêmio F.B.P.A.")).toBe("gremio");
    expect(normalizeTeamName("Getafe CF")).toBe("getafe");
    expect(normalizeTeamName("RC Celta de Vigo")).toBe("rc celta vigo");
  });

  it("preserva o nome quando a limpeza esvaziaria o resultado", () => {
    expect(normalizeTeamName("FC")).toBe("fc");
  });

  it("pontua similaridade entre 0 e 1 e é simétrica", () => {
    const a = nameSimilarity("Celta de Vigo", "RC Celta de Vigo");
    expect(a).toBeGreaterThan(0.45);
    expect(a).toBeLessThanOrEqual(1);
    expect(nameSimilarity("Lecce", "Cagliari")).toBeLessThan(0.3);
    expect(nameSimilarity("Lazio", "Udinese")).toBe(nameSimilarity("Udinese", "Lazio"));
  });
});

describe("proximidade de kickoff", () => {
  it("vale 1 dentro de 15 minutos e 0 acima de 3 horas", () => {
    expect(kickoffProximity("2025-09-06T16:30:00Z", 1757176200)).toBe(1);
    expect(kickoffProximity("2025-09-06T21:30:00Z", 1757176200)).toBe(0);
    expect(kickoffProximity(null, 1757176200)).toBe(0);
  });
});

describe("parsing de payload (test fixtures)", () => {
  it("extrai eventos com times, torneio e horário", () => {
    const events = parseScheduledEvents(TEST_FIXTURE_SCHEDULED_EVENTS);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      eventId: 100001,
      homeName: "Cagliari",
      awayName: "Lecce",
      tournament: "Serie A",
      category: "Italy",
      homeTeamId: 5001,
    });
  });

  it("ignora entradas malformadas em vez de inventar dados", () => {
    expect(parseScheduledEvents({ events: [{ id: 1 }, null, 42] })).toHaveLength(0);
    expect(parseScheduledEvents(null)).toHaveLength(0);
  });
});

describe("resolução determinística", () => {
  const events = parseScheduledEvents(TEST_FIXTURE_SCHEDULED_EVENTS);

  it("resolve quando nomes e horário batem com folga", () => {
    const r = resolveEvent(
      {
        homeTeam: "Getafe",
        awayTeam: "Celta de Vigo",
        competition: "LaLiga",
        kickoff: "2025-09-06T21:30:00Z",
      },
      events,
    );
    expect(r.status).toBe("MATCH_RESOLVED");
    expect(r.eventId).toBe(100003);
    expect(r.confidence).toBeGreaterThanOrEqual(0.78);
  });

  it("marca ambiguidade quando dois candidatos ficam próximos", () => {
    const twins = parseScheduledEvents({
      events: [
        {
          id: 1,
          startTimestamp: 1757176200,
          status: { type: "notstarted" },
          tournament: { uniqueTournament: { name: "Serie A" } },
          homeTeam: { id: 1, name: "Cagliari" },
          awayTeam: { id: 2, name: "Lecce" },
        },
        {
          id: 2,
          startTimestamp: 1757176200,
          status: { type: "notstarted" },
          tournament: { uniqueTournament: { name: "Serie A" } },
          homeTeam: { id: 3, name: "Cagliari" },
          awayTeam: { id: 4, name: "Lecce" },
        },
      ],
    });
    const r = resolveEvent(
      {
        homeTeam: "Cagliari",
        awayTeam: "Lecce",
        competition: "Serie A",
        kickoff: "2025-09-06T16:30:00Z",
      },
      twins,
    );
    expect(r.status).toBe("MATCH_AMBIGUOUS");
    expect(r.eventId).toBeNull();
  });

  it("retorna MATCH_NOT_FOUND sem candidato plausível", () => {
    const r = resolveEvent(
      {
        homeTeam: "Nantes",
        awayTeam: "Nancy",
        competition: "Ligue 2",
        kickoff: "2025-09-06T18:45:00Z",
      },
      events,
    );
    expect(r.status).toBe("MATCH_NOT_FOUND");
    expect(r.eventId).toBeNull();
  });

  it("não resolve nada com lista vazia", () => {
    const r = resolveEvent(
      { homeTeam: "A", awayTeam: "B", competition: "C", kickoff: null },
      [],
    );
    expect(r.status).toBe("MATCH_NOT_FOUND");
    expect(r.confidence).toBe(0);
  });
});

describe("definition gates", () => {
  const stats = mapStatistics(TEST_FIXTURE_EVENT_STATISTICS);

  it("lê apenas o período ALL e ignora métricas não mapeadas", () => {
    expect(stats.some((s) => s.sourceLabel === "Ball possession")).toBe(false);
    const corners = stats.filter((s) => s.canonical === "corners_taken");
    expect(corners.map((c) => c.value)).toEqual([6, 3]);
  });

  it("marca escanteios como compatíveis e cartões/chutes como incompatíveis", () => {
    expect(stats.find((s) => s.canonical === "corners_taken")!.contractCompatible).toBe(true);
    expect(stats.find((s) => s.canonical === "cards_yellow_raw")!.contractCompatible).toBe(false);
    expect(stats.find((s) => s.canonical === "shots_on_target")!.contractCompatible).toBe(false);
  });
});

describe("gols a partir de eventos encerrados", () => {
  const [finished] = parseScheduledEvents(TEST_FIXTURE_FINISHED_EVENTS);

  it("usa somente eventos anteriores ao prediction_at", () => {
    expect(goalsFromEvent(finished!, "2025-09-06T12:00:00Z")).toHaveLength(2);
    expect(goalsFromEvent(finished!, "2020-01-01T00:00:00Z")).toHaveLength(0);
  });

  it("não deriva gols de evento não encerrado", () => {
    const [scheduled] = parseScheduledEvents(TEST_FIXTURE_SCHEDULED_EVENTS);
    expect(goalsFromEvent(scheduled!, "2030-01-01T00:00:00Z")).toHaveLength(0);
  });
});
