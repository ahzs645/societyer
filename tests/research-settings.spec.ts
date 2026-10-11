import { completeGuidedOrganizationSetup } from "./helpers/guidedSetup";
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
  // Verify durable bytes, not just the optimistic form/toast. Startup seed
  // backfill previously overwrote this row even after a successful save.
  const persistedPolicies = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const rows = await Promise.all(databases.filter((entry) => entry.name?.startsWith("societyer-local-")).map((entry) => new Promise<any[]>((resolve, reject) => {
      const open = indexedDB.open(entry.name!);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const read = database.transaction("records").objectStore("records").getAll();
        read.onerror = () => { database.close(); reject(read.error); };
        read.onsuccess = () => { database.close(); resolve(read.result.filter((record: any) => record.table === "societies").map((record: any) => record.value.integrationSettings)); };
      };
    })));
    return rows.flat().filter(Boolean);
  });
  expect(persistedPolicies).toContainEqual(expect.objectContaining({ preferredProvider: "sharepoint", tenantId: "tenant-policy-test" }));
  await expect(page.getByRole("status").filter({ hasText: "Storage readiness: blocked" })).toContainText("Graph access token has not been checked");
  await expect(page.getByRole("heading", { name: "Authentication & session" })).toBeVisible();
  await expect(page.getByText("Current broker: No sign-in (trusted workspace)", { exact: true })).toBeVisible();

  await openRuntime();
  await expect(page.getByLabel("Microsoft tenant ID", { exact: true })).toHaveValue("tenant-policy-test");
  await expect(page.getByLabel("Offboarding and retention plan", { exact: true })).toHaveValue("Export originals and immutable versions before revocation");
  await expect(page.getByRole("status").filter({ hasText: "Storage readiness: blocked" })).toContainText("SharePoint deployment integration is not configured");
  await choose("Preferred document provider", "Cloudflare R2");
  await page.getByText("Require verified Canadian storage residency", { exact: true }).click();
  await expect(page.getByRole("switch", { name: /^Require verified Canadian storage residency/ })).toBeChecked();
  await expect(page.getByText(/Cloudflare R2's documented location controls/)).toBeVisible();
  await expect(page.getByText("Adapter available; deployment verification required.", { exact: true })).toBeVisible();
  await page.getByText("Storage cost forecast", { exact: true }).click();
  await page.getByLabel("Monthly Class A operations", { exact: true }).fill("1000001");
  await expect(page.getByText("Estimated monthly total: $9.00 USD", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("low select triggers stay open through page scrolling and support keyboard selection", async ({ page }) => {
  await page.goto("/demo/app/settings?tab=runtime", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Preferred document provider", { exact: true }).click();
  await page.getByRole("option", { name: "Microsoft SharePoint — planned", exact: true }).click();
  const trigger = page.getByLabel("Graph authorization mode", { exact: true });
  // The browser scrolls this newly inserted lower field into view before the
  // click. Its queued scroll event must not immediately dismiss the menu.
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const appOnly = page.getByRole("option", { name: "App-only — administrator-approved service", exact: true });
  await expect(appOnly).toBeVisible();
  await page.locator(".page--wide").evaluate((element) => { element.scrollTop += 40; });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(appOnly).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText("App-only — administrator-approved service");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("local Owner can edit storage policy while acting Member remains restricted after reload", async ({ page }) => {
  await page.goto("/setup", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Start a new organization/i }).click();
  await page.waitForURL(/\/app\/society\/new/);
  await completeGuidedOrganizationSetup(page, "Storage Policy Society", true);
  await page.goto("/app/users", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Storage Policy Member");
  await page.getByLabel("Email", { exact: true }).fill("storage-policy-member@example.test");
  // The existing membership form defaults to an Active Member.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("User added", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "storage-policy-member@example.test" })).toBeVisible();
  await page.goto("/app/settings?tab=runtime", { waitUntil: "domcontentloaded" });
  const picker = page.getByTitle("Switch acting user", { exact: true });
  await expect(picker).toContainText("Owner");
  const provider = page.getByLabel("Preferred document provider", { exact: true });
  const save = page.getByRole("button", { name: "Save storage policy", exact: true });
  await expect(provider).toBeEnabled();
  await page.getByLabel("Custodian / administrator contact", { exact: true }).fill("Owner draft");
  await expect(save).toBeEnabled();

  await picker.click();
  await page.getByText("Storage Policy Member", { exact: true }).click();
  await expect(picker).toContainText("Storage Policy Member");
  await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
  await expect(provider).toHaveCount(0);
  await expect(save).toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(picker).toContainText("Storage Policy Member");
  await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
  await expect(provider).toHaveCount(0);
  await expect(save).toHaveCount(0);
  await picker.click();
  await page.getByRole("listbox", { name: "Acting user", exact: true }).getByRole("option").filter({ hasText: "Owner" }).click();
  await expect(picker).toContainText("Owner");
  await expect(provider).toBeEnabled();
  await page.getByLabel("Custodian / administrator contact", { exact: true }).fill("Owner after reload");
  await expect(save).toBeEnabled();
});
