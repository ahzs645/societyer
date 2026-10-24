import {
  test,
  expect,
  type Page,
  type Locator,
  type Download,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function checked(scope: Locator, label: string) {
  const input = scope.getByRole("checkbox", { name: label, exact: true });
  if (!(await input.isChecked())) await input.check();
  await expect(input).toBeChecked();
}
async function seeded(page: Page) {
  await page.goto("/app/payroll/calculator?tab=filings");
  await page.evaluate(async () => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", {
      name: "Synthetic filing workspace",
      jurisdictionCode: "CA-BC",
      seedDocumentPackets: false,
      isCharity: false,
      isMemberFunded: false,
    });
    const societyId = created.societyId;
    const owners = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId);
    setStoredUserId(owners.find((row: any) => row.role === "Owner")._id);
    await client.mutation("employees:create", {
      societyId,
      firstName: "Alex",
      lastName: "Synthetic",
      role: "Test employee",
      startDate: "2026-10-01",
      birthDate: "2000-01-01",
      province: "BC",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    });
  });
  await page.reload();
  const panel = page.getByRole("region", {
    name: "Payroll filings",
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Earnings year", { exact: true }).fill("2026");
  await expect(
    panel.getByRole("button", {
      name: "Export source reconciliation CSV",
      exact: true,
    }),
  ).toBeVisible();
  return panel;
}
async function employer(panel: Locator) {
  for (const [label, value] of [
    ["Legal employer name", "Sample Society"],
    ["BN/RP payroll account", "123456782RP0001"],
    ["Filing contact name", "Alex Sample"],
    ["Contact area code", "250"],
    ["Contact seven-digit phone", "5550101"],
    ["Employer Street address", "100 Sample Street"],
    ["Employer City", "Victoria"],
    ["Employer Province/state code", "BC"],
    ["Employer Country code", "CAN"],
    ["Employer Postal/ZIP code", "V8V 1X4"],
  ])
    await panel.getByLabel(label, { exact: true }).fill(value);
}
async function identity(panel: Locator, prefix: string) {
  for (const [label, value] of [
    ["Given name", "Alex"],
    ["Surname", "Synthetic"],
    ["SIN", "046454286"],
    ["Street address", "100 Sample Street"],
    ["City", "Victoria"],
    ["Province/state code", "BC"],
    ["Country code", "CAN"],
    ["Postal/ZIP code", "V8V 1X4"],
  ])
    await panel.getByLabel(`${prefix} ${label}`, { exact: true }).fill(value);
}
async function schema(download: Download, relativeSchema: string) {
  const path = (await download.path())!;
  const checked = spawnSync(
    "python",
    [
      "-c",
      "from lxml import etree;import sys;schema=etree.XMLSchema(etree.parse(sys.argv[1]));schema.assertValid(etree.parse(sys.argv[2]))",
      `shared/payrollSchemas/${relativeSchema}`,
      path,
    ],
    { encoding: "utf8" },
  );
  expect(checked.status, checked.stderr).toBe(0);
  return readFile(path, "utf8");
}
async function noPersistedSin(page: Page) {
  const found = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    for (const info of databases) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const request = db
              .transaction(store, "readonly")
              .objectStore(store)
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (JSON.stringify(values).includes("046454286")) return true;
        }
      } finally {
        db.close();
      }
    }
    return false;
  });
  expect(found, "transient filing SIN must not reach IndexedDB").toBe(false);
  expect(
    await page.evaluate(
      () => `${location.href} ${JSON.stringify(localStorage)}`,
    ),
  ).not.toContain("046454286");
}

