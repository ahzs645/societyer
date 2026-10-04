import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { assertLiveFits } from "../../../tests/helpers/liveInterface";

test("Confirmed Member submits a nomination and a single anonymous ballot", async ({ page }, testInfo) => {
  const fixture = JSON.parse(readFileSync("experiments/live-qualification/.env.election-browser.local", "utf8"));
  const election = fixture.rows[testInfo.project.name];
  expect(election, "Dedicated unvoted election for this viewport").toBeTruthy();
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(fixture.account.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("societyer.currentSocietyId"))).toBe(fixture.societyId);
  expect(await page.evaluate(() => {
    const runtime = localStorage.getItem("societyer:app-runtime");
    return runtime ? JSON.parse(runtime).mode : null;
  })).not.toBe("local");
  await page.goto(`/app/elections/${election.electionId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: `Eligible member ${testInfo.project.name} qualification`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit anonymous ballot", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Close election", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish results", exact: true })).toHaveCount(0);
  await assertLiveFits(page);

  const nominee = `Browser candidate ${testInfo.project.name}`;
  await page.getByLabel("Nominee name", { exact: true }).fill(nominee);
  await page.getByRole("button", { name: "Submit nomination", exact: true }).click();
  await expect(page.getByText(nominee, { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Candidate Alpha", exact: true }).check();
  await page.getByRole("button", { name: "Submit anonymous ballot", exact: true }).click();
  await expect(page.getByText("You can review the ballot, but your vote is already recorded.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit anonymous ballot", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Candidate Alpha", exact: true })).toBeDisabled();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("You can review the ballot, but your vote is already recorded.", { exact: true })).toBeVisible();
  await expect(page.getByText(nominee, { exact: true })).toBeVisible();
  await assertLiveFits(page);
  expect(pageErrors).toEqual([]);
  expect(page.url()).not.toContain("/demo/");
  await page.screenshot({ path: `artifacts/offline/live-eligible-member-${testInfo.project.name}.png`, fullPage: true });
});
