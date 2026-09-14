import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("canonical bankroll edge synchronization", () => {
  it("authenticates the user and reads canonical owner-scoped bankroll metrics", () => {
    const edge = source("../supabase/functions/bankroll-dashboard/index.ts");

    expect(edge).toContain("auth.getUser(token)");
    expect(edge).toContain('admin.rpc("get_owner_bankroll_metrics"');
    expect(edge).toContain('admin.rpc("get_owner_home_metrics"');
    expect(edge).toContain('.eq("owner_id", ownerId)');
    expect(edge).toContain('"Cache-Control": "no-store"');
  });

  it("uses one browser client and one query key on both tracking screens", () => {
    const client = source("./lib/canonical-bankroll.browser.ts");
    const openBets = source("./routes/open-bets.tsx");
    const analytics = source("./routes/analytics.tsx");

    expect(client).toContain('functions.invoke<CanonicalBankrollSnapshot>("bankroll-dashboard"');
    expect(openBets).toContain("getCanonicalBankrollSnapshot");
    expect(analytics).toContain("getCanonicalBankrollSnapshot");
    expect(openBets).toContain('queryKey: ["canonical-bankroll"]');
    expect(analytics).toContain('queryKey: ["canonical-bankroll"]');
  });

  it("renders the same canonical equity and realized profit in performance and open bets", () => {
    const openBets = source("./routes/open-bets.tsx");
    const analytics = source("./routes/analytics.tsx");

    expect(openBets).toContain("money(bankroll.available)");
    expect(openBets).toContain("money(bankroll.equity)");
    expect(analytics).toContain("currentBankroll: canonical.equity");
    expect(analytics).toContain("totalProfit: canonical.settledProfit");
  });
});
