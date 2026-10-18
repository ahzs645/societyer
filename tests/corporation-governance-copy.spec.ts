import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __societyerE2E?: {
      reset(): Promise<void>;
      setupCorporationMvp(options?: { jurisdictionCode?: "CA-FED-CBCA" | "CA-BC" }): Promise<Record<string, string>>;
    };
  }
}

// Society-only legal references that must never reach a corporation workspace.
const SOCIETY_ONLY = /Societies Act|Societies Online|BC-SOC-|s\.24 —|of the Members of the Society/;
const CBCA_NAME = /Select workspace.*Northstar Browser Flow Holdings Inc\./;
const BC_COMPANY_NAME = /Select workspace.*Northstar BC Holdings Ltd\./;

async function pageText(page: Page) {
  return await page.locator(".page").first().innerText();
}

async function setupCorporation(page: Page, jurisdictionCode: "CA-FED-CBCA" | "CA-BC" = "CA-FED-CBCA") {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__societyerE2E));
  return await page.evaluate(async (code) => {
    await window.__societyerE2E!.reset();
    return await window.__societyerE2E!.setupCorporationMvp({ jurisdictionCode: code });
  }, jurisdictionCode);
}

function visitor(page: Page, workspace: RegExp) {
  return async (path: string, heading: string | RegExp) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: workspace })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 25_000 });
  };
}

async function openAllSidebarGroups(page: Page) {
  for (let i = 0; i < 15; i += 1) {
    const closedGroup = page.locator('.sidebar__group-toggle[aria-expanded="false"]').first();
    if (!(await closedGroup.count())) break;
    await closedGroup.click();
  }
}

test("governance and people pages show no Societies Act copy for a CBCA corporation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const fixture = await setupCorporation(page);
  const { agmId } = await page.evaluate(async (societyId) => {
    // Same permission-checked local mutations the UI uses; the dev server
    // serves the module the app already loaded, so this is the live client.
    const { localDataClient } = await import("/src/lib/localDataClient.ts" as string);
    const agmId = await localDataClient.mutation("meetings:create", {
      societyId, type: "AGM", title: "Annual meeting 2026", scheduledAt: "2026-12-10T18:00:00.000Z",
      electronic: false, status: "Scheduled", attendeeIds: [],
    });
    // An Active director with no attestation drives the attestation warning.
    await localDataClient.mutation("directors:create", {
      societyId, firstName: "Dana", lastName: "Director", position: "Director", status: "Active",
      isBCResident: false, consentOnFile: true, termStart: "2025-02-10",
    });
    return { agmId: String(agmId) };
  }, fixture.societyId);

  const visit = visitor(page, CBCA_NAME);

  await visit("/app/meetings", "Meetings");
  await expect(page.getByText("shareholder meetings (annual and special)", { exact: false })).toBeVisible();
  expect(await pageText(page)).not.toMatch(SOCIETY_ONLY);

  await visit(`/app/meetings/${agmId}/agm`, /Annual meeting workflow/);
  await expect(page.getByText("Record annual registry filing")).toBeVisible();
  const agmText = await pageText(page);
  expect(agmText).not.toMatch(SOCIETY_ONLY);
  expect(agmText).not.toContain("14–60 days before meeting");

  await visit("/app/attestations", /Director attestations/);
  // Corporate statutes impose no annual director attestation, so a missing one
  // is an informational practice note rather than a statutory warning.
  await expect(page.getByText(/1 director have no optional annual attestation recorded for \d{4}\./)).toBeVisible();
  await expect(page.getByText(/have not yet attested/)).toHaveCount(0);
  expect(await pageText(page)).not.toMatch(SOCIETY_ONLY);

  for (const [path, heading] of [
    ["/app/directors", "Directors"],
    ["/app/inspections", "Records inspections"],
    ["/app/written-resolutions", "Written resolutions"],
    ["/app/bylaws-history", "By-laws history"],
    ["/app/bylaw-rules", "By-law rules"],
    ["/app/conflicts", "Conflicts of interest"],
    ["/app/auditors", "Auditor appointments"],
  ] as const) {
    await visit(path, heading);
    expect(await pageText(page), path).not.toMatch(SOCIETY_ONLY);
  }
  // s.56 is the Societies Act conflict section.
  await visit("/app/conflicts", "Conflicts of interest");
  await expect(page.getByText("Directors’ disclosed interests and the recorded handling of each matter.", { exact: true })).toBeVisible();
  expect(await pageText(page)).not.toContain("(s.56)");

  expect(errors).toEqual([]);
});

