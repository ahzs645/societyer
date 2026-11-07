import { expect, test } from "@playwright/test";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

test("choose, save, reload and clear a primary sector while preserving the detailed code", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
  await completeGuidedOrganizationSetup(page, `NAICS fixture ${info.project.name}`);
  await page.goto("/app/society");
  const card = page.getByRole("region", { name: "Industry sector", exact: true });
  await expect(card.getByText("No sector selected", { exact: true })).toBeVisible();
  await card.getByText("Already have a NAICS code?", { exact: true }).click();
  await card.getByRole("textbox", { name: "NAICS code", exact: true }).fill("541514");
  await card.getByRole("button", { name: "Choose a sector", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "Choose your industry sector", exact: true });
  await expect(chooser.getByRole("radio")).toHaveCount(20);
  await expect(chooser.getByRole("button", { name: "Use this sector", exact: true })).toBeDisabled();
  await chooser.getByRole("button", { name: "Help me choose", exact: true }).click();
  await chooser.getByRole("radio", { name: "Education, health or social support", exact: true }).check();
  await expect(chooser.getByRole("group", { name: "Choose a primary sector", exact: true }).getByRole("radio")).toHaveCount(2);
  await chooser.getByRole("button", { name: "Show all sectors", exact: true }).click();
  await chooser.getByRole("searchbox", { name: "Search sectors", exact: true }).fill("zzzzunknown");
  await expect(chooser.getByText("No sectors match this search.", { exact: true })).toBeVisible();
  await chooser.getByRole("searchbox", { name: "Search sectors", exact: true }).fill("software");
  await chooser.getByRole("radio", { name: /^54 Professional, scientific and technical services/ }).check();
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  await page.screenshot({ path: info.outputPath("sector-chooser.png"), fullPage: true });
  await chooser.getByRole("button", { name: "Use this sector", exact: true }).click();
  await expect(card.getByText("Professional, scientific and technical services", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Organization profile saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText("Professional, scientific and technical services", { exact: true })).toBeVisible();
  await expect(card.getByRole("textbox", { name: "NAICS code", exact: true })).toHaveValue("541514");
  await expect(card.getByText(/NAICS Canada 2022 Version 1.0 · Sector 54/)).toBeVisible();

  // Cancelling a different selection must leave the saved sector alone.
  await card.getByRole("button", { name: "Change sector", exact: true }).click();
  await chooser.getByRole("searchbox", { name: "Search sectors", exact: true }).fill("restaurant");
  await chooser.getByRole("radio", { name: /^72 Accommodation and food services/ }).check();
  await chooser.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(card.getByText("Professional, scientific and technical services", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Clear sector", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Organization profile saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText("No sector selected", { exact: true })).toBeVisible();
  await expect(card.getByRole("textbox", { name: "NAICS code", exact: true })).toHaveValue("541514");
  expect(errors).toEqual([]);
});
