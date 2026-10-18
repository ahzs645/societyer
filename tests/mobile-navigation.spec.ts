import { expect, test } from "@playwright/test";

const PHONE = { width: 390, height: 844 };

test.describe("mobile navigation accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/demo", { waitUntil: "networkidle" });
  });

  test("uses the bottom bar as the only closed-drawer navigation trigger", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("removes background navigation from focus while the drawer is open", async ({ page }) => {
    const bottomNav = page.locator(".bottom-nav");
    await bottomNav.getByRole("button", { name: "More", exact: true }).click();

    // Phones open the navigation as a modal bottom sheet (named by the
    // workspace) over a scrim; Escape or a tap on the scrim closes it.
    const sheet = page.locator(".sidebar[role='dialog']");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".sidebar-backdrop--sheet")).toHaveClass(/is-open/);
    await expect(page.getByRole("main")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip to main content" })).toHaveCount(0);
    await expect(bottomNav).toHaveAttribute("aria-hidden", "true");
    await expect(bottomNav.locator("a, button")).toHaveCount(5);

    for (const control of await bottomNav.locator("a, button").all()) {
      await expect(control).toHaveAttribute("tabindex", "-1");
    }

    await page.keyboard.press("Escape");
    await expect(page.locator(".sidebar[role='dialog']")).toHaveCount(0);
    await expect(page.locator(".sidebar-backdrop--sheet")).not.toHaveClass(/is-open/);
    await expect(bottomNav).not.toHaveAttribute("aria-hidden", "true");
  });

  test("isolates full-screen inspector forms from the page behind them", async ({ page }) => {
    await page.goto("/demo/app/members", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New member", exact: true }).click();

    await expect(page.getByRole("dialog", { name: "Add member" })).toBeVisible();
    await expect(page.locator(".workbench__content")).toHaveAttribute("inert", "");
    await expect(page.locator(".workbench__content")).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(".bottom-nav")).toHaveAttribute("aria-hidden", "true");

    await page.getByRole("button", { name: "Close drawer" }).click();
    await expect(page.getByRole("dialog", { name: "Add member" })).toHaveCount(0);
    await expect(page.locator(".workbench__content")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".workbench__content")).not.toHaveAttribute("aria-hidden", "true");
  });
});
