import assert from "node:assert/strict";
import {
  assessRoeWorkflow,
  cleanRoeWorkflowFacts,
  emptyRoeReadiness,
  roeWorkflowFingerprint,
  validateRoeIssuedSerial,
  roeCaseFilingDefaults,
  type RoeWorkflowFacts,
  type RoeWorkflowCase,
} from "../shared/payrollRoeWorkflow";
import * as roe from "../shared/functions/payrollRoeWorkflow";
import * as deadlinesApi from "../shared/functions/deadlines";
import { MemoryDb } from "../shared/portable/memoryDb";
import { LocalStoreDb, MemoryRowStore } from "../shared/portable/localRowStore";
import { makeCapabilities } from "../shared/portable/capabilities";
import type { PortableMutationCtx } from "../shared/portable/ctx";
const facts: RoeWorkflowFacts = {
  trigger: "seven_days",
  format: "electronic",
  payPeriodCode: "B",
  firstDayWorked: "2025-01-01",
  lastDayPaid: "2026-01-23",
  awareDate: "2026-02-05",
  periodStart: "2026-01-12",
  periodEnd: "2026-01-25",
  noWorkNoEarningsDays: 7,
  anticipatedGap: false,
  exception: "ordinary",
  requestFrom: "none",
  inactiveCasual: false,
  otherRequirementConfirmed: false,
  reasonCode: "A00",
  evidence:
    "Reviewed actual payroll and end of contract; no work or insurable earnings for seven days",
};
assert.equal(assessRoeWorkflow(facts).interruptionDate, "2026-01-23");
assert.equal(
  assessRoeWorkflow(facts).dueDate,
  "2026-01-30",
  "electronic deadline receives no late-awareness extension",
);
assert.equal(
  assessRoeWorkflow({ ...facts, format: "paper" }).dueDate,
  "2026-02-10",
);
assert.equal(
  assessRoeWorkflow({
    ...facts,
    payPeriodCode: "M",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    lastDayPaid: "2026-01-01",
  }).dueDate,
  "2026-01-16",
);
assert.equal(
  assessRoeWorkflow({
    ...facts,
    payPeriodCode: "O",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-28",
    lastDayPaid: "2026-01-27",
  }).dueDate,
  "2026-02-02",
);
assert.equal(
  assessRoeWorkflow({
    ...facts,
    payPeriodCode: "W",
    lastDayPaid: "2026-01-23",
    periodEnd: "2026-01-25",
  }).dueDate,
  "2026-01-30",
);
assert.equal(
  assessRoeWorkflow({
    ...facts,
    lastDayPaid: "2026-01-24",
    periodEnd: "2026-01-26",
  }).dueDate,
  "2026-01-31",
  "calendar deadline stays Saturday",
);
const unverifiedRequest = assessRoeWorkflow({
  ...facts,
  requestFrom: "service_canada",
  interruptionDate: facts.lastDayPaid,
});
assert.ok(
  unverifiedRequest.blockers.some((message) =>
    message.includes("actual Service Canada request"),
  ),
);
assert.match(unverifiedRequest.deadlineBasis, /Estimated ordinary timing only/);
assert.equal(
  assessRoeWorkflow({
    ...facts,
    requestFrom: "service_canada",
    requestedDueDate: "2026-02-06",
  }).dueDate,
  "2026-02-06",
);
assert.equal(
  assessRoeWorkflow({ ...facts, trigger: "request", requestFrom: "employee" })
    .requirement,
  "required",
);
assert.equal(
  assessRoeWorkflow({ ...facts, noWorkNoEarningsDays: 6 }).requirement,
  "not_required",
);
assert.equal(
  assessRoeWorkflow({ ...facts, exception: "casual" }).requirement,
  "review_required",
);
assert.equal(
  assessRoeWorkflow({ ...facts, exception: "casual", noWorkNoEarningsDays: 30 })
    .requirement,
  "required",
);
assert.equal(
  assessRoeWorkflow({
    ...facts,
    exception: "casual",
    noWorkNoEarningsDays: 2,
    inactiveCasual: true,
  }).requirement,
  "required",
);
assert.equal(
  assessRoeWorkflow({ ...facts, exception: "casual", requestFrom: "employee" })
    .requirement,
  "required",
);
for (const exception of [
  "annual_vacation",
  "self_funded",
  "nonstandard",
] as const)
  assert.equal(
    assessRoeWorkflow({ ...facts, exception }).requirement,
    "review_required",
  );
