import { test, expect } from "@playwright/test";
import { skipIfEmptyLibrary } from "./fixtures/test-helpers";

const username = process.env.KIMA_TEST_USERNAME || "predeploy";
const password = process.env.KIMA_TEST_PASSWORD || "predeploy-password";

test("core smoke: login → library page renders", async ({ page }) => {
    // Login
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();

    // Login redirects to / (assuming onboarding was already completed by the API smoke test)
    await page.waitForURL(/\/($|\?)/);

    await skipIfEmptyLibrary(page);

    // Navigate to albums and open the first one
    await page.goto("/collection?tab=albums");
    await expect(page.locator('a[href^="/album/"]').first()).toBeVisible({ timeout: 10_000 });

    const firstAlbum = page.locator('a[href^="/album/"]').first();
    const albumCount = await firstAlbum.count();
    expect(albumCount).toBeGreaterThan(0);
    await firstAlbum.click();
    await expect(page).toHaveURL(/\/album\//);
});
