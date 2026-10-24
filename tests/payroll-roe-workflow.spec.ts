import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chooseViewType } from "./helpers/recordTableToolbar";
const browserSignals = new WeakMap<
  Page,
  { consoleErrors: string[]; pageErrors: string[]; responses: string[] }
>();
test.beforeEach(async ({ page }) => {
  const signals = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    responses: [] as string[],
  };
  browserSignals.set(page, signals);
  page.on("console", (message) => {
    if (message.type() === "error") signals.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => signals.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500)
      signals.responses.push(`${response.status()} ${response.url()}`);
  });
});
test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  const signals = browserSignals.get(page)!;
  await testInfo.attach("browser-signals", {
    body: JSON.stringify(signals, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("final-state.png"),
    fullPage: true,
  });
  if (testInfo.status === testInfo.expectedStatus) {
    await fitsViewport(page, "final state");
    expect(signals.pageErrors).toEqual([]);
    expect(signals.consoleErrors).toEqual([]);
    expect(signals.responses).toEqual([]);
  }
});
async function touch(page: Page) {
  return page.evaluate(() => matchMedia("(pointer: coarse)").matches);
}
async function activate(control: Locator) {
  if (await touch(control.page())) await control.tap();
  else await control.click();
}
async function fitsViewport(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    windowWidth: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    offenders: Array.from(document.querySelectorAll('main *, [role="main"] *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect(),
          style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          (rect.right > document.documentElement.clientWidth + 1 ||
            rect.left < -1)
        );
      })
      .slice(0, 18)
      .map((element) => ({
        tag: element.tagName,
        classes: element.className,
        label: element.getAttribute("aria-label"),
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        width: element.getBoundingClientRect().width,
      })),
  }));
  expect(
    geometry.document,
    `${label}: ${JSON.stringify(geometry)}`,
  ).toBeLessThanOrEqual(geometry.viewport + 1);
}
async function snapshot(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  label: string,
) {
  await fitsViewport(page, label);
  await page.screenshot({
    path: testInfo.outputPath(`${label}.png`),
    fullPage: true,
  });
}
async function seed(page: Page) {
  await page.goto("/app/payroll/calculator?tab=roe");
  const result = await page.evaluate(async () => {
    const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts"),
      { setStoredSocietyId } = await import("/src/hooks/useSociety.ts"),
      { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", {
        name: "Synthetic guided ROE employer",
        jurisdictionCode: "CA-BC",
        seedDocumentPackets: false,
        isCharity: false,
        isMemberFunded: false,
      }),
      societyId = created.societyId,
      owners = await client.query("users:list", { societyId }),
      ownerId = owners.find((row: any) => row.role === "Owner")._id;
    setStoredSocietyId(societyId);
    setStoredUserId(ownerId);
    const employeeId = await client.mutation("employees:create", {
        societyId,
        firstName: "Alex",
        lastName: "Synthetic",
        role: "Test employee",
        startDate: "2026-01-01",
        birthDate: "1995-01-01",
        province: "BC",
        employmentType: "PartTime",
        cppExempt: false,
        eiExempt: false,
      }),
      readerId = await client.mutation("users:upsert", {
        societyId,
        email: "roe-reader@example.test",
        displayName: "Read-only director",
        role: "Director",
        status: "Active",
      });
    return { societyId, employeeId, ownerId, readerId };
  });
  await page.reload();
  const panel = page.getByRole("region", { name: "ROE workflow", exact: true });
  await expect(panel).toBeVisible();
  await panel
    .getByLabel("ROE workflow employee", { exact: true })
    .selectOption(result.employeeId);
  await expect(
    panel.getByRole("button", { name: "Start guided ROE case", exact: true }),
  ).toBeEnabled();
  return { ...result, panel };
}
async function checked(scope: Locator, label: string) {
  const box = scope.getByRole("checkbox", { name: label, exact: true });
  if (!(await box.isChecked())) {
    if (await touch(scope.page())) await box.tap();
    else await box.check();
  }
  await expect(box).toBeChecked();
}
async function createCase(panel: Locator) {
  await activate(
    panel.getByRole("button", { name: "Start guided ROE case", exact: true }),
  );
  const form = panel.getByRole("form", { name: "ROE case facts", exact: true });
  for (const [label, value] of [
    ["First day worked since previous ROE", "2026-01-01"],
    ["Last day for which paid", "2026-01-23"],
    ["Employer became aware on", "2026-02-05"],
    ["Pay period containing interruption starts", "2026-01-12"],
    ["Pay period containing interruption ends", "2026-01-25"],
    [
      "Trigger, date and source evidence",
      "Actual contract ended; reviewed seven consecutive days without work or insurable earnings",
    ],
  ])
    await form.getByLabel(label, { exact: true }).fill(value);
  await expect(form.getByRole("status")).toContainText("2026-01-30");
  await fitsViewport(panel.page(), "case facts form");
  await activate(
    form.getByRole("button", { name: "Save ROE case", exact: true }),
  );
  await expect(form).toBeHidden();
  const detail = panel.getByRole("article", {
    name: "Selected ROE case",
    exact: true,
  });
  await expect(detail).toBeVisible();
  return detail;
}
async function review(detail: Locator) {
  const form = detail.getByRole("form", {
    name: "ROE readiness checklist",
    exact: true,
  });
  for (const box of await form.getByRole("checkbox").all()) {
    if (await touch(form.page())) await box.tap();
    else await box.check();
  }
  await activate(
    form.getByRole("button", { name: "Save readiness review", exact: true }),
  );
  await expect(
    detail.getByRole("button", {
      name: "Open reviewed ROE XML export",
      exact: true,
    }),
  ).toBeEnabled();
}
async function noPersistedSin(page: Page) {
  const found = await page.evaluate(async () => {
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        for (const name of Array.from(db.objectStoreNames)) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const r = db
              .transaction(name, "readonly")
              .objectStore(name)
              .getAll();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          if (JSON.stringify(values).includes("046454286")) return true;
        }
      } finally {
        db.close();
      }
    }
    return false;
  });
  expect(found).toBe(false);
}
test("guided ROE generates actual schema-valid XML without issuing, tracks acknowledgment, nonresponse, employee access and a full amendment", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { panel, societyId } = await seed(page),
    detail = await createCase(panel);
  await snapshot(page, testInfo, "saved-case");
  await expect(
    detail.getByRole("region", {
      name: "ROE deadline assessment",
      exact: true,
    }),
  ).toContainText("2026-01-30");
  await review(detail);
  await activate(
    detail.getByRole("button", {
      name: "Open reviewed ROE XML export",
      exact: true,
    }),
  );
  const filing = detail.getByRole("region", {
    name: "Payroll filings",
    exact: true,
  });
  await expect(
    filing.getByRole("button", { name: "Download ROE XML", exact: true }),
  ).toBeVisible();
  await expect(
    filing.getByLabel("First day worked since previous ROE", { exact: true }),
  ).toBeDisabled();
  await expect(
    filing.getByLabel("Last day for which paid", { exact: true }),
  ).toHaveValue("2026-01-23");
  for (const [label, value] of [
    ["BN/RP payroll account", "123456782RP0001"],
    ["Contact area code", "250"],
    ["Contact seven-digit phone", "5550101"],
    ["ROE employee Given name", "Alex"],
    ["ROE employee Surname", "Synthetic"],
    ["ROE employee SIN", "046454286"],
    ["ROE employee Street address", "100 Sample Street"],
    ["ROE employee City", "Victoria"],
    ["ROE employee Province/state code", "BC"],
    ["ROE employee Country code", "CAN"],
    ["ROE employee Postal/ZIP code", "V8V 1X4"],
    ["ROE contact given name", "Alex"],
    ["ROE contact surname", "Sample"],
  ])
    await filing.getByLabel(label, { exact: true }).fill(value);
  await activate(
    filing.getByRole("button", { name: "Add earlier pay period", exact: true }),
  );
  for (const [label, value] of [
    ["PP1 Period start", "2026-01-12"],
    ["PP1 Period end", "2026-01-25"],
    ["PP1 Insurable earnings", "1000.00"],
    ["PP1 Insurable hours", "40"],
  ])
    await filing.getByLabel(label, { exact: true }).fill(value);
  await activate(
    filing.getByRole("button", { name: "Add earlier pay period", exact: true }),
  );
  for (const [label, value] of [
    ["PP2 Period start", "2025-12-29"],
    ["PP2 Period end", "2026-01-11"],
    ["PP2 Insurable earnings", "800.00"],
    ["PP2 Insurable hours", "32"],
  ])
    await filing.getByLabel(label, { exact: true }).fill(value);
  await checked(
    filing,
    "I reviewed all separation payments. Final-period earnings include all insurable amounts reported in the separation blocks, and all required entries are included above.",
  );
  await checked(
    filing,
    "I reviewed all source records and required historical amounts for this export.",
  );
  await checked(
    filing,
    "These records belong to this legal employer and the entered payroll account.",
  );
  await snapshot(page, testInfo, "reviewed-xml-form");
  const downloading = page.waitForEvent("download");
  await activate(
    filing.getByRole("button", { name: "Download ROE XML", exact: true }),
  );
  const download = await downloading;
  await download.saveAs(testInfo.outputPath("guided-synthetic-roe.xml"));
  const path = (await download.path())!,
    validation = spawnSync(
      "python",
      [
        "-c",
        "from lxml import etree;import sys;etree.XMLSchema(etree.parse(sys.argv[1])).assertValid(etree.parse(sys.argv[2]))",
        "shared/payrollSchemas/PayrollExtractXmlV2.xsd",
        path,
      ],
      { encoding: "utf8" },
    );
  expect(validation.status, validation.stderr).toBe(0);
  const xml = await readFile(path, "utf8");
  expect(xml).toContain("<B11>2026-01-23</B11>");
  await expect(detail.getByRole("status").first()).toContainText("generated");
  await expect(detail.getByRole("status").first()).toContainText("to_issue");
  const selectedCaseId = await panel
    .getByLabel("ROE workflow case", { exact: true })
    .inputValue();
  const storedGenerated = await page.evaluate(
    async ({ societyId, id }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      return (
        await client.query("payrollRoeWorkflow:workspace", {
          societyId,
          collection: "cases",
          id,
        })
      ).detail;
    },
    { societyId, id: selectedCaseId },
  );
  expect(storedGenerated.generated.sha256).toBe(
    createHash("sha256").update(xml).digest("hex"),
  );
  expect(storedGenerated.generated.caseFingerprint).toBe(
    storedGenerated.caseFingerprint,
  );
  expect(storedGenerated.register.status).toBe("to_issue");
  expect(storedGenerated.facts.lastDayPaid).toBe("2026-01-23");
  await noPersistedSin(page);
  await activate(
    detail.getByRole("button", {
      name: "Close transient ROE export",
      exact: true,
    }),
  );
  const submission = detail.getByRole("form", {
    name: "Actual ROE submission",
    exact: true,
  });
  await submission
    .getByLabel("Actual submission time (local)", { exact: true })
    .fill("2026-01-26T09:00");
  await submission
    .getByLabel("Actual submission reference", { exact: true })
    .fill("Synthetic actual upload");
  await submission
    .getByLabel("Actual submission evidence / rejection details", {
      exact: true,
    })
    .fill("Reviewed actual portal response awaiting acceptance");
  await activate(
    submission.getByRole("button", {
      name: "Record actual submission",
      exact: true,
    }),
  );
  await expect(detail.getByRole("status").first()).toContainText("submitted");
  const issue = detail.getByRole("form", {
    name: "Actual ROE issuance",
    exact: true,
  });
  await issue
    .getByLabel("Actual issuance time (local)", { exact: true })
    .fill("2026-01-27T09:00");
  await issue
    .getByLabel("Actual issued ROE serial", { exact: true })
    .fill("W00000001");
  await issue
    .getByLabel("Actual successful acknowledgment evidence", { exact: true })
    .fill(
      "Synthetic successful official acknowledgment reviewed by authorized payroll administrator",
    );
  await activate(
    issue.getByRole("button", {
      name: "Record actual issuance acknowledgment",
      exact: true,
    }),
  );
  await expect(detail.getByRole("status").first()).toContainText("issued");
  await expect(
    detail.getByRole("form", {
      name: "ROE follow-up: Confirm employee access and any requested copy",
      exact: true,
    }),
  ).toBeVisible();
  await snapshot(page, testInfo, "issued-followups");
  await page.goto("/app/payroll?tab=roes");
  await expect(
    page.getByText("Alex Synthetic", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.locator(".badge").filter({ hasText: /^Issued$/ }),
  ).toBeVisible();
  const propagated = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return client.query("payroll:workspace", { societyId });
  }, societyId);
  expect(propagated.roes).toHaveLength(1);
  expect(propagated.roes[0]._id).toBe(storedGenerated.registerId);
  expect(propagated.roes[0].status).toBe("issued");
  expect(propagated.roes[0].serialNumber).toBe("W00000001");
  await snapshot(page, testInfo, "issued-payroll-register");
  await page.goto("/app/payroll/calculator?tab=roe");
  await panel
    .getByLabel("ROE workflow employee", { exact: true })
    .selectOption({ label: "Alex Synthetic" });
  await panel
    .getByLabel("ROE workflow case", { exact: true })
    .selectOption(selectedCaseId);
  await expect(detail.getByRole("status").first()).toContainText("issued");
  const missing = detail.getByRole("form", {
    name: "ROE follow-up: Resolve missing information or an unanswered request",
    exact: true,
  });
  await missing
    .getByLabel("Follow-up status", { exact: true })
    .selectOption("blocked");
  await missing
    .getByLabel("Protected follow-up evidence", { exact: true })
    .fill(
      "Waiting for the employee response; internal follow-up only, no message sent",
    );
  await activate(
    missing.getByRole("button", { name: "Save follow-up", exact: true }),
  );
  await expect(
    missing.getByLabel("Follow-up status", { exact: true }),
  ).toHaveValue("blocked");
  for (const name of [
    "Confirm employee access and any requested copy",
    "Resolve missing information or an unanswered request",
  ]) {
    const form = detail.getByRole("form", {
      name: `ROE follow-up: ${name}`,
      exact: true,
    });
    await form
      .getByLabel("Follow-up status", { exact: true })
      .selectOption("done");
    await form
      .getByLabel("Protected follow-up evidence", { exact: true })
      .fill("Actual review complete; source response retained securely");
    await activate(
      form.getByRole("button", { name: "Save follow-up", exact: true }),
    );
    await expect(
      form.getByLabel("Follow-up status", { exact: true }),
    ).toHaveValue("done");
  }
  await detail
    .getByLabel("Operational closure evidence", { exact: true })
    .fill(
      "Acceptance and employee follow-up complete; secure retention stays tracked",
    );
  await activate(
    detail.getByRole("button", {
      name: "Close resolved operational case",
      exact: true,
    }),
  );
  await expect(detail.getByRole("status").first()).toContainText("closed");
  await page.reload();
  await panel
    .getByLabel("ROE workflow employee", { exact: true })
    .selectOption({ label: "Alex Synthetic" });
  await panel
    .getByLabel("ROE workflow case", { exact: true })
    .selectOption({ index: 1 });
  await expect(detail.getByRole("status").first()).toContainText("closed");
  await activate(
    detail.getByRole("button", {
      name: "Create linked amendment",
      exact: true,
    }),
  );
  await snapshot(page, testInfo, "amendment-facts");
  const amend = panel.getByRole("form", {
    name: "ROE case facts",
    exact: true,
  });
  await amend
    .getByLabel("Case / correction notes", { exact: true })
    .fill(
      "Corrected actual insurable hours after source review; repeat all blocks",
    );
  await activate(
    amend.getByRole("button", { name: "Save ROE case", exact: true }),
  );
  await expect(detail).toContainText("Original serial: W00000001");
  await expect(detail.getByRole("status").first()).toContainText("preparing");
  const csvEvent = page.waitForEvent("download");
  await activate(
    panel.getByRole("button", { name: "Export ROE workflow CSV", exact: true }),
  );
  const csv = await csvEvent,
    csvText = await readFile((await csv.path())!, "utf8");
  expect(csvText).toContain("W00000001");
  expect(csvText).toContain("retention");
  expect(csvText).not.toContain("046454286");
  const state = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return client.query("payrollRoeWorkflow:workspace", {
      societyId,
      collection: "cases",
    });
  }, societyId);
  expect(state.page).toHaveLength(2);
  expect(state.page.some((row: any) => row.register?.status === "issued")).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test("read-only director can review a persisted ROE case and cannot write its checklist or issuance", async ({
  page,
}) => {
  const { panel, societyId, readerId } = await seed(page);
  await createCase(panel);
  await page.evaluate(
    async ({ readerId }) => {
      const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
      setStoredUserId(readerId);
    },
    { readerId },
  );
  await page.reload();
  await panel
    .getByLabel("ROE workflow employee", { exact: true })
    .selectOption({ label: "Alex Synthetic" });
  await panel
    .getByLabel("ROE workflow case", { exact: true })
    .selectOption({ index: 1 });
  const detail = panel.getByRole("article", {
    name: "Selected ROE case",
    exact: true,
  });
  await expect(detail).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Start guided ROE case", exact: true }),
  ).toBeDisabled();
  await expect(
    detail.getByRole("button", { name: "Save readiness review", exact: true }),
  ).toBeDisabled();
  await expect(
    detail.getByRole("button", {
      name: "Record actual issuance acknowledgment",
      exact: true,
    }),
  ).toBeDisabled();
  const rejected = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts"),
      result = await client.query("payrollRoeWorkflow:workspace", {
        societyId,
        collection: "cases",
      });
    try {
      await client.mutation("payrollRoeWorkflow:updateChecklist", {
        societyId,
        id: result.page[0]._id,
        checklist: result.page[0].checklist,
      });
      return false;
    } catch (error) {
      return String(error).includes("financials:write");
    }
  }, societyId);
  expect(rejected).toBe(true);
});

