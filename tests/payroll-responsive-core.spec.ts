import { test, expect, type Locator } from "@playwright/test";
import {
  assertPayrollFits,
  checkPayrollResponsiveViewport,
  watchPayrollResponsiveErrors,
} from "./helpers/payrollResponsiveChecks";
import { officialTd1Fixture } from "./helpers/payrollTd1Files";
test.beforeEach(watchPayrollResponsiveErrors);
test.afterEach(checkPayrollResponsiveViewport);

test("touch navigation and expanded TD1 evidence and rule comparisons fit the viewport", async ({
  page,
}, info) => {
  await page.goto("/app/payroll/calculator?tab=td1");
  await expect(
    page.getByRole("heading", { name: "Payroll calculator", exact: true }),
  ).toBeVisible();
  const employeeId = await page.evaluate(async () => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    const { setStoredSocietyId } = await import("/src/hooks/useSociety.ts");
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const created = await client.mutation("society:createWorkspace", {
      name: "Synthetic responsive payroll review",
      jurisdictionCode: "CA-BC",
      seedDocumentPackets: false,
      isCharity: false,
      isMemberFunded: false,
    });
    const societyId = created.societyId,
      users = await client.query("users:list", { societyId });
    setStoredSocietyId(societyId);
    setStoredUserId(users.find((user: any) => user.role === "Owner")._id);
    return await client.mutation("employees:create", {
      societyId,
      firstName: "Jordan",
      lastName: "Long responsive employee display name",
      role: "Synthetic responsive fixture",
      startDate: "2025-01-01",
      birthDate: "1990-01-01",
      province: "BC",
      employmentType: "PartTime",
      cppExempt: false,
      eiExempt: false,
    });
  });
  await page.reload();
  const press = async (locator: Locator) => {
    if (info.project.use.hasTouch) await locator.tap();
    else await locator.click();
  };
  const nav = page.getByRole("navigation", {
    name: "Payroll calculator sections",
    exact: true,
  });
  const panel = page.getByRole("region", { name: "TD1 import", exact: true });
  await panel
    .getByLabel("TD1 employee", { exact: true })
    .selectOption(employeeId);
  const federal = panel.getByRole("group", {
    name: "Federal TD1 review",
    exact: true,
  });
  await federal
    .getByLabel("Federal TD1 file", { exact: true })
    .setInputFiles(await officialTd1Fixture("td1"));
  await expect(
    federal.getByLabel("Federal TD1 annual total claim amount", {
      exact: true,
    }),
  ).toHaveValue("20000.00");
  await press(
    federal.getByText("Federal TD1 field and page evidence", { exact: true }),
  );
  await expect(
    federal.getByRole("table", {
      name: "Federal TD1 extracted claim lines",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("td1-evidence-expanded.png") });
  await assertPayrollFits(page);
  const claim = await federal
    .getByLabel("Federal TD1 annual total claim amount", { exact: true })
    .boundingBox();
  expect(claim!.x + claim!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  if (info.project.use.hasTouch)
    expect(
      claim!.height,
      "TD1 amount inputs have an easy touch target",
    ).toBeGreaterThanOrEqual(44);
  await press(nav.getByRole("button", { name: "Rules library", exact: true }));
  const library = page.getByRole("region", {
    name: "Payroll rules library",
    exact: true,
  });
  await press(
    library.getByRole("button", {
      name: "Clone 2026-01-BC-option1",
      exact: true,
    }),
  );
  const editor = page.getByRole("region", {
    name: "Payroll rule editor",
    exact: true,
  });
  await editor
    .getByLabel("Rule edition name", { exact: true })
    .fill("Reviewed responsive edition with a long display label");
  await press(
    editor.getByText("EI employee rate and annual caps", { exact: true }),
  );
  await editor.getByLabel("EI Rate (%)", { exact: true }).fill("2");
  await editor.getByLabel("EI Maximum (CAD)", { exact: true }).fill("1378.00");
  await editor
    .getByLabel("EI Employer Maximum (CAD)", { exact: true })
    .fill("1929.20");
  await press(
    editor.getByRole("button", {
      name: "Validate and compare rules",
      exact: true,
    }),
  );
  const comparison = editor.getByRole("region", {
    name: "Rule calculation comparison",
    exact: true,
  });
  await expect(
    comparison.getByRole("row", { name: /Employee EI/ }),
  ).toContainText("$100.00");
  await comparison.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("rules-comparison.png") });
  await assertPayrollFits(page);
  if (info.project.use.hasTouch) {
    const bounds = await nav
      .getByRole("button", { name: "Calculate", exact: true })
      .boundingBox();
    expect(
      bounds!.height,
      "Primary payroll navigation has an easy touch target",
    ).toBeGreaterThanOrEqual(44);
    const table = comparison.locator("table");
    const clip = await table.evaluate((element) => {
      let parent = element.parentElement;
      while (parent) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowX))
          return { width: parent.clientWidth, contents: parent.scrollWidth };
        parent = parent.parentElement;
      }
      return null;
    });
    expect(
      clip,
      "Wide comparison tables have their own scrolling region",
    ).not.toBeNull();
    expect(clip!.contents).toBeGreaterThan(clip!.width);
    const scroll = comparison.getByRole("region", {
      name: "Rule calculation comparison table",
      exact: true,
    });
    await scroll.scrollIntoViewIfNeeded();
    const area = await scroll.boundingBox();
    const session = await page.context().newCDPSession(page);
    const touch = (x: number) => [
      { x, y: area!.y + Math.min(area!.height / 2, 100) },
    ];
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: touch(area!.x + area!.width - 20),
    });
    for (let step = 1; step <= 6; step++)
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: touch(
          area!.x + area!.width - 20 - ((area!.width - 50) * step) / 6,
        ),
      });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => scroll.evaluate((element) => element.scrollLeft), {
        message: "A real touch swipe reaches the remaining comparison columns",
      })
      .toBeGreaterThan(20);
    await page.screenshot({
      path: info.outputPath("rules-comparison-after-touch.png"),
    });
    await session.detach();
  }
});
