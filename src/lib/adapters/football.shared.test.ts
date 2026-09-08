import { describe, expect, it } from "vitest";

import { nameSimilarity, normalizeTeamName } from "./football.shared";

describe("football aliases", () => {
  it("resolve aliases curtos da Championship sem baixar o threshold global", () => {
    expect(normalizeTeamName("Queens Park Rangers")).toBe("qpr");
    expect(normalizeTeamName("Derby County")).toBe("derby");
    expect(normalizeTeamName("West Bromwich Albion")).toBe("west brom");
    expect(normalizeTeamName("Norwich City")).toBe("norwich");
    expect(normalizeTeamName("Birmingham City")).toBe("birmingham");
    expect(nameSimilarity("Charlton Athletic", "Charlton")).toBe(1);
  });

  it("trata Atlético-MG e Atletico Mineiro como o mesmo clube", () => {
    expect(normalizeTeamName("Atlético-MG")).toBe("mineiro");
    expect(normalizeTeamName("Atletico Mineiro")).toBe("mineiro");
    expect(nameSimilarity("Atlético-MG", "Atletico Mineiro")).toBe(1);
  });

  it("trata Estudiantes e Estudiantes LP como alias determinístico", () => {
    expect(nameSimilarity("Estudiantes", "Estudiantes LP")).toBe(1);
  });
});
