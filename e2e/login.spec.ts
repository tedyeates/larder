import { test, expect } from "@playwright/test";

/**
 * Login smoke: proves the auth gate actually redirects, and that the login
 * form is reachable and submittable. Does not complete a real sign-in — the
 * magic link requires an inbox — but exercises the one boundary unit and
 * integration tests can't: a real browser navigating a real redirect.
 */
test.describe("login", () => {
  test("unauthenticated visitor is redirected to /login from the app shell", async ({
    page,
  }) => {
    await page.goto("/plan");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("can request a magic link", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Larder" })
    ).toBeVisible();

    await page.getByLabel(/email address/i).fill("smoke-test@example.com");
    await page
      .getByRole("button", { name: /send magic link/i })
      .click();

    await expect(page.getByTestId("login-sent-message")).toBeVisible();
  });
});