test("actual T4A/T619 form generates official-schema XML without persisting transient identifiers", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = await seeded(page);
  await panel.getByLabel("Filing format", { exact: true }).selectOption("T4A");
  await employer(panel);
  for (const [label, value] of [
    ["Submission reference (1–8 letters/digits)", "TEST0001"],
    ["Transmitter name", "Sample Society"],
    ["Transmitter BN9 or BN15", "123456782"],
    ["Transmitter contact email", "example@example.test"],
  ])
    await panel.getByLabel(label, { exact: true }).fill(value);
  await panel
    .getByLabel("Submission schema version", { exact: true })
    .selectOption("2027");
  await panel
    .getByRole("button", { name: "Add T4A recipient", exact: true })
    .click();
  await identity(panel, "T4A recipient 1");
  await panel
    .getByLabel("Fees for services (box 48)", { exact: true })
    .fill("1200.00");
  await panel
    .getByText("Additional T4A information codes", { exact: true })
    .click();
  const extraCodes = [
    "037",
    "104",
    "105",
    "106",
    "107",
    "108",
    "109",
    "110",
    "111",
    "115",
    "116",
    "117",
    "118",
  ];
  for (const [index, code] of extraCodes.entries()) {
    await panel
      .getByRole("button", { name: "Add information code", exact: true })
      .click();
    await panel
      .getByLabel(`Other information ${index + 1} code`, { exact: true })
      .selectOption(code);
    await panel
      .getByLabel(`Other information ${index + 1} amount`, { exact: true })
      .fill(code === "037" ? "-10.00" : "10.00");
  }
  await checked(
    panel,
    "I reviewed this recipient’s relationship and the correct T4A reporting category.",
  );
  await checked(
    panel,
    "I reviewed all source records and required historical amounts for this export.",
  );
  await checked(
    panel,
    "These records belong to this legal employer and the entered payroll account.",
  );
  const downloading = page.waitForEvent("download", { timeout: 15000 });
  await panel
    .getByRole("button", { name: "Download T4A XML", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const download = await downloading;
  await download.saveAs(testInfo.outputPath("synthetic-t4a-2027.xml"));
  const xml = await schema(download, "2027/T619_T4A.xsd");
  expect(xml).toContain("<tx_yr>2026</tx_yr>");
  expect(xml).toContain("<fee_or_oth_srvc_amt>1200.00</fee_or_oth_srvc_amt>");
  expect(xml).toContain("<slp_cnt>2</slp_cnt>");
  expect((xml.match(/<T4A_AMT>/g) ?? []).length).toBe(1);
  expect(xml).toContain("<rpt_tot_oth_info_amt>110.00</rpt_tot_oth_info_amt>");
  await noPersistedSin(page);
  await panel
    .getByRole("button", {
      name: "Clear transient filing identifiers",
      exact: true,
    })
    .click();
  await expect(
    panel.getByLabel("T4A recipient 1 SIN", { exact: true }),
  ).toHaveValue("");
  expect(errors).toEqual([]);
});

test("actual ROE form supports historical periods and all separation blocks in valid Service Canada XML", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = await seeded(page);
  await panel.getByLabel("Filing format", { exact: true }).selectOption("ROE");
  await employer(panel);
  const employee = panel.getByLabel("ROE employee", { exact: true });
  await expect(employee.locator("option")).toHaveCount(2);
  await employee.selectOption({ label: "Alex Synthetic" });
  await identity(panel, "ROE employee");
  for (const [label, value] of [
    ["First day worked since previous ROE", "2026-10-01"],
    ["Last day for which paid", "2026-10-23"],
    ["Final pay period ending", "2026-10-28"],
    ["ROE contact given name", "Alex"],
    ["ROE contact surname", "Sample"],
  ])
    await panel.getByLabel(label, { exact: true }).fill(value);
  await panel
    .getByLabel("ROE pay-period frequency", { exact: true })
    .selectOption("B");
  for (let index = 0; index < 2; index++) {
    await panel
      .getByRole("button", { name: "Add earlier pay period", exact: true })
      .click();
    for (const [label, value] of [
      ["Period start", index === 0 ? "2026-10-15" : "2026-10-01"],
      ["Period end", index === 0 ? "2026-10-28" : "2026-10-14"],
      ["Insurable earnings", index === 0 ? "1500.00" : "1800.00"],
      ["Insurable hours", index === 0 ? "48.2" : "64.2"],
    ])
      await panel
        .getByLabel(`PP${index + 1} ${label}`, { exact: true })
        .fill(value);
  }
  await panel
    .getByLabel("Vacation pay reporting", { exact: true })
    .selectOption("2");
  await panel.getByLabel("ROE vacation amount", { exact: true }).fill("200.00");
  await panel
    .getByText("Additional separation amounts (blocks 17B, 17C and 19)", {
      exact: true,
    })
    .click();
  await panel
    .getByRole("button", { name: "Add statutory holiday", exact: true })
    .click();
  await panel.getByLabel("Holiday 1 date", { exact: true }).fill("2026-11-11");
  await panel.getByLabel("Holiday 1 amount", { exact: true }).fill("100.00");
  await panel
    .getByRole("button", { name: "Add other monies", exact: true })
    .click();
  await panel
    .getByLabel("Other monies 1 amount", { exact: true })
    .fill("200.00");
  await panel
    .getByRole("button", { name: "Add special payment", exact: true })
    .click();
  await panel
    .getByLabel("Special payment 1 amount", { exact: true })
    .fill("100.00");
  await panel
    .getByLabel("Special payment 1 start", { exact: true })
    .fill("2026-10-22");
  await panel
    .getByLabel("Special payment 1 end", { exact: true })
    .fill("2026-10-23");
  await checked(
    panel,
    "I reviewed all separation payments. Final-period earnings include all insurable amounts reported in the separation blocks, and all required entries are included above.",
  );
  await checked(
    panel,
    "I reviewed all source records and required historical amounts for this export.",
  );
  await checked(
    panel,
    "These records belong to this legal employer and the entered payroll account.",
  );
  const downloading = page.waitForEvent("download", { timeout: 15000 });
  await panel
    .getByRole("button", { name: "Download ROE XML", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const download = await downloading;
  await download.saveAs(testInfo.outputPath("synthetic-roe.xml"));
  const xml = await schema(download, "PayrollExtractXmlV2.xsd");
  for (const value of [
    "<B15A>113</B15A>",
    "<B17A>",
    "<B17B>",
    "<B17C>",
    "<B19>",
  ])
    expect(xml).toContain(value);
  await noPersistedSin(page);
  expect(errors).toEqual([]);
});

test("complete recorded sources paginate into one T4 and apply earnings-year caps only after aggregation", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const panel = await seeded(page);
  await page.evaluate(async () => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { getStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const societyId = getStoredSocietyId()!;
    const employees = await client.query("employees:list", { societyId });
    const employeeId = employees.find(
      (row: any) => row.firstName === "Alex",
    )._id;
    for (let index = 0; index < 2; index++) {
      const grossCents = 5000000,
        cppEmployeeCents = index === 0 ? 200000 : 223045,
        cpp2EmployeeCents = index === 0 ? 20000 : 21600,
        eiEmployeeCents = index === 0 ? 50000 : 62307,
        incomeTaxCents = 1000000;
      await client.mutation("payroll:savePayRun", {
        societyId,
        periodStart: index === 0 ? "2026-10-01" : "2026-10-15",
        periodEnd: index === 0 ? "2026-10-14" : "2026-10-28",
        payDate: index === 0 ? "2026-10-16" : "2026-10-30",
        providerName: "Synthetic verified provider",
        providerRunId: `SOURCE-${index}`,
        lines: [
          {
            employeeId,
            employeeName: "Alex Synthetic",
            provinceOfEmployment: "BC",
            grossCents,
            nonCashTaxableCents: 0,
            nonTaxableCashCents: 0,
            cppEmployeeCents,
            cpp2EmployeeCents,
            eiEmployeeCents,
            incomeTaxCents,
            otherDeductionsCents: 0,
            cppEmployerCents: cppEmployeeCents,
            cpp2EmployerCents: cpp2EmployeeCents,
            eiEmployerCents: index === 0 ? 70000 : 87230,
            netCents:
              grossCents -
              cppEmployeeCents -
              cpp2EmployeeCents -
              eiEmployeeCents -
              incomeTaxCents,
            classifiedBases: {
              cashCents: grossCents,
              taxableCents: grossCents,
              pensionableCents: grossCents,
              insurableCents: grossCents,
              vacationableCents: grossCents,
              ehtCents: grossCents,
              workSafeCents: grossCents,
            },
            insurableHours: 80,
          },
        ],
      });
    }
  });
  await expect(panel).toContainText("2 recorded payroll sources");
  await expect(panel).toContainText("Taxable employment income $100000.00");
  await employer(panel);
  for (const [label, value] of [
    ["Submission reference (1–8 letters/digits)", "TESTT401"],
    ["Transmitter name", "Sample Society"],
    ["Transmitter BN9 or BN15", "123456782"],
    ["Transmitter contact email", "example@example.test"],
  ])
    await panel.getByLabel(label, { exact: true }).fill(value);
  await panel
    .getByLabel("Submission schema version", { exact: true })
    .selectOption("2027");
  await identity(panel, "Alex Synthetic");
  await panel
    .getByLabel("Employer dental benefit code (box 45)", { exact: true })
    .selectOption("3");
  await panel.getByLabel("CPP exempt", { exact: true }).selectOption("no");
  await panel.getByLabel("EI exempt", { exact: true }).selectOption("no");
  await checked(
    panel,
    "I reviewed all source records and required historical amounts for this export.",
  );
  await checked(
    panel,
    "These records belong to this legal employer and the entered payroll account.",
  );
  const downloading = page.waitForEvent("download", { timeout: 15000 });
  await panel
    .getByRole("button", { name: "Download T4 XML", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  const download = await downloading;
  await download.saveAs(testInfo.outputPath("synthetic-source-t4.xml"));
  const xml = await schema(download, "2027/T619_T4.xsd");
  for (const value of [
    "<slp_cnt>1</slp_cnt>",
    "<tx_yr>2026</tx_yr>",
    "<empt_incamt>100000.00</empt_incamt>",
    "<cpp_qpp_ern_amt>85000.00</cpp_qpp_ern_amt>",
    "<ei_insu_ern_amt>68900.00</ei_insu_ern_amt>",
    "<cppe_cntrb_amt>416.00</cppe_cntrb_amt>",
    "<tot_empr_cppe_amt>416.00</tot_empr_cppe_amt>",
  ])
    expect(xml).toContain(value);
  await noPersistedSin(page);
  expect(errors).toEqual([]);
});
