import { expect, test, type Page } from "@playwright/test";

/**
 * Governance retest: committee quorum and structured cadence entered from the
 * interface and tracked on Coverage & gaps, the board quorum rule kept across
 * bylaw rule versions, and recording an AGM that was already held. Synthetic
 * data in the local demo workspace.
 */

async function pickOption(page: Page, trigger: ReturnType<Page["locator"]>, name: string | RegExp) {
  await trigger.click();
  await page.getByRole("option", { name, exact: typeof name === "string" }).first().click();
}

test("a committee's quorum rule and cadence are saved, shown and tracked", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = `Fixture Operations ${Date.now().toString(36)}`;
  await page.goto("/app/committees");
  await page.getByRole("button", { name: /New committee/ }).first().click();
  const create = page.getByRole("dialog");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create).toContainText("Give the committee a name");
  await create.getByLabel(/^Name/).fill(name);
  await create.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/app\/committees\/[^/]+$/);

  const card = page.locator(".card").filter({ has: page.getByRole("heading", { name: "Body, cadence and mandate" }) });
  await card.getByRole("button", { name: "Edit" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel(/Use a structured cadence/).check();
  await pickOption(page, page.locator("#committee-cadence-frequency"), "Monthly");
  await pickOption(page, page.locator("#committee-quorum-type"), "Fixed number present");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(drawer).toContainText("Enter how many people must be present");
  await pickOption(page, page.locator("#committee-quorum-type"), "Majority (more than half)");
  await page.locator("#committee-quorum-minimum").fill("3");
  await page.locator("#committee-quorum-notes").fill("Terms of reference s. 4 (fixture)");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(card.getByTestId("committee-quorum-rule")).toContainText("Majority of committee members (at least 3)");
  await expect(card).toContainText("Monthly");
  await expect(card).not.toContainText("Cadence not set");

  await page.reload();
  await expect(page.getByTestId("committee-quorum-rule")).toContainText("Majority of committee members (at least 3)");

  await page.goto("/app/coverage?tab=expectations");
  const row = page.locator("tr", { hasText: `${name} meetings` });
  await expect(row).toContainText("Applies automatically");
  await expect(row).toContainText("Committee cadence");
  expect(errors).toEqual([]);
});

test("the board quorum rule is entered once and carried by the next bylaw version", async ({ page }) => {
  await page.goto("/app/bylaw-rules");
  const card = page.getByTestId("body-quorum-rules");
  await expect(card).toBeVisible();
  await pickOption(page, page.locator("#body-quorum-board-type"), "Majority (more than half)");
  await page.getByRole("button", { name: /Save new version/ }).first().click();
  const backdated = page.getByRole("dialog");
  if (await backdated.isVisible().catch(() => false)) await backdated.getByRole("button", { name: /Record historical version/ }).click();
  await expect(page.locator(".toast").filter({ hasText: /Bylaw rule set v\d+ saved/ })).toBeVisible();
  await page.reload();
  await expect(page.locator("#body-quorum-board-type")).toContainText("Majority");
  // Saving again without touching the card keeps the rule.
  await page.getByRole("button", { name: /Save new version/ }).first().click();
  const again = page.getByRole("dialog");
  if (await again.isVisible().catch(() => false)) await again.getByRole("button", { name: /Record historical version/ }).click();
  await page.reload();
  await expect(page.locator("#body-quorum-board-type")).toContainText("Majority");
});

test("an AGM that was already held is recorded as held, without a notice error", async ({ page }) => {
  await page.goto("/app/meetings");
  await page.getByRole("button", { name: "New meeting" }).first().click();
  const modal = page.getByRole("dialog");
  await page.getByLabel("Meeting body").click();
  await page.getByRole("option", { name: /Annual general meeting \(AGM\)/ }).first().click();
  const title = `Fixture held AGM ${Date.now().toString(36)}`;
  await modal.getByLabel("Title").first().fill(title);
  await modal.getByLabel("Scheduled").click();
  const calendar = page.locator(".calendar--with-time").last();
  for (let i = 0; i < 3; i += 1) await calendar.getByRole("button", { name: "Previous month" }).click();
  await calendar.locator(".calendar__cell:not(.is-out)", { hasText: /^15$/ }).first().click();
  await calendar.getByRole("button").last().click();
  await expect(modal).toContainText("recorded as already held");
  await page.getByRole("button", { name: "Schedule", exact: true }).last().click();
  await expect(page.locator(".toast").filter({ hasText: "Held meeting recorded" })).toBeVisible();
  await page.waitForURL(/\/app\/meetings\/[^/]+$/);
  await expect(page.locator("#main-content")).toContainText(/Held/);
});
