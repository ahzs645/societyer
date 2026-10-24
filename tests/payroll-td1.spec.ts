import {
  assertPayrollFits,
  checkPayrollResponsiveViewport,
  watchPayrollResponsiveErrors,
} from "./helpers/payrollResponsiveChecks";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { officialTd1Fixture as official } from "./helpers/payrollTd1Files";

test.beforeEach(watchPayrollResponsiveErrors);
test.afterEach(checkPayrollResponsiveViewport);

async function seed(page: Page) {
  await page.goto("/app/payroll/calculator?tab=td1");
  await expect(
    page.getByRole("heading", { name: "Payroll calculator", exact: true }),
  ).toBeVisible();
  const data = await page.evaluate(async () => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", {
      name: "Synthetic TD1 browser review",
      jurisdictionCode: "CA-BC",
      seedDocumentPackets: false,
      isCharity: false,
      isMemberFunded: false,
    });
    const societyId = created.societyId,
      users = await client.query("users:list", { societyId }),
      ownerId = users.find((u: any) => u.role === "Owner")._id;
    setStoredSocietyId(societyId);
    setStoredUserId(ownerId);
    const employeeId = await client.mutation("employees:create", {
      societyId,
      firstName: "Jordan",
      lastName: "TD1 review",
      role: "Synthetic fixture",
      startDate: "2025-01-01",
      birthDate: "1990-01-01",
      province: "BC",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    });
    const readerId = await client.mutation("users:upsert", {
      societyId,
      email: "td1-reader@example.test",
      displayName: "TD1 read-only director",
      role: "Director",
      status: "Active",
    });
    return { societyId, employeeId, ownerId, readerId };
  });
  await page.reload();
  const panel = page.getByRole("region", { name: "TD1 import", exact: true });
  await panel
    .getByLabel("TD1 employee", { exact: true })
    .selectOption(data.employeeId);
  await expect(
    panel.getByRole("form", { name: "Reviewed TD1 import", exact: true }),
  ).toBeVisible();
  return { ...data, panel };
}
const formReview = (scope: Locator, form: "Federal TD1" | "BC TD1") =>
  scope.getByRole("group", { name: `${form} review`, exact: true });
async function confirmations(scope: Locator, title: string) {
  await scope
    .getByLabel(
      `I confirmed ordinary Canadian resident treatment for this ${title}`,
      { exact: true },
    )
    .check();
  await scope
    .getByLabel(
      `I reviewed the employee’s signed and dated ${title} declaration`,
      { exact: true },
    )
    .check();
  await scope
    .getByLabel(
      `I reviewed every claim and declaration flag against the ${title}`,
      { exact: true },
    )
    .check();
}
async function manual(scope: Locator, title: "Federal TD1" | "BC TD1") {
  await scope
    .getByLabel(`${title} review source`, { exact: true })
    .selectOption("manual");
  await scope
    .getByLabel(`${title} annual total claim amount`, { exact: true })
    .fill("20000.00");
  await scope
    .getByLabel(`${title} concurrent employer/payer declaration`, {
      exact: true,
    })
    .selectOption("no");
  await scope
    .getByLabel(`${title} total income below total claims declaration`, {
      exact: true,
    })
    .selectOption("no");
  if (title === "Federal TD1") {
    await scope
      .getByLabel("Federal TD1 additional withholding per payment", {
        exact: true,
      })
      .fill("0");
    await scope
      .getByLabel("Federal TD1 annual prescribed-zone deduction", {
        exact: true,
      })
      .fill("0");
  }
  await scope
    .getByLabel(`${title} actual source page count`, { exact: true })
    .fill("2");
  await scope
    .getByLabel(`${title} review reference`, { exact: true })
    .fill("Restricted signed paper record reviewed by employer");
}

