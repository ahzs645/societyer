import { expect, test, type Page } from "@playwright/test";
import { chooseGuidedSetupAct } from "./helpers/guidedSetup";

test.setTimeout(180_000);

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: "Something went wrong.", exact: true })).toHaveCount(0);
}

/** A new federal (CBCA) corporation that is still preparing to incorporate, created through the public setup flow. */
async function createPreparingCbca(page: Page, name: string) {
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
  await chooseGuidedSetupAct(page, false, { jurisdiction: "federal", act: "Canada Business Corporations Act" });
  await page.getByRole("textbox", { name: "Proposed name / working name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  // The post-creation landing moves to the setup view; either landing is fine here.
  await page.waitForURL(/\/app(\/organization-setup)?\?welcome=/);
  await page.goto("/app/organization-setup?welcome=1");
}

test("setup view renders for the demo workspace with phases, the next step and setup-aware links", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/organization-setup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: /^Set up / })).toBeVisible();
  const phases = page.getByRole("navigation", { name: "Setup phases", exact: true });
  await expect(phases.getByRole("button")).toHaveCount(4);
  await expect(page.getByText(/^\d+ of \d+ done$/)).toBeVisible();
  await expect(page.locator(".setup-next")).toBeVisible();
  // Every step link carries ?setup=<key> so the destination can offer "Back to setup".
  const links = page.locator(".setup-layout a[href*='/app/']");
  const count = await links.count();
  for (let index = 0; index < count; index += 1) {
    await expect(links.nth(index)).toHaveAttribute("href", /[?&]setup=[a-z-]+/);
  }
  await fits(page);
  // "Back to setup" lands on #step-<key>: that step opens (and its phase with it).
  await page.goto("/demo/app/organization-setup#step-office", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#step-office .setup-step__toggle")).toHaveAttribute("aria-expanded", "true");
  expect(errors).toEqual([]);
});

test("a preparing CBCA corporation sees its phases, can skip and undo a step, and mark the filing done and undo it", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const name = `Setup View Robotics ${testInfo.project.name} Inc.`;
  await createPreparingCbca(page, name);

  await expect(page.getByRole("heading", { level: 1, name: `Set up ${name}` })).toBeVisible();
  await expect(page.getByText("Your workspace is ready. Here's what to do next.")).toBeVisible();
  const phases = page.getByRole("navigation", { name: "Setup phases", exact: true });
  await expect(phases.getByRole("button", { name: /Get ready to file/ })).toBeVisible();
  await expect(phases.getByRole("button", { name: /File with Corporations Canada/ })).toBeVisible();
  await expect(phases.getByRole("button", { name: /After your certificate arrives/ })).toBeVisible();
  await expect(phases.getByRole("button", { name: /Keep it in good standing/ })).toBeVisible();

  // Next step: the registered office (nothing in setup needs an incorporation number yet).
  const next = page.locator(".setup-next");
  await expect(next.getByRole("heading", { name: "Add the registered office address" })).toBeVisible();
  await expect(next.getByRole("link", { name: /Add the address/ })).toHaveAttribute("href", /\/app\/society\?setup=office#registered-office$/);
  await fits(page);

  // "Doesn't apply to us" needs a reason, stays listed (crossed out) and can be undone.
  const isc = page.locator("#step-isc");
  await isc.getByRole("button", { name: "More options for List people with significant control" }).click();
  await page.getByRole("menuitem", { name: "Doesn't apply to us…" }).click();
  const sheet = page.getByRole("dialog", { name: "Doesn't apply to us" });
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet.getByText("Choose a reason.")).toBeVisible();
  await sheet.getByRole("radio", { name: "No one owns 25% or more" }).check();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(isc.locator(".setup-step__state")).toHaveText("Doesn't apply");
  await expect(isc.getByText("No one owns 25% or more", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(isc.locator(".setup-step__state")).toHaveText("To do");

  // "I've filed it" (date defaults to today, reference optional), then undo.
  await phases.getByRole("button", { name: /File with Corporations Canada/ }).click();
  const file = page.locator("#step-file");
  await file.locator(".setup-step__toggle").click();
  await expect(file.getByRole("link", { name: /Open Corporations Canada/ })).toHaveAttribute("target", "_blank");
  await file.getByText(/What you'll need/).click();
  await file.getByRole("button", { name: "I've filed it", exact: true }).click();
  const filed = page.getByRole("dialog", { name: "I've filed it" });
  await filed.getByRole("button", { name: "Mark as filed", exact: true }).click();
  await expect(filed).toHaveCount(0);
  await expect(page.locator("#phase-file").getByText("Waiting for Corporations Canada", { exact: true })).toBeVisible();
  await expect(page.locator(".setup-next").getByRole("heading", { name: "Record your certificate of incorporation" })).toBeVisible();
  await fits(page);
  await file.getByRole("button", { name: "Undo — I haven't filed yet", exact: true }).click();
  await expect(page.getByText("Waiting for Corporations Canada")).toHaveCount(0);
  await expect(file.getByRole("button", { name: "I've filed it", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
