import { expect, type Page } from "@playwright/test";

/** Follow the public setup flow; no seed shortcut or mocked create mutation. */
export async function completeGuidedOrganizationSetup(page: Page, name: string, existing = false) {
  await page.getByRole("button", { name: existing ? "Yes, set up an existing organization" : "No, prepare a new incorporation", exact: true }).click();
  await page.getByLabel(existing ? "Act the organization was formed under" : "Act you plan to incorporate under", { exact: true }).click();
  await page.getByRole("option", { name: /^BC society \(nonprofit\)/ }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("textbox", { name: existing ? "Recorded legal name" : "Proposed name / working name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\?welcome=/);
}
