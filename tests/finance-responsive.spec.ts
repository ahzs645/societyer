import {
  test,
  expect,
  type Page,
  type Locator,
  type TestInfo,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

async function freshWorkspace(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const result = await client.mutation("society:createWorkspace", {
      name,
      jurisdictionCode: "CA-BC",
      seedDocumentPackets: false,
      isCharity: false,
      isMemberFunded: false,
    });
    const users = await client.query("users:list", {
      societyId: result.societyId,
    });
    setStoredSocietyId(result.societyId);
    setStoredUserId(users.find((user: any) => user.role === "Owner")._id);
    return result.societyId;
  }, name);
}
async function pick(page: Page, scope: Locator, label: string, value: string) {
  const labelled = scope.getByLabel(label, { exact: true });
  const input = (await labelled.count())
    ? labelled
    : scope.getByRole("button", { name: label, exact: true });
  if (await input.evaluate((element) => element.tagName === "SELECT"))
    await input.selectOption({ label: value });
  else {
    await input.click();
    await page.getByRole("option", { name: value, exact: true }).click();
  }
}
async function checked(scope: Locator, label: string, value = true) {
  const input = scope.getByRole("checkbox", { name: label, exact: true });
  if ((await input.isChecked()) !== value)
    await scope.getByText(label, { exact: true }).click();
  if (value) await expect(input).toBeChecked();
  else await expect(input).not.toBeChecked();
}
async function noPageOverflow(page: Page, testInfo: TestInfo, stage: string) {
  const result = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      dialogOpen: [
        ...document.querySelectorAll<HTMLElement>("[role=dialog]"),
      ].some((element) => element.getBoundingClientRect().width > 0),
      pages: [...document.querySelectorAll<HTMLElement>(".page")].map(
        (element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          left: element.getBoundingClientRect().left,
          right: element.getBoundingClientRect().right,
        }),
      ),
      offenders: [...document.querySelectorAll("main *, [role=main] *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            class: element.className.toString().slice(0, 150),
            left: rect.left,
            right: rect.right,
            width: rect.width,
            text: element.textContent?.slice(0, 80),
          };
        })
        .filter((row) => row.width > 0 && row.right > viewport + 2)
        .slice(0, 30),
    };
  });
  await testInfo.attach(`${stage}-viewport`, {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.documentWidth, stage).toBeLessThanOrEqual(result.viewport + 2);
  expect(result.bodyWidth, stage).toBeLessThanOrEqual(result.viewport + 2);
  for (const panel of result.pages) {
    expect(
      panel.scrollWidth,
      `${stage}: page content remains bounded`,
    ).toBeLessThanOrEqual(
      (result.dialogOpen ? result.viewport - panel.left : panel.clientWidth) +
        2,
    );
    expect(panel.right, `${stage}: page fits viewport`).toBeLessThanOrEqual(
      result.viewport + 2,
    );
  }
}
async function panToLastColumn(
  page: Page,
  wrapper: Locator,
  testInfo: TestInfo,
  stage: string,
) {
  if (!testInfo.project.use.hasTouch) return;
  await wrapper.scrollIntoViewIfNeeded();
  await wrapper.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const session = await page.context().newCDPSession(page);
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const remaining = await wrapper.evaluate(
        (element) =>
          element.scrollWidth - element.clientWidth - element.scrollLeft,
      );
      if (remaining <= 2) break;
      const rect = await wrapper.boundingBox();
      if (!rect) throw new Error(`${stage}: missing table viewport`);
      const start = rect.x + rect.width - 24,
        end = rect.x + 24;
      const y = rect.y + Math.min(72, rect.height / 2);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: start, y, id: 1 }],
      });
      for (let step = 1; step <= 8; step++)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: start + ((end - start) * step) / 8, y, id: 1 }],
        });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    }
  } finally {
    await session.detach();
  }
  await expect
    .poll(
      () =>
        wrapper.evaluate(
          (element) =>
            element.scrollWidth - element.clientWidth - element.scrollLeft,
        ),
      {
        message: `${stage}: an actual touch pan reaches the last column`,
      },
    )
    .toBeLessThanOrEqual(2);
  const lastHeader = wrapper.locator("thead th").last();
  const bounds = await wrapper.boundingBox(),
    last = await lastHeader.boundingBox();
  expect(
    bounds && last && last.x + last.width <= bounds.x + bounds.width + 2,
  ).toBe(true);
  await wrapper.screenshot({
    path: testInfo.outputPath(`${stage}-last-column.png`),
  });
  await wrapper.evaluate((element) => {
    element.scrollLeft = 0;
  });
}
async function pdfText(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  }).promise;
  let text = "";
  for (let number = 1; number <= pdf.numPages; number++)
    text +=
      (await (await pdf.getPage(number)).getTextContent()).items
        .map((item: any) => item.str ?? "")
        .join(" ") + " ";
  await pdf.destroy();
  return text;
}