test("a CBCA corporation sees corporate profile, communications, workflow, research and nav wording", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupCorporation(page);
  const visit = visitor(page, CBCA_NAME);

  // Item 2: organization profile hides society-only status flags.
  await visit("/app/society", "Organization profile");
  await expect(page.getByText("Business activities / article restrictions").first()).toBeVisible();
  await expect(page.getByText("Registered CRA charity", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Member-funded society", { exact: true })).toHaveCount(0);
  const docs = page.locator("table.society-doc-table");
  await expect(docs.getByText("Articles", { exact: true })).toBeVisible();
  await expect(docs.getByText("By-laws", { exact: true })).toBeVisible();
  await expect(docs.getByText("Constitution", { exact: true })).toHaveCount(0);
  await page.locator("#more-organization-details > summary").click();
  await expect(page.getByText("Tax evidence reference", { exact: true })).toBeVisible();
  await expect(page.getByText("Charitable registration", { exact: true })).toHaveCount(0);

  // Item 3: communications use shareholder and contact wording.
  await visit("/app/communications", "Communications");
  await expect(page.getByText("Notices, campaigns and shareholder and contact preferences.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await expect(page.getByText("Contact preferences", { exact: true }).first()).toBeVisible();
  expect(await pageText(page)).not.toContain("member contact preferences");
  expect(await pageText(page)).not.toContain("Member contact preferences");

  // Item 4: workflows use annual-meeting wording; Societies Online recipes are not offered.
  await visit("/app/workflows", "Workflows");
  await expect(page.getByText("Automations like annual meeting prep reminders and filing alerts.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions" }).filter({ hasText: "Templates" }).click();
  await expect(page.getByRole("menuitem", { name: "Annual meeting deadlines" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "AGM deadlines" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Recipe relabelling and the hidden Societies Online recipe are checked in
  // scripts/check-entity-rule-scope.ts (the local catalog only ships examples).

  // Item 5: research library shows federal/Ontario templates, not BC society ones.
  await visit("/app/research-library", "Research library");
  await expect(page.getByRole("heading", { name: "Form 1 — Articles of Incorporation", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordinary society constitution", exact: true })).toHaveCount(0);
  await expect(page.getByText("10 records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Applies to", exact: true }).click();
  await page.getByRole("option", { name: "All entity types" }).click();
  await expect(page.getByText("28 records", { exact: true })).toBeVisible();
  await expect(page.getByText("Other entity type: BC societies").first()).toBeVisible();

  // Item 6: the sidebar names PIPA only for BC workspaces.
  await visit("/app", "Dashboard");
  await openAllSidebarGroups(page);
  const sidebar = page.locator(".sidebar").first();
  await expect(sidebar.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Privacy (PIPA)", exact: true })).toHaveCount(0);

  // Item 7: society-only pages opened by URL explain they do not apply.
  for (const [path, label] of [
    ["/app/members", "Members"],
    ["/app/membership", "Membership & billing"],
    ["/app/receipts", "Donation receipts"],
    ["/app/proposals", "Member proposals"],
  ] as const) {
    await visit(path, `${label} is not used for this kind of organization`);
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/app");
  }
  await visit("/app/members", "Members is not used for this kind of organization");
  await expect(page.getByRole("link", { name: "Open role holders" })).toHaveAttribute("href", "/app/role-holders");

  // Item 8: eligible voters come from the share register (Sera holds 100 voting shares).
  await visit("/app/written-resolutions", "Written resolutions");
  await page.getByRole("button", { name: "New resolution" }).click();
  // The drawer previews the electorate it will freeze from the share register:
  // one voting shareholder (Sera). CBCA s.142 written resolutions need every
  // shareholder entitled to vote, so the count is in people, not shares.
  const resolutionDrawer = page.getByRole("dialog", { name: "New written resolution" });
  await expect(resolutionDrawer.getByRole("button", { name: "Decision body", exact: true })).toContainText("Shareholders");
  await expect(resolutionDrawer.getByText(/^1 eligible (person|people) · 1 (person|people)\. Required: 1 (person|people)\.$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await visit("/app/elections", "Elections");
  await expect(page.getByTestId("election-voter-source")).toContainText("Shareholders holding voting shares on the share register: 1");
  // Corporate elections weight ballots by shares and verify proxies/representatives.
  await expect(page.getByText("Shareholder elections with verified representation and share-weighted ballots.", { exact: true })).toBeVisible();

  await visit("/app/point-in-time-register", "Point-in-time register");
  await expect(page.getByRole("heading", { name: /^Shareholders \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Members \(/ })).toHaveCount(0);
  await visit("/app/minute-book", "Minute book");
  await expect(page.getByText("Your corporation's legal records and the evidence behind them.", { exact: true })).toBeVisible();

  // Item 9: stored record-table labels are worded for the entity at render time.
  await visit("/app/role-holders", "Corporation people");
  await expect(page.getByText("Share / right class", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Membership / right class", { exact: true })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("a BC company keeps BC privacy wording without society-only fields", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setupCorporation(page, "CA-BC");
  const visit = visitor(page, BC_COMPANY_NAME);

  // BC PIPA s. 3(1) applies to every organization unless federal law governs,
  // so a BC company with no recorded privacy facts presumes it.
  await visit("/app", "Dashboard");
  await openAllSidebarGroups(page);
  const sidebar = page.locator(".sidebar").first();
  await expect(sidebar.getByRole("link", { name: "Privacy (PIPA)", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "PIPA training", exact: true })).toBeVisible();

  // The assessment labels the presumption and asks for the facts that could displace it.
  await visit("/app/privacy", "Privacy");
  await expect(page.locator(".privacy-status-line")).toContainText("BC PIPA applies (assumed)");
  const assessment = page.getByRole("region", { name: "Privacy-law scope", exact: true });
  await expect(assessment.locator("summary").filter({ hasText: /^BC PIPA Assumed: confirm$/ })).toHaveCount(1);
  await expect(assessment).not.toContainText("Assessed as applicable");
  await expect(assessment).toContainText("federal work, undertaking or business");

  await visit("/app/society", "Organization profile");
  await expect(page.getByText("Registered CRA charity", { exact: true })).toHaveCount(0);
  const docs = page.locator("table.society-doc-table");
  await expect(docs.getByText("Articles", { exact: true })).toBeVisible();
  // A BC company's articles take the place of separate by-laws.
  await expect(docs.getByText(/^By-?laws$/)).toHaveCount(0);

  await visit("/app/research-library", "Research library");
  await expect(page.getByRole("heading", { name: "Table 1 articles", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ordinary society constitution", exact: true })).toHaveCount(0);

  await visit("/app/court-orders", "Court orders");
  expect(await pageText(page)).not.toContain("s.20");
  await visit("/app/conflicts", "Conflicts of interest");
  expect(await pageText(page)).not.toContain("(s.56)");
  await visit("/app/receipts", "Donation receipts is not used for this kind of organization");

  expect(errors).toEqual([]);
});
