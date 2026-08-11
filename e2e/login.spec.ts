import { test, expect } from "@playwright/test";

/**
 * Login smoke: proves the auth gate actually redirects, and that the login
 * form is reachable and submittable with the seeded dev user's credentials.
 */
test.describe("login", () => {
  test("unauthenticated visitor is redirected to /login from the app shell", async ({
    page,
  }) => {
    await page.goto("/plan");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("can sign in with email and password", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Larder" })
    ).toBeVisible();

    await page.getByLabel(/email address/i).fill("dev@larder.local");
    await page.getByLabel(/password/i).fill("larder-dev-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/$|\/plan$/);
  });
});
