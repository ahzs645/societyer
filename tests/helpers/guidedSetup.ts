import { expect, type Page } from "@playwright/test";

export type GuidedSetupAct = {
  /** "federal", or the province/territory name as listed ("British Columbia"). */
  jurisdiction: "federal" | string;
  /** Start of the Act's name as listed ("Societies Act", "Canada Business Corporations Act"). */
  act: string | RegExp;
  /** Entity kind label, when the Act allows several ("Business corporation"). */
  entityKind?: string;
  /** The Act's name, for "Another Act". */
  otherActName?: string;
};

export const BC_SOCIETY_ACT: GuidedSetupAct = { jurisdiction: "British Columbia", act: "Societies Act" };

/** Answer the starting-point, jurisdiction and governing-Act questions, ending on "Name and basics". */
export async function chooseGuidedSetupAct(page: Page, existing: boolean, choice: GuidedSetupAct = BC_SOCIETY_ACT) {
  await page.getByRole("button", { name: existing ? "Yes, set up an existing organization" : "No, prepare a new incorporation", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  if (choice.jurisdiction === "federal") {
    await page.getByRole("button", { name: /^Federally \(Canada-wide\)/ }).click();
  } else {
    await page.getByRole("button", { name: /^Provincially or territorially/ }).click();
    await page.getByLabel("Province or territory", { exact: true }).click();
    await page.getByRole("option", { name: new RegExp(`^${choice.jurisdiction}`) }).first().click();
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const act = typeof choice.act === "string" ? new RegExp(`^${choice.act.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) : choice.act;
  await page.getByRole("radio", { name: act }).first().check();
  if (choice.otherActName) await page.getByRole("textbox", { name: "Name of the Act", exact: true }).fill(choice.otherActName);
  if (choice.entityKind) await page.getByRole("radio", { name: new RegExp(`^${choice.entityKind}`) }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Name and basics", exact: true })).toBeVisible();
}

/** Follow the public setup flow; no seed shortcut or mocked create mutation. */
export async function completeGuidedOrganizationSetup(page: Page, name: string, existing = false, choice: GuidedSetupAct = BC_SOCIETY_ACT) {
  await chooseGuidedSetupAct(page, existing, choice);
  await page.getByRole("textbox", { name: existing ? "Recorded legal name" : "Proposed name / working name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and create", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await page.waitForURL(/\/app\/organization-setup\?welcome=1/);
}