test("semester recurrence and staff edits propagate through live totals, exports and reload at each viewport", async ({
  page,
}, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/financials/planning");
  await expect(
    page.getByRole("heading", { name: "Semester cost planner", exact: true }),
  ).toBeVisible();
  await freshWorkspace(page, `Responsive planner ${testInfo.project.name}`);
  await page.reload();
  await page.getByRole("button", { name: "New period", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Period name", { exact: true })
    .fill("Winter responsive plan");
  await dialog.getByLabel("Start date", { exact: true }).fill("2027-01-01");
  await dialog.getByLabel("End date", { exact: true }).fill("2027-04-30");
  await dialog.getByLabel("Currency", { exact: true }).fill("CAD");
  await dialog.getByLabel("Allocation", { exact: true }).fill("10000.00");
  await dialog.getByLabel("Opening balance", { exact: true }).fill("500.00");
  await dialog.getByLabel("Reserve", { exact: true }).fill("1000.00");
  await pick(page, dialog, "Forecast basis", "Allocated · covered period");
  await noPageOverflow(page, testInfo, "planner-period-drawer");
  await dialog
    .getByRole("button", { name: "Save period", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  for (const entry of [
    {
      name: "Annual insurance",
      category: "Insurance",
      amount: "1200.00",
      recurrence: "Annually",
      start: "2026-09-01",
    },
    {
      name: "Monthly software",
      category: "Software",
      amount: "100.00",
      recurrence: "Monthly",
      start: "2027-01-01",
    },
  ]) {
    await page.getByRole("button", { name: "New cost", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Cost name", { exact: true }).fill(entry.name);
    await dialog.getByLabel("Category", { exact: true }).fill(entry.category);
    await dialog.getByLabel("Cost currency", { exact: true }).fill("CAD");
    await dialog.getByLabel("Cost amount", { exact: true }).fill(entry.amount);
    await pick(page, dialog, "Recurrence", entry.recurrence);
    await dialog
      .getByLabel("Coverage starts", { exact: true })
      .fill(entry.start);
    await dialog
      .getByLabel("First payment / renewal date", { exact: true })
      .fill(entry.start);
    await pick(page, dialog, "Cost status", "Committed");
    await dialog
      .getByRole("button", { name: "Save cost", exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
  await page
    .getByRole("button", { name: "Add staff cost", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Staff / position name", { exact: true })
    .fill("Semester assistant");
  await dialog
    .getByLabel("Employment start date", { exact: true })
    .fill("2027-01-01");
  await dialog
    .getByLabel("Employment end date", { exact: true })
    .fill("2027-04-30");
  await pick(page, dialog, "Compensation basis", "Hourly");
  await dialog.getByLabel("Rate (CAD)", { exact: true }).fill("20.00");
  await dialog.getByLabel("Hours per week", { exact: true }).fill("10");
  await pick(page, dialog, "Pay frequency", "Monthly");
  await dialog.getByLabel("First pay date", { exact: true }).fill("2027-01-31");
  await dialog.getByLabel("Vacation pay (%)", { exact: true }).fill("4");
  await dialog
    .getByLabel("Employer contributions (%)", { exact: true })
    .fill("10");
  await dialog
    .getByLabel("Monthly benefits (CAD)", { exact: true })
    .fill("50.00");
  await checked(dialog, "I reviewed these staff cost assumptions");
  await noPageOverflow(page, testInfo, "planner-staff-drawer");
  await dialog
    .getByRole("button", { name: "Save staff cost", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const summary = page.getByRole("region", {
    name: "Budget summary",
    exact: true,
  });
  await expect(summary).toContainText("$4,929.88");
  await expect(summary).toContainText("$4,535.36");
  await expect(summary).toContainText("$4,570.12");
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Semester assistant" }),
  ).toContainText("$4,135.36");
  await page.getByRole("button", { name: "Costs", exact: true }).click();
  const insurance = page
    .getByRole("row")
    .filter({ hasText: "Annual insurance" });
  await expect(insurance).toContainText("$394.52");
  await expect(insurance).toContainText("$0.00");
  const costViewport = page
    .getByRole("table", { name: "Reusable planning costs", exact: true })
    .locator("..");
  await panToLastColumn(page, costViewport, testInfo, "planner-costs");
  await costViewport.screenshot({
    path: testInfo.outputPath("planner-costs.png"),
  });
  await expect(
    page
      .getByRole("region", { name: "Monthly forecast", exact: true })
      .getByRole("img"),
  ).toBeVisible();
  await noPageOverflow(page, testInfo, "planner-allocated");
  await page
    .getByRole("region", { name: "Monthly forecast", exact: true })
    .screenshot({ path: testInfo.outputPath("planner-monthly-chart.png") });
  await page.screenshot({
    path: testInfo.outputPath("planner-allocated.png"),
    fullPage: true,
  });
  let downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = (await readFile((await (await downloading).path())!)).toString();
  expect(csv).toContain("4135.36");
  expect(csv).toContain("394.52");
  await page
    .getByRole("button", { name: "Edit cost Monthly software", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Cost amount", { exact: true }).fill("125.00");
  await dialog.getByRole("button", { name: "Save cost", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(summary).toContainText("$5,029.88");
  await expect(summary).toContainText("$4,635.36");
  await expect(summary).toContainText("$4,470.12");
  await pick(
    page,
    page.locator(".cost-planner__toolbar"),
    "Forecast basis",
    "Cash · dated payments",
  );
  await expect(summary).toContainText("$4,864.64");
  await page.reload();
  await expect(summary).toContainText("$4,864.64");
  await expect(
    page.getByRole("row").filter({ hasText: "Monthly software" }),
  ).toContainText("$500.00");
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Edit staff cost Semester assistant",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Hours per week", { exact: true }),
  ).toHaveValue("10");
  await dialog.getByLabel("Hours per week", { exact: true }).fill("11");
  await expect(
    dialog.getByRole("checkbox", {
      name: "I reviewed these staff cost assumptions",
      exact: true,
    }),
  ).not.toBeChecked();
  await dialog
    .getByRole("button", { name: "Save staff cost", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Planning warnings", exact: true }),
  ).toContainText("have not been confirmed");
  await expect(summary).toContainText("$4,471.10");
  await page.reload();
  await expect(summary).toContainText("$4,471.10");
  downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Excel", exact: true }).click();
  const workbook = await JSZip.loadAsync(
    await readFile((await (await downloading).path())!),
  );
  expect(workbook.file("xl/worksheets/sheet1.xml")).toBeTruthy();
  await noPageOverflow(page, testInfo, "planner-cash-updated");
  await page.screenshot({
    path: testInfo.outputPath("planner-cash-updated.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("report filters, drill-down and changed invoice values persist through saved views and exports at each viewport", async ({
  page,
}, testInfo) => {
  page.setDefaultTimeout(30_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/app/financials/reports/catalog");
  await expect(
    page.getByRole("heading", {
      name: "Report catalog & designer",
      exact: true,
    }),
  ).toBeVisible();
  const societyId = await freshWorkspace(
    page,
    `Responsive reports ${testInfo.project.name}`,
  );
  await page.reload();
  const fixture = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const args = {
      societyId,
      partyKind: "custom",
      billToName: "Responsive customer",
      issueDate: "2026-10-21",
      terms: "net_30",
      currency: "CAD",
      lines: [
        {
          key: "responsive-service",
          item: "Responsive service",
          quantity: 2,
          unitPriceCents: 2500,
        },
      ],
    };
    const first = await client.mutation("invoices:upsert", args);
    await client.mutation("invoices:upsert", {
      ...args,
      lines: [{ ...args.lines[0], key: "second", quantity: 4 }],
    });
    await client.mutation("invoices:upsert", {
      ...args,
      billToName: "Excluded customer",
      lines: [
        {
          ...args.lines[0],
          key: "excluded",
          item: "Excluded service",
          quantity: 99,
          unitPriceCents: 999999,
        },
      ],
    });
    return { id: first, args };
  }, societyId);
  await page
    .getByRole("button", { name: "Build sales by item", exact: true })
    .click();
  await page
    .getByLabel("Report name", { exact: true })
    .fill("Responsive service sales");
  await page.getByLabel("As of", { exact: true }).fill("2026-10-23");
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-23");
  await page
    .getByLabel("Customer / vendor", { exact: true })
    .fill("Responsive customer");
  await checked(page.locator("body"), "Include draft / unapproved documents");
  await page
    .getByRole("textbox", { name: "Filter preset name", exact: true })
    .fill("Responsive customer preset");
  await page
    .getByRole("button", { name: "Save filter preset", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Responsive customer preset",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await page
    .getByRole("button", { name: "Run full report", exact: true })
    .click();
  await expect(
    page.getByText("2 source rows → 1 result rows · CAD", { exact: true }),
  ).toBeVisible();
  const detail = page.getByRole("region", {
    name: "Report details",
    exact: true,
  });
  await expect(detail).toContainText("Responsive service");
  await expect(detail).toContainText("$150.00");
  await expect(detail).not.toContainText("Excluded service");
  await detail.locator("summary").click();
  await expect(detail.getByRole("link")).toHaveCount(2);
  const firstLink = detail.getByRole("link").first();
  await expect(firstLink).toHaveAttribute("href", /invoice=/);
  const graph = page
    .getByRole("region", { name: "Report graph · Sales by item", exact: true })
    .first();
  await expect(graph.getByRole("img")).toBeVisible();
  await graph
    .getByRole("button", { name: "View as table", exact: true })
    .click();
  await expect(
    graph.getByRole("cell", { name: "$150.00", exact: true }),
  ).toBeVisible();
  await graph
    .getByRole("button", { name: "View as chart", exact: true })
    .click();
  await expect
    .poll(async () =>
      graph
        .locator("svg text")
        .evaluateAll((labels) =>
          labels.length
            ? Math.min(
                ...labels.map((label) => label.getBoundingClientRect().height),
              )
            : 0,
        ),
    )
    .toBeGreaterThanOrEqual(10);
  await noPageOverflow(page, testInfo, "report-results");
  await graph.screenshot({ path: testInfo.outputPath("report-chart.png") });
  await panToLastColumn(
    page,
    page.getByRole("region", { name: "Report details table", exact: true }),
    testInfo,
    "report-details",
  );
  await detail.screenshot({ path: testInfo.outputPath("report-detail.png") });
  await page.screenshot({
    path: testInfo.outputPath("report-results.png"),
    fullPage: true,
  });
  let downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export all CSV", exact: true })
    .click();
  const csv = (await readFile((await (await downloading).path())!)).toString();
  expect(csv).toContain("150.00");
  expect(csv).not.toContain("Excluded service");
  downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download branded PDF", exact: true })
    .click();
  const pdf = await downloading;
  await pdf.saveAs(testInfo.outputPath("responsive-sales.pdf"));
  expect(await pdfText(await readFile((await pdf.path())!))).toContain(
    "$150.00",
  );
  await page.evaluate(async (fixture) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    await client.mutation("invoices:upsert", {
      ...fixture.args,
      id: fixture.id,
      lines: [{ ...fixture.args.lines[0], quantity: 3 }],
    });
  }, fixture);
  await page
    .getByRole("button", { name: "Run full report", exact: true })
    .click();
  await expect(detail).toContainText("$175.00");
  if (
    !(await detail
      .locator("details")
      .first()
      .evaluate((element: HTMLDetailsElement) => element.open))
  )
    await detail.locator("summary").click();
  await detail.getByRole("link").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Responsive customer");
  await page.goto("/app/financials/reports/catalog");
  await page
    .getByRole("button", { name: "Responsive service sales", exact: true })
    .click();
  await expect(
    page.getByLabel("Customer / vendor", { exact: true }),
  ).toHaveValue("Responsive customer");
  await page
    .getByRole("button", { name: "Run full report", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Report details", exact: true }),
  ).toContainText("$175.00");
  await page
    .getByLabel("Customer / vendor", { exact: true })
    .fill("Excluded customer");
  await page
    .getByRole("button", { name: "Responsive customer preset", exact: true })
    .click();
  await expect(
    page.getByLabel("Customer / vendor", { exact: true }),
  ).toHaveValue("Responsive customer");
  await page.getByRole("tab", { name: "Columns", exact: true }).click();
  await noPageOverflow(page, testInfo, "report-column-designer");
  await page.screenshot({
    path: testInfo.outputPath("report-column-designer.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
