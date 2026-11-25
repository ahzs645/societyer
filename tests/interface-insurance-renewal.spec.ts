import { expect, test } from "@playwright/test";
import { join } from "node:path";
import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";

const examples = join(process.cwd(), "docs/insurance/examples");
const name = "Juniper Hall Society";

test("imports two policy terms and compares the same register with a bid and rental", async ({ page }, info) => {
  test.setTimeout(240_000);
  const capture = async (step: string) => {
    await page.screenshot({ path: info.outputPath(step + ".png"), animations: "disabled" });
  };
  await page.goto("/setup");
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await completeGuidedOrganizationSetup(page, name, true);
  await page.goto("/app/insurance");
  const button = (label: string) => page.getByRole("button", { name: label, exact: true });
  const dialog = page.getByRole("dialog").last();
  await button("Import renewal ZIP").click();
  await expect(button("Choose ZIP")).toBeVisible();
  await capture("01-upload");
  const chooser = page.waitForEvent("filechooser");
  await button("Choose ZIP").click();
  await (await chooser).setFiles(join(examples, "example-renewal.zip"));
  await dialog.getByLabel("Package currency").fill("CAD");
  await dialog.getByRole("group", { name: "Previously reviewed policy fields" }).locator("input").setInputFiles(join(examples, "reviewed-fields.json"));
  await expect(dialog).toContainText("reviewed-fields.json");
  await capture("02-files");
  const declaration = button("Review Commercial general liability renewal.pdf");
  await declaration.click();
  await expect(dialog.getByLabel("Policy number")).toHaveValue("CGL-4100");
  await capture("03-declaration");
  await button("Coverage").click();
  await expect(dialog).toContainText("Coverage lines");
  await capture("04-coverage");
  await button("Back to files").click();
  await expect(declaration).toBeFocused();
  await button("Review Broker invoice.pdf").click();
  await expect(dialog.getByRole("checkbox", { name: /Link to CGL-4100/ })).toBeChecked();
  await capture("05-invoice");
  await button("Back to files").click();
  await button("Continue").click();
  await expect(dialog).toContainText("2 policy terms");
  await expect(button("Save reviewed renewal")).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await capture("06-confirm");
  await button("Save reviewed renewal").click();
  await expect(dialog).toContainText("2 policy terms and 3 original documents", { timeout: 45_000 });
  await capture("07-receipt");
  await button("Done").click();
  await expect(page.getByText("Example Mutual", { exact: true }).first()).toBeVisible();
  await capture("08-register");

  // Give the two source records their reviewed clauses. Both surfaces read the
  // same policy through their normal workspace-scoped local mutations and queries.
  const records = await page.evaluate(async (organizationName) => {
    const { localDataClient: client } = await import("/src/lib/localDataClient.ts" as string);
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts" as string);
    const { emptyClause } = await import("/shared/insuranceClauses.ts" as string);
    const societyId = getStoredSocietyId();
    const terms = await client.query("insurance:list", { societyId });
    const policy = terms.find((row: { policyNumber: string }) => row.policyNumber === "CGL-4100");
    await client.mutation("insurance:update", { id: policy._id, patch: { status: "Active" } });
    const rentalText = "Maintain CAD 1 million commercial general liability per occurrence for the rental.";
    const agreementId = await client.mutation("agreements:create", {
      societyId, title: "Community hall rental", kind: "lease", status: "active",
      parties: [{ name: "Example Municipality", role: "counterparty" }], summary: rentalText,
    });
    const limit = { ...emptyClause, kind: "limit", coverageCode: "CGL", limitBasis: "Each occurrence",
      currency: "CAD", namedInsured: organizationName, from: "2027-03-01", through: "2027-03-02" };
    await client.mutation("insurance:saveClause", {
      societyId, origin: "agreement", originKey: agreementId, source: { label: "Rental terms", reference: "Section 6", version: "rental-1" },
      clause: { ...limit, quote: rentalText, stage: "Before occupancy", minimumCents: 100000000 },
    });
    for (const clause of [
      { ...limit, quote: "Maintain CAD 3 million commercial general liability per occurrence.", minimumCents: 300000000 },
      { ...limit, kind: "certificate", quote: "Provide a certificate to the municipality at award.", beneficiary: "Example Municipality", stage: "Award" },
      { ...limit, kind: "wording", quote: "Maintain professional liability insurance.", coverageCode: "ProfessionalLiability" },
    ]) {
      await client.mutation("insurance:saveClause", { societyId, origin: "procurement", originKey: "hall-design",
        source: { label: "Published bid description", reference: "Notice description", version: "bid-1" }, clause });
    }
    return { agreementId, policyId: policy._id };
  }, name);
  await page.goto("/app/insurance/" + records.policyId);
  await expect(page.getByText("Coverage items", { exact: true }).first()).toBeVisible();
  await expect(button("Read coverage wording")).toBeVisible();
  await capture("09-policy");
  await page.goto("/tests/fixtures/insurance/opportunity.html?notice=hall-design");
  await button("Check against register").click();
  await expect(dialog).toContainText("Below required limit");
  await expect(dialog).toContainText("No matching coverage on file");
  await capture("10-bid");
  await page.goto("/app/agreements/" + records.agreementId);
  await button("Check against register").click();
  await expect(dialog).toContainText("Review policy evidence");
  await button("Confirm supporting evidence").click();
  await expect(dialog.getByLabel("Applicable policy line")).toBeVisible();
  await capture("11-rental");
});
