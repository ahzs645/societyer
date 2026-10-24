import { checkPayrollResponsiveViewport, watchPayrollResponsiveErrors } from "./helpers/payrollResponsiveChecks";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(watchPayrollResponsiveErrors);
test.afterEach(checkPayrollResponsiveViewport);

test("manual payroll edition is edited, reviewed, published, selected and frozen through real UI", async ({
  page,
}) => {
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/payroll/calculator?tab=rules");
  await expect(
    page.getByRole("heading", { name: "Payroll calculator", exact: true }),
  ).toBeVisible();
  const societyId = await page.evaluate(async () => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const result = await client.mutation("society:createWorkspace", {
      name: "Synthetic payroll rule library QA",
      jurisdictionCode: "CA-BC",
      seedDocumentPackets: false,
      isCharity: false,
      isMemberFunded: false,
    });
    const users = await client.query("users:list", {
      societyId: result.societyId,
    });
    setStoredSocietyId(result.societyId);
    setStoredUserId(users.find((row: any) => row.role === "Owner")._id);
    return result.societyId;
  });
  await page.reload();
  const library = page.getByRole("region", {
    name: "Payroll rules library",
    exact: true,
  });
  await expect(library).toBeVisible();
  await library
    .getByRole("button", { name: "Clone 2026-01-BC-option1", exact: true })
    .click();
  const editor = page.getByRole("region", {
    name: "Payroll rule editor",
    exact: true,
  });
  await editor
    .getByLabel("Rule edition name", { exact: true })
    .fill("Synthetic EI revision");
  await editor
    .getByText("EI employee rate and annual caps", { exact: true })
    .click();
  await editor.getByLabel("EI Rate (%)", { exact: true }).fill("2");
  await editor.getByLabel("EI Maximum (CAD)", { exact: true }).fill("1378.00");
  await editor
    .getByLabel("EI Employer Maximum (CAD)", { exact: true })
    .fill("1929.20");
  await editor
    .getByLabel("Rule source 1 notes", { exact: true })
    .fill(
      "Synthetic QA edition only: explicit2percent employee EI and consistent annual caps; actual payroll requires reviewed official evidence.",
    );
  await editor
    .getByRole("button", { name: "Validate and compare rules", exact: true })
    .click();
  const comparison = editor.getByRole("region", {
    name: "Rule calculation comparison",
    exact: true,
  });
  await expect(
    comparison.getByRole("row", { name: /Employee EI/ }),
  ).toContainText("$81.50");
  await expect(
    comparison.getByRole("row", { name: /Employee EI/ }),
  ).toContainText("$100.00");
  await editor
    .getByRole("button", { name: "Save working draft", exact: true })
    .click();
  await expect(editor).toBeHidden();
  let card = library.getByRole("article", {
    name: "Rule edition Synthetic EI revision",
    exact: true,
  });
  await expect(card).toContainText(
    "revision1".replace("revision1", "revision 1"),
  );
  await card
    .getByLabel("Rule review evidence", { exact: true })
    .fill(
      "QA: checked explicit percentages versus decimal JSON, annual caps, Option1 dates, archived baseline and synthetic evidence.",
    );
  await card
    .getByRole("checkbox", {
      name: "I reviewed the exact rates, caps, brackets, effective dates and official source evidence",
      exact: true,
    })
    .check();
  await card
    .getByRole("button", { name: "Review exact edition", exact: true })
    .click();
  await expect(card).toContainText("reviewed");
  await card
    .getByRole("button", { name: "Publish reviewed edition", exact: true })
    .click();
  await expect(card).toContainText("published");
  const download = page.waitForEvent("download");
  await card
    .getByRole("button", { name: "Export edition JSON", exact: true })
    .click();
  const file = await download;
  const exported = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(exported.draft.rateSet.ei.rate).toBe("0.02");
  expect(exported.provenance.status).toBe("published");
  await page.reload();
  await expect(
    page.getByRole("article", {
      name: "Rule edition Synthetic EI revision",
      exact: true,
    }),
  ).toContainText("published");
  const fixture = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { emptyPayrollYtd } = await import("/shared/payrollDeductions.ts");
    const rules = await client.query("payrollRules:workspace", {
      societyId,
      status: "published",
      year: 2026,
    });
    const edition = rules.page.find(
      (row: any) => row.name === "Synthetic EI revision",
    );
    const employeeId = await client.mutation("employees:create", {
      societyId,
      firstName: "Casey",
      lastName: "Rules QA",
      role: "Synthetic fixture",
      startDate: "2025-01-01",
      birthDate: "1990-01-01",
      province: "BC",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    });
    await client.mutation("payrollCalculation:saveEmployerSettings", {
      societyId,
      fields: {
        year: 2026,
        payFrequency: "semimonthly",
        payDates: Array.from({ length: 12 }, (_, i) => [
          `2026-${String(i + 1).padStart(2, "0")}-15`,
          new Date(Date.UTC(2026, i + 1, 0)).toISOString().slice(0, 10),
        ]).flat(),
        eiEmployerMultiplier: 1.4,
        ehtEmployerClass: "ordinary",
        ehtOpeningRemunerationCents: 0,
        ehtOpeningThroughDate: "2025-12-31",
        ehtOpeningConfirmed: true,
        ehtOpeningSourceReference: "Confirmed zero annual employer opening",
        ehtOpeningRepresentedPayRunIds: [],
        ehtAssociated: false,
        ehtPermanentEstablishmentDays: 365,
        workSafeRatePer100Dollars: 0,
        workSafeAssessableLimitCents: 12750000,
        workSafeClassificationCode: "Reviewed synthetic classification",
        workSafeRateEvidence: "Reviewed zero net-rate fixture",
        employerBenefitsCentsPerPay: 0,
        employerPensionPercent: 0,
      },
    });
    await client.mutation("payrollCalculation:saveProfile", {
      societyId,
      employeeId,
      fields: {
        effectiveFrom: "2025-01-01",
        provinceOfEmployment: "BC",
        employmentKind: "ordinary",
        compensation: "hourly",
        rateCents: 2500,
        normalWeeklyMinutes: 2400,
        averageWeeklyMinutes: 2400,
        policy: "ordinary_bc",
        restPeriodsConfirmed: true,
        historyCompleteFrom: "2025-01-01",
        historyCompleteThrough: "2026-12-31",
        ytdConfirmed: true,
        vacationMode: "accrue",
        td1: {
          confirmed: true,
          declarationReference: "Reviewed current employee TD1",
        },
        cpp: { exempt: false },
        eiExempt: false,
      },
    });
    await client.mutation("payrollCalculation:saveOpeningBalance", {
      societyId,
      employeeId,
      fields: {
        year: 2026,
        coveredThroughDate: "2025-12-31",
        sameEmployerConfirmed: true,
        sourceReference: "Complete zero opening",
        ytd: emptyPayrollYtd(),
        insurableHours: 0,
        cashPaidCents: 0,
        netPaidCents: 0,
        vacationBalanceCents: 0,
        workSafeAssessableCents: 0,
        sickPaidDaysUsed: 0,
        sickUnpaidDaysUsed: 0,
        representedPayRunIds: [],
      },
    });
    await client.mutation("payrollCalculation:saveWorkDay", {
      societyId,
      employeeId,
      fields: { date: "2026-05-05", minutes: 480 },
    });
    return { id: edition._id, hash: edition.contentHash, employeeId };
  }, societyId);
  await page.goto("/app/payroll/calculator?tab=calculate");
  const form = page.getByRole("form", {
    name: "Payroll run inputs",
    exact: true,
  });
  await form.getByLabel("Pay period start", { exact: true }).fill("2026-05-01");
  await form.getByLabel("Pay period end", { exact: true }).fill("2026-05-15");
  await form.getByLabel("Payment date", { exact: true }).fill("2026-05-15");
  await form
    .getByLabel("Payroll rule edition", { exact: true })
    .selectOption(fixture.id);
  await form.getByRole("checkbox", { name: /Casey Rules QA/ }).check();
  await form
    .getByRole("button", { name: "Preview calculation", exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: "Live payroll preview",
    exact: true,
  });
  await expect(preview.getByRole("alert")).toHaveCount(0);
  await expect(preview).toContainText("$4.00");
  await preview
    .getByRole("button", { name: "Save payroll draft", exact: true })
    .click();
  const frozen = await page.evaluate(
    async ({ societyId, fixture }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      const rows = await client.query("payrollCalculation:workspace", {
        societyId,
        collection: "calculations",
        year: 2026,
      });
      const result = await client.query("payrollCalculation:workspace", {
        societyId,
        collection: "calculation",
        id: rows.page[0]._id,
      });
      return {
        selected: result.detail.input.ruleEditionId,
        hash: result.detail.result.ruleEdition.contentHash,
        ei: result.detail.result.employees[0].deductions.eiEmployeeCents,
      };
    },
    { societyId, fixture },
  );
  expect(frozen).toEqual({ selected: fixture.id, hash: fixture.hash, ei: 400 });
  expect(errors).toEqual([]);
});
