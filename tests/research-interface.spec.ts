import { test, expect } from "@playwright/test";

test("research reference preserves form classification and unresolved questions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo/app/research-library", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Research library", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordinary society constitution", exact: true })).toBeVisible();
  await expect(page.getByText("28 of 28 records", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("WORK01SOC");
  await expect(page.getByText(/records$/).filter({ hasText: /of 28 records/ })).toBeVisible();
  await page.getByRole("searchbox").clear();
  await page.getByRole("button", { name: "Collection", exact: true }).click();
  await page.getByRole("option", { name: "Questions to confirm" }).click();
  await expect(page.getByText("42 of 42 records", { exact: true })).toBeVisible();
  await expect(page.getByText("Authorized registry filer / portal reviewer", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("decision preview requires evidence and distinguishes written ordinary from special", async ({ page }) => {
  await page.goto("/demo/app/bylaw-rules", { waitUntil: "networkidle" });
  const assessment = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Decision threshold preview" }) });
  await expect(assessment).toBeVisible();
  await expect(assessment.getByText("Needs evidence / review", { exact: true })).toBeVisible();
  await assessment.getByRole("spinbutton", { name: "Votes for / signed consent" }).fill("2");
  await assessment.getByRole("spinbutton", { name: "Votes against" }).fill("1");
  await assessment.getByRole("spinbutton", { name: "All eligible votes" }).fill("3");
  await assessment.getByRole("textbox", { name: "Articles / bylaws and electorate evidence" }).fill("Adopted bylaws and current legal member register");
  await assessment.getByRole("button", { name: "Decision mode", exact: true }).click();
  await page.getByRole("option", { name: "Written resolution" }).click();
  await assessment.getByRole("checkbox", { name: "Distribution to every eligible voter is evidenced" }).check();
  await expect(assessment.getByText("Threshold met", { exact: true })).toBeVisible();
  await assessment.getByRole("button", { name: "Resolution", exact: true }).click();
  await page.getByRole("option", { name: "Special", exact: true }).click();
  await expect(assessment.getByText("Threshold not met", { exact: true })).toBeVisible();
});
