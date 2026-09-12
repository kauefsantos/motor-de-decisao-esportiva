import { expect, test } from "@playwright/test";

test.describe("performance budgets", () => {
  test("public route loads without slow navigation or layout instability", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Performance timing gate is measured once in Chromium.");

    await page.goto("/privacidade", { waitUntil: "networkidle" });
    await page.waitForTimeout(250);

    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
      const lcp = lcpEntries.length ? lcpEntries[lcpEntries.length - 1]!.startTime : 0;
      const shifts = performance.getEntriesByType("layout-shift") as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>;
      const cls = shifts.filter((entry) => !entry.hadRecentInput).reduce((sum, entry) => sum + (entry.value ?? 0), 0);
      return {
        domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
        load: nav ? nav.loadEventEnd - nav.startTime : 0,
        lcp,
        cls,
      };
    });

    expect(metrics.domContentLoaded).toBeLessThan(3_000);
    expect(metrics.load).toBeLessThan(4_000);
    if (metrics.lcp > 0) expect(metrics.lcp).toBeLessThanOrEqual(2_500);
    expect(metrics.cls).toBeLessThanOrEqual(0.1);
  });
});