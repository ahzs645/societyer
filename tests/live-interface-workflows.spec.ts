import { expect, test } from "@playwright/test";
import { assertLiveFits, liveFixture, livePath, signInLive } from "./helpers/liveInterface";
import { INTERFACE_ROUTES } from "./helpers/interfaceRoutes";
import { interfaceRouteReadPermission } from "../shared/interfaceRouteAccess";
import { hasPermission } from "../shared/functions/permissions";

test("production login rejects an incorrect password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("invalid-login@live-interface.example");
  await page.getByLabel("Password", { exact: true }).fill("invalid-password-for-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await assertLiveFits(page);
});

test("production login form authenticates the real workspace account", async ({ page }) => {
  await signInLive(page, "Owner", true);
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
});

test("anonymous production routes require login before mounting the app shell", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/app", "/app/documents", "/app/users", "/app/settings"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await assertLiveFits(page);
  }
  expect(errors).toEqual([]);
});

test("live people directory validates and persists a created person and edit", async ({ page }, testInfo) => {
  await signInLive(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const title = `Live person ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/app/people-directory");
  await page.getByRole("button", { name: "New person", exact: true }).click();
  let form = page.getByRole("dialog", { name: "New person", exact: true });
  await expect(form.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await form.getByLabel("Full name", { exact: true }).fill(title);
  await assertLiveFits(page);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByLabel("Search people", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  form = page.getByRole("dialog", { name: "Edit person", exact: true });
  await form.getByLabel("Full name", { exact: true }).fill(`${title} edited`);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Search people", { exact: true }).fill(title);
  await expect(page.getByText(`${title} edited`, { exact: true }).first()).toBeVisible();
  await assertLiveFits(page);
  expect(errors).toEqual([]);
});

test("live document metadata and review comments persist through reload", async ({ page }, testInfo) => {
  await signInLive(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const title = `Live review ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/app/documents");
  await page.getByRole("button", { name: "New document", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await assertLiveFits(page);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Document saved", { exact: true })).toBeVisible();
  await page.locator("tr", { hasText: title }).getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Add a comment first.", { exact: true })).toBeVisible();
  await page.locator("[contenteditable=true]").first().pressSequentially(`Review comment for ${title}`);
  await page.getByLabel("Page", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Comment added", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "In review", exact: true }).click();
  await expect(page.getByText("Review status updated", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page.reload();
  await expect(page.locator(".panel").filter({ hasText: `Review comment for ${title}` }).getByText("Resolved", { exact: true })).toBeVisible();
  await assertLiveFits(page);
  expect(errors).toEqual([]);
});

test("live annual filing validates evidence and persists a pending record", async ({ page }, testInfo) => {
  await signInLive(page);
  await page.goto("/app/annual-filings");
  await page.getByRole("button", { name: "Add filing", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter a jurisdiction and a four-digit filing year.", { exact: true })).toBeVisible();
  const jurisdiction = `LIVE-${testInfo.project.name.toUpperCase()}-${Date.now()}`;
  await dialog.getByLabel("Jurisdiction", { exact: true }).fill(jurisdiction);
  await dialog.getByLabel("Year", { exact: true }).fill("2027");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Add the filed-on date before marking this filing as filed.", { exact: true })).toBeVisible();
  await dialog.getByRole("checkbox").uncheck();
  await assertLiveFits(page);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Annual filing saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".card").filter({ has: page.getByRole("heading", { name: jurisdiction, exact: true }) }).locator("tr", { hasText: "2027" })).toContainText("✗");
});

test("live governance motion template creates, edits and deletes with confirmation", async ({ page }, testInfo) => {
  await signInLive(page);
  await page.goto("/app/motion-library");
  const title = `Live motion ${testInfo.project.name} ${Date.now()}`;
  const editor = page.locator(".motion-library__editor");
  await editor.getByLabel("Title", { exact: true }).fill(title);
  await editor.locator("[contenteditable=true]").fill("BE IT RESOLVED THAT the isolated live test be recorded.");
  await editor.getByRole("button", { name: "Add template", exact: true }).click();
  const template = page.locator(".motion-library__template").filter({ hasText: title });
  await expect(template).toHaveCount(1);
  await template.getByRole("button", { name: `Edit ${title}`, exact: true }).click();
  await editor.getByLabel("Title", { exact: true }).fill(`${title} edited`);
  await editor.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.reload();
  const edited = page.locator(".motion-library__template").filter({ hasText: `${title} edited` });
  await expect(edited).toHaveCount(1);
  await edited.getByRole("button", { name: `Delete ${title} edited`, exact: true }).click();
  let confirmation = page.getByRole("dialog", { name: "Delete motion template?" });
  await assertLiveFits(page);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edited).toHaveCount(1);
  await edited.getByRole("button", { name: `Delete ${title} edited`, exact: true }).click();
  confirmation = page.getByRole("dialog", { name: "Delete motion template?" });
  await confirmation.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(edited).toHaveCount(0);
});

for (const role of ["Owner", "Admin", "Director", "Member", "Viewer"]) {
  test(`${role} live module access and read/write controls match their workspace authority`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    await signInLive(page, role);
    await page.goto("/app/meetings");
    const newMeeting = page.getByRole("button", { name: "New meeting", exact: true });
    if (["Owner", "Admin", "Director"].includes(role)) await expect(newMeeting).toBeEnabled();
    else await expect(newMeeting).toBeDisabled();
    await page.goto(`/app/meetings/${liveFixture().ids.static_meeting_board_q2}`);
    const approval = page.locator(".meeting-governance-strip__item").filter({ hasText: "Minutes approval" }).getByRole("button");
    if (["Owner", "Admin"].includes(role)) await expect(approval).toBeEnabled();
    else await expect(approval).toBeDisabled();
    await page.goto("/app/documents");
    const newDocument = page.getByRole("button", { name: "New document", exact: true });
    if (["Owner", "Admin", "Director"].includes(role)) await expect(newDocument).toBeEnabled();
    else await expect(newDocument).toBeDisabled();
    await page.goto("/app/financials");
    if (role === "Member") await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toHaveCount(0);
    await page.goto("/app/settings");
    if (role === "Member") await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
    else await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toHaveCount(0);
    await page.goto("/app/users");
    if (["Member", "Viewer", "Director"].includes(role)) await expect(page.getByRole("button", { name: "Add user", exact: true })).toHaveCount(0);
    else await expect(page.getByRole("button", { name: "Add user", exact: true })).toBeEnabled();
    if (role !== "Member") {
      await page.goto("/app/goals");
      const newGoal = page.getByRole("button", { name: "New goal", exact: true });
      if (["Owner", "Admin"].includes(role)) await expect(newGoal).toBeEnabled();
      else await expect(newGoal).toBeDisabled();
      await page.locator('a[href^="/app/goals/"]').first().click();
      await page.getByRole("button", { name: "More actions", exact: true }).click();
      const deleteGoal = page.getByRole("menuitem", { name: "Delete goal", exact: true });
      if (["Owner", "Admin"].includes(role)) {
        await expect(deleteGoal).toBeEnabled();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("slider")).toBeEnabled();
      } else {
        await expect(deleteGoal).toBeDisabled();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("slider")).toBeDisabled();
        for (const checkbox of await page.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
        await expect(page.getByRole("link", { name: "New task", exact: true })).toHaveCount(0);
      }
    }
    if (role === "Viewer") {
      await page.goto("/app/exports");
      await expect(page.getByRole("status").filter({ hasText: "Your workspace role does not include export downloads" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
    }
    await assertLiveFits(page);
    await expect(page.getByTitle("Switch acting user", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("Member live guards cover every restricted module entry before mounting its data page", async ({ page }, testInfo) => {
  await signInLive(page, "Member");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  const results = [];
  for (const route of INTERFACE_ROUTES.filter((entry) => entry.kind === "app")) {
    const permission = interfaceRouteReadPermission(route.pattern);
    if (!permission || hasPermission("Member", permission)) continue;
    const path = livePath(route);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    if (path === "/app/table-field-lab") {
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { name: /Run your society/ })).toBeVisible();
      results.push({ path, permission, state: "Demo-only route safely excluded from hosted app" });
      continue;
    }
    await expect(page.getByRole("heading", { name: "Access restricted", exact: true })).toBeVisible();
    await assertLiveFits(page);
    results.push({ path, permission, state: "Access restricted" });
  }
  await testInfo.attach("restricted-module-entries", { body: JSON.stringify(results), contentType: "application/json" });
  expect(errors).toEqual([]);
});

test("anonymous live volunteer intake validates then submits without a membership", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/public/${liveFixture().publicIntake.slug}/volunteer-apply`);
  await expect(page.getByRole("heading", { name: /^Volunteer with / })).toBeVisible();
  await page.getByRole("button", { name: "Submit application", exact: true }).click();
  await expect(page.getByText("Complete these fields to submit", { exact: true })).toBeVisible();
  await page.locator("#volunteer-first-name").fill("Anonymous");
  await page.locator("#volunteer-last-name").fill(`Live ${testInfo.project.name}`);
  await page.locator("#volunteer-email").fill(`live-${testInfo.project.name}-${Date.now()}@example.test`);
  await page.locator("#volunteer-role-wanted").fill("Event support");
  await assertLiveFits(page);
  await page.getByRole("button", { name: "Submit application", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Application submitted", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("anonymous live grant intake validates then submits without a membership", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/public/${liveFixture().publicIntake.slug}/grant-apply`);
  await expect(page.getByRole("heading", { name: /^Funding intake for / })).toBeVisible();
  await page.getByRole("button", { name: "Submit funding request", exact: true }).click();
  await expect(page.getByText("Complete these fields to submit", { exact: true })).toBeVisible();
  await page.locator("#grant-applicant-name").fill(`Anonymous live ${testInfo.project.name}`);
  await page.locator("#grant-email").fill(`live-${testInfo.project.name}-${Date.now()}@example.test`);
  await page.locator("#grant-requested-amount").fill("250.50");
  await page.locator("#grant-project-title").fill(`Isolated live public proposal ${testInfo.project.name}`);
  await assertLiveFits(page);
  // Submit immediately after the last keystroke in the project summary.
  await page.locator("#grant-project-summary").pressSequentially("Community event proposal from an anonymous browser.");
  await page.getByRole("button", { name: "Submit funding request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Funding request submitted", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Member native cold shell rejects forged global create events", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  await signInLive(page, "Member");
  for (const path of ["/app", "/app/meetings", "/app/documents", "/app/members"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.locator(".page h1").first()).toBeVisible();
    await page.evaluate(() => {
      for (const event of ["quickaction:add-task", "quickaction:add-asset", "quickaction:create-meeting", "quickaction:add-commitment"])
        window.dispatchEvent(new CustomEvent(event, { detail: { initialValues: { name: "Forged global write attempt" } } }));
    });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await assertLiveFits(page);
  }
  expect(errors).toEqual([]);
});

const memberReadRoutes = INTERFACE_ROUTES.filter((route) => {
  const permission = interfaceRouteReadPermission(route.pattern);
  return route.kind === "app" && route.pattern !== "/app/table-field-lab" && permission && hasPermission("Member", permission);
});
for (let offset = 0; offset < memberReadRoutes.length; offset += 10) {
  const routes = memberReadRoutes.slice(offset, offset + 10);
  test(`Member native permitted reads ${offset + 1}-${offset + routes.length} do not subscribe to restricted auxiliary resources`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
    await signInLive(page, "Member");
    const failures: { pattern: string; error: string }[] = [];
    const checks = [];
    for (const route of routes) {
      const permission = interfaceRouteReadPermission(route.pattern);
      try {
        await page.goto(livePath(route), { waitUntil: "domcontentloaded" });
        if (route.pattern === "/app/society/new") await expect(page.getByRole("heading", { name: "New organization workspace", exact: true })).toBeVisible();
        else {
          await expect(page.locator(".app-shell")).toBeVisible();
          if (route.pattern === "/app/workflows/:id") await expect(page.locator(".workflow-topbar__title strong")).toBeVisible();
          else await expect(page.locator(".page h1").first()).toBeVisible();
        }
        await expect(page.getByRole("heading", { name: /^Something went wrong\.?$/ })).toHaveCount(0);
        if (route.pattern === "/app/members/:id") {
          for (const label of ["Custom fields", "Notes", "Activity"]) {
            await page.locator(".tabs").getByRole("button", { name: label, exact: true }).click();
            await assertLiveFits(page);
          }
        }
        await assertLiveFits(page);
        checks.push({ pattern: route.pattern, path: page.url(), permission });
      } catch (error) { failures.push({ pattern: route.pattern, error: String(error) }); }
    }
    await testInfo.attach("native-member-permitted-reads", { body: JSON.stringify({ checks, failures, errors }), contentType: "application/json" });
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
  });
}
