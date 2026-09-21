import { Page, TestInfo, test } from "@playwright/test";

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Required env var ${name} is not set. Set it before running E2E tests.`);
    }
    return value;
}

const username = requireEnv("KIMA_TEST_USERNAME");
const password = requireEnv("KIMA_TEST_PASSWORD");
const baseUrl = process.env.KIMA_UI_BASE_URL || "http://127.0.0.1:3030";

export async function loginAsTestUser(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator("#username").fill(username);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    await page.waitForURL(/\/($|\?|home)/);
}

/** Read the auth token from localStorage (set after login) for use in page.request calls. */
export async function getAuthToken(page: Page): Promise<string> {
    return page.evaluate(() => localStorage.getItem("auth_token") ?? "");
}

export function skipIfNoEnv(envVar: string, testInfo: TestInfo): void {
    if (!process.env[envVar]) {
        testInfo.skip(true, `Skipping: ${envVar} not set`);
    }
}

export async function waitForApiHealth(page: Page, timeoutMs = 30000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await page.request.get(`${baseUrl}/api/health`);
            if (response.ok()) return;
        } catch {}
        await page.waitForTimeout(1000);
    }
    throw new Error("API health check timed out");
}

/** Skip the current test if the library has no music.
 *  Must be called after login (reads auth token from localStorage). */
export async function skipIfEmptyLibrary(page: Page): Promise<void> {
    const token = await getAuthToken(page);
    let isEmpty = false;
    try {
        const res = await page.request.get("/api/library/tracks?limit=1", {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok()) {
            const data = await res.json() as { tracks?: unknown[]; total?: number };
            const total = data.total ?? (data.tracks ?? []).length;
            isEmpty = total === 0;
        }
    } catch {
        // network error -- don't skip, let test proceed
    }
    // test.skip() must be called OUTSIDE the try/catch -- it works by throwing
    // a SkipError internally, which the catch block above would otherwise swallow.
    if (isEmpty) {
        test.skip(true, "No music in library -- skipping (empty CI container)");
    }
}

export { username, password, baseUrl };
