import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __societyerE2E?: {
      reset(): Promise<void>;
      setupCorporationMvp(): Promise<Record<string, string>>;
      inspect(): Promise<{
        selectedSocietyId: string | null;
        societies: Array<{ _id: string; name: string; entityType?: string; jurisdictionCode?: string }>;
        selectedRoleHolderCount: number;
      }>;
    };
  }
}

test("corporation MVP flow renders obligations, share register, registration, and packets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A real navigation, not history.pushState + a synthetic popstate: react-router
  // tracks its own history index in `window.history.state`, so a hand-rolled
  // pushState changes the URL without the router ever re-rendering. The fixture
  // survives the reload — records are in IndexedDB, the selected workspace in
  // localStorage — so nothing has to be rebuilt between steps.
  const navigate = async (path: string) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // Wait for the workspace to be resolved, not just the shell to mount: the
    // local store answers from its seed until IndexedDB is read back, and the
    // fixture workspace only appears once that finishes.
    await expect(
      page.getByRole("button", { name: /Select workspace.*Northstar Browser Flow Holdings Inc\./ }),
    ).toBeVisible({ timeout: 25_000 });
  };

  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__societyerE2E));
  const fixture = await page.evaluate(async () => {
    await window.__societyerE2E!.reset();
    return await window.__societyerE2E!.setupCorporationMvp();
  });
  const setupState = await page.evaluate(async () => await window.__societyerE2E!.inspect());
  expect(setupState.selectedSocietyId, JSON.stringify(setupState)).toBe(fixture.societyId);
  expect(setupState.selectedRoleHolderCount, JSON.stringify(setupState)).toBe(4);
  await expect(page.getByRole("button", { name: /Select workspace.*Northstar Browser Flow Holdings Inc\./ })).toBeVisible();

  // A corporation must not see society-only chrome: no Societies Act copy on the
  // dashboard or in the sidebar, and no society member register in the nav.
  await navigate("/app");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Record directors and shareholders").first()).toBeVisible();
  for (let i = 0; i < 15; i += 1) {
    const closedGroup = page.locator('.sidebar__group-toggle[aria-expanded="false"]').first();
    if (!(await closedGroup.count())) break;
    await closedGroup.click();
  }
  const sidebar = page.locator(".sidebar").first();
  await expect(sidebar.getByRole("link", { name: "Role holders" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /^(Members|Member proposals|Donation receipts|Membership & billing)$/ })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: /^Society$/ })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Societies Act");
  await expect(page.locator("body")).not.toContainText("s.40 requires");

  await navigate("/app/role-holders");
  await expect(page.getByRole("heading", { name: "Corporation people" })).toBeVisible();
  await expect(page.getByText("Dina Director")).toBeVisible();
  await expect(page.getByText("Omar Officer")).toBeVisible();
  await expect(page.getByText("Sera Shareholder")).toBeVisible();
  await expect(page.getByText("Cleo Controller")).toBeVisible();

  await navigate("/app/rights-ledger");
  await expect(page.getByRole("heading", { name: "Share register" })).toBeVisible();
  await expect(page.getByText("Common shares").first()).toBeVisible();
  await expect(page.getByText("Current share holdings")).toBeVisible();
  await expect(page.getByText("100").first()).toBeVisible();
  await page.getByRole("button", { name: "Packet" }).click();
  await expect(page.getByText("Packet staged").last()).toBeVisible();

  // Organization Details was merged into the Society page; the old route now
  // redirects there, and the registration register lives in its expandable
  // "More organization details" section.
  await navigate("/app/organization-details");
  await expect(page.getByRole("heading", { name: "Organization profile" })).toBeVisible();
  await expect(page.locator("input.input").first()).toHaveValue("Northstar Browser Flow Holdings Inc.");
  await page.getByText("More organization details").click();
  await expect(page.getByText("Canada federal - CBCA").first()).toBeVisible();
  await expect(page.getByText("Ontario - OBCA").first()).toBeVisible();
  await expect(page.getByText("ON-BROWSER-001")).toBeVisible();

  await navigate("/app/compliance-obligations");
  await expect(page.getByRole("heading", { name: "Compliance obligations" })).toBeVisible();
  await expect(page.getByText("Annual return filing window", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("ISC register annual review", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Initial return deadline", { exact: false }).first()).toBeVisible();

  const annualReturnRow = page.locator("tr", { hasText: "Annual return filing window" }).first();
  await annualReturnRow.getByRole("button", { name: "Track" }).click();
  await expect(page.getByText("Filing created")).toBeVisible();
  await annualReturnRow.getByRole("button", { name: /^More actions for / }).click();
  await page.getByRole("menuitem", { name: "Stage document packet" }).click();
  await expect(page.getByText("Packet staged").last()).toBeVisible();

  await navigate("/app/filings");
  await expect(page.getByRole("heading", { name: "Filings" })).toBeVisible();
  // The filings table shows the readable kind label, not the stored code.
  await expect(page.getByRole("button", { name: "Federal annual return", exact: true }).first()).toBeVisible();

  await navigate("/app/template-engine");
  await expect(page.getByRole("heading", { name: "Template Engine" })).toBeVisible();
  await expect(page.getByText("Share issuance packet", { exact: true }).first()).toBeVisible();
  // Annual packets are Act-specific preparation drafts, not executed resolutions.
  await expect(page.getByText("Annual business and return preparation", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Annual resolutions and return packet", { exact: true })).toHaveCount(0);

  expect(errors).toEqual([]);
});
