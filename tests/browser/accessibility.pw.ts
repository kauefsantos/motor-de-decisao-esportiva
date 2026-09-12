import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicPaths = ["/", "/privacidade"];

for (const path of publicPaths) {
  test(`WCAG 2.2 AA automated scan: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(
      results.violations,
      results.violations
        .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} ocorrência(s))`)
        .join("\n"),
    ).toEqual([]);
  });
}

test("login surface supports keyboard-only activation", async ({ page }) => {
  await page.goto("/");
  const login = page.getByRole("button", { name: "Entrar com Google" });
  await expect(login).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(login).toBeFocused();
});
