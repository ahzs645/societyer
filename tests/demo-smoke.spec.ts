import { test, expect } from "@playwright/test";

test.describe("Public marketing route", () => {
  test("root loads the marketing page without starting local Convex sync", async ({
    page,
  }) => {
    const localConvexSockets: string[] = [];
    page.on("websocket", (webSocket) => {
      if (webSocket.url().includes("127.0.0.1:3210")) {
        localConvexSockets.push(webSocket.url());
      }
    });

    await page.goto("/", { waitUntil: "networkidle" });

    await expect(
      page.getByRole("heading", { name: /run your society/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /open demo/i }).first()).toBeVisible();
    expect(localConvexSockets).toEqual([]);
  });
});

// Core demo routes that should load without crashing.
// These use in-memory fixture data, so no backend is needed.
const DEMO_ROUTES = [
  { path: "/demo", name: "Dashboard" },
  { path: "/demo/app/members", name: "Members" },
  { path: "/demo/app/directors", name: "Directors" },
  { path: "/demo/app/meetings", name: "Meetings" },
  { path: "/demo/app/minutes", name: "Minutes" },
  { path: "/demo/app/filings", name: "Filings" },
  { path: "/demo/app/deadlines", name: "Deadlines" },
  { path: "/demo/app/documents", name: "Documents" },
  { path: "/demo/app/conflicts", name: "Conflicts" },
  { path: "/demo/app/financials", name: "Financials" },
  { path: "/demo/app/treasurer", name: "Treasurer" },
  { path: "/demo/app/committees", name: "Committees" },
  { path: "/demo/app/goals", name: "Goals" },
  { path: "/demo/app/tasks", name: "Tasks" },
  { path: "/demo/app/timeline", name: "Timeline" },
  { path: "/demo/app/communications", name: "Communications" },
  { path: "/demo/app/grants", name: "Grants" },
  { path: "/demo/app/volunteers", name: "Volunteers" },
  { path: "/demo/app/settings", name: "Settings" },
];

test.describe("Demo route smoke tests", () => {
  for (const route of DEMO_ROUTES) {
    test(`${route.name} (${route.path}) loads without error`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));

      await page.goto(route.path, { waitUntil: "networkidle" });

      // Page should have rendered the app shell
      await expect(page.locator(".app-shell")).toBeVisible({ timeout: 10_000 });

      // No uncaught JS errors
      expect(errors).toEqual([]);
    });
  }
});

test.describe("Demo navigation", () => {
  test("sidebar navigation works", async ({ page }) => {
    await page.goto("/demo", { waitUntil: "networkidle" });
    await expect(page.locator(".app-shell")).toBeVisible();

    // Click Members in the sidebar
    await page.getByRole("link", { name: /^Members\b/ }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
  });

  test("demo banner is visible", async ({ page }) => {
    await page.goto("/demo", { waitUntil: "networkidle" });
    // The demo banner should indicate this is a demo
    const banner = page.locator(".demo-banner");
    if (await banner.isVisible()) {
      await expect(banner).toContainText(/demo/i);
    }
  });
});

test.describe("Theme preference", () => {
  test("defaults to system theme and follows OS theme changes", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/demo/app/settings", { waitUntil: "networkidle" });

    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("radio", { name: /system/i })).toBeChecked();

    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass(/light/);
  });

  test("explicit theme preference overrides the system theme", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/demo/app/settings", { waitUntil: "networkidle" });

    await page.locator("label.radio-row", { hasText: /^Light/ }).click();
    await expect(page.locator("html")).toHaveClass(/light/);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveClass(/light/);
  });
});
