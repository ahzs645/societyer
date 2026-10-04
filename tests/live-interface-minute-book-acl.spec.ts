import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { assertLiveFits, signInLive } from "./helpers/liveInterface";

/** A fresh synthetic workspace keeps the private core record inside the actual
 * bounded binder preview. Preparation/cleanup use the isolated operator only;
 * both browser surfaces use real Better Auth cookies and production queries. */
test("native minute-book private core ACL reports unknown to Viewer and full coverage to Owner", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("tmp/live-minute-book-interface-fixture.json", "utf8"));
  for (const role of ["Viewer", "Owner"]) {
    const errors: string[] = [];
    const listener = (error: Error) => errors.push(error.message);
    page.on("pageerror", listener);
    await signInLive(page, role);
    await page.goto("/app/minute-book");
    if (page.viewportSize()!.width < 980) {
      await page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true }).click();
    }
    await page.locator(".sidebar__workspace").click();
    await page.getByRole("button", { name: /^Packet authorization qualification\b/ }).click();
    if (await page.getByRole("dialog", { name: "navigation", exact: true }).isVisible()) await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Minute book", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"))).toBe(fixture.societyId);
    await page.reload();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"))).toBe(fixture.societyId);
    await expect(page.getByRole("heading", { name: "Minute book", exact: true })).toBeVisible();
    const message = page.getByRole("status").filter({ hasText: "Some supporting documents are unavailable to your role. Document completeness is unknown." });
    if (role === "Viewer") {
      await expect(message).toBeVisible();
      const check = page.locator(".row").filter({ has: page.getByText("Core document completeness", { exact: true }) });
      await expect(check.getByText("Unknown", { exact: true })).toBeVisible();
      await expect(page.getByText("Missing constitution/bylaws/minutes", { exact: true })).toHaveCount(0);
      await expect(page.getByText(fixture.privateTitle, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Accessible completeness checks", exact: true })).toBeVisible();
    } else {
      await expect(page.getByText(fixture.privateTitle, { exact: true })).toBeVisible();
      await expect(message).toHaveCount(0);
      await expect(page.getByText("Core document completeness", { exact: true })).toHaveCount(0);
      const check = page.locator(".row").filter({ has: page.getByText("Missing constitution/bylaws/minutes", { exact: true }) });
      await expect(check).toBeVisible();
      await expect(check.locator(".muted")).not.toContainText(/constitution/i);
      await expect(page.getByRole("heading", { name: "Completeness checks", exact: true })).toBeVisible();
    }
    const auth = await page.context().request.get("/api/auth/token");
    expect(auth.ok()).toBe(true);
    const { token } = await auth.json();
    const client = new ConvexHttpClient("http://127.0.0.1:43230", { logger: false });
    client.setAuth(token);
    const overview: any = await client.query(makeFunctionReference("minuteBook:overview"), { societyId: fixture.societyId });
    const openChecks = overview.checks.filter((check: any) => check.status !== "unknown" && !check.ok).length;
    await expect(page.locator(".stat").filter({ has: page.getByText("Open checks", { exact: true }) }).locator(".stat__value")).toHaveText(String(openChecks));
    expect(overview.documentCoverageLimited).toBe(role === "Viewer");
    await assertLiveFits(page);
    expect(errors, `${role} native minute-book queries must remain authorized`).toEqual([]);
    page.off("pageerror", listener);
    // The next real sign-in should start from the baseline workspace, so its
    // membership/shell checks remain as strict as the existing main suite.
    await page.evaluate(() => localStorage.removeItem("societyer.currentSocietyId"));
    const logout = await page.context().request.post("/api/auth/sign-out", { data: {}, headers: { origin: new URL(page.url()).origin } });
    expect(logout.ok()).toBe(true);
  }
});
