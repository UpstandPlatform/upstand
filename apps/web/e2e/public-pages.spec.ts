import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function assertAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  expect(
    results.violations,
    JSON.stringify(results.violations, null, 2),
  ).toEqual([]);
}

test.describe("public web production surface", () => {
  test("login renders with security headers and no accessibility violations", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.route("**/api/setup/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ needsOwnerSetup: false, isCloud: false }),
      }),
    );
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: "null",
      }),
    );

    const response = await page.goto("/login", {
      waitUntil: "domcontentloaded",
    });

    expect(response?.ok()).toBe(true);
    expect(response?.headers()["content-security-policy"]).toBeTruthy();
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Upstand/);
    await expect(page.locator("body")).toContainText("Upstand");
    await assertAccessible(page);

    // The Windows local preview infers the API on http://127.0.0.1:3000,
    // which the production CSP intentionally rejects. CI builds with the
    // reserved HTTPS origin and intercepts these same endpoints above. Firefox
    // also reports Next's vendor-chunk eval diagnostic as a CSP console error;
    // the response header remains asserted above and the production policy is
    // intentionally not weakened for this browser diagnostic.
    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) =>
        !message.includes("http://127.0.0.1:3000/api/setup/status") &&
        !message.includes("http://127.0.0.1:3000/api/auth/get-session") &&
        !message.includes("Content-Security-Policy") &&
        !message.includes("blocked a JavaScript eval"),
    );
    expect(unexpectedConsoleErrors).toEqual([]);
  });
});
