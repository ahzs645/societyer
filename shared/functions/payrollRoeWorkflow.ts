import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  resolutionCalendarDate,
  resolutionTimeZone,
} from "../writtenResolutionEvidence";
import {
  assessRoeWorkflow,
  cleanRoeWorkflowFacts,
  cleanRoeReadiness,
  emptyRoeReadiness,
  roeReadinessBlockers,
  roeWorkflowFingerprint,
  validateRoeIssuedSerial,
  ROE_WORKFLOW_RULES_VERSION,
  ROE_WORKFLOW_SOURCES,
  ROE_FOLLOWUP_LABELS,
  type RoeWorkflowCase,
  type RoeWorkflowFacts,
  type RoeWorkflowView,
  type RoeRegister,
  type RoeReadiness,
  type RoeFollowUp,
  type RoeFollowUpKey,
  type RoeWorkflowEvent,
} from "../payrollRoeWorkflow";
const table = "payrollRoeWorkflowCases";
async function authorize(
  ctx: PortableQueryCtx,
  societyId: string,
  write = false,
) {
  await requirePermissionPortable(
    ctx,
    societyId,
    write ? "financials:write" : "financials:read",
  );
  await requirePermissionPortable(ctx, societyId, "employees:read");
}
async function today(ctx: PortableQueryCtx, societyId: string) {
  const org = await getOwned(ctx, "societies", societyId, societyId).catch(() =>
    ctx.db.get(societyId, "societies"),
  );
  if (!org) throw new Error("Organization not found.");
  return (
    resolutionCalendarDate(new Date().toISOString(), resolutionTimeZone(org)) ??
    new Date().toISOString().slice(0, 10)
  );
}
function bounded(value: unknown, label: string, required = false, max = 2000) {
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length > max ||
    /(?:^|[^0-9])\d{3}[- ]?\d{3}[- ]?\d{3}(?:[^0-9]|$)/.test(value) ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
  )
    throw new Error(
      `${label} must contain ${required ? "1–" : "at most "}${max} valid characters.`,
    );
  return value.trim();
}
function date(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return value;
}
function instant(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    Date.parse(value) > Date.now() + 60000
  )
    throw new Error(`${label} must be an actual timestamp, not a future date.`);
  return new Date(value).toISOString();
}
function clean<T extends object>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}
function size(value: unknown) {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 48000)
    throw new Error(
      "This case exceeds the 48 KB protected audit bound. Retain this case and create a linked reviewed follow-up; history is never silently removed.",
    );
}
function assertVersion(row: RoeWorkflowCase, expected?: number) {
  if (expected !== undefined && row.version !== expected)
    throw new Error(
      "This ROE case changed. Reopen the current version before recording the action.",
    );
}
async function person(ctx: PortableQueryCtx, societyId: string, id: string) {
  const row = await getOwned(ctx, "employees", id, societyId);
  return {
    _id: row._id,
    name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
    startDate: String(row.startDate ?? ""),
  };
}
function registerProjection(row: any): RoeRegister {
  return clean({
    _id: row._id,
    employeeId: row.employeeId,
    employeeName: String(row.employeeName ?? ""),
    lastDayPaid: String(row.lastDayPaid ?? ""),
    reasonCode: String(row.reasonCode ?? ""),
    dueDate: row.dueDate,
    status: String(row.status ?? "to_issue"),
    issuedOn: row.issuedOn,
    serialNumber: row.serialNumber,
  });
}
async function fingerprint(row: RoeWorkflowCase) {
  return roeWorkflowFingerprint({
    employeeId: row.employeeId,
    facts: row.facts,
    checklist: row.checklist,
    rulesVersion: row.rulesVersion,
    amendmentOfCaseId: row.amendmentOfCaseId,
    amendmentOriginalSerial: row.amendmentOriginalSerial,
  });
}
async function view(
  ctx: PortableQueryCtx,
  row: RoeWorkflowCase,
): Promise<RoeWorkflowView> {
  const register = row.registerId
    ? registerProjection(
        await getOwned(
          ctx,
          "recordsOfEmployment",
          row.registerId,
          row.societyId,
        ),
      )
    : null;
  if (register && register.employeeId !== row.employeeId)
    throw new Error(
      "Linked ROE register employee does not match the protected case.",
    );
  const caseFingerprint = await fingerprint(row),
    assessment = assessRoeWorkflow(row.facts, Boolean(row.amendmentOfCaseId));
  let originalCase: RoeWorkflowView["originalCase"];
  if (row.amendmentOfCaseId) {
    const parent = await getOwned<RoeWorkflowCase>(
        ctx,
        table,
        row.amendmentOfCaseId,
        row.societyId,
      ),
      original = parent.registerId
        ? await getOwned(
            ctx,
            "recordsOfEmployment",
            parent.registerId,
            row.societyId,
          )
        : null;
    originalCase = clean({
      _id: parent._id,
      employeeName: parent.employeeName,
      serialNumber: original?.serialNumber,
      issuedOn: original?.issuedOn,
    });
  }
  return clean({
    ...row,
    assessment,
    register,
    caseFingerprint,
    readinessBlockers: roeReadinessBlockers(row),
    stage: row.closedAtISO
      ? "closed"
      : register?.status === "issued"
        ? "issued"
        : row.submission
          ? "submitted"
          : row.generated?.caseFingerprint === caseFingerprint
            ? "generated"
            : assessment.requirement === "not_required"
              ? "not_required"
              : "preparing",
    originalCase,
  });
}
async function event(
  ctx: PortableMutationCtx,
  row: RoeWorkflowCase | null,
  societyId: string,
  action: string,
  note?: string,
  extra: Partial<RoeWorkflowEvent> = {},
) {
  if ((row?.history.length ?? 0) >= 100)
    throw new Error(
      "This case already contains 100 retained audit events. Create a linked follow-up rather than discarding protected history.",
    );
  return clean({
    atISO: new Date().toISOString(),
    actorUserId: await principalUserId(ctx, societyId),
    action,
    version: (row?.version ?? 0) + 1,
    note,
    ...extra,
  });
}
async function write(
  ctx: PortableMutationCtx,
  row: RoeWorkflowCase,
  patch: Partial<RoeWorkflowCase>,
  action: string,
  note?: string,
  extra: Partial<RoeWorkflowEvent> = {},
) {
  const change = {
    ...patch,
    version: row.version + 1,
    updatedAtISO: new Date().toISOString(),
    history: [
      ...row.history,
      await event(ctx, row, row.societyId, action, note, extra),
    ],
  };
  size({ ...row, ...change });
  await ctx.db.patch(row._id, change);
  return row._id;
}
async function editable(ctx: PortableQueryCtx, row: RoeWorkflowCase) {
  if (row.closedAtISO || row.submission)
    throw new Error(
      "Submitted or closed ROE facts are retained. Record a rejection before correction, or create an amendment after issuance.",
    );
  if (
    row.registerId &&
    (await getOwned(ctx, "recordsOfEmployment", row.registerId, row.societyId))
      .status === "issued"
  )
    throw new Error(
      "An issued ROE cannot be edited or cancelled. Create a complete linked amendment using its actual serial.",
    );
}
async function mainDeadline(
  ctx: PortableMutationCtx,
  row: RoeWorkflowCase,
  assessment: ReturnType<typeof assessRoeWorkflow>,
  done: boolean,
) {
  if (!assessment.dueDate) return row.deadlineId;
  const fields = {
    societyId: row.societyId,
    title: row.amendmentOfCaseId
      ? "ROE amendment deadline"
      : "Record of Employment deadline",
    dueDate: assessment.dueDate,
    category: "Payroll",
    description: `Protected ROE workflow. ${assessment.deadlineBasis} Source: ${ROE_WORKFLOW_SOURCES[0].url}`,
    status: done ? "complete" : "open",
    done,
    sourceKey: `payroll:roe:${row.registerId}`,
  };
  if (row.deadlineId) {
    await getOwned(ctx, "deadlines", row.deadlineId, row.societyId);
    await ctx.db.patch(row.deadlineId, fields);
    return row.deadlineId;
  }
  return ctx.db.insert("deadlines", fields);
}
function cursor(raw: string | null | undefined, scope: string) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid ROE page. Restart from the first page.");
  }
  if (parsed.scope !== scope || typeof parsed.cursor !== "string")
    throw new Error(
      "This ROE page belongs to another workspace, employee or collection.",
    );
  return parsed.cursor as string;
}
export async function workspacePortable(
  ctx: PortableQueryCtx,
  args: {
    societyId: string;
    collection: "cases" | "registers";
    employeeId?: string;
    id?: string;
    cursor?: string | null;
  },
) {
  await authorize(ctx, args.societyId);
  if (args.employeeId) await person(ctx, args.societyId, args.employeeId);
  const scope = JSON.stringify([
      args.societyId,
      args.collection,
      args.employeeId ?? "",
    ]),
    pageCursor = cursor(args.cursor, scope);
  if (!["cases", "registers"].includes(args.collection))
    throw new Error("Select ROE cases or existing register records.");
  const query =
    args.collection === "cases"
      ? args.employeeId
        ? ctx.db
            .query<RoeWorkflowCase>(table)
            .withIndex("by_society_employee", (q) =>
              q
                .eq("societyId", args.societyId)
                .eq("employeeId", args.employeeId),
            )
        : ctx.db
            .query<RoeWorkflowCase>(table)
            .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      : ctx.db
          .query("recordsOfEmployment")
          .withIndex("by_society", (q) => q.eq("societyId", args.societyId));
  const result = await query
    .order("desc")
    .paginate({ numItems: 4, cursor: pageCursor, maximumBytesRead: 750000 });
  const page =
    args.collection === "cases"
      ? await Promise.all(
          result.page.map((row) => view(ctx, row as RoeWorkflowCase)),
        )
      : result.page
          .filter(
            (row) => !args.employeeId || row.employeeId === args.employeeId,
          )
          .map(registerProjection);
  return clean({
    page,
    isDone: result.isDone,
    continueCursor: result.isDone
      ? ""
      : JSON.stringify({ scope, cursor: result.continueCursor }),
    today: await today(ctx, args.societyId),
    detail: args.id
      ? await view(
          ctx,
          await getOwned<RoeWorkflowCase>(ctx, table, args.id, args.societyId),
        )
      : undefined,
    sources: ROE_WORKFLOW_SOURCES,
  });
}
export async function saveCasePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id?: string;
    employeeId: string;
    registerId?: string;
    amendmentOfCaseId?: string;
    facts: RoeWorkflowFacts;
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const employee = await person(ctx, args.societyId, args.employeeId),
    old = args.id
      ? await getOwned<RoeWorkflowCase>(ctx, table, args.id, args.societyId)
      : null,
    facts = cleanRoeWorkflowFacts(args.facts);
  if (old) {
    assertVersion(old, args.expectedVersion);
    await editable(ctx, old);
    if (
      old.employeeId !== args.employeeId ||
      old.amendmentOfCaseId !== args.amendmentOfCaseId
    )
      throw new Error(
        "A case cannot move to another employee or amendment parent.",
      );
    if (args.registerId && args.registerId !== old.registerId)
      throw new Error("The case's linked register is retained.");
  }
  let originalSerial = old?.amendmentOriginalSerial;
  if (args.amendmentOfCaseId) {
    const parent = await getOwned<RoeWorkflowCase>(
      ctx,
      table,
      args.amendmentOfCaseId,
      args.societyId,
    );
    if (parent.employeeId !== args.employeeId || !parent.registerId)
      throw new Error(
        "An amendment must reference this employee's actual issued ROE case.",
      );
    const register = await getOwned(
      ctx,
      "recordsOfEmployment",
      parent.registerId,
      args.societyId,
    );
    if (register.status !== "issued" || !register.serialNumber)
      throw new Error(
        "Obtain the original issued ROE serial first; an unissued case is corrected in place.",
      );
    originalSerial = String(register.serialNumber);
    if (!/^[WMSYAEKLZ]\d{8}$/.test(originalSerial))
      throw new Error(
        "The original ROE serial requires review before amendment.",
      );
    if (
      JSON.stringify(parent.facts) === JSON.stringify(facts) &&
      !facts.notes?.trim()
    )
      throw new Error(
        "An amendment needs actual new or corrected information and an explanation; no new information does not require an amendment.",
      );
  }
  const assessment = assessRoeWorkflow(facts, Boolean(args.amendmentOfCaseId));
  let registerId = old?.registerId ?? args.registerId;
  let adoptedIssued = false;
  if (registerId) {
    const linked = await getOwned(
      ctx,
      "recordsOfEmployment",
      registerId,
      args.societyId,
    );
    if (linked.employeeId !== args.employeeId)
      throw new Error(
        "Choose an existing ROE register record linked to this employee.",
      );
    const peers = await ctx.db
      .query<RoeWorkflowCase>(table)
      .withIndex("by_society_register", (q) =>
        q.eq("societyId", args.societyId).eq("registerId", registerId),
      )
      .take(2);
    if (peers.some((row) => row._id !== old?._id))
      throw new Error("This register record already has a guided ROE case.");
    if (linked.status === "issued" && old)
      throw new Error("Issued records require a linked amendment.");
    if (
      linked.status === "issued" &&
      (linked.lastDayPaid !== facts.lastDayPaid ||
        (linked.reasonCode !== facts.reasonCode &&
          linked.reasonCode !== facts.reasonCode.slice(0, 1)))
    )
      throw new Error(
        "Existing issued register facts cannot be rewritten by adopting a case. Review the exact original last-paid date and reason first; use an amendment for corrected issued facts.",
      );
    adoptedIssued = linked.status === "issued";
    if (adoptedIssued && assessment.requirement !== "required")
      throw new Error(
        "Review the actual original interruption requirement before adopting an issued register record.",
      );
    if (adoptedIssued && linked.dueDate !== assessment.dueDate)
      await ctx.db.patch(registerId, {
        dueDate: assessment.dueDate,
        updatedAtISO: new Date().toISOString(),
      });
    if (linked.status !== "issued")
      await ctx.db.patch(
        registerId,
        clean({
          lastDayPaid: facts.lastDayPaid,
          reasonCode: facts.reasonCode,
          dueDate: assessment.dueDate,
          updatedAtISO: new Date().toISOString(),
        }),
      );
  }
  if (!registerId && assessment.requirement === "required")
    registerId = await ctx.db.insert(
      "recordsOfEmployment",
      clean({
        societyId: args.societyId,
        employeeId: employee._id,
        employeeName: employee.name,
        reasonCode: facts.reasonCode,
        lastDayPaid: facts.lastDayPaid,
        dueDate: assessment.dueDate,
        status: "to_issue",
        notes:
          "Managed by the protected guided ROE workflow; export is not issuance.",
        createdAtISO: new Date().toISOString(),
        updatedAtISO: new Date().toISOString(),
      }),
    );
  if (old?.registerId && assessment.requirement !== "required")
    throw new Error(
      "This case already has an ROE obligation in the register. Keep its requirement under review and resolve the original obligation explicitly instead of silently deleting it.",
    );
  const now = new Date().toISOString(),
    data = clean({
      societyId: args.societyId,
      employeeId: employee._id,
      employeeName: employee.name,
      registerId,
      amendmentOfCaseId: args.amendmentOfCaseId,
      amendmentOriginalSerial: originalSerial,
      facts,
      checklist: emptyRoeReadiness(),
      rulesVersion: ROE_WORKFLOW_RULES_VERSION,
      version: (old?.version ?? 0) + 1,
      history: [
        ...(old?.history ?? []),
        await event(
          ctx,
          old,
          args.societyId,
          old ? "facts_updated" : "case_created",
        ),
      ],
      followUps: old?.followUps ?? [],
      createdAtISO: old?.createdAtISO ?? now,
      updatedAtISO: now,
      ...(old?.deadlineId ? { deadlineId: old.deadlineId } : {}),
    });
  size(data);
  const id = old ? old._id : await ctx.db.insert(table, data);
  if (old) await ctx.db.patch(id, { ...data, generated: undefined });
  if (registerId) {
    const deadlineId = await mainDeadline(
      ctx,
      { ...data, _id: id } as RoeWorkflowCase,
      assessment,
      (await getOwned(ctx, "recordsOfEmployment", registerId, args.societyId))
        .status === "issued",
    );
    if (deadlineId) await ctx.db.patch(id, { deadlineId });
  }
  if (adoptedIssued) {
    const row = { ...data, _id: id } as RoeWorkflowCase,
      asOf = await today(ctx, args.societyId),
      retentionDate = `${Number(facts.lastDayPaid.slice(0, 4)) + 6}-12-31`;
    const followUps: RoeFollowUp[] = [];
    for (const key of Object.keys(ROE_FOLLOWUP_LABELS) as RoeFollowUpKey[])
      followUps.push(
        await followup(
          ctx,
          row,
          key,
          key === "retention" ? retentionDate : asOf,
          "open",
          key === "acceptance"
            ? "Existing register states issued. Review its actual serial/date and official acceptance source; adoption did not issue another ROE."
            : key === "retention"
              ? "Retain related records for six years after the year to which they relate; review target only, no automatic deletion."
              : "Review the actual existing ROE follow-up; no employee access or missing-information resolution is assumed.",
        ),
      );
    await ctx.db.patch(id, { followUps });
  }
  return id;
}
export async function updateChecklistPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    checklist: RoeReadiness;
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const row = await getOwned<RoeWorkflowCase>(
    ctx,
    table,
    args.id,
    args.societyId,
  );
  assertVersion(row, args.expectedVersion);
  const issued =
    row.registerId &&
    (await getOwned(ctx, "recordsOfEmployment", row.registerId, args.societyId))
      .status === "issued";
  if (row.closedAtISO || (row.submission && !issued))
    throw new Error(
      "A submitted/closed case retains its review; record rejection or use an amendment as appropriate.",
    );
  if (!issued) await editable(ctx, row);
  return write(
    ctx,
    row,
    { checklist: cleanRoeReadiness(args.checklist), generated: undefined },
    "readiness_reviewed",
  );
}
export async function recordGeneratedPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    caseFingerprint: string;
    sha256: string;
    byteLength: number;
    filename: string;
    schemaVersion: string;
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const row = await getOwned<RoeWorkflowCase>(
    ctx,
    table,
    args.id,
    args.societyId,
  );
  assertVersion(row, args.expectedVersion);
  await editable(ctx, row);
  const blockers = roeReadinessBlockers(row);
  if (blockers.length)
    throw new Error(
      `Complete the ROE readiness review: ${blockers.join("; ")}`,
    );
  if (args.caseFingerprint !== (await fingerprint(row)))
    throw new Error(
      "The case changed after the export form opened. Reopen its current facts before recording this XML.",
    );
  if (
    !/^[a-f0-9]{64}$/.test(args.sha256) ||
    !Number.isSafeInteger(args.byteLength) ||
    args.byteLength < 1 ||
    args.byteLength > 1000000 ||
    args.schemaVersion !== "W-2.0"
  )
    throw new Error(
      "Record the actual bounded ROE XML SHA-256, byte count and W-2.0 schema version.",
    );
  const filename = bounded(args.filename, "XML filename", true, 100)!;
  if (!/^[A-Za-z0-9_.-]+\.xml$/.test(filename))
    throw new Error(
      "Use a plain XML filename without employee identifiers or paths.",
    );
  const generated = {
    atISO: new Date().toISOString(),
    sha256: args.sha256,
    byteLength: args.byteLength,
    filename,
    caseFingerprint: args.caseFingerprint,
    schemaVersion: args.schemaVersion,
  };
  return write(
    ctx,
    row,
    { generated },
    "xml_generated",
    "Local XML download prepared; not submitted or issued.",
    generated,
  );
}
export async function recordSubmissionPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    atISO: string;
    channel: "roe_web" | "provider" | "paper";
    reference: string;
    note: string;
    outcome?: "submitted" | "rejected";
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const row = await getOwned<RoeWorkflowCase>(
    ctx,
    table,
    args.id,
    args.societyId,
  );
  assertVersion(row, args.expectedVersion);
  const current = await view(ctx, row);
  if (current.register?.status === "issued" || row.closedAtISO)
    throw new Error(
      "Issued/closed cases retain their submission evidence. Use an amendment for an issued correction.",
    );
  const note = bounded(
      args.note,
      "Actual submission / rejection evidence",
      true,
    )!,
    reference = bounded(
      args.reference,
      "Actual portal/provider/paper reference",
      true,
      100,
    )!;
  if (args.outcome === "rejected") {
    if (!row.submission)
      throw new Error("Record an actual submission before its rejection.");
    return write(
      ctx,
      row,
      {
        submission: undefined,
        generated: undefined,
        checklist: emptyRoeReadiness(),
      },
      "submission_rejected",
      `${instant(args.atISO, "Actual rejection time")} · ${reference}: ${note}`,
    );
  }
  if (current.readinessBlockers.length)
    throw new Error(
      "Complete the saved readiness checklist before recording submission.",
    );
  if (
    !["roe_web", "provider", "paper"].includes(args.channel) ||
    (args.channel === "paper") !== (row.facts.format === "paper")
  )
    throw new Error(
      "The submission channel must match the case's reviewed paper/electronic format.",
    );
  const submission = {
    atISO: instant(args.atISO, "Actual submission time"),
    channel: args.channel,
    reference,
    note,
  };
  return write(
    ctx,
    row,
    { submission },
    "submission_recorded",
    `${reference}: ${note}`,
  );
}
async function followup(
  ctx: PortableMutationCtx,
  row: RoeWorkflowCase,
  key: RoeFollowUpKey,
  dueDate: string,
  status: RoeFollowUp["status"],
  note?: string,
) {
  const old = row.followUps.find((item) => item.key === key),
    done = status === "done" || status === "not_applicable",
    fields = {
      societyId: row.societyId,
      title: `ROE follow-up — ${ROE_FOLLOWUP_LABELS[key]}`,
      dueDate,
      category: "Payroll",
      description:
        "Protected employment information. An authorized payroll administrator can open the guided ROE case for source evidence.",
      status: done ? "complete" : "open",
      done,
      sourceKey: `roe-workflow:${row._id}:${key}`,
    };
  let deadlineId = old?.deadlineId;
  if (deadlineId) {
    await getOwned(ctx, "deadlines", deadlineId, row.societyId);
    await ctx.db.patch(deadlineId, fields);
  } else deadlineId = await ctx.db.insert("deadlines", fields);
  return clean({
    key,
    dueDate,
    status,
    note,
    deadlineId,
    updatedAtISO: new Date().toISOString(),
    completedAtISO: done ? new Date().toISOString() : undefined,
  });
}
export async function recordIssuancePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    atISO: string;
    serialNumber: string;
    acknowledgment: string;
    paperCopiesCompleted?: boolean;
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const row = await getOwned<RoeWorkflowCase>(
    ctx,
    table,
    args.id,
    args.societyId,
  );
  assertVersion(row, args.expectedVersion);
  if (row.closedAtISO || !row.registerId)
    throw new Error(
      "Open a case with an actual ROE register obligation before recording issuance.",
    );
  const readiness = roeReadinessBlockers(row);
  if (readiness.length)
    throw new Error(
      "Complete the saved readiness review before recording issuance.",
    );
  const acknowledgment = bounded(
      args.acknowledgment,
      "Actual Service Canada / paper issuance acknowledgment",
      true,
    )!,
    atISO = /^\d{4}-\d{2}-\d{2}$/.test(args.atISO)
      ? date(args.atISO, "Actual issued date (time unknown)")
      : instant(args.atISO, "Actual issuance time"),
    serialNumber = validateRoeIssuedSerial(args.serialNumber, row.facts.format),
    asOf = await today(ctx, args.societyId),
    issuedOn =
      atISO.length === 10
        ? atISO
        : (resolutionCalendarDate(
            atISO,
            resolutionTimeZone(
              (await ctx.db.get(args.societyId, "societies")) ?? {},
            ),
          ) ?? atISO.slice(0, 10));
  if (issuedOn > asOf)
    throw new Error(
      "Actual issuance cannot be dated after the organization's current date.",
    );
  if (row.facts.format === "paper" && args.paperCopiesCompleted !== true)
    throw new Error(
      "Confirm the actual paper copies: employee Part 1, Service Canada Part 2 and secure employer Part 3.",
    );
  const serialPeers = await ctx.db
    .query("recordsOfEmployment")
    .withIndex("by_society_serial", (q) =>
      q.eq("societyId", args.societyId).eq("serialNumber", serialNumber),
    )
    .take(2);
  if (serialPeers.some((item) => item._id !== row.registerId))
    throw new Error(
      "This actual ROE serial is already recorded for another register record. Confirm the new amendment serial from Service Canada.",
    );
  const register = await getOwned(
    ctx,
    "recordsOfEmployment",
    row.registerId,
    args.societyId,
  );
  if (
    register.status === "issued" &&
    ((register.serialNumber && register.serialNumber !== serialNumber) ||
      (register.issuedOn && register.issuedOn !== issuedOn))
  )
    throw new Error(
      "An issued register record's actual serial/date are retained; use an amendment rather than overwrite them.",
    );
  await ctx.db.patch(row.registerId, {
    status: "issued",
    serialNumber,
    issuedOn,
    updatedAtISO: new Date().toISOString(),
  });
  const deadlineId = await mainDeadline(
      ctx,
      row,
      assessRoeWorkflow(row.facts, Boolean(row.amendmentOfCaseId)),
      true,
    ),
    retentionDate = `${Number(row.facts.lastDayPaid.slice(0, 4)) + 6}-12-31`;
  const next = [...row.followUps];
  for (const [key, due, status, note] of [
    ["acceptance", issuedOn, "done", acknowledgment],
    [
      "employee_access",
      asOf,
      "open",
      "Confirm employee access through MSCA or actual paper delivery; employee should apply for EI promptly even if the ROE is outstanding.",
    ],
    [
      "missing_information",
      asOf,
      "open",
      "Review whether any Service Canada request, missing history or employee question remains; explicitly resolve or mark not applicable.",
    ],
    [
      "retention",
      retentionDate,
      "open",
      "Retain related payroll/ROE records securely for six years after the year to which they relate. This is a review target, not automatic deletion.",
    ],
  ] as const) {
    if (key !== "acceptance" && next.some((item) => item.key === key)) continue;
    const value = await followup(ctx, row, key, due, status, note),
      index = next.findIndex((item) => item.key === key);
    if (index >= 0) next[index] = value;
    else next.push(value);
  }
  return write(
    ctx,
    row,
    { deadlineId, followUps: next },
    "issuance_acknowledged",
    `${serialNumber} · ${atISO} · ${acknowledgment}`,
  );
}
export async function saveFollowUpPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    key: RoeFollowUpKey;
    dueDate: string;
    status: RoeFollowUp["status"];
    note?: string;
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const row = await getOwned<RoeWorkflowCase>(
    ctx,
    table,
    args.id,
    args.societyId,
  );
  assertVersion(row, args.expectedVersion);
  if (
    !Object.keys(ROE_FOLLOWUP_LABELS).includes(args.key) ||
    !["open", "blocked", "done", "not_applicable"].includes(args.status)
  )
    throw new Error("Choose a supported ROE follow-up and status.");
  if (
    args.key === "acceptance" &&
    ["done", "not_applicable"].includes(args.status) &&
    assessRoeWorkflow(row.facts, Boolean(row.amendmentOfCaseId)).requirement !==
      "not_required"
  ) {
    const register = row.registerId
      ? await getOwned(
          ctx,
          "recordsOfEmployment",
          row.registerId,
          args.societyId,
        )
      : null;
    if (
      args.status === "not_applicable" ||
      register?.status !== "issued" ||
      !register.serialNumber
    )
      throw new Error(
        "Actual acceptance needs an issued ROE with its real serial; it cannot be waived or resolved by a follow-up before issuance.",
      );
  }
  const note = bounded(args.note, "Follow-up evidence", args.status !== "open"),
    next = await followup(
      ctx,
      row,
      args.key,
      date(args.dueDate, "Follow-up target"),
      args.status,
      note,
    );
  return write(
    ctx,
    row,
    {
      ...(row.closedAtISO &&
      args.key !== "retention" &&
      ["open", "blocked"].includes(args.status)
        ? { closedAtISO: undefined, closeNote: undefined }
        : {}),
      followUps: [
        ...row.followUps.filter((item) => item.key !== args.key),
        next,
      ],
    },
    "follow_up_updated",
    `${args.key}: ${args.status}${note ? ` · ${note}` : ""}`,
  );
}
export async function closeCasePortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    id: string;
    note: string;
    expectedVersion?: number;
  },
) {
  await authorize(ctx, args.societyId, true);
  const row = await getOwned<RoeWorkflowCase>(
    ctx,
    table,
    args.id,
    args.societyId,
  );
  assertVersion(row, args.expectedVersion);
  if (row.closedAtISO) return row._id;
  const current = await view(ctx, row);
  if (
    current.assessment.requirement !== "not_required" &&
    current.register?.status !== "issued"
  )
    throw new Error(
      "An actual ROE obligation cannot be closed before issuance; keep a blocked follow-up rather than treating a missing ROE as resolved.",
    );
  if (
    current.assessment.requirement !== "not_required" &&
    !current.register?.serialNumber
  )
    throw new Error(
      "Obtain and record the actual original ROE serial before resolving acceptance or closing this issued case; do not invent one.",
    );
  if (
    row.followUps.some(
      (item) =>
        item.key !== "retention" &&
        !["done", "not_applicable"].includes(item.status),
    )
  )
    throw new Error(
      "Resolve acceptance, employee access and missing-information follow-ups before closing operational work. The future retention review remains tracked.",
    );
  return write(
    ctx,
    row,
    {
      closedAtISO: new Date().toISOString(),
      closeNote: bounded(args.note, "Closure evidence", true),
    },
    "case_closed",
    bounded(args.note, "Closure evidence", true),
  );
}