const reduced = {
  ...facts,
  trigger: "reduced_earnings" as const,
  normalWeeklyEarningsCents: 100000,
  reducedWeeklyEarningsCents: 60000,
  reductionWeekDate: "2026-01-22",
  reductionReason: "illness_injury_quarantine" as const,
};
assert.equal(assessRoeWorkflow(reduced).requirement, "not_required");
assert.equal(
  assessRoeWorkflow({ ...reduced, reducedWeeklyEarningsCents: 59999 })
    .requirement,
  "required",
);
assert.equal(
  assessRoeWorkflow({ ...reduced, reducedWeeklyEarningsCents: 59999 })
    .interruptionDate,
  "2026-01-18",
);
assert.equal(
  assessRoeWorkflow({
    ...reduced,
    reducedWeeklyEarningsCents: 59999,
    reductionReason: "other",
  }).requirement,
  "review_required",
);
assert.equal(
  assessRoeWorkflow({ ...facts, reviewTargetDate: "2026-02-20" }, true).dueDate,
  "2026-02-20",
);
assert.ok(assessRoeWorkflow(facts, true).blockers.length);
assert.throws(
  () => cleanRoeWorkflowFacts({ ...facts, lastDayPaid: "2026-02-30" }),
  /valid/,
);
assert.throws(
  () => cleanRoeWorkflowFacts({ ...facts, evidence: "SIN 046 454 286" }),
  /valid/,
);
assert.equal(validateRoeIssuedSerial("W00000001", "electronic"), "W00000001");
assert.equal(validateRoeIssuedSerial("E00000001", "paper"), "E00000001");
assert.throws(() => validateRoeIssuedSerial("UNKNOWN", "electronic"));
assert.equal(
  await roeWorkflowFingerprint({ b: 2, a: 1 }),
  await roeWorkflowFingerprint({ a: 1, b: 2 }),
  "fingerprints canonicalize key order",
);
const societyId = "roe-society",
  employeeId = "roe-employee",
  ownerId = "roe-owner";
