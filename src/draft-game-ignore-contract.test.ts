import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const route = read("src/routes/draft.$draftId.validacao.tsx");
const functions = read("src/lib/analysis-draft.functions.ts");
const migration = read("supabase/migrations/20260912174500_analysis_draft_game_ignore.sql");

describe("draft game ignore contract", () => {
  it("offers an explicit reversible ignore action in validation UI", () => {
    expect(route).toContain("Não analisar este jogo");
    expect(route).toContain("Jogo não será analisado");
    expect(route).toContain("Reincluir jogo");
    expect(route).toContain("game.ignored");
  });

  it("persists ignore state server-side and keeps it owner scoped", () => {
    expect(functions).toContain("setAnalysisDraftGameIgnored");
    expect(functions).toContain('.eq("draft_id", data.draftId)');
    expect(functions).toContain('requireDraft(db, data.draftId, context.userId)');
    expect(functions).toContain("ignored: data.ignored");
  });

  it("does not count ignored games as invalid during validation", () => {
    expect(functions).toContain("if (game.ignored)");
    expect(functions).toContain("ignored += 1");
    expect(functions).toContain("active > 0 && invalid === 0");
  });

  it("never copies ignored games into a finalized run", () => {
    expect(migration).toContain("and not g.ignored");
    expect(migration).toContain("where draft_id=p_draft_id and not ignored");
    expect(migration).toContain("v_active_count=0");
    expect(migration).toContain("Escolha pelo menos uma partida para analisar");
  });

  it("treats finalized and cancelled drafts as terminal", () => {
    expect(functions).toContain('const TERMINAL_DRAFT_STATUSES = new Set(["FINALIZED", "CANCELLED"])');
    expect(functions).toContain("assertDraftMutable(draft)");
    expect(functions).toContain("Esta rodada já foi encerrada e não pode voltar para validação.");
    expect(functions).toContain('status === "FINALIZED" && !draft?.final_run_id');
  });

  it("does not revalidate or cache a terminal draft in the validation route", () => {
    expect(route).toContain('status === "FINALIZED" || status === "CANCELLED"');
    expect(route).toContain("staleTime: 0");
    expect(route).toContain("gcTime: 0");
    expect(route).toContain('refetchOnMount: "always"');
    expect(route).toContain("Esta rodada já foi encerrada");
    expect(route).toContain('to: "/run/$runId/processamento"');
  });
});
