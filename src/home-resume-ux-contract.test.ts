import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("home resume UX", () => {
  it("renders resume navigation as real buttons without nested interactive wrappers", () => {
    const home = source("./routes/index.tsx");
    expect(home).toContain("function ResumeRunButton");
    expect(home).toContain("<ResumeRunButton run={summary.resumableRun} />");
    expect(home).toContain("<ResumeRunButton run={run} compact />");
    expect(home).not.toContain("ResumeRunLink");
  });

  it("makes pending registrations directly actionable from the home summary", () => {
    const home = source("./routes/index.tsx");
    const summary = source("./lib/home-summary.functions.ts");
    expect(summary).toContain("proposedRunId");
    expect(summary).toContain("ownerRunIds");
    expect(home).toContain("summary.proposedCount > 0 && summary.proposedRunId");
    expect(home).toContain('to="/run/$runId/resultado"');
    expect(home).toContain("Sugestões para registrar");
  });
});
