import { test, expect, type Page } from "@playwright/test";

/**
 * Notification overlay (activity panel) regression test.
 *
 * Reported bug: clicking the bell threw
 *   "RangeError: Maximum call stack size exceeded"
 * and the overlay never opened. Cause: `useActivityPanel` dispatched the
 * open/close window events from inside its own setState updaters, while
 * `AuthenticatedLayout` listened to those very events and called the same
 * state transitions again -> unbounded synchronous re-entry.
 *
 * The API is mocked, so this spec needs no backend and no test user.
 */

const USER = {
    id: "e2e-overlay-user",
    username: "overlay-e2e",
    role: "admin",
    onboardingComplete: true,
};

async function mockApi(page: Page): Promise<void> {
    // Lowest precedence (Playwright matches the most recently registered route
    // first): anything not mocked explicitly resolves to an empty collection.
    await page.route("**/api/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.route("**/api/auth/me", (route) => route.fulfill({ json: USER }));
    await page.route("**/api/notifications", (route) =>
        route.fulfill({ json: [] })
    );
    await page.route("**/api/notifications/downloads/active", (route) =>
        route.fulfill({ json: [] })
    );
}

test.describe("notification overlay", () => {
    test("bell opens the activity panel without a stack overflow", async ({
        page,
    }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        await mockApi(page);
        await page.addInitScript(() => {
            localStorage.setItem("auth_token", "e2e-mocked-token");
            localStorage.setItem("kima_activity_panel_open", "false");
        });

        // Any protected route renders inside AuthenticatedLayout (TopBar bell).
        await page.goto("/notification-overlay-e2e");

        const bell = page.getByRole("button", {
            name: "Toggle activity panel",
        });
        await expect(bell).toBeVisible();
        await expect(bell).toHaveAttribute("aria-expanded", "false");

        await bell.click();

        // Must open - and must not blow the call stack while doing so.
        await expect
            .soft(bell)
            .toHaveAttribute("aria-expanded", "true");
        await expect
            .soft(page.locator("#activity-panel"))
            .toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

        // And it must close again (aria mirror must not lag behind).
        await bell.click();
        await expect
            .soft(bell)
            .toHaveAttribute("aria-expanded", "false");
        await expect
            .soft(page.locator("#activity-panel"))
            .toHaveCSS("transform", "matrix(1, 0, 0, 1, 402, 0)");

        expect(
            pageErrors,
            `unexpected page errors: ${pageErrors.join(" | ")}`
        ).toEqual([]);
    });

    test("mobile bell opens the full-screen overlay", async ({ page }) => {
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        await page.setViewportSize({ width: 390, height: 844 });
        await mockApi(page);
        await page.addInitScript(() => {
            localStorage.setItem("auth_token", "e2e-mocked-token");
            localStorage.setItem("kima_activity_panel_open", "false");
        });

        await page.goto("/notification-overlay-e2e");

        const bell = page.locator(
            '[aria-label="Notifications"][aria-controls="activity-panel-mobile"]'
        );
        await expect(bell).toBeVisible();

        await bell.click();
        await expect.soft(page.locator("#activity-panel-mobile")).toBeVisible();
        await expect.soft(bell).toHaveAttribute("aria-expanded", "true");

        // The overlay covers the bell; closing goes through its own close button.
        await page.locator('#activity-panel-mobile button[title="Close"]').click();
        await expect.soft(page.locator("#activity-panel-mobile")).toHaveCount(0);
        await expect.soft(bell).toHaveAttribute("aria-expanded", "false");

        expect(
            pageErrors,
            `unexpected page errors: ${pageErrors.join(" | ")}`
        ).toEqual([]);
    });
});
