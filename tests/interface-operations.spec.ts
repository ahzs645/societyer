import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function visit(page: Page, route: string) {
  await page.goto(`/demo/app/${route}`, { waitUntil: "networkidle" });
}

function input(page: Page, label: string) {
  return page.locator(".field").filter({ has: page.locator(".field__label").filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).first().locator("input,textarea").first();
}

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    await expect.poll(() => dialog.last().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1 && element.scrollWidth <= rect.width + 1;
    })).toBe(true);
  }
}

for (const width of [320, 390, 768, 1440]) {
  test(`finance actions, insurance form and report alternatives remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await visit(page, "treasurer");
    // A real click catches the formerly collapsed grid header: the date card
    // covered this button on phones even though the button itself was visible.
    await page.getByRole("button", { name: "Quick entry", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("posts a balanced entry");
    await fits(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "Funding source", exact: true }).click();
    await fits(page);
    await page.keyboard.press("Escape");

    await visit(page, "insurance");
    await page.getByRole("button", { name: "New policy", exact: true }).click();
    await expect(input(page, "Policy number")).toBeVisible();
    await input(page, "Insurer").fill("Operations audit insurer with a deliberately long descriptive name");
    await fits(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await visit(page, "financials/year-end");
    await page.getByRole("button", { name: "Restricted funds", exact: true }).click();
    await expect(page.getByRole("button", { name: "Export Word", exact: true })).toBeVisible();
    await fits(page);
    await page.getByRole("button", { name: "Organization revenue & expenses", exact: true }).click();
    await fits(page);
    await visit(page, "financials/fy/2025-2026");
    await page.getByRole("button", { name: /^Docs/ }).click();
    await expect(page.getByText("FY2025 financial statements", { exact: true }).first()).toBeVisible();
    await fits(page);
    expect(errors).toEqual([]);
  });
}

test("invalid dividend input stays editable, reports the problem, and a corrected declaration persists", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "dividends");
  await page.getByRole("button", { name: "New declaration", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter the share class, per-share amount and shares outstanding.")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await input(page, "Share class").fill("Operations audit common");
  await input(page, "Per-share amount (cents)").fill("25");
  await input(page, "Shares outstanding").fill("40");
  await input(page, "Currency").fill("Canadian dollars");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter a three-letter currency code, such as CAD or USD.")).toBeVisible();
  await input(page, "Currency").fill("cad");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("tr", { hasText: "Operations audit common" })).toContainText("$10.00");
  await page.reload();
  await expect(page.locator("tr", { hasText: "Operations audit common" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("stock intake updates the asset and the camera fallback resolves an existing tag", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "assets");
  await page.locator(".asset-mobile-card").filter({ hasText: /\bflats?\b/ }).first().getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Add stock", exact: true }).click();
  await input(page, "Amount being added").fill("2");
  await expect(input(page, "Resulting total")).toHaveValue("3");
  await page.getByRole("button", { name: "Update stock", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("3 flats", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await fits(page);
  const manualCode = page.getByRole("textbox", { name: "Asset tag or code", exact: true });
  await expect(manualCode).toHaveAttribute("aria-describedby", /.+/);
  await manualCode.fill("AST-0001");
  await manualCode.press("Enter");
  await expect(page).toHaveURL(/assets\/static_asset_projector/);
  await expect(page.getByRole("heading", { name: "Epson community projector", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Maintenance/ }).click();
  await fits(page);
  await visit(page, "assets");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Start verification", exact: true }).click();
  await input(page, "Run title").fill("Operations audit verification");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/assets\/verification\//);
  await expect(page.locator("tr", { hasText: "pending" })).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await page.locator("tr", { hasText: "pending" }).first().getByRole("button", { name: "Verified", exact: true }).click();
    await expect(page.locator("tr", { hasText: "pending" })).toHaveCount(2 - index);
  }
  await page.getByRole("button", { name: "Complete run", exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await visit(page, "assets/verification/missing-run");
  await expect(page.getByRole("heading", { name: "Physical inventory run not found" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete run", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("insurance policy save opens the corresponding detail without losing entered coverage", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "insurance");
  await page.getByRole("button", { name: "New policy", exact: true }).click();
  await input(page, "Insurer").fill("Operations Audit Mutual");
  await input(page, "Policy number").fill("OPS-AUDIT-001");
  await input(page, "Coverage").fill("100000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByText("Operations Audit Mutual", { exact: true }).first().click();
  await page.locator(".inspector-panel").getByRole("button", { name: /^Open/ }).click();
  await expect(page).toHaveURL(/insurance\//);
  await expect(page.getByText("Policy OPS-AUDIT-001", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("$100,000", { exact: true }).first()).toBeVisible();
  await fits(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Operations Audit Mutual", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("direct grant editing opens its fields, persists corrections and source alternatives stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "grants/static_grant/edit");
  await expect(page.getByRole("tab", { name: "Edit", exact: true })).toHaveAttribute("aria-selected", "true");
  await input(page, "Title").fill("Operations audit youth grant");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Operations audit youth grant", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
  for (const name of [/^Timeline/, /^Financials/, /^Source/]) {
    await page.getByRole("tab", { name }).click();
    await fits(page);
  }
  await visit(page, "grants/sources");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await fits(page);
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await visit(page, "grants/sources/bc-arts-council");
  await expect(page.getByRole("link", { name: "Official source", exact: true })).toHaveAttribute("href", /^https:\/\//);
  await expect(page.getByText("manual_mapping", { exact: true })).toBeVisible();
  await fits(page);
  await visit(page, "org-history?section=budgets");
  await page.getByRole("button", { name: /^Budgets/ }).click();
  await fits(page);
  await visit(page, "org-history/budgets/static_document_orghistory_budget_2025");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("FY2024-2025 approved budget");
  await fits(page);
  expect(errors).toEqual([]);
});

test("inventory creation and staged import parsing work without applying records", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "inventory");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Item", exact: true }).click();
  await input(page, "Name").fill("Operations audit supplies");
  await input(page, "SKU").fill("AUDIT-OPS-001");
  await fits(page);
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Operations audit supplies", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Locations & bins/ }).click();
  await fits(page);
  await page.getByRole("button", { name: /Lots & serials/ }).click();
  await fits(page);
  await visit(page, "imports");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New session", exact: true }).click();
  await input(page, "Session name").fill("Operations audit staged import");
  await input(page, "Import JSON").fill("{ invalid JSON");
  // Invalid JSON is caught by the live preview: the parse error shows, and
  // "Create session" explains why it cannot stage instead of creating anything.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".badge--danger").last()).toBeVisible();
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(dialog).toBeVisible();
  await input(page, "Import JSON").fill('{"sources":[{"title":"Operations audit staged source","sourceExternalId":"operations-audit-source","category":"Finance"}]}');
  // The bundle declares no source organization, so ownership must be confirmed first.
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(dialog.getByText("Confirm that you reviewed the source ownership before staging these records.", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await page.getByRole("checkbox", { name: /I reviewed the source ownership and evidence gaps/ }).check();
  await page.getByRole("button", { name: "Create session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Operations audit staged import", { exact: true }).first()).toBeVisible();
  await fits(page);
  expect(errors).toEqual([]);
});

test("disconnecting Wave preserves the cache while disabling refresh and showing connection guidance", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await visit(page, "financials");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sync", exact: true }).click();
  await expect(page.getByText("Demo bookkeeping data is already loaded. Live sync requires configured Wave credentials.")).toBeVisible();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Wave", exact: true })).toBeVisible();
  await visit(page, "financials/wave/account");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Wave is disconnected" })).toBeVisible();
  await expect(page.getByText("Operating chequing", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Categories/ }).click();
  await fits(page);
  await page.getByRole("button", { name: /^Money accounts/ }).click();
  await page.getByRole("link", { name: "Details", exact: true }).last().click();
  await expect(page.getByText("Money account details", { exact: true })).toBeVisible();
  await fits(page);
  await visit(page, "financials");
  await page.getByRole("button", { name: "Connect Wave", exact: true }).click();
  await expect(page.getByText("Connected · wave", { exact: true })).toBeVisible();
  await visit(page, "financials/wave/account");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(page.getByText("Operating chequing", { exact: true }).first()).toBeVisible();
});

test("a synthetic donation receipt can be issued and voided while keeping its original audit record", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "receipts");
  await page.getByRole("button", { name: "Issue receipt", exact: true }).click();
  await input(page, "Charity registration #").fill("000000000RR0001");
  await input(page, "Donor name").fill("Synthetic operations receipt audit");
  await input(page, "Amount").fill("100");
  await input(page, "Eligible amount").fill("100");
  await fits(page);
  await page.getByRole("button", { name: "Issue", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator("tr", { hasText: "Synthetic operations receipt audit" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("000001");
  await row.getByRole("button", { name: "Void", exact: true }).click();
  await page.getByPlaceholder("Reason (required)").fill("Synthetic browser audit — no real donation");
  await fits(page);
  await page.getByRole("button", { name: "Void receipt", exact: true }).click();
  await expect(row).toContainText("Voided");
  await page.reload();
  await expect(row).toContainText("000001");
  await expect(row).toContainText("Voided");
  expect(errors).toEqual([]);
});

test("a manual bank transaction can be reconciled with its note and a quick entry reaches the ledger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await visit(page, "reconciliation");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add transaction", exact: true }).click();
  await input(page, "Description").fill("Synthetic operations bank fee");
  await input(page, "Amount").fill("10");
  await fits(page);
  await page.getByRole("button", { name: "Add transaction", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Selecting a row opens its match panel directly (no generic side panel).
  await page.getByRole("button", { name: "Match Synthetic operations bank fee", exact: true }).click();
  await page.getByRole("button", { name: "Mark manually reconciled…", exact: true }).click();
  await page.getByPlaceholder("Reason", { exact: true }).fill("Synthetic account fee for browser audit");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unmatch", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic account fee for browser audit", { exact: false })).toBeVisible();
  await fits(page);

  await visit(page, "treasurer");
  await page.getByRole("button", { name: "Quick entry", exact: true }).click();
  await input(page, "Amount").fill("10");
  await input(page, "Description").fill("Synthetic operations ledger posting");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await visit(page, "financials/accounting");
  const entry = page.locator("details").filter({ hasText: "Synthetic operations ledger posting" });
  await expect(entry).toHaveCount(1);
  await entry.locator("summary").click();
  await expect(entry.locator("tbody tr")).toHaveCount(2);
  await expect(entry).toContainText("debit");
  await expect(entry).toContainText("credit");
  await page.getByRole("button", { name: "Journal entry", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Post journal entry");
  await fits(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(errors).toEqual([]);
});

for (const role of ["Viewer", "Director", "Member"] as const) {
  test(role === "Member" ? "Member can read grants without accessing finance, roster or secret queries" : `${role} can review finance registers while writes wait for authority`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await visit(page, "receipts");
    await page.getByRole("button", { name: "Issue receipt", exact: true }).click();
    await input(page, "Charity registration #").fill("000000000RR0001");
    await input(page, "Donor name").fill("Synthetic restricted-role receipt");
    await input(page, "Amount").fill("100");
    await input(page, "Eligible amount").fill("100");
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await visit(page, "users");
    const name = `Operations Interface ${role}`;
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Display name", { exact: true }).fill(name);
    await dialog.getByLabel("Email", { exact: true }).fill(`${role.toLowerCase()}@operations-interface.example`);
    await dialog.getByLabel("Role", { exact: true }).click();
    await page.getByRole("option", { name: role, exact: true }).click();
    await dialog.getByLabel("Status", { exact: true }).click();
    await page.getByRole("option", { name: "Active", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.locator("tr", { hasText: name }).getByRole("button", { name: "Act as", exact: true }).click();
    await expect(page.getByText(`Now acting as ${name}`, { exact: true })).toBeVisible();
    // BrowserRouter navigation retains the intentionally in-memory demo actor.
    async function navigate(route: string) {
      await page.evaluate(route => {
        window.history.pushState(null, "", `/demo/app/${route}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, route);
    }
    if (role === "Member") {
      await navigate("grants");
      await expect(page.getByRole("button", { name: "New grant", exact: true })).toBeDisabled();
      await navigate("grants/static_grant/edit");
      await expect(page.getByRole("button", { name: "Edit workspace", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Edit", exact: true })).toHaveCount(0);
      await navigate("grants/sources/bc-arts-council");
      await expect(page.getByRole("button", { name: "Add to pipeline", exact: true })).toBeDisabled();
      expect(errors).toEqual([]);
      return;
    }
    await navigate("receipts");
    await expect(page.getByRole("button", { name: "Issue receipt", exact: true })).toBeDisabled();
    const issuedReceipt = page.locator("tr", { hasText: "Synthetic restricted-role receipt" });
    await expect(issuedReceipt).toHaveCount(1);
    await expect(issuedReceipt).toContainText("Issued");
    await expect(issuedReceipt.getByRole("button", { name: "Void", exact: true, includeHidden: true })).toBeDisabled();
    await navigate("reconciliation");
    await expect(page.getByRole("button", { name: "Auto-match high confidence", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Add transaction", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await navigate("insurance");
    await expect(page.getByRole("button", { name: "New policy", exact: true })).toBeDisabled();
    await expect(page.getByRole("main").getByRole("button", { name: "Edit", exact: true, includeHidden: true }).first()).toBeDisabled();
    await navigate("inventory");
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
    await expect(page.getByRole("main").getByRole("button", { name: "Place / move", exact: true, includeHidden: true }).first()).toBeDisabled();
    await navigate("assets");
    await expect(page.getByRole("button", { name: "New asset", exact: true })).toBeDisabled();
    await expect(page.getByRole("main").getByRole("button", { name: "Edit", exact: true, includeHidden: true }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Scan", exact: true })).toBeEnabled();
    await navigate("dividends");
    await expect(page.getByRole("button", { name: "New declaration", exact: true })).toBeDisabled();
    await navigate("treasurer");
    await expect(page.getByRole("button", { name: "Quick entry", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
    await navigate("financials/accounting");
    await expect(page.getByRole("button", { name: "Journal entry", exact: true })).toBeDisabled();
    const accountingExports = page.getByRole("button", { name: /^(chart of accounts|trial balance|journal entries|general ledger|board\/auditor ZIP)$/ });
    await expect(accountingExports).toHaveCount(5);
    for (const button of await accountingExports.all()) {
      if (role === "Viewer") await expect(button).toBeDisabled();
      else await expect(button).toBeEnabled();
    }
    await navigate("financials/year-end");
    await page.getByRole("button", { name: "Restricted funds", exact: true }).click();
    if (role !== "Director") await expect(page.getByRole("button", { name: "Export Word", exact: true })).toBeDisabled();
    else await expect(page.getByRole("button", { name: "Export Word", exact: true })).toBeEnabled();
    await navigate("grants");
    await expect(page.getByRole("button", { name: "New grant", exact: true })).toBeDisabled();
    await navigate("grants/static_grant/edit");
    await expect(page.getByRole("button", { name: "Edit workspace", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Edit", exact: true })).toHaveCount(0);
    await fits(page);
    expect(errors).toEqual([]);
  });
}

test("financial overview contains every year-end column and opens the selected fiscal year", async ({ page }) => {
  await visit(page, "financials");
  const statements = page.getByRole("region", { name: "Year-over-year financial statements", exact: true });
  await expect(statements).toBeVisible();
  await expect.poll(() => page.locator(".page").evaluate(element => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await statements.scrollIntoViewIfNeeded();
  await statements.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(statements.getByRole("columnheader", { name: "Board approval", exact: true })).toBeInViewport();
  await statements.evaluate(element => { element.scrollLeft = 0; });
  await statements.getByRole("button", { name: "Open FY 2025-2026 financial detail", exact: true }).click();
  await expect(page.getByRole("heading", { name: "FY 2025-2026 financials", exact: true })).toBeVisible();
});
