import { defineConfig } from "@playwright/test";

/**
 * Playwright config for specs that mock the API themselves (no backend, no
 * test user, no globalSetup). Run e.g.:
 *
 *   npx playwright test tests/e2e/activity-panel.spec.ts --config=playwright.mocked.config.ts
 *
 * KIMA_UI_BASE_URL selects the target (default http://127.0.0.1:3030).
 * For the full suite (real backend + test user) use playwright.config.ts.
 */
export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 180_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL: process.env.KIMA_UI_BASE_URL || "http://127.0.0.1:3030",
        navigationTimeout: 90_000,
        trace: "retain-on-failure",
    },
    reporter: [["list"]],
});
