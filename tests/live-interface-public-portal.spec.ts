import { expect, test } from "@playwright/test";
import { assertLiveFits, liveFixture } from "./helpers/liveInterface";

test("anonymous live scoped private portal exposes only its permitted synthetic board without downloads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const portal = liveFixture().partyPortal;
  await page.goto(`/portal/${portal.token}`);
  await expect(page.getByRole("heading", { name: portal.societyName, exact: true })).toBeVisible();
  await expect(page.getByText(portal.label, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Board of directors", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic Portal Director", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^(?:Documents|Publications)$/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  await expect(page.getByText("Riverside Community Society", { exact: true })).toHaveCount(0);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await assertLiveFits(page);
  expect(errors).toEqual([]);
});
