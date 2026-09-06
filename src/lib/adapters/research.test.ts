import { describe, expect, it } from "vitest";

import {
  crossCheck,
  matchLeague,
  observationsForTeam,
  parseFootballDataCsv,
  resolveResearchMatch,
  resolveTeam,
  selectHistory,
  teamRoster,
  RESEARCH_DEFINITION_VERSION,
  RESEARCH_SOURCE,
} from "./research.parse";

const CSV = `Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HS,AS,HST,AST,HC,AC,HY,AY,HR,AR,HF,AF
E0,10/08/2024,Man City,Chelsea,2,0,15,7,6,2,8,3,1,2,0,0,9,11
E0,17/08/2024,Chelsea,Arsenal,1,1,10,12,3,5,4,6,2,1,0,0,12,10
E0,24/08/2024,Arsenal,Man City,0,2,9,14,2,7,5,9,3,1,1,0,14,8
E0,31/08/2024,Chelsea,Man City,1,3,8,16,4,8,2,10,1,0,0,0,10,9
E0,14/09/2024,Man City,Arsenal,2,2,18,6,9,3,11,2,0,3,0,1,7,13
E0,21/09/2024,Chelsea,Everton,3,0,17,5,8,1,9,2,1,1,0,0,8,12
E0,28/09/2024,Everton,Man City,0,1,6,19,1,9,3,12,2,0,0,0,13,7
E0,05/10/2024,Man City,Everton,4,1,20,4,11,2,13,1,0,2,0,0,6,14
`;

const fixtures = parseFootballDataCsv(CSV, {
  leagueKey: "england-premier-league",
  season: "2425",
  sourceUrl: "https://example.org/E0.csv",
});

describe("research adapter — dataset público", () => {
  it("expõe fonte e versão de definição próprias", () => {
    expect(RESEARCH_SOURCE).toBe("research_adapter");
    expect(RESEARCH_DEFINITION_VERSION).toBe("research-v1");
  });

  it("faz o parsing das partidas com data ISO e chave estável", () => {
    expect(fixtures).toHaveLength(8);
    expect(fixtures[0]!.date).toBe("2024-08-10");
    expect(fixtures[0]!.homeTeam).toBe("Man City");
    expect(fixtures[0]!.key).toContain("2024-08-10");
  });

  it("reconhece a competição a partir do rótulo do CSV do usuário", () => {
    expect(matchLeague("Premier League")?.league.key).toBe("england-premier-league");
    expect(matchLeague("Campeonato Fictício da Lua")).toBeNull();
  });
});

describe("research adapter — resolução", () => {
  const roster = teamRoster(fixtures);

  it("resolve time por nome aproximado", () => {
    const r = resolveTeam("Manchester City", roster);
    expect(r.status).toBe("MATCH_RESOLVED");
    expect(r.team).toBe("Man City");
  });

  it("não resolve time inexistente", () => {
    expect(resolveTeam("Clube Inventado FC", roster).status).toBe("MATCH_NOT_FOUND");
  });

  it("resolve a partida do CSV com score de confiança", () => {
    const res = resolveResearchMatch(
      {
        homeTeam: "Manchester City",
        awayTeam: "Chelsea",
        competition: "Premier League",
        kickoff: "2024-08-10T16:00:00Z",
      },
      fixtures,
      1,
    );
    expect(res.status).toBe("MATCH_RESOLVED");
    expect(res.confidence).toBeGreaterThan(0.7);
    expect(res.fixtureKey).toContain("2024-08-10");
  });
});

describe("research adapter — histórico pré-jogo", () => {
  it("usa somente jogos anteriores ao prediction_at", () => {
    const sel = selectHistory("Man City", fixtures, "2024-09-30T00:00:00Z");
    expect(sel.status).toBe("OK");
    expect(sel.fixtures).toHaveLength(5);
    for (const f of sel.fixtures) expect(f.date < "2024-09-30").toBe(true);
  });

  it("marca INSUFFICIENT_HISTORY quando há menos de 5 jogos", () => {
    const sel = selectHistory("Everton", fixtures, "2024-10-10T00:00:00Z");
    expect(sel.found).toBeLessThan(5);
    expect(sel.status).toBe("INSUFFICIENT_HISTORY");
  });
});

describe("research adapter — métricas e gates", () => {
  const obs = observationsForTeam(fixtures[0]!, "Man City");

  it("extrai gols marcados/sofridos e escanteios como compatíveis", () => {
    const compat = obs.filter((o) => o.contractCompatible).map((o) => o.canonical);
    expect(compat).toContain("goals_scored");
    expect(compat).toContain("goals_conceded");
    expect(compat).toContain("corners_taken");
  });

  it("rejeita finalizações e cartões por definição incompatível", () => {
    const rejected = obs.filter((o) => !o.contractCompatible).map((o) => o.canonical);
    expect(rejected).toContain("shots_total");
    expect(rejected).toContain("shots_on_target");
  });

  it("nunca cria valor ausente", () => {
    const semDados = observationsForTeam(
      { ...fixtures[0]!, raw: { ...fixtures[0]!.raw, HC: "", AC: "" } },
      "Man City",
    );
    expect(semDados.some((o) => o.canonical === "corners_taken")).toBe(false);
    for (const o of semDados) expect(Number.isFinite(o.value)).toBe(true);
  });

  it("mantém lineage mínima em cada observação", () => {
    for (const o of obs) {
      expect(o.sourceUrl).toBe("https://example.org/E0.csv");
      expect(o.fixtureKey).toBeTruthy();
      expect(o.fixtureDate).toBe("2024-08-10");
      expect(o.metricLabelRaw).toBeTruthy();
    }
  });
});

describe("research adapter — cross-check entre fontes", () => {
  it("confirma valores iguais ou compatíveis", () => {
    expect(crossCheck([{ source: "a", value: 5 }])).toBe("SINGLE_SOURCE");
    expect(
      crossCheck([
        { source: "a", value: 5 },
        { source: "b", value: 5 },
      ]),
    ).toBe("CROSS_SOURCE_CONFIRMED");
  });

  it("aponta conflito quando divergem", () => {
    expect(
      crossCheck([
        { source: "a", value: 5 },
        { source: "b", value: 8 },
      ]),
    ).toBe("SOURCE_CONFLICT");
  });
});
