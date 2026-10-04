import { test, expect, type Page } from "@playwright/test";
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await request.post("/__fixture/reset");
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("Ready");
  // Warm the shell request under SW control before a true offline restart.
  await page.reload();
  await expect(page.locator("#status")).toContainText("Ready");
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function save(page: Page, title: string, content = "Company name, address and incorporators") {
  await page.getByLabel("Draft title").fill(title);
  await page.getByLabel("Draft information").fill(content);
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(page.locator("#drafts")).toContainText(title);
}
test("offline create and edit survive restart then upload through actual Convex mutation", async ({ page, context, request }) => {
  await context.setOffline(true);
  await save(page, "Incorporation preparation");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await save(page, "Revised incorporation preparation", "Updated registered address");
  await expect(page.locator("#queue")).toHaveText("2 pending operations");
  await page.reload();
  await expect(page.locator("#status")).toContainText("Ready · offline");
  await expect(page.locator("#drafts")).toContainText("Updated registered address");
  await expect(page.locator("#queue")).toHaveText("2 pending operations");
  await context.setOffline(false);
  await page.getByRole("button", { name: "Upload pending drafts" }).click();
  await expect(page.locator("#queue")).toHaveText("0 pending operations");
  const rows = await (await request.get("/__fixture/list?subject=owner-a")).json();
  expect(rows).toHaveLength(1); expect(rows[0].revision).toBe(2);
  expect(rows[0].content).toBe("Updated registered address");
});
test("lost acknowledgement retains queue and retry creates no duplicate", async ({ page, request }) => {
  await save(page, "Retry-safe draft");
  await request.post("/__fixture/lose-ack", { data: { subject: "owner-a" } });
  await page.getByRole("button", { name: "Upload pending drafts" }).click();
  await expect(page.getByRole("alert")).toContainText("lost acknowledgement");
  await expect(page.locator("#queue")).toHaveText("1 pending operations");
  await page.reload(); await expect(page.locator("#status")).toContainText("Ready");
  await page.getByRole("button", { name: "Retry pending upload" }).click();
  await expect(page.locator("#queue")).toHaveText("0 pending operations");
  const rows = await (await request.get("/__fixture/list?subject=owner-a")).json();
  expect(rows).toHaveLength(1); expect(rows[0].revision).toBe(1);
});
test("changed role rejects upload and preserves offline work through restart", async ({ page, request }) => {
  await save(page, "Draft before role change");
  await request.post("/__fixture/role", { data: { subject: "owner-a", role: "Member" } });
  await page.getByRole("button", { name: "Upload pending drafts" }).click();
  await expect(page.getByRole("alert")).toContainText("documents:write");
  await expect(page.locator("#queue")).toHaveText("1 pending operations");
  await page.reload(); await expect(page.locator("#drafts")).toContainText("Draft before role change");
  await expect(page.locator("#queue")).toHaveText("1 pending operations");
  expect(await (await request.get("/__fixture/list?subject=owner-a")).json()).toHaveLength(0);
});
test("actor and workspace switches isolate local rows and pending queues", async ({ page }) => {
  await save(page, "Private workspace A draft");
  await page.getByLabel("Evaluation account").selectOption("viewer-a");
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#drafts")).not.toContainText("Private workspace A draft");
  await expect(page.getByRole("button", { name: "Save on this device" })).toBeDisabled();
  await page.getByLabel("Evaluation account").selectOption("owner-b");
  await expect(page.getByRole("button", { name: "Save on this device" })).toBeEnabled();
  await expect(page.locator("#queue")).toHaveText("0 pending operations");
  await save(page, "Private workspace B draft");
  await page.getByLabel("Evaluation account").selectOption("owner-a");
  await expect(page.locator("#drafts")).toContainText("Private workspace A draft");
  await expect(page.locator("#drafts")).not.toContainText("Private workspace B draft");
  await expect(page.locator("#queue")).toHaveText("1 pending operations");
});
test("mobile and desktop controls contain long draft information", async ({ page }) => {
  await save(page, "X".repeat(190), "Y".repeat(300));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
});
test("conflicting server edit remains intact and rejected local edit stays recoverable", async ({ page, request }) => {
  await save(page, "Original draft");
  await page.getByRole("button", { name: "Upload pending drafts" }).click();
  await expect(page.locator("#queue")).toHaveText("0 pending operations");
  const [row] = await (await request.get("/__fixture/list?subject=owner-a")).json();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await save(page, "Local changed draft", "Offline changes to retain");
  const remote = await request.post("/__fixture/upload", { data: { subject: "owner-a", batch: {
    societyId: row.societyId, batchId: "other-client-edit", operations: [{ id: row.uuid, baseRevision: 1, title: "Server changed draft", content: "Other client changes" }],
  } } });
  expect(remote.ok()).toBe(true);
  await page.getByRole("button", { name: "Upload pending drafts" }).click();
  await expect(page.getByRole("alert")).toContainText("REVISION_CONFLICT");
  await expect(page.locator("#queue")).toHaveText("1 pending operations");
  await page.reload(); await expect(page.locator("#drafts")).toContainText("Offline changes to retain");
  const rows = await (await request.get("/__fixture/list?subject=owner-a")).json();
  expect(rows[0].title).toBe("Server changed draft"); expect(rows[0].revision).toBe(2);
});
test("session switch during upload leaves original acknowledgement available for replay", async ({ page, request }) => {
  await save(page, "Draft with delayed acknowledgement");
  let release!: () => void;
  let committed!: () => void;
  let fulfilled!: () => void;
  const waitForCommit = new Promise<void>(resolve => { committed = resolve; });
  const waitForFulfilment = new Promise<void>(resolve => { fulfilled = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/__fixture/upload", async route => {
    const response = await route.fetch(); committed(); await held; await route.fulfill({ response }); fulfilled();
  });
  await page.getByRole("button", { name: "Upload pending drafts" }).click();
  await waitForCommit;
  await page.getByLabel("Evaluation account").selectOption("owner-b");
  await expect(page.locator("#queue")).toHaveText("0 pending operations");
  release(); await waitForFulfilment; await page.unroute("**/__fixture/upload");
  await page.getByLabel("Evaluation account").selectOption("owner-a");
  await expect(page.locator("#queue")).toHaveText("1 pending operations");
  await page.getByRole("button", { name: "Retry pending upload" }).click();
  await expect(page.locator("#queue")).toHaveText("0 pending operations");
  const rows = await (await request.get("/__fixture/list?subject=owner-a")).json();
  expect(rows).toHaveLength(1); expect(rows[0].revision).toBe(1);
});
