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
    const contentSecurityPolicy =
      response?.headers()["content-security-policy"] ?? "";
    expect(contentSecurityPolicy).toContain(
      "form-action 'self' https://github.com",
    );
    expect(contentSecurityPolicy).toContain(
      "connect-src 'self' http: https: ws: wss:",
    );
    expect(contentSecurityPolicy).not.toContain(
      "script-src 'self' 'unsafe-eval'",
    );
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Upstand/);
    await expect(page.locator("body")).toContainText("Upstand");
    await expect(
      page.getByRole("button", { name: "Continue with passkey" }),
    ).toBeVisible({ timeout: 15_000 });
    await assertAccessible(page);

    // Firefox can report Next's vendor-chunk eval diagnostic as a CSP console
    // error even when the response header is correct. The direct-IP HTTP API
    // requests should no longer be present here: they are a supported
    // self-hosted recovery path and are allowed by the production policy.
    const unexpectedConsoleErrors = consoleErrors.filter(
      (message) =>
        !message.includes("Content-Security-Policy") &&
        !message.includes("blocked a JavaScript eval"),
    );
    expect(unexpectedConsoleErrors).toEqual([]);
  });

  test("does not leave the landing page blank when the control plane is unavailable", async ({
    page,
  }) => {
    await page.route("**/api/setup/status", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Control plane unavailable" }),
      }),
    );
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: "null",
      }),
    );

    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", {
        name: "Instance status is unavailable",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry status check" }),
    ).toBeVisible();
    await assertAccessible(page);
  });
});