const principal = {
  kind: "user",
  runtime: "test",
  assurance: "trusted-workspace",
  subject: ownerId,
  userId: ownerId,
  societyId,
} as const;
const seed = {
  societies: [{ _id: societyId, name: "Protected employer" }],
  users: [
    { _id: ownerId, societyId, role: "Owner", status: "Active" },
    { _id: "reader", societyId, role: "Director", status: "Active" },
  ],
  employees: [
    {
      _id: employeeId,
      societyId,
      firstName: "Protected",
      lastName: "Employee",
      startDate: "2025-01-01",
      sinSecretVaultItemId: "DO-NOT-EXPOSE",
    },
    { _id: "foreign", societyId: "other", firstName: "Foreign" },
  ],
};
for (const runtime of ["memory", "indexed-local"] as const) {
  const db =
    runtime === "memory"
      ? new MemoryDb({ seed: structuredClone(seed) })
      : new LocalStoreDb(
          new MemoryRowStore(structuredClone(seed), { indexed: true }),
        );
  const ctx = {
    db,
    principal,
    capabilities: makeCapabilities({}),
  } as PortableMutationCtx;
  const mutate = <T>(fn: () => Promise<T>) => db.transaction(fn);
  const id = await mutate(() =>
    roe.saveCasePortable(ctx, {
      societyId,
      employeeId,
      facts: {
        ...facts,
        privateSin: "NEVER-PERSIST",
        employeeId: "foreign",
      } as any,
    }),
  );
  let record = await db.get<RoeWorkflowCase>(id, "payrollRoeWorkflowCases");
  assert.ok(record?.registerId);
  assert.equal(record?.employeeId, employeeId);
  assert.ok(!JSON.stringify(record).includes("NEVER-PERSIST"));
  let view = (
    await roe.workspacePortable(ctx, { societyId, collection: "cases", id })
  ).detail!;
  assert.equal(view.stage, "preparing");
  assert.ok(!JSON.stringify(view).includes("DO-NOT-EXPOSE"));
  assert.equal(view.register?.status, "to_issue");
  assert.equal(view.register?.dueDate, "2026-01-30");
  await assert.rejects(
    mutate(() =>
      roe.recordGeneratedPortable(ctx, {
        societyId,
        id,
        caseFingerprint: view.caseFingerprint,
        sha256: "a".repeat(64),
        byteLength: 100,
        filename: "ROE.xml",
        schemaVersion: "W-2.0",
      }),
    ),
    /readiness/,
  );
  const checklist = Object.fromEntries(
    Object.keys(emptyRoeReadiness()).map((key) => [key, true]),
  ) as ReturnType<typeof emptyRoeReadiness>;
  await mutate(() =>
    roe.updateChecklistPortable(ctx, {
      societyId,
      id,
      checklist,
      expectedVersion: 1,
    }),
  );
  view = (
    await roe.workspacePortable(ctx, { societyId, collection: "cases", id })
  ).detail!;
  await assert.rejects(
    mutate(() =>
      roe.recordGeneratedPortable(ctx, {
        societyId,
        id,
        caseFingerprint: "stale",
        sha256: "a".repeat(64),
        byteLength: 100,
        filename: "ROE.xml",
        schemaVersion: "W-2.0",
      }),
    ),
    /changed/,
  );
  await mutate(() =>
    roe.recordGeneratedPortable(ctx, {
      societyId,
      id,
      caseFingerprint: view.caseFingerprint,
      sha256: "a".repeat(64),
      byteLength: 100,
      filename: "ROE.xml",
      schemaVersion: "W-2.0",
      expectedVersion: view.version,
    }),
  );
  view = (
    await roe.workspacePortable(ctx, { societyId, collection: "cases", id })
  ).detail!;
  assert.equal(view.stage, "generated");
  assert.equal(
    view.register?.status,
    "to_issue",
    "generating XML never issues ROE",
  );
  await mutate(() =>
    roe.recordSubmissionPortable(ctx, {
      societyId,
      id,
      atISO: "2026-01-26T16:00:00Z",
      channel: "roe_web",
      reference: "actual-test-upload",
      note: "Actual portal upload pending validation",
    }),
  );
  view = (
    await roe.workspacePortable(ctx, { societyId, collection: "cases", id })
  ).detail!;
  assert.equal(view.stage, "submitted");
  assert.equal(view.register?.status, "to_issue");
  await assert.rejects(
    mutate(() =>
      roe.saveCasePortable(ctx, { societyId, id, employeeId, facts }),
    ),
    /Submitted/,
  );
  await mutate(() =>
    roe.recordSubmissionPortable(ctx, {
      societyId,
      id,
      atISO: "2026-01-26T17:00:00Z",
      channel: "roe_web",
      reference: "actual-test-rejection",
      note: "Actual portal validation rejected; source corrected next",
      outcome: "rejected",
    }),
  );
  await mutate(() =>
    roe.saveCasePortable(ctx, {
      societyId,
      id,
      employeeId,
      facts: { ...facts, notes: "Actual corrected payroll history reviewed" },
    }),
  );
  view = (
    await roe.workspacePortable(ctx, { societyId, collection: "cases", id })
  ).detail!;
  assert.equal(
    view.stage,
    "preparing",
    "editing facts invalidates generated snapshot",
  );
  await mutate(() =>
    roe.updateChecklistPortable(ctx, { societyId, id, checklist }),
  );
  await assert.rejects(
    mutate(() =>
      roe.recordIssuancePortable(ctx, {
        societyId,
        id,
        atISO: "2026-01-27T16:00:00Z",
        serialNumber: "W00000001",
        acknowledgment: "SIN 046454286",
      }),
    ),
    /valid/,
  );
  await mutate(() =>
    roe.recordIssuancePortable(ctx, {
      societyId,
      id,
      atISO: "2026-01-27T16:00:00Z",
      serialNumber: "W00000001",
      acknowledgment:
        "Actual success acknowledgment reviewed; direct ROE Web entry",
    }),
  );
  view = (
    await roe.workspacePortable(ctx, { societyId, collection: "cases", id })
  ).detail!;
  assert.equal(view.stage, "issued");
  assert.equal(view.register?.status, "issued");
  assert.equal(view.register?.serialNumber, "W00000001");
  assert.equal(
    view.followUps.find((row) => row.key === "retention")?.dueDate,
    "2032-12-31",
  );
  assert.equal(
    (await db.get(view.deadlineId!, "deadlines"))?.status,
    "complete",
  );
  const deadlines = await db.query("deadlines").collect();
  assert.ok(deadlines.length >= 5);
  for (const deadline of deadlines) {
    assert.ok(!JSON.stringify(deadline).includes("Protected Employee"));
    assert.ok(
      !String(deadline.description).includes("Actual success acknowledgment"),
    );
  }
  assert.ok(
    deadlines
      .filter((row) => String(row.sourceKey).startsWith("roe-workflow:"))
      .every((row) => !String(row.sourceKey).startsWith("payroll:")),
  );
  await assert.rejects(
    mutate(() =>
      roe.saveCasePortable(ctx, { societyId, id, employeeId, facts }),
    ),
    /issued ROE/,
  );
  await assert.rejects(
    mutate(() => roe.closeCasePortable(ctx, { societyId, id, note: "Done" })),
    /follow-ups/,
  );
  for (const key of ["employee_access", "missing_information"] as const)
    await mutate(() =>
      roe.saveFollowUpPortable(ctx, {
        societyId,
        id,
        key,
        dueDate: "2026-01-28",
        status: "done",
        note: "Actual review complete",
      }),
    );
  await mutate(() =>
    roe.closeCasePortable(ctx, {
      societyId,
      id,
      note: "Operational follow-ups complete; secure retention remains tracked",
    }),
  );
  const amendment = await mutate(() =>
    roe.saveCasePortable(ctx, {
      societyId,
      employeeId,
      amendmentOfCaseId: id,
      facts: {
        ...facts,
        reviewTargetDate: "2026-02-02",
        notes: "Correct actual hours in all blocks",
      },
    }),
  );
  const amendmentView = (
    await roe.workspacePortable(ctx, {
      societyId,
      collection: "cases",
      id: amendment,
    })
  ).detail!;
  assert.equal(amendmentView.amendmentOriginalSerial, "W00000001");
  assert.notEqual(amendmentView.registerId, view.registerId);
  assert.equal(
    (await db.get(view.registerId!, "recordsOfEmployment"))?.status,
    "issued",
  );
  await mutate(() =>
    roe.updateChecklistPortable(ctx, { societyId, id: amendment, checklist }),
  );
  await assert.rejects(
    mutate(() =>
      roe.recordIssuancePortable(ctx, {
        societyId,
        id: amendment,
        atISO: "2026-01-29T16:00:00Z",
        serialNumber: "W00000001",
        acknowledgment: "Actual amendment accepted",
      }),
    ),
    /already recorded/,
  );
  await assert.rejects(
    mutate(() =>
      roe.saveCasePortable(ctx, { societyId, employeeId: "foreign", facts }),
    ),
    /not found/,
  );
  const reader = {
    ...ctx,
    principal: { ...principal, userId: "reader" },
  } as PortableMutationCtx;
  assert.ok(
    await roe.workspacePortable(reader, { societyId, collection: "cases" }),
  );
  await assert.rejects(
    mutate(() =>
      roe.saveCasePortable(reader, { societyId, employeeId, facts }),
    ),
    /financials:write/,
  );
  for (const managed of await db.query("deadlines").collect()) {
    await assert.rejects(
      mutate(() =>
        deadlinesApi.setStatusPortable(ctx, {
          id: managed._id,
          status: "closed",
        }),
      ),
      /protected ROE case/,
    );
    await assert.rejects(
      mutate(() =>
        deadlinesApi.toggleDonePortable(ctx, { id: managed._id, done: true }),
      ),
      /protected ROE case/,
    );
    await assert.rejects(
      mutate(() =>
        deadlinesApi.updatePortable(ctx, {
          id: managed._id,
          patch: { dueDate: "2099-01-01" },
        }),
      ),
      /protected ROE case/,
    );
    await assert.rejects(
      mutate(() => deadlinesApi.removePortable(ctx, { id: managed._id })),
      /protected ROE case/,
    );
  }
  const ordinary = await mutate(() =>
    deadlinesApi.createPortable(ctx, {
      societyId,
      title: "Ordinary editable reminder",
      dueDate: "2026-02-01",
      category: "Other",
    }),
  );
  await mutate(() =>
    deadlinesApi.updatePortable(ctx, {
      id: ordinary,
      patch: { dueDate: "2026-02-02" },
    }),
  );
  await mutate(() =>
    deadlinesApi.setStatusPortable(ctx, { id: ordinary, status: "closed" }),
  );
  await mutate(() =>
    deadlinesApi.toggleDonePortable(ctx, { id: ordinary, done: false }),
  );
  await mutate(() => deadlinesApi.removePortable(ctx, { id: ordinary }));
  const legacy = await mutate(() =>
    db.insert("recordsOfEmployment", {
      societyId,
      employeeId,
      employeeName: "Protected Employee",
      status: "issued",
      lastDayPaid: facts.lastDayPaid,
      reasonCode: "A",
      dueDate: "2026-01-28",
      issuedOn: "2026-01-27",
      serialNumber: "M00000003",
    }),
  );
  const adopted = await mutate(() =>
    roe.saveCasePortable(ctx, {
      societyId,
      employeeId,
      registerId: legacy,
      facts,
    }),
  );
  const adoption = (
    await roe.workspacePortable(ctx, {
      societyId,
      collection: "cases",
      id: adopted,
    })
  ).detail!;
  assert.equal(adoption.stage, "issued");
  assert.equal(adoption.register?.serialNumber, "M00000003");
  assert.equal(adoption.register?.issuedOn, "2026-01-27");
  assert.equal(
    adoption.register?.reasonCode,
    "A",
    "adoption preserves actual legacy issued facts",
  );
  assert.equal(
    adoption.register?.dueDate,
    adoption.assessment.dueDate,
    "reviewed deadline and original register remain coherent",
  );
  assert.equal(adoption.followUps.length, 4);
  assert.ok(
    adoption.followUps.every((item) => item.status === "open"),
    "adoption does not invent acceptance review or employee access",
  );
  await mutate(() =>
    roe.updateChecklistPortable(ctx, { societyId, id: adopted, checklist }),
  );
  const missingLegacy = await mutate(() =>
    db.insert("recordsOfEmployment", {
      societyId,
      employeeId,
      employeeName: "Protected Employee",
      status: "issued",
      lastDayPaid: facts.lastDayPaid,
      reasonCode: "A",
      issuedOn: "2026-01-27",
    }),
  );
  const missingCase = await mutate(() =>
    roe.saveCasePortable(ctx, {
      societyId,
      employeeId,
      registerId: missingLegacy,
      facts: { ...facts, format: "paper" },
    }),
  );
  await assert.rejects(
    mutate(() =>
      roe.saveCasePortable(ctx, {
        societyId,
        employeeId,
        amendmentOfCaseId: missingCase,
        facts: {
          ...facts,
          reviewTargetDate: "2026-02-02",
          notes: "Actual correction",
        },
      }),
    ),
    /original issued ROE serial/,
  );
  await assert.rejects(
    mutate(() =>
      roe.saveFollowUpPortable(ctx, {
        societyId,
        id: missingCase,
        key: "acceptance",
        dueDate: "2026-01-28",
        status: "done",
        note: "Cannot assume unknown serial",
      }),
    ),
    /real serial/,
  );
  await mutate(() =>
    roe.updateChecklistPortable(ctx, { societyId, id: missingCase, checklist }),
  );
  await mutate(() =>
    roe.recordIssuancePortable(ctx, {
      societyId,
      id: missingCase,
      atISO: "2026-01-27",
      serialNumber: "E00000002",
      acknowledgment:
        "Original official paper source reviewed; date known, exact time not recorded",
      paperCopiesCompleted: true,
    }),
  );
  const completedLegacy = (
    await roe.workspacePortable(ctx, {
      societyId,
      collection: "cases",
      id: missingCase,
    })
  ).detail!;
  assert.equal(completedLegacy.register?.issuedOn, "2026-01-27");
  assert.equal(completedLegacy.register?.serialNumber, "E00000002");
  assert.match(
    roeCaseFilingDefaults({
      ...completedLegacy,
      amendmentOriginalSerial: "E00000002",
    }).comments ?? "",
    /Amending a paper ROE E00000002/,
  );
  const noRequirement = await mutate(() =>
    roe.saveCasePortable(ctx, {
      societyId,
      employeeId,
      facts: { ...facts, noWorkNoEarningsDays: 2 },
    }),
  );
  assert.equal(
    (await db.get(noRequirement, "payrollRoeWorkflowCases"))?.registerId,
    undefined,
  );
  await mutate(() =>
    roe.closeCasePortable(ctx, {
      societyId,
      id: noRequirement,
      note: "Reviewed two-day ordinary gap; monitor actual changes",
    }),
  );
  for (let n = 0; n < 7; n++)
    await mutate(() =>
      roe.saveCasePortable(ctx, {
        societyId,
        employeeId,
        facts: {
          ...facts,
          noWorkNoEarningsDays: 2,
          evidence: `Reviewed short-gap scenario ${n}`,
        },
      }),
    );
  let cursor: string | null = null,
    count = 0,
    seen = new Set<string>();
  do {
    const page = await roe.workspacePortable(ctx, {
      societyId,
      collection: "cases",
      cursor,
    });
    for (const row of page.page) {
      assert.ok(!seen.has(row._id));
      seen.add(row._id);
    }
    count++;
    if (page.isDone) break;
    cursor = page.continueCursor;
  } while (count < 20);
  assert.equal(seen.size, 12);
  assert.ok(count >= 3);
  console.log(
    `ROE workflow ${runtime}: official calendar thresholds/deadlines, saved readiness, distinct generated/submitted/issued stages, original register/deadline coherence, protected followups, amendment serial ownership, audit, full pagination and financial write guards passed.`,
  );
}
