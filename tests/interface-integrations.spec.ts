import { expect, test, type Page } from "@playwright/test";

// Use client navigation after the initial load: this also exercises route/tab
// state without masking failures behind a fresh app mount.
async function openApp(page: Page, path: string, heading: string) {
  if (!page.url().includes("/demo/")) await page.goto(`/demo/app/${path}`, { waitUntil: "domcontentloaded" });
  else await page.evaluate((url) => { history.pushState({}, "", url); dispatchEvent(new PopStateEvent("popstate")); }, `/demo/app/${path}`);
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
}
async function contained(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const overflow = await page.evaluate(() => [document.documentElement, ...document.querySelectorAll<HTMLElement>(".page")]
    .filter((node) => node.clientWidth && node.scrollWidth > node.clientWidth + 2)
    .map((node) => ({ className: node.className, width: node.clientWidth, scroll: node.scrollWidth })));
  expect(overflow).toEqual([]);
}

// Containment checks deliberately cover every breakpoint; restore the project
// viewport so subsequent actions still exercise its phone/tablet/desktop layout.
async function containedAtWidths(page: Page) {
  const original = page.viewportSize();
  try {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await contained(page);
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
}

/** Opens the page's "+ New" menu, checks one option's state, and closes it. */
async function expectNewMenuItem(page: Page, item: string, state: "enabled" | "disabled") {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const option = page.getByRole("menuitem", { name: item, exact: true });
  if (state === "disabled") await expect(option).toBeDisabled();
  else await expect(option).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(option).toHaveCount(0);
}

test("API clients persist, real tabs select panels, and local preview cannot issue server credentials", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "settings/api-keys", "API keys");
  await expectNewMenuItem(page, "API token", "disabled");
  await expect(page.getByText("API tokens require a connected server", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Tokens", exact: true }).click();
  await expect(page).toHaveURL(/tab=tokens/);
  await expect(page.getByRole("tab", { name: "Tokens", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Tokens", exact: true })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Clients", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "API client", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Interface audit client");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Client created", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Clients", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Interface audit client", { exact: true })).toBeVisible();
  // A client record must not bypass the local-runtime credential gate.
  await expectNewMenuItem(page, "API token", "disabled");
  await containedAtWidths(page);
  expect(errors).toEqual([]);
});

test("integration setup, unavailable browser sessions, and package lifecycle tabs respond", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "integrations", "Integration marketplace");
  await page.getByRole("tab", { name: "Setup", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Setup", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/tab=setup/);
  await page.getByRole("tab", { name: "Catalog", exact: true }).click();
  await page.getByRole("button", { name: /Microsoft 365/ }).click();
  await expect(page.getByRole("button", { name: "Coming soon", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await containedAtWidths(page);
  await openApp(page, "browser-connectors", "Browser apps");
  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Runtime", exact: true })).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Sessions", exact: true }).click();
  await expect(page.getByText("No active browser sessions in this workspace.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Apps", exact: true }).click();
  await expect(page.getByRole("button", { name: "Launch browser", exact: true }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Open workspace", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Wave", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Launch browser", exact: true }).first()).toBeDisabled();
  await openApp(page, "workflow-packages", "Workflow packages");
  await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Lifecycle", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Package lifecycle", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Packages", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Packages", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("exports contain native file controls and handle invalid previews; local webhooks stay gated", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "exports", "Data export");
  await containedAtWidths(page);
  await page.getByLabel("Workspace backup ZIP or JSON", { exact: true }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{broken") });
  await expect(page.locator(".notice--danger")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data export", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByText("Technical details: individual tables", { exact: true }).click();
  await page.getByRole("button", { name: /^Societies(\s|$)/ }).click();
  expect((await download).suggestedFilename()).toMatch(/-societies-.*\.csv$/);
  await openApp(page, "webhooks", "Webhooks");
  await expect(page.getByText("Webhook delivery requires a connected server", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add endpoint", exact: true })).toHaveCount(0);
  await containedAtWidths(page);
  expect(errors).toEqual([]);
});

test("public previews preserve demo links, public form validation, and invalid-token privacy", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "transparency", "Public transparency");
  await expect(page.getByText("Local preview only", { exact: true })).toBeVisible();
  const navigate = async (path: string) => page.evaluate((url) => { history.pushState({}, "", url); dispatchEvent(new PopStateEvent("popstate")); }, path);
  await navigate("/demo/public/riverside-community-society");
  await expect(page.getByRole("heading", { name: "Riverside Community Society", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Volunteer/ })).toHaveAttribute("href", /\/demo\/public\/riverside-community-society\/volunteer-apply/);
  await navigate("/demo/public/riverside-community-society/volunteer-apply");
  await page.getByRole("button", { name: /Submit application/i }).click();
  await expect(page.getByText("Enter your first name.", { exact: true })).toBeVisible();
  await expect(page.getByText("Enter your last name.", { exact: true })).toBeVisible();
  await navigate("/demo/public/riverside-community-society/grant-apply");
  await page.getByRole("button", { name: /Submit funding request/i }).click();
  await expect(page.getByText("Enter a project title.", { exact: true })).toBeVisible();
  await expect(page.getByText("Enter the amount requested in dollars.", { exact: true })).toBeVisible();
  await navigate("/demo/public/unknown-organization/grant-apply");
  await expect(page.getByRole("heading", { name: "Grant intake is unavailable.", exact: true })).toBeVisible();
  await navigate("/demo/portal/expired-interface-token");
  await expect(page.getByRole("heading", { name: "Portal unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toHaveCount(0);
  await containedAtWidths(page);
  expect(errors).toEqual([]);
});


test("local preparation stays useful while external sends, workflow runs, and feed links are gated", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "communications", "Communications");
  await page.getByRole("button", { name: "Send campaign", exact: true }).click();
  await expect(page.getByText(/Campaign delivery requires a connected server/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await openApp(page, "paperless", "Paperless-ngx");
  await expect(page.getByRole("button", { name: "Disable", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText("Paperless demo adapter is ready", { exact: true })).toBeVisible();
  await openApp(page, "workflows", "Workflows");
  await expect(page.getByRole("button", { name: "Run now", exact: true }).first()).toBeDisabled();
  await openApp(page, "calendar-sync", "Calendar sync");
  await expect(page.getByText(/Outbound calendar subscriptions require a connected server/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable calendar feed", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Stage .*events?$/ })).toBeDisabled();
  await page.getByLabel("…or paste .ics content", { exact: true }).fill("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Interface audit meeting\nDTSTART:20261015\nDTEND:20261015\nUID:interface-audit@example.test\nEND:VEVENT\nEND:VCALENDAR");
  await expect(page.getByRole("button", { name: "Stage 1 event", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stage 1 event", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/app\/imports\?sessionId=/);
  await expect(page.getByText("Staged 1 event for review", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("manual outbox drafts and custom field definitions persist; AI tabs expose their actual content", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await openApp(page, "outbox", "Outbox");
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("reviewer@example.test");
  await page.getByLabel("Subject", { exact: true }).fill("Interface draft awaiting manual dispatch");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // A new draft stays a draft (it is never queued for sending on save).
  await expect(page.getByText("Draft saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByText("Interface draft awaiting manual dispatch", { exact: true })).toBeVisible();
  await openApp(page, "custom-fields", "Custom fields");
  await page.getByRole("button", { name: "New field", exact: true }).click();
  await page.getByLabel("Label", { exact: true }).fill("Interface preferred contact");
  await page.getByLabel("Key", { exact: true }).fill("interface_preferred_contact");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.locator(".custom-fields-mobile-list:visible, .custom-fields-record-table:visible").getByText("Interface preferred contact", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Link map", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Link map", exact: true })).toHaveAttribute("aria-selected", "true");
  await openApp(page, "ai-agents", "AI agents");
  await page.getByRole("tab", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Available tools by role", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recent runs", exact: true })).toBeVisible();
  await containedAtWidths(page);
  expect(errors).toEqual([]);
});


test("Admin manages API clients while Viewer retains read-only client access", async ({ page }) => {
  test.setTimeout(70_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openApp(page, "users", "Users");
  for (const role of ["Admin", "Viewer"] as const) {
    await page.getByRole("button", { name: "Add user", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Add user", exact: true });
    await form.getByLabel("Display name", { exact: true }).fill(`API client ${role}`);
    await form.getByLabel("Email", { exact: true }).fill(`api-client-${role.toLowerCase()}@interface.example`);
    await form.getByLabel("Role", { exact: true }).click();
    await page.getByRole("option", { name: role, exact: true }).click();
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).toBeHidden();
  }
  const chooseActor = async (role: "Admin" | "Viewer") => {
    const picker = page.getByTitle("Switch acting user", { exact: true });
    if (!await picker.isVisible()) await page.locator(".bottom-nav").getByRole("button", { name: "More", exact: true }).click();
    await picker.click();
    await page.getByRole("listbox", { name: "Acting user", exact: true }).getByRole("option", { name: new RegExp(`API client ${role}`) }).click();
    if (page.viewportSize()!.width < 980) await page.keyboard.press("Escape");
    await expect(picker).toContainText(role);
  };
  await chooseActor("Admin");
  await openApp(page, "settings/api-keys", "API keys");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "API client", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Admin-created API client");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Client created", { exact: true })).toBeVisible();
  await expect(page.getByText("Admin-created API client", { exact: true })).toBeVisible();
  await expect(page.locator(".record-table__cell--editable").first()).toBeVisible();
  await expectNewMenuItem(page, "API token", "disabled");
  await chooseActor("Viewer");
  await expect(page.getByText("Admin-created API client", { exact: true })).toBeVisible();
  // Neither a client nor a token can be created, so the "+" menu is disabled.
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeDisabled();
  await expect(page.locator(".record-table__cell--editable")).toHaveCount(0);
  expect(errors).toEqual([]);
});