test("actual official PDFs require independent review and retain sanitized payment-date declarations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const data = await seed(page),
    panel = data.panel,
    federal = formReview(panel, "Federal TD1"),
    bc = formReview(panel, "BC TD1");
  const requests: Array<{
    url: string;
    body: string;
    type: string;
    method: string;
  }> = [];
  page.on("request", (request) =>
    requests.push({
      url: request.url(),
      body: request.postData() ?? "",
      type: request.resourceType(),
      method: request.method(),
    }),
  );
  await federal
    .getByLabel("Federal TD1 file", { exact: true })
    .setInputFiles(await official("td1"));
  await expect(
    federal.getByLabel("Federal TD1 annual total claim amount", {
      exact: true,
    }),
  ).toHaveValue("20000.00");
  await expect(federal).toContainText("Manual field review required");
  await expect(
    federal.getByLabel(
      "I reviewed the employee’s signed and dated Federal TD1 declaration",
      { exact: true },
    ),
  ).not.toBeChecked();
  await bc
    .getByLabel("BC TD1 file", { exact: true })
    .setInputFiles(await official("td1bc"));
  await expect(
    bc.getByLabel("BC TD1 annual total claim amount", { exact: true }),
  ).toHaveValue("0.00");
  await expect(
    bc.getByLabel("BC TD1 concurrent employer/payer declaration", {
      exact: true,
    }),
  ).toHaveValue("yes");
  await federal
    .getByText("Federal TD1 field and page evidence", { exact: true })
    .click();
  await expect(federal).toContainText("high confidence");
  await expect(federal).toContainText("page 1");
  await expect(panel).not.toContainText("PRIVATE-SYNTHETIC-NAME");
  await expect(panel).not.toContainText("046454286");
  await panel
    .getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText("reviews are required");
  await federal
    .getByLabel("Federal TD1 review reference", { exact: true })
    .fill("Federal original reviewed in restricted records");
  await bc
    .getByLabel("BC TD1 review reference", { exact: true })
    .fill("BC original reviewed in restricted records");
  await confirmations(federal, "Federal TD1");
  await confirmations(bc, "BC TD1");
  const illustration = panel.getByRole("region", {
    name: "TD1 withholding illustration",
    exact: true,
  });
  await illustration
    .getByRole("button", {
      name: "Calculate illustrative withholding",
      exact: true,
    })
    .click();
  await expect(illustration).toContainText(
    "Income tax with these reviewed declarations",
  );
  await panel.getByLabel("TD1 received on", { exact: true }).fill("2026-01-01");
  await panel
    .getByLabel("TD1 effective from", { exact: true })
    .fill("2026-02-01");
  await panel
    .getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Reviewed declarations saved",
  );
  const stored = await page.evaluate(
    async ({ societyId, employeeId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      return {
        declarations: await client.query("payrollTd1:workspace", {
          societyId,
          employeeId,
        }),
        profiles: await client.query("payrollCalculation:workspace", {
          societyId,
          collection: "profiles",
        }),
      };
    },
    { societyId: data.societyId, employeeId: data.employeeId },
  );
  expect(stored.declarations.page).toHaveLength(2);
  expect(stored.profiles.page).toHaveLength(0);
  const f = stored.declarations.page.find((r: any) => r.form === "federal"),
    p = stored.declarations.page.find((r: any) => r.form === "BC");
  expect(f.totalClaimCents).toBe(2_000_000);
  expect(f.additionalTaxCents).toBe(2550);
  expect(f.multipleEmployers).toBe(false);
  expect(p.multipleEmployers).toBe(true);
  expect(p.totalClaimCents).toBe(0);
  for (const record of stored.declarations.page) {
    expect(record.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.effectiveFrom).toBe("2026-02-01");
    expect(record.originalStored).toBe(false);
    expect(record.employeeElectronicSignatureCertified).toBe(false);
  }
  for (const privateText of [
    "046454286",
    "PRIVATE-SYNTHETIC",
    "rawText",
    "claimLines",
    "signatureImage",
  ])
    expect(JSON.stringify(stored)).not.toContain(privateText);
  expect(
    requests.filter(
      (r) =>
        !r.url.startsWith(new URL(page.url()).origin) &&
        !r.url.startsWith("blob:") &&
        !r.url.startsWith("data:") &&
        !(
          r.type === "font" &&
          r.method === "GET" &&
          new URL(r.url).hostname === "fonts.gstatic.com"
        ),
    ),
  ).toEqual([]);
  expect(requests.some((r) => /046454286|PRIVATE-SYNTHETIC/.test(r.body))).toBe(
    false,
  );
  await page.reload();
  await panel
    .getByLabel("TD1 employee", { exact: true })
    .selectOption(data.employeeId);
  const history = panel.getByRole("region", {
    name: "Reviewed TD1 history",
    exact: true,
  });
  await expect(history).toContainText("effective 2026-02-01");
  await history
    .getByText("Federal TD1 · applicable 2026 · effective 2026-02-01", {
      exact: true,
    })
    .click();
  await expect(history).toContainText("Document SHA-256:");
  await mkdir("/workspace/scratch", { recursive: true });
  await page.screenshot({
    path: "/workspace/scratch/payroll-operations-td1.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("wrong jurisdiction blocks upload and explicit prior-year manual review imports one form without fabricating a hash", async ({
  page,
}) => {
  const data = await seed(page),
    panel = data.panel,
    federal = formReview(panel, "Federal TD1"),
    bc = formReview(panel, "BC TD1");
  await federal
    .getByLabel("Federal TD1 file", { exact: true })
    .setInputFiles(await official("td1bc"));
  await expect(federal).toContainText("File cannot be applied");
  await bc.getByLabel("Apply BC TD1", { exact: true }).uncheck();
  await manual(federal, "Federal TD1");
  await federal
    .getByLabel("Federal TD1 actual source form year", { exact: true })
    .fill("2025");
  await confirmations(federal, "Federal TD1");
  await panel
    .getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "prior-year form applicability",
  );
  await federal
    .getByLabel(
      "I reviewed the older declaration’s continued applicability and current indexed claims for 2026",
      { exact: true },
    )
    .check();
  await federal
    .getByLabel("Federal TD1 prior-year applicability reference", {
      exact: true,
    })
    .fill("Circumstances unchanged; current indexed claims reviewed");
  await panel
    .getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Reviewed declarations saved",
  );
  const rows = await page.evaluate(
    async ({ societyId, employeeId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      return (
        await client.query("payrollTd1:workspace", { societyId, employeeId })
      ).page;
    },
    { societyId: data.societyId, employeeId: data.employeeId },
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].sourceFormYear).toBe(2025);
  expect(rows[0].source.method).toBe("manual");
  expect(rows[0].source.sha256).toBeUndefined();
  expect(rows[0].priorYearReviewed).toBe(true);
  await federal.getByLabel("Apply Federal TD1", { exact: true }).uncheck();
  await bc.getByLabel("Apply BC TD1", { exact: true }).check();
  await manual(bc, "BC TD1");
  await confirmations(bc, "BC TD1");
  await panel
    .getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Reviewed declarations saved",
  );
  const independent = await page.evaluate(
    async ({ societyId, employeeId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      return (
        await client.query("payrollTd1:workspace", { societyId, employeeId })
      ).page;
    },
    { societyId: data.societyId, employeeId: data.employeeId },
  );
  expect(independent).toHaveLength(2);
  expect(independent.find((record: any) => record.form === "federal")._id).toBe(
    rows[0]._id,
  );
  await page.evaluate(async (id) => {
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    setStoredUserId(id);
  }, data.readerId);
  await page.reload();
  await panel
    .getByLabel("TD1 employee", { exact: true })
    .selectOption(data.employeeId);
  await expect(
    panel.getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("region", { name: "Reviewed TD1 history", exact: true }),
  ).toContainText("effective");
});

