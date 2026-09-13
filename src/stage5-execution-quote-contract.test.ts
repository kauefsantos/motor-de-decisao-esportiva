import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const bankroll = readFileSync(`${root}/src/lib/bankroll.functions.ts`, "utf8");
const confirmation = readFileSync(`${root}/src/components/BetConfirmationFlow.tsx`, "utf8");

function compact(value: string) {
  return value.replace(/\s+/g, " ");
}

describe("Stage 5 execution quote contract", () => {
  it("requires a current Bet365 odd before positive stake", () => {
    const source = compact(bankroll);
    expect(source).toContain("currentOdd");
    expect(source).toContain("Confira a odd atual na Bet365 antes de registrar a aposta.");
    expect(source).toContain("executionValueContract");
    expect(source).toContain("evaluateValue");
  });

  it("requires a current line for line-based contracts", () => {
    const source = compact(bankroll);
    expect(source).toContain("Confira também a linha atual da Bet365 antes de registrar a aposta.");
    expect(source).toContain("lineAtEntry: data.currentLine ?? null");
  });

  it("rejects an execution quote older than the 10-minute freshness window", () => {
    const source = compact(bankroll);
    expect(source).toContain("currentQuoteCapturedAt");
    expect(source).toContain("EXECUTION_QUOTE_MAX_AGE_MS");
    expect(source).toContain("A cotação confirmada ficou desatualizada");
  });

  it("keeps the UI blocked until the execution quote is confirmed", () => {
    const source = compact(confirmation);
    expect(source).toContain("Odd da decisão");
    expect(source).toContain("Confira a cotação na Bet365 agora");
    expect(source).toContain("A confirmação expira em 10 minutos");
    expect(source).toContain("currentQuoteCapturedAt");
    expect(source).toContain("disabled={saving || !quoteConfirmed}");
  });
});