import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __societyerE2E?: {
      reset(): Promise<void>;
      setupCorporationMvp(): Promise<Record<string, string>>;
    };
  }
}

// Society-only legal references that must never reach a corporation workspace.
const SOCIETY_ONLY = /Societies Act|Societies Online|BC-SOC-|s\.24 —|of the Members of the Society/;

async function pageText(page: Page) {
  return await page.locator(".page").first().innerText();
}

test("governance and people pages show no Societies Act copy for a CBCA corporation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__societyerE2E));
  const { agmId } = await page.evaluate(async () => {
    await window.__societyerE2E!.reset();
    const fixture = await window.__societyerE2E!.setupCorporationMvp();
    // Same permission-checked local mutations the UI uses; the dev server
    // serves the module the app already loaded, so this is the live client.
    const { localDataClient } = await import("/src/lib/localDataClient.ts" as string);
    const societyId = fixture.societyId;
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
  });

  const visit = async (path: string, heading: string | RegExp) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Select workspace.*Northstar Browser Flow Holdings Inc\./ })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 25_000 });
  };

  await visit("/app/members", "Members");
  await expect(page.getByText("Member and contact records for this corporation.", { exact: false })).toBeVisible();
  expect(await pageText(page)).not.toMatch(SOCIETY_ONLY);

  await visit("/app/meetings", "Meetings");
  await expect(page.getByText("shareholder meetings (annual and special)", { exact: false })).toBeVisible();
  expect(await pageText(page)).not.toMatch(SOCIETY_ONLY);

  await visit(`/app/meetings/${agmId}/agm`, /AGM workflow/);
  await expect(page.getByText("Record annual registry filing")).toBeVisible();
  const agmText = await pageText(page);
  expect(agmText).not.toMatch(SOCIETY_ONLY);
  expect(agmText).not.toContain("14–60 days before meeting");

  await visit("/app/attestations", /Director attestations/);
  await expect(page.getByText(/have not yet attested/)).toBeVisible();
  expect(await pageText(page)).not.toMatch(SOCIETY_ONLY);

  for (const [path, heading] of [
    ["/app/directors", "Directors"],
    ["/app/inspections", "Records inspections"],
    ["/app/written-resolutions", "Written resolutions"],
    ["/app/bylaws-history", "Bylaws history"],
    ["/app/bylaw-rules", "Bylaw rules"],
  ] as const) {
    await visit(path, heading);
    expect(await pageText(page), path).not.toMatch(SOCIETY_ONLY);
  }

  expect(errors).toEqual([]);
});
