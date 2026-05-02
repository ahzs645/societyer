import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { assertAllowedOption } from "./lib/orgHubOptions";

export const list = query({
  args: {
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, workflowId }) => {
    const packagesQuery = workflowId
      ? ctx.db
          .query("workflowPackages")
          .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
          .collect()
      : ctx.db
          .query("workflowPackages")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect();
    const [rows, tasks, filings, signatures] = await Promise.all([
      packagesQuery,
      ctx.db.query("tasks").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("signatures").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    return rows
      .filter((row) => row.societyId === societyId)
      .sort((a, b) => String(b.effectiveDate ?? b.createdAtISO).localeCompare(String(a.effectiveDate ?? a.createdAtISO)))
      .map((row) => ({
        ...row,
        lifecycle: packageLifecycle(row, { tasks, filings, signatures }),
      }));
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("workflowPackages")),
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    eventType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.optional(v.string()),
    packageName: v.string(),
    parts: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    supportingDocumentIds: v.optional(v.array(v.id("documents"))),
    priceItems: v.optional(v.array(v.string())),
    transactionId: v.optional(v.string()),
    signerRoster: v.optional(v.array(v.string())),
    signerEmails: v.optional(v.array(v.string())),
    signingPackageIds: v.optional(v.array(v.string())),
    stripeCheckoutSessionId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, ...args }) => {
    assertAllowedOption("eventTypes", args.eventType, "Event type", false);
    assertAllowedOption("workflowPackageStatuses", args.status, "Workflow package status");
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      workflowId: args.workflowId,
      workflowRunId: args.workflowRunId,
      eventType: cleanText(args.eventType) || "other",
      effectiveDate: cleanText(args.effectiveDate),
      status: cleanText(args.status) || "draft",
      packageName: cleanText(args.packageName) || "Untitled package",
      parts: cleanList(args.parts),
      notes: cleanText(args.notes),
      supportingDocumentIds: args.supportingDocumentIds ?? [],
      priceItems: cleanList(args.priceItems),
      transactionId: cleanText(args.transactionId),
      signerRoster: cleanList(args.signerRoster),
      signerEmails: cleanList(args.signerEmails),
      signingPackageIds: cleanList(args.signingPackageIds),
      stripeCheckoutSessionId: cleanText(args.stripeCheckoutSessionId),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("workflowPackages", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("workflowPackages") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const createFollowUpTask = mutation({
  args: {
    packageId: v.id("workflowPackages"),
    title: v.optional(v.string()),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { packageId, title, dueDate }) => {
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Workflow package not found.");
    return await ctx.db.insert("tasks", {
      societyId: pkg.societyId,
      title: cleanText(title) || `Complete package: ${pkg.packageName}`,
      description: [
        `Event: ${pkg.eventType}`,
        pkg.signerRoster.length ? `Signers: ${pkg.signerRoster.join(", ")}` : "",
        pkg.priceItems.length ? `Price items: ${pkg.priceItems.join(", ")}` : "",
      ].filter(Boolean).join("\n"),
      status: "Todo",
      priority: pkg.effectiveDate && pkg.effectiveDate < todayDate() ? "High" : "Medium",
      dueDate: dueDate || pkg.effectiveDate || todayDate(),
      workflowId: pkg.workflowId,
      documentId: pkg.supportingDocumentIds[0],
      eventId: `workflowPackage:${String(pkg._id)}`,
      tags: ["workflow-package", pkg.eventType],
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const markFiled = mutation({
  args: {
    packageId: v.id("workflowPackages"),
    transactionId: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { packageId, transactionId, notes }) => {
    const pkg = await ctx.db.get(packageId);
    if (!pkg) throw new Error("Workflow package not found.");
    await ctx.db.patch(packageId, {
      status: "filed",
      transactionId: cleanText(transactionId) || pkg.transactionId,
      notes: appendNote(pkg.notes, cleanText(notes) || `Marked filed ${todayDate()}.`),
      updatedAtISO: new Date().toISOString(),
    });
  },
});

export const createBoardPack = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.id("meetings"),
    workflowId: v.optional(v.id("workflows")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.object({
    packageId: v.id("workflowPackages"),
    taskIds: v.array(v.id("tasks")),
  }),
  handler: async (ctx, { societyId, meetingId, workflowId, actingUserId }) => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting || meeting.societyId !== societyId) throw new Error("Meeting not found.");
    const [materials, minutes] = await Promise.all([
      ctx.db.query("meetingMaterials").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect(),
      meeting.minutesId ? ctx.db.get(meeting.minutesId) : Promise.resolve(null),
    ]);
    const now = new Date().toISOString();
    const packageName = `Board pack - ${meeting.title}`;
    const effectiveDate = meeting.scheduledAt.slice(0, 10);
    const existingPackage = (await ctx.db
      .query("workflowPackages")
      .withIndex("by_society_effective", (q) => q.eq("societyId", societyId).eq("effectiveDate", effectiveDate))
      .collect()).find((row) => row.packageName === packageName);
    const packagePayload = {
      societyId,
      workflowId,
      eventType: "custom.event",
      effectiveDate,
      status: meeting.packageReviewStatus === "released" ? "ready" : "draft",
      packageName,
      parts: [
        "Agenda",
        "Meeting materials",
        "Notice of meeting",
        "Attendance and quorum",
        "Draft minutes",
        "Follow-up actions",
        "Minute-book publication",
      ],
      notes: [
        `Board-pack workflow for ${meeting.title}.`,
        `Meeting status: ${meeting.status}.`,
        meeting.noticeSentAt ? `Notice sent: ${meeting.noticeSentAt}.` : "Notice has not been recorded yet.",
        materials.length ? `${materials.length} meeting material(s) attached.` : "No meeting materials attached yet.",
        minutes ? "Minutes record exists." : "Minutes record has not been created yet.",
      ].join("\n"),
      supportingDocumentIds: materials.map((material) => material.documentId),
      priceItems: [],
      transactionId: undefined,
      signerRoster: [],
      signerEmails: [],
      signingPackageIds: [],
      stripeCheckoutSessionId: undefined,
      updatedAtISO: now,
    };
    const packageId = existingPackage?._id ?? await ctx.db.insert("workflowPackages", {
      ...packagePayload,
      createdAtISO: now,
    });
    if (existingPackage) {
      await ctx.db.patch(existingPackage._id, packagePayload);
    }
    await ctx.db.patch(meetingId, {
      packageReviewStatus: "needs_review",
      packageReviewedAtISO: now,
      packageReviewedByUserId: actingUserId,
      packageReviewNotes: appendNote(
        meeting.packageReviewNotes,
        `Board pack package ${String(packageId)} created ${now.slice(0, 10)}.`,
      ),
    });
    const taskIds = [] as any[];
    const existingTasks = await ctx.db.query("tasks").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect();
    for (const task of boardPackTasks(meeting, packageId, materials.length, Boolean(minutes))) {
      const eventId = `boardPack:${String(packageId)}:${task.key}`;
      const existingTask = existingTasks.find((row) => row.eventId === eventId);
      if (existingTask) {
        await ctx.db.patch(existingTask._id, {
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDate: task.dueDate,
        });
        taskIds.push(existingTask._id);
        continue;
      }
      taskIds.push(await ctx.db.insert("tasks", {
        societyId,
        meetingId,
        workflowId,
        title: task.title,
        description: task.description,
        status: "Todo",
        priority: task.priority,
        dueDate: task.dueDate,
        eventId,
        tags: ["board-pack", task.key],
        createdAtISO: now,
      }));
    }
    return { packageId, taskIds };
  },
});

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))) as string[];
}

function packageLifecycle(pkg: any, related: Record<string, any[]>) {
  const packageId = String(pkg._id);
  const relatedTasks = related.tasks.filter((task) =>
    task.eventId === `workflowPackage:${packageId}` ||
    task.eventId === packageId ||
    (pkg.workflowId && task.workflowId === pkg.workflowId) ||
    (task.documentId && (pkg.supportingDocumentIds ?? []).map(String).includes(String(task.documentId))),
  );
  const relatedSignatures = related.signatures.filter((signature) =>
    signature.entityId === packageId ||
    (pkg.signingPackageIds ?? []).includes(signature.entityId),
  );
  const relatedFilings = related.filings.filter((filing) =>
    String(filing.kind ?? "").toLowerCase().includes(String(pkg.eventType ?? "").toLowerCase()) ||
    relatedTasks.some((task) => task.filingId && task.filingId === filing._id),
  );
  const expectedSigners = Math.max((pkg.signerRoster ?? []).length, (pkg.signerEmails ?? []).length);
  return {
    signerState:
      expectedSigners === 0 ? "not_required"
      : relatedSignatures.length >= expectedSigners ? "complete"
      : (pkg.signingPackageIds ?? []).length ? "sent"
      : "needed",
    expectedSigners,
    capturedSignatures: relatedSignatures.length,
    paymentState:
      pkg.transactionId ? "transaction_linked"
      : pkg.stripeCheckoutSessionId ? "checkout_created"
      : (pkg.priceItems ?? []).length ? "priced"
      : "none",
    taskCount: relatedTasks.length,
    openTaskCount: relatedTasks.filter((task) => task.status !== "Done").length,
    filingCount: relatedFilings.length,
    filed: /filed|archived/i.test(String(pkg.status ?? "")),
  };
}

function appendNote(current: unknown, note: string) {
  const text = cleanText(current);
  if (!text) return note;
  if (text.includes(note)) return text;
  return `${text}\n${note}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function boardPackTasks(meeting: any, packageId: any, materialCount: number, hasMinutes: boolean) {
  const meetingDate = String(meeting.scheduledAt ?? todayDate()).slice(0, 10);
  return [
    {
      key: "prepare-agenda",
      title: `Prepare agenda for ${meeting.title}`,
      description: "Confirm agenda items, bylaw-required business, motions, presenters, and time boxes.",
      priority: "High",
      dueDate: addDays(meetingDate, -14),
    },
    {
      key: "attach-materials",
      title: `Attach board materials for ${meeting.title}`,
      description: materialCount
        ? `${materialCount} material(s) are already attached. Review access levels and missing agenda links.`
        : "Attach reports, motions, financials, policies, and supporting documents to the meeting materials list.",
      priority: materialCount ? "Medium" : "High",
      dueDate: addDays(meetingDate, -10),
    },
    {
      key: "send-notice",
      title: `Send meeting notice for ${meeting.title}`,
      description: "Queue or record notice delivery, including remote attendance instructions and material access.",
      priority: meeting.noticeSentAt ? "Low" : "High",
      dueDate: addDays(meetingDate, -7),
    },
    {
      key: "record-quorum",
      title: `Record attendance and quorum for ${meeting.title}`,
      description: "Capture present/absent/proxy attendance, quorum source, remote participation, and conflicts.",
      priority: "High",
      dueDate: meetingDate,
    },
    {
      key: "draft-minutes",
      title: `Draft minutes for ${meeting.title}`,
      description: hasMinutes
        ? "Minutes record exists. Review sections, motions, decisions, and action items before approval."
        : "Create draft minutes from agenda, transcript, notes, and motions without approving the record.",
      priority: "High",
      dueDate: addDays(meetingDate, 2),
    },
    {
      key: "publish-minute-book",
      title: `Publish minute-book entry for ${meeting.title}`,
      description: `After minutes approval, publish evidence into the minute book and close board pack ${String(packageId)}.`,
      priority: "Medium",
      dueDate: addDays(meetingDate, 14),
    },
  ];
}
