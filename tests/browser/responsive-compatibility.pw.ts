import { expect, test } from "@playwright/test";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth - overflow.clientWidth).toBeLessThanOrEqual(1);
}

test("public surfaces fit the viewport across the browser matrix", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Entrar com Google" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/privacidade");
  await expect(page.locator("body")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("touch profiles keep the primary action finger-sized", async ({ page }) => {
  const hasTouch = Boolean(test.info().project.use.hasTouch);
  test.skip(!hasTouch, "Touch-target assertion only applies to touch projects.");

  await page.goto("/");
  const button = page.getByRole("button", { name: "Entrar com Google" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("installed app is not locked to portrait", async ({ request }) => {
  const response = await request.get("/site.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.orientation).toBe("any");
});
