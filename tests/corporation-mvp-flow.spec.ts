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
  const navigate = async (path: string) => {
    await page.evaluate((nextPath) => {
      window.history.pushState({}, "", nextPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await page.waitForLoadState("networkidle");
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

  await navigate("/app/organization-details");
  await expect(page.getByRole("heading", { name: "Organization details" })).toBeVisible();
  await expect(page.getByText("Canada federal - CBCA").first()).toBeVisible();
  await expect(page.getByText("Ontario - OBCA").first()).toBeVisible();
  await expect(page.getByText("ON-BROWSER-001")).toBeVisible();

  await navigate("/app/compliance-obligations");
  await expect(page.getByRole("heading", { name: "Compliance obligations" })).toBeVisible();
  await expect(page.getByText("Annual return filing window", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("ISC register annual review", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Initial return deadline", { exact: false }).first()).toBeVisible();

  const annualReturnRow = page.locator(".table__row", { hasText: "Annual return filing window" }).first();
  await annualReturnRow.getByRole("button", { name: "Track" }).click();
  await expect(page.getByText("Filing created")).toBeVisible();
  await annualReturnRow.getByRole("button", { name: "Packet" }).click();
  await expect(page.getByText("Packet staged").last()).toBeVisible();

  await navigate("/app/filings");
  await expect(page.getByRole("heading", { name: "Filings" })).toBeVisible();
  await expect(page.getByText("FederalAnnualReturn")).toBeVisible();

  await navigate("/app/template-engine");
  await expect(page.getByRole("heading", { name: "Template Engine" })).toBeVisible();
  await expect(page.getByText("Share issuance packet", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Annual resolutions and return packet", { exact: true }).first()).toBeVisible();

  expect(errors).toEqual([]);
});