test("registered views keep old deep links and persist user-scoped visibility, favorites, ordering and expanded sections", async ({
  page,
}) => {
  const data = await seed(page),
    nav = page.getByRole("navigation", {
      name: "Payroll calculator sections",
      exact: true,
    });
  await page.getByText("Customize payroll views", { exact: true }).click();
  const settings = page.getByRole("table", {
    name: "Payroll view preferences",
    exact: true,
  });
  await expect(
    settings.getByLabel("Show Calculate", { exact: true }),
  ).toBeDisabled();
  await settings.getByLabel("Show Tools", { exact: true }).uncheck();
  await settings.getByLabel("Favorite TD1 import", { exact: true }).check();
  await settings
    .getByRole("button", { name: "Move Employee profiles down", exact: true })
    .click();
  await expect(
    nav.getByRole("button", { name: "Tools", exact: true }),
  ).toHaveCount(0);
  await expect(nav.getByRole("button").nth(0)).toHaveText("Calculate");
  await expect(nav.getByRole("button").nth(1)).toContainText("TD1 import");
  await page.getByText("TD1 import section", { exact: true }).click();
  await page.reload();
  await expect(
    page.locator("details.payroll-calculator__view-section"),
  ).not.toHaveAttribute("open");
  await page.goto("/app/payroll/calculator?tab=tools");
  await expect(
    page.getByRole("region", {
      name: "Mileage reimbursement calculator",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Show Tools in navigation", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("button", { name: "Tools", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(async (id) => {
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    setStoredUserId(id);
  }, data.readerId);
  await page.reload();
  await expect(
    nav.getByRole("button", { name: "Tools", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (id) => {
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    setStoredUserId(id);
  }, data.ownerId);
  await page.reload();
  await expect(
    nav.getByRole("button", { name: "Tools", exact: true }),
  ).toHaveCount(0);
  await page.getByText("Customize payroll views", { exact: true }).click();
  await page
    .getByRole("button", { name: "Reset payroll views", exact: true })
    .click();
  await expect(
    nav.getByRole("button", { name: "Tools", exact: true }),
  ).toBeVisible();
  await page.goto("/app/payroll/calculator?tab=profiles");
  await page
    .getByRole("button", { name: "New employee profile", exact: true })
    .click();
  const profile = page.getByRole("form", {
    name: "Employee profile",
    exact: true,
  });
  await profile
    .getByLabel("Employee", { exact: true })
    .selectOption(data.employeeId);
  await profile
    .getByRole("button", {
      name: "Import reviewed federal and BC TD1",
      exact: true,
    })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByRole("region", { name: "TD1 import", exact: true }),
  ).toBeVisible();
  expect(await drawer.locator("form form").count()).toBe(0);
  await expect(drawer.getByLabel("TD1 employee", { exact: true })).toHaveValue(
    data.employeeId,
  );
  const imported = drawer.getByRole("region", {
    name: "TD1 import",
    exact: true,
  });
  await formReview(imported, "BC TD1")
    .getByLabel("Apply BC TD1", { exact: true })
    .uncheck();
  await manual(formReview(imported, "Federal TD1"), "Federal TD1");
  await confirmations(formReview(imported, "Federal TD1"), "Federal TD1");
  await imported
    .getByRole("button", {
      name: "Apply reviewed TD1 declarations",
      exact: true,
    })
    .click();
  await expect(imported.getByRole("status")).toContainText(
    "Reviewed declarations saved",
  );
  await assertPayrollFits(page);
  await expect(page.locator('form[aria-label="Employee profile"]')).toHaveCount(
    1,
  );
  await drawer
    .getByRole("button", { name: "Close drawer", exact: true })
    .click();
  await expect(profile).toBeVisible();
  const profileRows = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return (
      await client.query("payrollCalculation:workspace", {
        societyId,
        collection: "profiles",
      })
    ).page;
  }, data.societyId);
  expect(profileRows).toHaveLength(0);
});
