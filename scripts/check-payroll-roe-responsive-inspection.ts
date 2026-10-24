import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";
const destination = "/workspace/scratch/payroll-responsive-roe-inspection",
  baseURL = process.env.PAYROLL_RESPONSIVE_ROE_URL ?? "http://127.0.0.1:4211";
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const layout of [
    { name: "desktop", width: 1440, height: 1000, touch: false },
    { name: "touch-phone", width: 390, height: 844, touch: true },
    { name: "narrow-phone", width: 360, height: 800, touch: true },
  ]) {
    if (
      process.env.PAYROLL_ROE_INSPECT_LAYOUT &&
      layout.name !== process.env.PAYROLL_ROE_INSPECT_LAYOUT
    )
      continue;
    const context = await browser.newContext({
        ...(layout.touch ? devices["Pixel 5"] : devices["Desktop Chrome"]),
        viewport: { width: layout.width, height: layout.height },
        timezoneId: "America/Vancouver",
      }),
      page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${baseURL}/app/payroll/calculator?tab=roe`);
    const saved = await page.evaluate(async () => {
      const { localDataClient: client } =
          await import("/src/lib/localDataClient.ts"),
        { setStoredSocietyId } = await import("/src/hooks/useSociety.ts"),
        { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
      const { societyId } = await client.mutation("society:createWorkspace", {
          name: "Synthetic ROE responsive source review",
          jurisdictionCode: "CA-BC",
          seedDocumentPackets: false,
          isCharity: false,
          isMemberFunded: false,
        }),
        users = await client.query("users:list", { societyId });
      setStoredSocietyId(societyId);
      setStoredUserId(users.find((user: any) => user.role === "Owner")._id);
      const employeeId = await client.mutation("employees:create", {
          societyId,
          firstName: "Alex",
          lastName: "Source review",
          role: "Test employee",
          startDate: "2026-01-01",
          birthDate: "1995-01-01",
          province: "BC",
          employmentType: "PartTime",
          cppExempt: false,
          eiExempt: false,
        }),
        reference = `https://example.test/reviewed-payroll-history/${"long-source-reference".repeat(12)}`,
        id = await client.mutation("payrollRoeWorkflow:saveCase", {
          societyId,
          employeeId,
          facts: {
            trigger: "seven_days",
            format: "electronic",
            payPeriodCode: "B",
            firstDayWorked: "2026-01-01",
            lastDayPaid: "2026-01-23",
            awareDate: "2026-01-26",
            periodStart: "2026-01-12",
            periodEnd: "2026-01-25",
            noWorkNoEarningsDays: 7,
            anticipatedGap: false,
            exception: "ordinary",
            requestFrom: "none",
            inactiveCasual: false,
            otherRequirementConfirmed: false,
            reasonCode: "A00",
            evidence: `Reviewed actual seven-day interruption source: ${reference}`,
            notes:
              "Actual source review; identifiers entered separately in the transient export form",
          },
        });
      return { employeeId, id, reference };
    });
    await page.reload();
    const panel = page.getByRole("region", {
      name: "ROE workflow",
      exact: true,
    });
    await panel
      .getByLabel("ROE workflow employee", { exact: true })
      .selectOption(saved.employeeId);
    await panel
      .getByLabel("ROE workflow case", { exact: true })
      .selectOption(saved.id);
    const detail = panel.getByRole("article", {
      name: "Selected ROE case",
      exact: true,
    });
    await detail.waitFor();
    assert.ok((await detail.textContent())?.includes(saved.reference));
    const guidance = panel
        .locator("details")
        .filter({
          has: page.locator("summary", { hasText: "Where to issue an ROE" }),
        })
        .first(),
      summary = guidance.locator("summary").first();
    if (layout.touch) await summary.tap();
    else await summary.click();
    assert.equal(await guidance.getAttribute("open"), "");
    await guidance.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${destination}/${layout.name}-official-guidance.png`,
      fullPage: true,
    });
    const history = detail.locator("details").filter({
        has: page.locator("summary", { hasText: "Protected case history" }),
      }),
      historySummary = history.locator("summary");
    if (layout.touch) await historySummary.tap();
    else await historySummary.click();
    await page.screenshot({
      path: `${destination}/${layout.name}-history.png`,
      fullPage: true,
    });
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      window: innerWidth,
      document: document.documentElement.scrollWidth,
      roots: Array.from(
        document.querySelectorAll<HTMLElement>(
          'main,[role="main"],.page,.payroll-calculator',
        ),
      ).map((element) => ({
        tag: element.tagName,
        classes: element.className,
        label: element.getAttribute("aria-label"),
        client: element.clientWidth,
        scroll: element.scrollWidth,
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
        overflowChildren: Array.from(element.querySelectorAll<HTMLElement>("*"))
          .filter((child) => {
            const rect = child.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.right > element.getBoundingClientRect().right + 1
            );
          })
          .slice(0, 15)
          .map((child) => ({
            tag: child.tagName,
            classes: child.className,
            label: child.getAttribute("aria-label"),
            right: child.getBoundingClientRect().right,
            text: child.textContent?.slice(0, 70),
          })),
      })),
      clippedControls: Array.from(
        document.querySelectorAll<HTMLElement>(
          'section[aria-label="ROE workflow"] input,section[aria-label="ROE workflow"] select,section[aria-label="ROE workflow"] textarea,section[aria-label="ROE workflow"] button',
        ),
      )
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            (rect.right > document.documentElement.clientWidth + 1 ||
              rect.left < -1)
          );
        })
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.slice(0, 80),
          width: element.getBoundingClientRect().width,
        })),
    }));
    results.push({ layout: layout.name, geometry, errors });
    await writeFile(
      `${destination}/results.json`,
      JSON.stringify(results, null, 2),
    );
    assert.equal(
      geometry.document <= geometry.viewport + 1,
      true,
      JSON.stringify(geometry),
    );
    assert.ok(
      geometry.roots.every((root) => root.scroll <= root.client + 1),
      JSON.stringify(geometry),
    );
    assert.equal(geometry.clippedControls.length, 0, JSON.stringify(geometry));
    assert.deepEqual(errors, []);
    console.log(
      `${layout.name}: expanded official guidance, persisted long source evidence and case history fit document + every application root; controls stay in bounds and console is clean.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