test("ROE-derived deadlines stay read-only in the grid, details and kanban while ordinary reminders remain editable", async ({
  page,
}, testInfo) => {
  const { panel, societyId } = await seed(page);
  await createCase(panel);
  await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    await client.mutation("deadlines:create", {
      societyId,
      title: "Ordinary editable deadline",
      dueDate: "2026-02-01",
      category: "Governance",
    });
  }, societyId);
  await page.goto("/app/deadlines");
  await chooseViewType(page, "Table view");
  const isTouch = await touch(page);
  const mobileList = page.getByRole("list", { name: "Deadlines", exact: true });
  const derived = isTouch
    ? mobileList
        .getByRole("listitem")
        .filter({ hasText: "Record of Employment deadline" })
    : page
        .locator("tr.record-table__row")
        .filter({ hasText: "Record of Employment deadline" });
  const ordinary = isTouch
    ? mobileList
        .getByRole("listitem")
        .filter({ hasText: "Ordinary editable deadline" })
    : page
        .locator("tr.record-table__row")
        .filter({ hasText: "Ordinary editable deadline" });
  await expect(derived).toHaveCount(1);
  await expect(ordinary).toHaveCount(1);
  if (!isTouch) {
    for (const field of ["title", "dueDate", "category"]) {
      await expect(
        derived.locator(`td[data-field-name="${field}"]`),
      ).toHaveAttribute("aria-readonly", "true");
      await expect(
        ordinary.locator(`td[data-field-name="${field}"]`),
      ).toHaveAttribute("aria-readonly", "false");
    }
    await expect(
      derived.locator('td[data-field-name="status"]').getByRole("checkbox"),
    ).toBeDisabled();
    await expect(
      derived.getByRole("link", {
        name: "Managed by ROE workflow",
        exact: true,
      }),
    ).toHaveAttribute("href", "/app/payroll/calculator?tab=roe");
  }
  await snapshot(
    page,
    testInfo,
    isTouch ? "managed-deadline-cards" : "managed-deadline-grid",
  );
  await activate(
    isTouch
      ? derived.getByRole("button", { name: /^Record of Employment deadline/ })
      : derived.locator('td[data-field-name="title"] strong'),
  );
  const drawer = page.getByRole("dialog", {
    name: /^Record of Employment deadline/,
  });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await activate(drawer.getByRole("button", { name: /^Open(?:\s|$)/ }));
  const dialog = page.getByRole("dialog", {
    name: "View deadline",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Open ROE workflow", exact: true }),
  ).toBeVisible();
  await activate(
    dialog.getByRole("button", { name: "Close", exact: true }).last(),
  );
  if (await drawer.isVisible())
    await activate(drawer.getByRole("button", { name: "Close", exact: true }));
  if (isTouch) {
    await activate(
      ordinary.getByRole("button", { name: /^Ordinary editable deadline/ }),
    );
    const ordinaryDrawer = page.getByRole("dialog", {
      name: /^Ordinary editable deadline/,
    });
    await expect(
      ordinaryDrawer.getByRole("button", { name: /^Edit / }).first(),
    ).toBeVisible();
    await activate(
      ordinaryDrawer.getByRole("button", { name: /^Open(?:\s|$)/ }),
    );
    const editDialog = page.getByRole("dialog", {
      name: "Edit deadline",
      exact: true,
    });
    await editDialog
      .getByLabel("Title", { exact: true })
      .fill("Ordinary edited deadline");
    await activate(
      editDialog.getByRole("button", { name: "Save", exact: true }),
    );
    await expect(editDialog).toBeHidden();
    const updatedDrawer = page.getByRole("dialog", {
      name: /^Ordinary edited deadline/,
    });
    if (await updatedDrawer.isVisible())
      await activate(
        updatedDrawer.getByRole("button", { name: "Close", exact: true }),
      );
  } else {
    const titleCell = ordinary.locator('td[data-field-name="title"]');
    await titleCell.hover();
    await activate(titleCell.getByRole("button", { name: /^Edit / }));
    const input = page
      .locator(".record-table__cell-editor-popover input")
      .first();
    await expect(input).toBeVisible();
    await input.fill("Ordinary edited deadline");
    await input.press("Enter");
  }
  await expect(
    isTouch
      ? mobileList
          .getByRole("listitem")
          .filter({ hasText: "Ordinary edited deadline" })
      : page.locator('td[data-field-name="title"]', {
          hasText: "Ordinary edited deadline",
        }),
  ).toBeVisible();
  await chooseViewType(page, "Kanban view");
  const locked = page.locator(".kanban__card", {
      hasText: "Record of Employment deadline",
    }),
    movable = page.locator(".kanban__card", {
      hasText: "Ordinary edited deadline",
    });
  await expect(locked).toHaveAttribute("draggable", "false");
  await expect(
    locked.getByRole("button", {
      name: "Move to column",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(0);
  await expect(movable).toHaveAttribute("draggable", "true");
  await expect(
    movable.getByRole("button", {
      name: "Move to column",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveCount(1);
  const complete = page.locator(".kanban__col", {
    has: page.locator(".kanban__head", { hasText: "Complete" }),
  });
  if (await touch(page)) {
    await activate(
      movable.getByRole("button", { name: "Move to column", exact: true }),
    );
    await activate(
      page.getByRole("menuitem", { name: "Complete", exact: true }),
    );
  } else await movable.dragTo(complete.locator(".kanban__body"));
  await expect(
    complete.locator(".kanban__card", { hasText: "Ordinary edited deadline" }),
  ).toBeVisible();
  await expect(locked).toHaveAttribute("draggable", "false");
  await snapshot(page, testInfo, "managed-deadline-kanban");
});
