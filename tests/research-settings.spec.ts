import { expect, test } from "@playwright/test";

test("storage policy persists while planned providers stay blocked and app identity stays separate", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const choose = async (label: string, option: string) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  const openRuntime = async () => {
    await page.goto("/demo/app/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Runtime", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Document storage & custody" })).toBeVisible();
  };
  await openRuntime();
  await choose("Preferred document provider", "Microsoft SharePoint — planned");
  await choose("Graph authorization mode", "App-only — administrator-approved service");
  await page.getByLabel("Microsoft tenant ID", { exact: true }).fill("tenant-policy-test");
  await page.getByLabel("Selected SharePoint site ID", { exact: true }).fill("site-policy-test");
  await page.getByLabel("Document library / drive ID", { exact: true }).fill("library-policy-test");
  await page.getByLabel("Permission evidence reference", { exact: true }).fill("Audit document 45");
  await choose("Graph permission consent evidence", "Administrator evidence recorded");
  await choose("Selected-resource grant evidence", "Administrator evidence recorded");
  await page.getByLabel("Offboarding and retention plan", { exact: true }).fill("Export originals and immutable versions before revocation");
  await page.getByRole("button", { name: "Save storage policy", exact: true }).click();
  await expect(page.getByText("Document storage policy saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Storage readiness: blocked" })).toContainText("Graph access token has not been checked");
  await expect(page.getByRole("heading", { name: "Authentication & session" })).toBeVisible();
  await expect(page.getByText("Current broker: No sign-in (trusted workspace)", { exact: true })).toBeVisible();

  await openRuntime();
  await expect(page.getByLabel("Microsoft tenant ID", { exact: true })).toHaveValue("tenant-policy-test");
  await expect(page.getByLabel("Offboarding and retention plan", { exact: true })).toHaveValue("Export originals and immutable versions before revocation");
  await expect(page.getByRole("status").filter({ hasText: "Storage readiness: blocked" })).toContainText("SharePoint deployment integration is not configured");
  await choose("Preferred document provider", "Cloudflare R2");
  await page.getByRole("switch", { name: /^Require verified Canadian storage residency/ }).click();
  await expect(page.getByText(/Cloudflare R2's documented location controls/)).toBeVisible();
  await expect(page.getByText("Adapter available; deployment verification required.", { exact: true })).toBeVisible();
  await page.getByText("Storage cost forecast", { exact: true }).click();
  await page.getByLabel("Monthly Class A operations", { exact: true }).fill("1000001");
  await expect(page.getByText("Estimated monthly total: $9.00 USD", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
