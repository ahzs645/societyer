import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  activateRemittance,
  inspectRemittance,
  swipeRemittanceTable,
} from "./payroll-remittance-responsive";
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "touch")
          sessionStorage.setItem(
            "__remittanceQaTouchCount",
            String(
              Number(sessionStorage.getItem("__remittanceQaTouchCount") ?? 0) +
                1,
            ),
          );
      },
      true,
    );
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(page) ?? [];
  await testInfo.attach("browser-errors", {
    body: JSON.stringify(errors),
    contentType: "application/json",
  });
  expect(errors, "No browser console errors or unhandled exceptions").toEqual(
    [],
  );
  if (testInfo.status === "passed" && testInfo.project.use.hasTouch)
    expect(
      await page.evaluate(() =>
        Number(sessionStorage.getItem("__remittanceQaTouchCount") ?? 0),
      ),
      "Mobile workflow uses actual touch events",
    ).toBeGreaterThan(0);
});
async function seed(page: Page) {
  await page.goto("/app/payroll/calculator?tab=remittances");
  const fixture = await page.evaluate(async () => {
    const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts"),
      { setStoredSocietyId } = await import("/src/hooks/useSociety.ts"),
      { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    const { societyId } = await client.mutation("society:createWorkspace", {
        name: "Synthetic CRA remittance workspace",
        jurisdictionCode: "CA-BC",
        seedDocumentPackets: false,
        isCharity: false,
        isMemberFunded: false,
      }),
      owners = await client.query("users:list", { societyId }),
      ownerId = owners.find((r: any) => r.role === "Owner")._id;
    setStoredSocietyId(societyId);
    setStoredUserId(ownerId);
    const bankResult = await client.mutation(
        "bankAccounts:createManualAccount",
        {
          societyId,
          name: "Actual remittance source bank",
          kind: "bank",
          currency: "CAD",
          openingBalanceCents: 1000000,
          openingDate: "2026-01-01",
        },
      ),
      bankAccountId =
        typeof bankResult === "string" ? bankResult : bankResult.accountId;
    if (!bankAccountId)
      throw new Error("Manual bank account missing from seed.");
    await client.mutation("payroll:saveSettings", {
      societyId,
      remitterType: "regular",
      province: "BC",
      payrollAccountNumber: "123456789RP0001",
    });
    for (const day of [15, 31])
      await client.mutation("payroll:savePayRun", {
        societyId,
        periodStart: day === 15 ? "2026-05-01" : "2026-05-16",
        periodEnd: `2026-05-${day}`,
        payDate: `2026-05-${day}`,
        providerName: "Synthetic actual payroll provider",
        providerRunId: `REM-MAY-${day}`,
        grossCents: 100000,
        nonCashTaxableCents: 0,
        nonTaxableCashCents: 0,
        cppEmployeeCents: 1000,
        cpp2EmployeeCents: 500,
        eiEmployeeCents: 200,
        incomeTaxCents: 10000,
        otherDeductionsCents: 0,
        cppEmployerCents: 1000,
        cpp2EmployerCents: 500,
        eiEmployerCents: 280,
        netCents: 88300,
      });
    await client.mutation("financialHub:importBankCsvTransactions", {
      societyId,
      accountId: bankAccountId,
      rows: [
        {
          date: "2026-06-12",
          description: "Actual partial CRA payroll remittance",
          amountCents: -12000,
          externalId: "remit-browser-partial",
        },
        {
          date: "2026-06-15",
          description: "Actual remaining CRA payroll remittance",
          amountCents: -14960,
          externalId: "remit-browser-final",
        },
      ],
    });
    const readerId = await client.mutation("users:upsert", {
      societyId,
      email: "remit-reader@example.test",
      displayName: "Read-only remittance director",
      role: "Director",
      status: "Active",
    });
    const obligations = await client.query("payrollRemittance:workspace", {
      societyId,
      collection: "obligations",
    });
    return {
      societyId,
      ownerId,
      readerId,
      bankAccountId,
      obligationId: obligations.rows[0]._id,
    };
  });
  await page.reload();
  const panel = page.getByRole("region", {
    name: "CRA remittances",
    exact: true,
  });
  await expect(panel).toBeVisible();
  return { ...fixture, panel };
}
async function reopenRemittance(page: Page, amount?: string) {
  await page.reload();
  const panel = page.getByRole("region", {
      name: "CRA remittances",
      exact: true,
    }),
    plans = panel.getByRole("region", {
      name: "Remittance plans",
      exact: true,
    });
  await expect(plans).toBeVisible();
  const row = amount
    ? plans.locator("tbody tr").filter({ hasText: amount })
    : plans.locator("tbody tr");
  await activateRemittance(
    row.getByRole("button", { name: "Review plan", exact: true }).first(),
  );
  await expect(
    panel.getByRole("region", { name: "Remittance plan review", exact: true }),
  ).toBeVisible();
}
async function verifyRemittancePropagation(
  page: Page,
  societyId: string,
  bankAccountId: string,
  paidCents: number,
  amountDueCents: number,
  settlementCount: number,
) {
  const recorded = await page.evaluate(
    async ({ societyId, bankAccountId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      const obligations = await client.query("payrollRemittance:workspace", {
          societyId,
          collection: "obligations",
        }),
        settlements = await client.query("payrollRemittance:workspace", {
          societyId,
          collection: "settlements",
        }),
        transactions = await client.query("payrollRemittance:workspace", {
          societyId,
          collection: "transactions",
          bankAccountId,
        }),
        register = await client.query("payroll:workspace", { societyId });
      return {
        obligation: obligations.rows[0],
        settlements: settlements.rows,
        transactions: transactions.rows,
        register: register.remittances.find(
          (r: any) => r._id === obligations.rows[0]._id,
        ),
      };
    },
    { societyId, bankAccountId },
  );
  expect(recorded.obligation.paidCents).toBe(paidCents);
  expect(recorded.obligation.amountDueCents).toBe(amountDueCents);
  expect(recorded.register.paidCents).toBe(paidCents);
  expect(recorded.register.amountDueCents).toBe(amountDueCents);
  expect(recorded.register.status).toBe(
    paidCents === amountDueCents ? "paid" : "partial",
  );
  expect(recorded.settlements).toHaveLength(settlementCount);
  for (const settlement of recorded.settlements) {
    expect(settlement.bankAccountId).toBe(bankAccountId);
    expect(settlement.payrollAccountNumber).toBe("123456789RP0001");
    const transaction = recorded.transactions.find(
      (r: any) => r._id === settlement.transactionId,
    );
    expect(transaction).toMatchObject({
      matchedKind: "payroll_remittance",
      matchedId: settlement._id,
      amountCents: -settlement.amountCents,
      date: settlement.date,
      accountId: bankAccountId,
    });
  }
}
test("CRA plans require review, export no payment, and actual partial bank settlements retain exact provenance", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { panel, societyId, bankAccountId } = await seed(page);
  await inspectRemittance(page, testInfo, "initial-obligations");
  await swipeRemittanceTable(page, testInfo);
  await activateRemittance(
    panel.getByRole("button", { name: "Prepare payment plan", exact: true }),
  );
  const planForm = panel.getByRole("form", {
    name: "CRA remittance plan",
    exact: true,
  });
  await testInfo.attach("plan-open-position", {
    body: JSON.stringify(
      await planForm
        .getByRole("heading", { name: "Prepare remittance", exact: true })
        .evaluate((el) => ({
          top: el.getBoundingClientRect().top,
          bottom: el.getBoundingClientRect().bottom,
          viewport: document.documentElement.clientHeight,
        })),
    ),
    contentType: "application/json",
  });
  await expect(
    planForm.getByText("123456789RP0001", { exact: true }),
  ).toBeVisible();
  await expect(
    planForm.getByText("Actual CRA obligation $269.60", { exact: false }),
  ).toBeVisible();
  await planForm
    .getByLabel("Remittance source bank", { exact: true })
    .selectOption(bankAccountId);
  await planForm
    .getByLabel("Intended remittance date", { exact: true })
    .fill("2026-06-12");
  await planForm
    .getByLabel("Exact CRA payee / destination reference", { exact: true })
    .fill("CRA payroll deductions regular/quarterly 123456789RP0001");
  await inspectRemittance(
    page,
    testInfo,
    "plan-form",
    planForm.getByRole("heading", { name: "Prepare remittance", exact: true }),
  );
  await activateRemittance(
    planForm.getByRole("button", {
      name: "Save remittance draft",
      exact: true,
    }),
  );
  await reopenRemittance(page);
  const review = panel.getByRole("region", {
    name: "Remittance plan review",
    exact: true,
  });
  await expect(
    review.getByText("Awaiting review", { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText("Actual remittance source bank · CAD", { exact: true }),
  ).toBeVisible();
  await inspectRemittance(
    page,
    testInfo,
    "saved-draft",
    review.getByRole("heading", { name: "Review CRA remittance", exact: true }),
  );
  await activateRemittance(
    review.getByRole("button", {
      name: "Approve remittance plan",
      exact: true,
    }),
  );
  await expect(
    review.getByRole("button", {
      name: "Download prepared instructions",
      exact: true,
    }),
  ).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await activateRemittance(
    review.getByRole("button", {
      name: "Download prepared instructions",
      exact: true,
    }),
  );
  const download = await downloadPromise,
    path = await download.path();
  expect(path).toBeTruthy();
  const instructions = await readFile(path!, "utf8");
  expect(instructions).toContain("PREPARED INSTRUCTIONS ONLY");
  expect(instructions).toContain("No payment has been initiated or confirmed");
  expect(instructions).toContain("CAD 269.60");
  const unpaid = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return client.query("payrollRemittance:workspace", {
      societyId,
      collection: "obligations",
    });
  }, societyId);
  expect(unpaid.rows[0].paidCents).toBe(0);
  await review
    .getByLabel("External submission reference or rejection reason", {
      exact: true,
    })
    .fill("Actual bank bill-payment submission acknowledgement");
  await activateRemittance(
    review.getByRole("button", {
      name: "Record manual submission",
      exact: true,
    }),
  );
  await expect(
    review.getByText("manual submitted", { exact: true }),
  ).toBeVisible();
  for (const [index, [description, expected]] of [
    ["Actual partial CRA payroll remittance", "$120.00"],
    ["Actual remaining CRA payroll remittance", "$149.60"],
  ].entries()) {
    await activateRemittance(
      review.getByRole("button", {
        name: "Reconcile actual payment",
        exact: true,
      }),
    );
    const form = review.getByRole("form", {
      name: "Reconcile actual CRA payment",
      exact: true,
    });
    const option = form.getByRole("option", { name: new RegExp(description) });
    await expect(option).toBeAttached();
    if (index === 1)
      await expect(
        form.getByRole("option", {
          name: /Actual partial CRA payroll remittance/,
        }),
      ).toHaveCount(0);
    await form
      .getByLabel("Actual source-bank outflow", { exact: true })
      .selectOption((await option.getAttribute("value")) as string);
    await form
      .getByLabel("Settlement evidence", { exact: true })
      .fill(
        `Verified actual settled bank entry and exact CRA RP for ${description}`,
      );
    await inspectRemittance(
      page,
      testInfo,
      `settlement-${index + 1}-form`,
      form.getByRole("heading", {
        name: "Reconcile actual payment",
        exact: true,
      }),
    );
    await activateRemittance(
      form.getByText(
        "I verified actual settlement to this exact CRA RP account and period",
        { exact: true },
      ),
    );
    await activateRemittance(
      form.getByRole("button", {
        name: "Record actual settlement",
        exact: true,
      }),
    );
    await expect(form).toBeHidden();
    await expect(
      review.getByText(new RegExp(expected.replace("$", "\\$"))),
    ).not.toHaveCount(0);
    await verifyRemittancePropagation(
      page,
      societyId,
      bankAccountId,
      index === 0 ? 12000 : 26960,
      26960,
      index + 1,
    );
    await reopenRemittance(page);
    await expect(
      review
        .getByText("Plan remaining", { exact: true })
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText(index === 0 ? "$149.60" : "$0.00");
    await expect(
      review.getByText(
        "CRA payroll deductions regular/quarterly 123456789RP0001",
        { exact: true },
      ),
    ).toBeVisible();
    await inspectRemittance(
      page,
      testInfo,
      index === 0 ? "partial-reloaded" : "settled-reloaded",
      review.getByRole("heading", {
        name: "Review CRA remittance",
        exact: true,
      }),
    );
    if (index === 0) {
      const remainingDownload = page.waitForEvent("download");
      await activateRemittance(
        review.getByRole("button", {
          name: "Download prepared instructions",
          exact: true,
        }),
      );
      const file = await remainingDownload,
        body = await readFile((await file.path())!, "utf8");
      expect(body).toContain("Amount: CAD 149.60");
      expect(body).toContain("Recorded actual settlements: CAD 120.00");
      expect(body).toContain("Source bank: Actual remittance source bank");
    }
  }
  await expect(review.getByText("settled", { exact: true })).toBeVisible();
  await expect(
    review.getByRole("button", {
      name: "Reconcile actual payment",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    review.getByText("Matched bank outflow", { exact: false }),
  ).toHaveCount(2);
  const actual = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return {
      obligations: await client.query("payrollRemittance:workspace", {
        societyId,
        collection: "obligations",
      }),
      settlements: await client.query("payrollRemittance:workspace", {
        societyId,
        collection: "settlements",
      }),
    };
  }, societyId);
  expect(actual.obligations.rows[0].paidCents).toBe(26960);
  expect(actual.settlements.rows).toHaveLength(2);
  expect(
    actual.settlements.rows.every(
      (r: any) =>
        r.bankAccountId === bankAccountId &&
        r.payrollAccountNumber === "123456789RP0001",
    ),
  ).toBe(true);
  const history = review
    .locator("summary")
    .filter({ hasText: "Approval and activity history" });
  await activateRemittance(history);
  await inspectRemittance(page, testInfo, "retained-history", history);
  await activateRemittance(history);
  if (!testInfo.project.name) {
    await page.screenshot({
      path: "/workspace/scratch/payroll-operations-remittance-settlements.png",
      fullPage: true,
    });
    await page.evaluate(() => {
      for (const node of document.querySelectorAll<HTMLElement>("*"))
        if (node.scrollTop > 0) node.scrollTop = 0;
    });
    await page.screenshot({
      path: "/workspace/scratch/payroll-operations-remittance.png",
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});
test("a stale partially paid plan releases only its unpaid remainder for a corrected replacement", async ({
  page,
}, testInfo) => {
  const { panel, societyId, bankAccountId, obligationId } = await seed(page);
  await page.evaluate(
    async ({ societyId, bankAccountId, obligationId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      const id = await client.mutation("payrollRemittance:saveDraft", {
        societyId,
        fields: {
          obligationId,
          bankAccountId,
          amountCents: 26960,
          scheduledDate: "2026-06-12",
          channel: "financial_institution",
          destinationReference:
            "CRA payroll deductions regular/quarterly 123456789RP0001",
        },
      });
      await client.mutation("payrollRemittance:approve", {
        societyId,
        id,
        expectedVersion: 1,
      });
      const transactions = await client.query("payrollRemittance:workspace", {
          societyId,
          collection: "transactions",
          bankAccountId,
        }),
        partial = transactions.rows.find((r: any) => r.amountCents === -12000);
      await client.mutation("payrollRemittance:reconcilePayment", {
        societyId,
        id,
        date: partial.date,
        amountCents: 12000,
        transactionId: partial._id,
        evidence: "Actual reviewed partial bank settlement",
        destinationConfirmed: true,
        idempotencyKey: "browser-stale-partial",
        postToLedger: false,
      });
      const workspace = await client.query("payroll:workspace", { societyId }),
        run = workspace.runs.find((r: any) => r.payDate === "2026-05-15");
      await client.mutation("payroll:savePayRun", {
        societyId,
        id: run._id,
        periodStart: "2026-05-01",
        periodEnd: "2026-05-15",
        payDate: "2026-05-15",
        providerName: "Synthetic actual payroll provider",
        providerRunId: "REM-MAY-15",
        grossCents: 100000,
        nonCashTaxableCents: 0,
        nonTaxableCashCents: 0,
        cppEmployeeCents: 1000,
        cpp2EmployeeCents: 500,
        eiEmployeeCents: 200,
        incomeTaxCents: 8000,
        otherDeductionsCents: 0,
        cppEmployerCents: 1000,
        cpp2EmployerCents: 500,
        eiEmployerCents: 280,
        netCents: 90300,
        notes: "Reviewed actual source correction reducing income tax",
      });
    },
    { societyId, bankAccountId, obligationId },
  );
  await activateRemittance(
    panel.getByRole("button", { name: "Review plan", exact: true }),
  );
  const review = panel.getByRole("region", {
    name: "Remittance plan review",
    exact: true,
  });
  await activateRemittance(
    review.getByRole("button", {
      name: "Download prepared instructions",
      exact: true,
    }),
  );
  await expect(review.getByRole("alert")).toContainText(
    "changed after this snapshot",
  );
  await review
    .getByLabel("External submission reference or rejection reason", {
      exact: true,
    })
    .fill(
      "Release unpaid commitment after reviewed source correction; retain actual partial receipt",
    );
  await activateRemittance(
    review.getByRole("button", { name: "Cancel remaining plan", exact: true }),
  );
  await expect(review.getByText("rejected", { exact: true })).toBeVisible();
  await expect(
    review.getByText("Released remaining commitment", { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText("Matched bank outflow", { exact: false }),
  ).toHaveCount(1);
  await activateRemittance(
    panel.getByRole("button", { name: "Prepare payment plan", exact: true }),
  );
  const form = panel.getByRole("form", {
    name: "CRA remittance plan",
    exact: true,
  });
  await expect(
    form.getByLabel("Planned remittance amount (CAD)", { exact: true }),
  ).toHaveValue("129.60");
  await form
    .getByLabel("Remittance source bank", { exact: true })
    .selectOption(bankAccountId);
  await form
    .getByLabel("Exact CRA payee / destination reference", { exact: true })
    .fill("CRA payroll deductions regular/quarterly 123456789RP0001");
  await activateRemittance(
    form.getByRole("button", { name: "Save remittance draft", exact: true }),
  );
  await expect(form).toBeHidden();
  const records = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return {
      obligations: await client.query("payrollRemittance:workspace", {
        societyId,
        collection: "obligations",
      }),
      plans: await client.query("payrollRemittance:workspace", {
        societyId,
        collection: "plans",
      }),
      settlements: await client.query("payrollRemittance:workspace", {
        societyId,
        collection: "settlements",
      }),
    };
  }, societyId);
  expect(records.obligations.rows[0].paidCents).toBe(12000);
  expect(
    records.plans.rows.find((r: any) => r.status === "draft").amountCents,
  ).toBe(12960);
  expect(records.settlements.rows).toHaveLength(1);
  await verifyRemittancePropagation(
    page,
    societyId,
    bankAccountId,
    12000,
    24960,
    1,
  );
  await reopenRemittance(page, "$129.60");
  await expect(
    review
      .getByText("Plan remaining", { exact: true })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("$129.60");
  await expect(
    review.getByText(
      "CRA payroll deductions regular/quarterly 123456789RP0001",
      { exact: true },
    ),
  ).toBeVisible();
  await inspectRemittance(
    page,
    testInfo,
    "replacement-reloaded",
    review.getByRole("heading", { name: "Review CRA remittance", exact: true }),
  );
});
test("remittance plan paging and read-only financial permissions remain accessible without payment execution", async ({
  page,
}, testInfo) => {
  const { panel, societyId, readerId, bankAccountId, obligationId } =
    await seed(page);
  await page.evaluate(
    async ({ societyId, bankAccountId, obligationId }) => {
      const { localDataClient: client } =
        await import("/src/lib/localDataClient.ts");
      for (let i = 0; i < 12; i++)
        await client.mutation("payrollRemittance:saveDraft", {
          societyId,
          fields: {
            obligationId,
            bankAccountId,
            amountCents: 100,
            scheduledDate: "2026-06-12",
            channel: "financial_institution",
            destinationReference: "CRA payroll 123456789RP0001",
            notes: `Paged draft ${i + 1}`,
          },
        });
    },
    { societyId, bankAccountId, obligationId },
  );
  const plans = panel.getByRole("region", {
    name: "Remittance plans",
    exact: true,
  });
  await expect(
    plans.getByText("Page 1 · 10 visible", { exact: true }),
  ).toBeVisible();
  await activateRemittance(
    plans.getByRole("button", { name: "Next plans", exact: true }),
  );
  await expect(
    plans.getByText("Page 2 · 2 visible", { exact: true }),
  ).toBeVisible();
  await activateRemittance(
    plans.getByRole("button", { name: "Review plan", exact: true }).first(),
  );
  await expect(
    panel.getByRole("region", { name: "Remittance plan review", exact: true }),
  ).toBeVisible();
  await activateRemittance(
    plans.getByRole("button", { name: "Previous plans", exact: true }),
  );
  await expect(
    plans.getByText("Page 1 · 10 visible", { exact: true }),
  ).toBeVisible();
  await activateRemittance(
    panel.getByRole("button", {
      name: "Review automation readiness",
      exact: true,
    }),
  );
  const setup = panel.getByRole("form", {
    name: "Remittance automation readiness",
    exact: true,
  });
  await inspectRemittance(
    page,
    testInfo,
    "readiness-form",
    setup.getByRole("heading", { name: "Automation preparation", exact: true }),
  );
  await activateRemittance(
    setup.getByText("Registered CRA RP account verified", { exact: true }),
  );
  await activateRemittance(
    setup.getByText("CRA remitter category and effective schedule verified", {
      exact: true,
    }),
  );
  await activateRemittance(
    setup.getByRole("button", { name: "Save readiness review", exact: true }),
  );
  await expect(setup).toBeHidden();
  await page.evaluate(async (readerId) => {
    const { setStoredUserId } = await import("/src/hooks/useCurrentUser.ts");
    setStoredUserId(readerId);
  }, readerId);
  await page.reload();
  await expect(
    panel.getByText(
      "Read-only financial access: preparation, approval and payment recording are disabled.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", {
      name: "Review automation readiness",
      exact: true,
    }),
  ).toBeDisabled();
  for (const button of await panel
    .getByRole("button", { name: "Prepare payment plan", exact: true })
    .all())
    await expect(button).toBeDisabled();
  await activateRemittance(
    panel
      .getByRole("region", { name: "Remittance plans", exact: true })
      .getByRole("button", { name: "Review plan", exact: true })
      .first(),
  );
  const readonlyReview = panel.getByRole("region", {
    name: "Remittance plan review",
    exact: true,
  });
  await expect(
    readonlyReview.getByRole("button", {
      name: "Approve remittance plan",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    readonlyReview.getByRole("button", {
      name: "Revise remittance draft",
      exact: true,
    }),
  ).toBeDisabled();
  await inspectRemittance(
    page,
    testInfo,
    "read-only-reloaded",
    readonlyReview.getByRole("heading", {
      name: "Review CRA remittance",
      exact: true,
    }),
  );
  const readiness = await page.evaluate(async (societyId) => {
    const { localDataClient: client } =
      await import("/src/lib/localDataClient.ts");
    return client.query("payrollRemittance:workspace", {
      societyId,
      collection: "readiness",
    });
  }, societyId);
  expect(readiness.automationAvailable).toBe(false);
  expect(readiness.fields.rpRegistrationConfirmed).toBe(true);
  expect(readiness.fields.remitterCategoryConfirmed).toBe(true);
});
