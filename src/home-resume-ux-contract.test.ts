import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("home resume UX contract", () => {
  it("renders resume actions as real Button -> Link pairs", () => {
    const home = source("./routes/index.tsx");

    expect(home).toContain("function ResumeRunButton");
    expect(home).toContain("<Button asChild {...buttonProps}>");
    expect(home).not.toContain("ResumeRunLink");
    expect(home).not.toContain("<Button asChild size=\"sm\" variant=\"outline\"><ResumeRun");
  });

  it("links proposed suggestions directly to the owning run result", () => {
    const home = source("./routes/index.tsx");
    const summary = source("./lib/home-summary.functions.ts");

    expect(home).toContain('data-testid="proposed-run-link"');
    expect(home).toContain("summary.proposedRunId");
    expect(home).toContain('to="/run/$runId/resultado"');
    expect(summary).toContain('"get_owner_latest_proposed_run_id"');
    expect(summary).toContain("{ p_owner_id: userId }");
    expect(summary).not.toContain('.from("experimental_bet_tracking")');
    expect(summary).toContain("proposedRunId: proposedRunResult.data ?? null");
  });

  it("keeps home run typing strict", () => {
    const home = source("./routes/index.tsx");

    expect(home).toContain('type RecentRun = HomeSummary["recentRuns"][number]');
    expect(home).not.toContain("run: any");
  });
});
