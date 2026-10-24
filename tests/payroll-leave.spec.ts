import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
async function checked(scope: Locator, label: string) {
  const input = scope.getByRole("checkbox", { name: label, exact: true });
  if (!(await input.isChecked()))
    await scope.getByText(label, { exact: true }).click();
  await expect(input).toBeChecked();
}
async function seed(page: Page) {
  await page.goto("/app/payroll/calculator?tab=leave");
  const value = await page.evaluate(async () => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", {
      name: "Synthetic vacation time workspace",
      jurisdictionCode: "CA-BC",
      seedDocumentPackets: false,
      isCharity: false,
      isMemberFunded: false,
    });
    const societyId = created.societyId,
      owners = await client.query("users:list", { societyId }),
      ownerId = owners.find((row: any) => row.role === "Owner")._id;
    setStoredSocietyId(societyId);
    setStoredUserId(ownerId);
    const employeeId = await client.mutation("employees:create", {
      societyId,
      firstName: "Taylor",
      lastName: "Vacation",
      role: "Student assistant",
      startDate: "2024-10-01",
      birthDate: "1995-01-01",
      province: "BC",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    });
    const readerId = await client.mutation("users:upsert", {
      societyId,
      email: "vacation-reader@example.test",
      displayName: "Vacation read-only director",
      role: "Director",
      status: "Active",
    });
    return { societyId, employeeId, ownerId, readerId };
  });
  await page.reload();
  const panel = page.getByRole("region", {
    name: "Vacation time",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("Vacation employee", { exact: true })
    .selectOption(value.employeeId);
  await expect(
    panel.getByRole("button", { name: "Add entitlement period", exact: true }),
  ).toBeEnabled();
  return { ...value, panel };
}
const stat = (panel: Locator, label: string) =>
  panel
    .locator(".stat-tile")
    .filter({ hasText: label })
    .locator(".stat__value");

test("vacation anniversary time persists separately from money through requested, approved, taken and cancelled history with complete CSV", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { panel, societyId, employeeId } = await seed(page);
  await panel
    .getByRole("button", { name: "Add entitlement period", exact: true })
    .click();
  let form = panel.getByRole("form", {
    name: "Vacation entitlement",
    exact: true,
  });
  for (const [label, value] of [
    ["Completed service year", "2"],
    ["Normal weekly scheduled hours", "35:00"],
    ["Normal daily scheduled hours", "7:00"],
    ["Opening history covers through", "2026-10-01"],
    ["Vacation already used in opening (hours)", "14:00"],
    ["Reviewed carryover from untracked history (hours)", "7:00"],
    [
      "Opening balance evidence",
      "Reviewed two days used before October 1; actual untracked source",
    ],
    [
      "Additional entitlement / carryover policy evidence",
      "Reviewed seven-hour carryover from the untracked prior anniversary year",
    ],
  ])
    await form.getByLabel(label, { exact: true }).fill(value);
  await checked(
    form,
    "I reviewed complete opening vacation-time history, including any explicit zero balance",
  );
  await form
    .getByRole("button", { name: "Save vacation entitlement", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expect(stat(panel, "Entitlement time")).toHaveText("70 h");
  await expect(stat(panel, "Remaining time")).toHaveText("63 h");
  const periodId = await panel
    .getByLabel("Vacation entitlement period", { exact: true })
    .inputValue();
  const initial = await page.evaluate(
    async ({ societyId, employeeId, periodId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      return client.query("payrollLeave:workspace", {
        societyId,
        employeeId,
        collection: "requests",
        periodId,
      });
    },
    { societyId, employeeId, periodId },
  );
  expect(initial.period.earnedOn).toBe("2026-10-01");
  expect(initial.period.takeBy).toBe("2027-09-30");
  expect(initial.balance.remainingMinutes).toBe(3780);
  await panel
    .getByRole("button", { name: "Add vacation request", exact: true })
    .click();
  form = panel.getByRole("form", { name: "Vacation request", exact: true });
  for (const [label, value] of [
    ["Vacation request label", "Student study break"],
    ["Vacation date 1", "2026-10-22"],
    ["Vacation hours 1", "1:30"],
    [
      "Employee request / approval evidence",
      "Employee requested the exact partial day; reviewed actual request",
    ],
  ])
    await form.getByLabel(label, { exact: true }).fill(value);
  await checked(
    form,
    "Employee requested a vacation period shorter than one week",
  );
  await checked(
    form,
    "Entitled statutory holidays are excluded from these vacation minutes",
  );
  await form
    .getByRole("button", { name: "Save vacation request", exact: true })
    .click();
  await expect(form).toBeHidden();
  let card = panel.getByRole("article", {
    name: "Vacation request: Student study break",
    exact: true,
  });
  await expect(card.getByText("Requested", { exact: true })).toBeVisible();
  await expect(stat(panel, "Requested time")).toHaveText("1 h 30 min");
  await card
    .getByRole("button", { name: "Edit requested leave", exact: true })
    .click();
  form = panel.getByRole("form", { name: "Vacation request", exact: true });
  await form.getByLabel("Vacation hours 1", { exact: true }).fill("3:00");
  await form
    .getByRole("button", { name: "Save vacation request", exact: true })
    .click();
  await expect(form).toBeHidden();
  await expect(stat(panel, "Requested time")).toHaveText("3 h");
  await card
    .getByRole("button", { name: "Approve leave", exact: true })
    .click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await expect(stat(panel, "Available after approved leave")).toHaveText(
    "60 h",
  );
  await expect(stat(panel, "Remaining time")).toHaveText("63 h");
  await card
    .getByRole("button", { name: "Mark leave taken", exact: true })
    .click();
  await expect(card.getByText("Taken", { exact: true })).toBeVisible();
  await expect(stat(panel, "Remaining time")).toHaveText("60 h");
  await page.reload();
  await panel
    .getByLabel("Vacation employee", { exact: true })
    .selectOption(employeeId);
  card = panel.getByRole("article", {
    name: "Vacation request: Student study break",
    exact: true,
  });
  await expect(card.getByText("Taken", { exact: true })).toBeVisible();
  await card
    .getByLabel("Action reason for Student study break", { exact: true })
    .fill(
      "Actual attendance corrected the absence; retained cancellation evidence",
    );
  await card.getByRole("button", { name: "Cancel leave", exact: true }).click();
  await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(stat(panel, "Remaining time")).toHaveText("63 h");
  await card.getByText(/Change history/).click();
  await expect(card).toContainText("status taken");
  await expect(card).toContainText("Actual attendance corrected the absence");
  // Exercise the second request page and a second anniversary period through real endpoints.
  await page.evaluate(
    async ({ societyId, employeeId, periodId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      let count = 0;
      for (let offset = 0; count < 26; offset++) {
        const date = new Date(Date.UTC(2026, 10, 2 + offset)),
          day = date.toISOString().slice(0, 10);
        if ([0, 6].includes(date.getUTCDay()) || day === "2026-11-11") continue;
        count++;
        await client.mutation("payrollLeave:saveRequest", {
          societyId,
          employeeId,
          periodId,
          fields: {
            label:
              count === 26 ? "=Retained source 26" : `Retained source ${count}`,
            days: [{ date: day, minutes: 15 }],
            employeeRequestedShortPeriod: true,
            advanceAgreementConfirmed: false,
            statutoryHolidaysExcluded: true,
            evidence: "Synthetic reviewed exact future partial-day request",
          },
        });
      }
      await client.mutation("payrollLeave:savePeriod", {
        societyId,
        employeeId,
        fields: {
          serviceYear: 3,
          provinceOfEmployment: "BC",
          normalWeeklyMinutes: 2100,
          normalDailyMinutes: 420,
          openingThroughDate: "2026-10-01",
          openingUsedMinutes: 0,
          openingCarryoverMinutes: 0,
          openingReviewed: true,
          openingEvidence: "Reviewed zero opening for planned next anniversary",
          additionalEntitlementMinutes: 0,
        },
      });
    },
    { societyId, employeeId, periodId },
  );
  await expect(
    panel
      .getByLabel("Vacation entitlement period", { exact: true })
      .locator("option"),
  ).toHaveCount(2);
  await panel
    .getByLabel("Vacation entitlement period", { exact: true })
    .selectOption(periodId);
  await expect(panel.getByRole("article")).toHaveCount(27);
  await expect(stat(panel, "Remaining time")).toHaveText("63 h");
  const downloading = page.waitForEvent("download", { timeout: 15000 });
  await panel
    .getByRole("button", { name: "Export vacation time CSV", exact: true })
    .click();
  const download = await downloading;
  await download.saveAs(testInfo.outputPath("vacation-ledger.csv"));
  const csv = await readFile((await download.path())!, "utf8");
  for (const text of [
    '"Remaining minutes","3780"',
    '"Student study break","cancelled"',
    '"\'=Retained source 26"',
    "status_taken",
    "Actual attendance corrected the absence",
  ])
    expect(csv).toContain(text);
  const money = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return client.query("payroll:workspace", { societyId });
  }, societyId);
  expect(money.runs).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("read-only finance membership can review vacation time and export CSV but cannot change persisted entitlement", async ({
  page,
}) => {
  const { societyId, employeeId, readerId, panel } = await seed(page);
  const periodId = await page.evaluate(
    async ({ societyId, employeeId, readerId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
      const periodId = await client.mutation("payrollLeave:savePeriod", {
        societyId,
        employeeId,
        fields: {
          serviceYear: 2,
          provinceOfEmployment: "BC",
          normalWeeklyMinutes: 2100,
          normalDailyMinutes: 420,
          openingThroughDate: "2026-10-01",
          openingUsedMinutes: 0,
          openingCarryoverMinutes: 0,
          openingReviewed: true,
          openingEvidence: "Actual complete zero opening",
          additionalEntitlementMinutes: 0,
        },
      });
      setStoredUserId(readerId);
      return periodId;
    },
    { societyId, employeeId, readerId },
  );
  await page.reload();
  await panel
    .getByLabel("Vacation employee", { exact: true })
    .selectOption(employeeId);
  await expect(stat(panel, "Remaining time")).toHaveText("70 h");
  for (const label of [
    "Add entitlement period",
    "Edit reviewed entitlement",
    "Add vacation request",
  ])
    await expect(
      panel.getByRole("button", { name: label, exact: true }),
    ).toBeDisabled();
  await expect(
    panel.getByRole("button", {
      name: "Export vacation time CSV",
      exact: true,
    }),
  ).toBeEnabled();
  const error = await page.evaluate(
    async ({ societyId, employeeId, periodId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      try {
        await client.mutation("payrollLeave:savePeriod", {
          societyId,
          employeeId,
          id: periodId,
          fields: {
            serviceYear: 2,
            provinceOfEmployment: "BC",
            normalWeeklyMinutes: 2400,
            normalDailyMinutes: 480,
            openingThroughDate: "2026-10-01",
            openingUsedMinutes: 0,
            openingCarryoverMinutes: 0,
            openingReviewed: true,
            openingEvidence: "Unauthorized attempt",
            additionalEntitlementMinutes: 0,
          },
        });
        return "Unexpected success";
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    { societyId, employeeId, periodId },
  );
  expect(error).toContain("financials:write");
  await expect(stat(panel, "Remaining time")).toHaveText("70 h");
});
