import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertAllowedOption } from "./lib/orgHubOptions";

const BINDER_DOCUMENT_CATEGORIES = ["Constitution", "Bylaws", "Minutes", "Policy", "Filing", "FinancialStatement", "WorkflowGenerated"];
const DOCUMENT_PREVIEW_LIMIT_PER_CATEGORY = 1;
const MEETING_RECORD_LIMIT = 5;
const MINUTES_RECORD_LIMIT = 5;
const CORE_RECORD_LIMIT = 10;
const SUPPORT_RECORD_LIMIT = 20;
const DELIVERY_RECORD_LIMIT = 20;

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const [
      items,
      meetings,
      minutes,
      filings,
      policies,
      workflowPackages,
      signatures,
      sourceEvidence,
      motionEvidence,
      archiveAccessions,
      meetingMaterials,
      meetingAttendanceRecords,
      communicationCampaigns,
      communicationDeliveries,
      noticeDeliveries,
      agmRuns,
      financials,
      elections,
      proxies,
      memberProposals,
      tasks,
      bylawAmendments,
      writtenResolutions,
      agendas,
      agendaItems,
      recordsLocations,
    ] = await Promise.all([
      collectBySociety(ctx, "minuteBookItems", societyId, SUPPORT_RECORD_LIMIT),
      ctx.db.query("meetings").withIndex("by_society_date", (q) => q.eq("societyId", societyId)).order("desc").take(MEETING_RECORD_LIMIT),
      collectBySociety(ctx, "minutes", societyId, MINUTES_RECORD_LIMIT),
      collectBySociety(ctx, "filings", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "policies", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "workflowPackages", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "signatures", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "sourceEvidence", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "motionEvidence", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "archiveAccessions", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "meetingMaterials", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "meetingAttendanceRecords", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "communicationCampaigns", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "communicationDeliveries", societyId, DELIVERY_RECORD_LIMIT),
      collectBySociety(ctx, "noticeDeliveries", societyId, DELIVERY_RECORD_LIMIT),
      collectBySociety(ctx, "agmRuns", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "financials", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "elections", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "proxies", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "memberProposals", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "tasks", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "bylawAmendments", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "writtenResolutions", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "agendas", societyId, CORE_RECORD_LIMIT),
      collectBySociety(ctx, "agendaItems", societyId, SUPPORT_RECORD_LIMIT),
      collectBySociety(ctx, "recordsLocation", societyId, CORE_RECORD_LIMIT),
    ]);

    const documents = await collectBinderDocumentPreviews(ctx, societyId);
    const binderDocuments = documents;
    const graphInput = {
      items,
      documents,
      meetings,
      minutes,
      filings,
      policies,
      workflowPackages,
      signatures,
      sourceEvidence,
      motionEvidence,
      archiveAccessions,
      meetingMaterials,
      meetingAttendanceRecords,
      communicationCampaigns,
      communicationDeliveries,
      noticeDeliveries,
      agmRuns,
      financials,
      elections,
      proxies,
      memberProposals,
      tasks,
      bylawAmendments,
      writtenResolutions,
      agendas,
      agendaItems,
      recordsLocations,
    };

    return {
      items: sortDesc(items.map(minuteBookItemPreview), "effectiveDate"),
      documents: sortDesc(binderDocuments, "createdAtISO"),
      meetings: sortDesc(meetings.map(meetingPreview), "scheduledAt"),
      minutes: sortDesc(minutes.map(minutesPreview), "heldAt"),
      filings: sortDesc(filings.map(filingPreview), "dueDate"),
      policies: sortDesc(policies.map(policyPreview), "effectiveDate"),
      workflowPackages: sortDesc(workflowPackages.map(workflowPackagePreview), "effectiveDate"),
      signatures: sortDesc(signatures.map(signaturePreview), "signedAtISO"),
      sourceEvidence: sortDesc(sourceEvidence.map(sourceEvidencePreview), "createdAtISO"),
      motionEvidence: sortDesc(motionEvidence.map(motionEvidencePreview), "meetingDate"),
      archiveAccessions: sortDesc(archiveAccessions.map(archiveAccessionPreview), "dateReceived"),
      meetingMaterials: sortDesc(meetingMaterials.map(meetingMaterialPreview), "createdAtISO"),
      meetingAttendanceRecords: sortDesc(meetingAttendanceRecords.map(attendancePreview), "meetingDate"),
      communicationCampaigns: sortDesc(communicationCampaigns.map(communicationCampaignPreview), "createdAtISO"),
      communicationDeliveries: sortDesc(communicationDeliveries.map(communicationDeliveryPreview), "sentAtISO"),
      noticeDeliveries: sortDesc(noticeDeliveries.map(noticeDeliveryPreview), "sentAtISO"),
      agmRuns: sortDesc(agmRuns.map(agmRunPreview), "updatedAtISO"),
      financials: sortDesc(financials.map(financialPreview), "periodEnd"),
      elections: sortDesc(elections.map(electionPreview), "opensAtISO"),
      proxies: sortDesc(proxies.map(proxyPreview), "signedAtISO"),
      memberProposals: sortDesc(memberProposals.map(memberProposalPreview), "submittedAtISO"),
      tasks: sortDesc(tasks.map(taskPreview), "dueDate"),
      bylawAmendments: sortDesc(bylawAmendments.map(bylawAmendmentPreview), "updatedAtISO"),
      writtenResolutions: sortDesc(writtenResolutions.map(writtenResolutionPreview), "circulatedAtISO"),
      agendas: sortDesc(agendas.map(agendaPreview), "updatedAtISO"),
      agendaItems: agendaItems.map(agendaItemPreview),
      recordsLocations: recordsLocations.map(recordsLocationPreview),
      recordBundles: buildRecordBundles(graphInput),
      checks: minuteBookChecks({
        items,
        documents,
        binderDocuments,
        meetings,
        minutes,
        filings,
        policies,
        workflowPackages,
        signatures,
        motionEvidence,
        archiveAccessions,
        writtenResolutions,
      }),
    };
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("minuteBookItems")),
    societyId: v.id("societies"),
    title: v.string(),
    recordType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.optional(v.string()),
    documentIds: v.optional(v.array(v.id("documents"))),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    filingId: v.optional(v.id("filings")),
    policyId: v.optional(v.id("policies")),
    workflowPackageId: v.optional(v.id("workflowPackages")),
    writtenResolutionId: v.optional(v.id("writtenResolutions")),
    signatureIds: v.optional(v.array(v.id("signatures"))),
    sourceEvidenceIds: v.optional(v.array(v.id("sourceEvidence"))),
    archivedAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, ...args }) => {
    assertAllowedOption("minuteBookRecordTypes", args.recordType, "Minute-book record type", false);
    assertAllowedOption("minuteBookStatuses", args.status, "Minute-book status");
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      title: cleanText(args.title) || "Untitled record",
      recordType: cleanText(args.recordType) || "other",
      effectiveDate: cleanText(args.effectiveDate),
      status: cleanText(args.status) || "NeedsReview",
      documentIds: args.documentIds ?? [],
      meetingId: args.meetingId,
      minutesId: args.minutesId,
      filingId: args.filingId,
      policyId: args.policyId,
      workflowPackageId: args.workflowPackageId,
      writtenResolutionId: args.writtenResolutionId,
      signatureIds: args.signatureIds ?? [],
      sourceEvidenceIds: args.sourceEvidenceIds ?? [],
      archivedAtISO: cleanText(args.archivedAtISO),
      notes: cleanText(args.notes),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("minuteBookItems", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("minuteBookItems") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

function sortDesc(rows: any[], field: string) {
  return rows.slice().sort((a, b) => String(b[field] ?? "").localeCompare(String(a[field] ?? "")));
}

function collectBySociety(ctx: any, table: string, societyId: any, limit: number) {
  return ctx.db
    .query(table)
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .take(limit);
}

async function collectBinderDocumentPreviews(ctx: any, societyId: any) {
  const groups = await Promise.all(
    BINDER_DOCUMENT_CATEGORIES.map((category) =>
      ctx.db
        .query("documents")
        .withIndex("by_society_category", (q: any) => q.eq("societyId", societyId).eq("category", category))
        .take(DOCUMENT_PREVIEW_LIMIT_PER_CATEGORY),
    ),
  );
  return groups.flat().map((doc: any) => ({
    _id: doc._id,
    title: doc.title,
    category: doc.category,
    createdAtISO: doc.createdAtISO,
    reviewStatus: doc.reviewStatus,
    tags: doc.tags ?? [],
  }));
}

function buildRecordBundles(data: Record<string, any[]>) {
  const meetings = data.meetings ?? [];
  const minutes = data.minutes ?? [];
  const filings = data.filings ?? [];
  const policies = data.policies ?? [];
  const workflowPackages = data.workflowPackages ?? [];
  const signatures = data.signatures ?? [];
  const sourceEvidence = data.sourceEvidence ?? [];
  const motionEvidence = data.motionEvidence ?? [];
  const archiveAccessions = data.archiveAccessions ?? [];
  const meetingMaterials = data.meetingMaterials ?? [];
  const meetingAttendanceRecords = data.meetingAttendanceRecords ?? [];
  const communicationCampaigns = data.communicationCampaigns ?? [];
  const communicationDeliveries = data.communicationDeliveries ?? [];
  const noticeDeliveries = data.noticeDeliveries ?? [];
  const agmRuns = data.agmRuns ?? [];
  const financials = data.financials ?? [];
  const elections = data.elections ?? [];
  const proxies = data.proxies ?? [];
  const memberProposals = data.memberProposals ?? [];
  const tasks = data.tasks ?? [];
  const bylawAmendments = data.bylawAmendments ?? [];
  const writtenResolutions = data.writtenResolutions ?? [];
  const agendas = data.agendas ?? [];
  const agendaItems = data.agendaItems ?? [];
  const recordsLocations = data.recordsLocations ?? [];
  const items = data.items ?? [];

  const minutesById = byId(minutes);
  const filingsById = byId(filings);
  const meetingsById = byId(meetings);
  const motionEvidenceById = byId(motionEvidence);
  const minutesByMeetingId = firstByField(sortDesc(minutes, "heldAt"), "meetingId");
  const materialsByMeetingId = groupByField(meetingMaterials, "meetingId");
  const attendanceByMeetingId = groupByField(meetingAttendanceRecords, "meetingId");
  const attendanceByMinutesId = groupByField(meetingAttendanceRecords, "minutesId");
  const motionsByMeetingId = groupByField(motionEvidence, "meetingId");
  const motionsByMinutesId = groupByField(motionEvidence, "minutesId");
  const campaignsByMeetingId = groupByField(communicationCampaigns, "meetingId");
  const deliveriesByMeetingId = groupByField(communicationDeliveries, "meetingId");
  const noticesByMeetingId = groupByField(noticeDeliveries, "meetingId");
  const agmByMeetingId = firstByField(agmRuns, "meetingId");
  const financialsByMeetingId = groupByField(financials, "presentedAtMeetingId");
  const electionsByMeetingId = groupByField(elections, "meetingId");
  const proxiesByMeetingId = groupByField(proxies, "meetingId");
  const proposalsByMeetingId = groupByField(memberProposals, "meetingId");
  const tasksByMeetingId = groupByField(tasks, "meetingId");
  const amendmentsByMeetingId = groupByField(bylawAmendments, "resolutionMeetingId");
  const amendmentsByFilingId = groupByField(bylawAmendments, "filingId");
  const sourceByTarget = groupBy(sourceEvidence, (row) => targetKey(row.targetTable, row.targetId));
  const signaturesByEntity = groupBy(signatures, (row) => targetKey(row.entityType, row.entityId));
  const agendaItemsByAgendaId = groupByField(agendaItems, "agendaId");
  const agendasByMeetingId = groupByField(agendas, "meetingId");

  const bundles: any[] = [];

  for (const meeting of meetings) {
    const meetingId = String(meeting._id);
    const linkedMinutes = (meeting.minutesId ? minutesById.get(String(meeting.minutesId)) : undefined) ??
      minutesByMeetingId.get(meetingId);
    const hasLinkedMinutes = Boolean(meeting.minutesId || linkedMinutes);
    const minutesId = linkedMinutes ? String(linkedMinutes._id) : meeting.minutesId ? String(meeting.minutesId) : undefined;
    const meetingAgendas = agendasByMeetingId.get(meetingId) ?? [];
    const meetingAgendaItems = meetingAgendas.flatMap((agenda: any) => agendaItemsByAgendaId.get(String(agenda._id)) ?? []);
    const materials = materialsByMeetingId.get(meetingId) ?? [];
    const attendance = [
      ...(attendanceByMeetingId.get(meetingId) ?? []),
      ...(minutesId ? attendanceByMinutesId.get(minutesId) ?? [] : []),
    ];
    const motions = [
      ...(motionsByMeetingId.get(meetingId) ?? []),
      ...(minutesId ? motionsByMinutesId.get(minutesId) ?? [] : []),
    ];
    const campaigns = campaignsByMeetingId.get(meetingId) ?? [];
    const deliveries = deliveriesByMeetingId.get(meetingId) ?? [];
    const notices = noticesByMeetingId.get(meetingId) ?? [];
    const agmRun = agmByMeetingId.get(meetingId);
    const relatedFinancials = financialsByMeetingId.get(meetingId) ?? [];
    const relatedElections = electionsByMeetingId.get(meetingId) ?? [];
    const relatedProxies = proxiesByMeetingId.get(meetingId) ?? [];
    const relatedProposals = proposalsByMeetingId.get(meetingId) ?? [];
    const relatedTasks = tasksByMeetingId.get(meetingId) ?? [];
    const relatedAmendments = amendmentsByMeetingId.get(meetingId) ?? [];
    const sourceRows = [
      ...targetRows(sourceByTarget, ["meeting", "meetings"], meetingId),
      ...(minutesId ? targetRows(sourceByTarget, ["minute", "minutes"], minutesId) : []),
    ];
    const meetingSignatures = [
      ...targetRows(signaturesByEntity, ["meeting", "meetings"], meetingId),
      ...(minutesId ? targetRows(signaturesByEntity, ["minute", "minutes"], minutesId) : []),
    ];
    const filingIds = uniqueStrings([
      agmRun?.annualReportFilingId,
      ...relatedAmendments.map((amendment: any) => amendment.filingId),
    ]);
    const relatedFilings = filingIds.map((id) => filingsById.get(id)).filter(Boolean);
    const sourceDocumentIds = uniqueStrings([
      ...materials.map((material: any) => material.documentId),
      ...(linkedMinutes?.sourceDocumentIds ?? []),
      ...sourceRows.map((row: any) => row.sourceDocumentId),
      ...attendance.flatMap((row: any) => row.sourceDocumentIds ?? []),
      ...motions.flatMap((row: any) => row.sourceDocumentIds ?? []),
      ...relatedFinancials.map((row: any) => row.statementsDocId),
      ...relatedElections.map((row: any) => row.evidenceDocumentId),
    ]);
    const isAgm = /agm|annual general/i.test(`${meeting.type ?? ""} ${meeting.title ?? ""}`);
    bundles.push(bundle({
      key: `meeting:${meetingId}`,
      type: "meeting",
      title: meeting.title,
      date: meeting.scheduledAt,
      status: meeting.status,
      href: `/app/meetings/${meetingId}`,
      badges: compact([
        badge(meeting.type || "Meeting", "neutral"),
        hasLinkedMinutes ? badge("minutes linked", "success") : badge("no minutes", "warn"),
        agmRun ? badge("AGM workflow", "info") : undefined,
      ]),
      links: compact([
        bundleLink("Meeting", meeting.title, `/app/meetings/${meetingId}`),
        hasLinkedMinutes ? bundleLink("Minutes", linkedMinutes?.heldAt ? `Minutes ${linkedMinutes.heldAt}` : "Linked minutes", "/app/minutes") : undefined,
        materials.length ? bundleLink("Materials", `${materials.length} meeting materials`, "/app/documents", materials.length) : undefined,
        campaigns.length || deliveries.length || notices.length ? bundleLink("Notices", `${campaigns.length + deliveries.length + notices.length} notices/communications`, "/app/communications") : undefined,
        relatedFinancials.length ? bundleLink("Financials", `${relatedFinancials.length} financial records`, "/app/financials", relatedFinancials.length) : undefined,
        relatedElections.length ? bundleLink("Elections", `${relatedElections.length} elections`, "/app/elections", relatedElections.length) : undefined,
        relatedProxies.length ? bundleLink("Proxies", `${relatedProxies.length} proxies`, "/app/proxies", relatedProxies.length) : undefined,
        relatedProposals.length ? bundleLink("Proposals", `${relatedProposals.length} proposals`, "/app/proposals", relatedProposals.length) : undefined,
        agmRun ? bundleLink("AGM workflow", agmRun.step ?? "AGM workflow", `/app/meetings/${meetingId}/agm`) : undefined,
        relatedFilings.length ? bundleLink("Filings", `${relatedFilings.length} filings`, "/app/filings", relatedFilings.length) : undefined,
        relatedAmendments.length ? bundleLink("Bylaws", `${relatedAmendments.length} bylaw amendments`, "/app/bylaws-history", relatedAmendments.length) : undefined,
        sourceRows.length || motions.length || attendance.length ? bundleLink("Evidence", `${sourceRows.length + motions.length + attendance.length} evidence rows`, "/app/meeting-evidence") : undefined,
        relatedTasks.length ? bundleLink("Tasks", `${relatedTasks.length} tasks`, "/app/tasks", relatedTasks.length) : undefined,
      ]),
      counts: {
        documents: sourceDocumentIds.length,
        agendas: meetingAgendas.length,
        agendaItems: meetingAgendaItems.length,
        materials: materials.length,
        attendance: attendance.length,
        motions: motions.length,
        signatures: meetingSignatures.length,
        notices: campaigns.length + deliveries.length + notices.length,
        tasks: relatedTasks.length,
      },
      gaps: compact([
        !hasLinkedMinutes ? gap("missing_minutes", "No linked minutes", "warn", "Link or create minutes for this meeting.") : undefined,
        linkedMinutes && !linkedMinutes.approvedAt && !linkedMinutes.approvedInMeetingId
          ? gap("minutes_approval_gap", "Minutes approval not linked", "warn", "Record the approval date or approval meeting.")
          : undefined,
        linkedMinutes && (linkedMinutes.sourceDocumentIds ?? []).length === 0 && (linkedMinutes.sourceExternalIds ?? []).length === 0 && sourceRows.length === 0
          ? gap("minutes_source_gap", "No minutes source evidence", "info", "Attach the imported minutes document or source evidence.")
          : undefined,
        materials.length === 0 ? gap("materials_gap", "No meeting materials linked", "info", "Attach agenda packets, reports, or board materials when available.") : undefined,
        isAgm && !agmRun ? gap("agm_workflow_gap", "No AGM workflow run", "info", "AGM notice, financials, elections, minutes approval, and annual report can be tracked together.") : undefined,
      ]),
    }));
  }

  for (const filing of filings) {
    const filingId = String(filing._id);
    const sourceRows = targetRows(sourceByTarget, ["filing", "filings"], filingId);
    const signaturesForFiling = targetRows(signaturesByEntity, ["filing", "filings"], filingId);
    const relatedAmendments = amendmentsByFilingId.get(filingId) ?? [];
    const sourceDocumentIds = uniqueStrings([
      filing.receiptDocumentId,
      filing.stagedPacketDocumentId,
      ...(filing.sourceDocumentIds ?? []),
      ...sourceRows.map((row: any) => row.sourceDocumentId),
      ...relatedAmendments.flatMap((row: any) => row.sourceDocumentIds ?? []),
    ]);
    bundles.push(bundle({
      key: `filing:${filingId}`,
      type: "filing",
      title: filing.kind,
      date: filing.filedAt ?? filing.dueDate,
      status: filing.status,
      href: "/app/filings",
      badges: [badge("Filing", "neutral"), badge(filing.status ?? "Needs review", toneForBundleStatus(filing.status))],
      links: compact([
        bundleLink("Filing", filing.kind, "/app/filings"),
        sourceDocumentIds.length ? bundleLink("Documents", `${sourceDocumentIds.length} filing documents`, "/app/documents", sourceDocumentIds.length) : undefined,
        relatedAmendments.length ? bundleLink("Bylaws", `${relatedAmendments.length} bylaw amendments`, "/app/bylaws-history", relatedAmendments.length) : undefined,
        sourceRows.length ? bundleLink("Evidence", `${sourceRows.length} source evidence`, "/app/meeting-evidence", sourceRows.length) : undefined,
      ]),
      counts: { documents: sourceDocumentIds.length, signatures: signaturesForFiling.length, amendments: relatedAmendments.length },
      gaps: compact([
        !/filed|submitted|complete/i.test(String(filing.status ?? ""))
          ? gap("open_filing", "Filing not complete", "warn", "Submission or completion evidence is still needed.")
          : undefined,
        sourceDocumentIds.length === 0 ? gap("filing_evidence_gap", "No filing packet or receipt documents", "info") : undefined,
      ]),
    }));
  }

  for (const policy of policies) {
    const policyId = String(policy._id);
    const policyDocumentIds = uniqueStrings([policy.docxDocumentId, policy.pdfDocumentId]);
    const sourceRows = targetRows(sourceByTarget, ["policy", "policies"], policyId);
    const policySignatures = targetRows(signaturesByEntity, ["policy", "policies"], policyId);
    const adoptionMeeting = policy.adoptedAtMeetingId ? meetingsById.get(String(policy.adoptedAtMeetingId)) : undefined;
    const adoptionMinutes = policy.adoptedInMinutesId ? minutesById.get(String(policy.adoptedInMinutesId)) : undefined;
    const adoptionMotion = policy.adoptingMotionEvidenceId ? motionEvidenceById.get(String(policy.adoptingMotionEvidenceId)) : undefined;
    const policyTasks = tasks.filter((task: any) =>
      String(task.eventId ?? "").includes(policyId) ||
      (task.documentId && policyDocumentIds.includes(String(task.documentId))),
    );
    bundles.push(bundle({
      key: `policy:${policyId}`,
      type: "policy",
      title: policy.policyName,
      date: policy.effectiveDate ?? policy.reviewDate,
      status: policy.status,
      href: "/app/policies",
      badges: compact([
        badge("Policy", "neutral"),
        adoptionMeeting || adoptionMinutes || adoptionMotion ? badge("adoption linked", "success") : badge("adoption gap", policy.status === "Active" ? "warn" : "neutral"),
      ]),
      links: compact([
        bundleLink("Policy", policy.policyName, "/app/policies"),
        policyDocumentIds.length ? bundleLink("Documents", `${policyDocumentIds.length} policy documents`, "/app/documents", policyDocumentIds.length) : undefined,
        adoptionMeeting ? bundleLink("Adoption meeting", adoptionMeeting.title, `/app/meetings/${String(adoptionMeeting._id)}`) : undefined,
        adoptionMinutes ? bundleLink("Adoption minutes", adoptionMinutes.heldAt ?? "Minutes", "/app/minutes") : undefined,
        adoptionMotion ? bundleLink("Resolution evidence", shortText(adoptionMotion.motionText, 72), "/app/meeting-evidence") : undefined,
        policyTasks.length ? bundleLink("Tasks", `${policyTasks.length} policy tasks`, "/app/tasks", policyTasks.length) : undefined,
        sourceRows.length ? bundleLink("Evidence", `${sourceRows.length} source evidence`, "/app/meeting-evidence", sourceRows.length) : undefined,
      ]),
      counts: { documents: policyDocumentIds.length, signatures: policySignatures.length, tasks: policyTasks.length, sourceEvidence: sourceRows.length },
      gaps: compact([
        policy.status === "Active" && !adoptionMeeting && !adoptionMinutes && !adoptionMotion
          ? gap("policy_adoption_gap", "No adoption meeting or resolution linked", "warn")
          : undefined,
        policyDocumentIds.length === 0 ? gap("policy_document_gap", "No policy source document linked", "info") : undefined,
        !policy.reviewDate && !/ceased|superseded/i.test(String(policy.status ?? ""))
          ? gap("policy_review_gap", "No policy review date", "warn")
          : undefined,
        policy.signatureRequired && policySignatures.length === 0
          ? gap("policy_signature_gap", "Signature required but not collected", "warn")
          : undefined,
      ]),
    }));
  }

  for (const writtenResolution of writtenResolutions) {
    const resolutionId = String(writtenResolution._id);
    const linkedItems = items.filter((item: any) => String(item.writtenResolutionId ?? "") === resolutionId);
    const sourceRows = targetRows(sourceByTarget, ["writtenResolution", "writtenResolutions", "written_resolution"], resolutionId);
    bundles.push(bundle({
      key: `writtenResolution:${resolutionId}`,
      type: "written_resolution",
      title: writtenResolution.title,
      date: writtenResolution.completedAtISO ?? writtenResolution.circulatedAtISO,
      status: writtenResolution.status,
      href: "/app/written-resolutions",
      badges: [
        badge(writtenResolution.kind ?? "Resolution", writtenResolution.kind === "Special" ? "warn" : "neutral"),
        writtenResolution.status === "Carried" ? badge("carried", "success") : badge(writtenResolution.status ?? "Circulating", toneForBundleStatus(writtenResolution.status)),
      ],
      links: compact([
        bundleLink("Written resolution", writtenResolution.title, "/app/written-resolutions"),
        linkedItems.length ? bundleLink("Minute book", `${linkedItems.length} manual spine rows`, "/app/minute-book", linkedItems.length) : undefined,
        sourceRows.length ? bundleLink("Evidence", `${sourceRows.length} source evidence`, "/app/meeting-evidence", sourceRows.length) : undefined,
      ]),
      counts: {
        signatures: (writtenResolution.signatures ?? []).length,
        required: writtenResolution.requiredCount ?? 0,
        manualRecords: linkedItems.length,
        sourceEvidence: sourceRows.length,
      },
      gaps: compact([
        writtenResolution.status === "Carried" && linkedItems.length === 0
          ? gap("written_resolution_spine_gap", "Carried resolution not linked to a manual spine row", "warn")
          : undefined,
        writtenResolution.status === "Circulating" && (writtenResolution.signatures ?? []).length < (writtenResolution.requiredCount ?? 0)
          ? gap("written_resolution_signature_gap", "Resolution still needs signatures", "info")
          : undefined,
      ]),
    }));
  }

  for (const amendment of bylawAmendments) {
    const amendmentId = String(amendment._id);
    const meeting = amendment.resolutionMeetingId ? meetingsById.get(String(amendment.resolutionMeetingId)) : undefined;
    const filing = amendment.filingId ? filingsById.get(String(amendment.filingId)) : undefined;
    bundles.push(bundle({
      key: `bylawAmendment:${amendmentId}`,
      type: "bylaw_amendment",
      title: amendment.title,
      date: amendment.filedAtISO ?? amendment.resolutionPassedAtISO ?? amendment.updatedAtISO,
      status: amendment.status,
      href: "/app/bylaws-history",
      badges: [badge("Bylaw amendment", "neutral"), badge(amendment.status ?? "Draft", toneForBundleStatus(amendment.status))],
      links: compact([
        bundleLink("Bylaw amendment", amendment.title, "/app/bylaws-history"),
        meeting ? bundleLink("Resolution meeting", meeting.title, `/app/meetings/${String(meeting._id)}`) : undefined,
        filing ? bundleLink("Filing", filing.kind, "/app/filings") : undefined,
        (amendment.sourceDocumentIds ?? []).length ? bundleLink("Documents", `${amendment.sourceDocumentIds.length} source documents`, "/app/documents", amendment.sourceDocumentIds.length) : undefined,
      ]),
      counts: { documents: (amendment.sourceDocumentIds ?? []).length, filings: filing ? 1 : 0 },
      gaps: compact([
        !/draft|consultation/i.test(String(amendment.status ?? "")) && !meeting
          ? gap("bylaw_resolution_meeting_gap", "Resolution meeting not linked", "warn")
          : undefined,
        /resolutionpassed/i.test(String(amendment.status ?? "")) && !filing
          ? gap("bylaw_filing_gap", "Filing not linked", "warn")
          : undefined,
      ]),
    }));
  }

  for (const financial of financials) {
    const financialId = String(financial._id);
    const meeting = financial.presentedAtMeetingId ? meetingsById.get(String(financial.presentedAtMeetingId)) : undefined;
    const hasStatementDocument = Boolean(financial.statementsDocId);
    bundles.push(bundle({
      key: `financial:${financialId}`,
      type: "financials",
      title: `Financial statements ${financial.fiscalYear}`,
      date: financial.periodEnd,
      status: financial.auditStatus,
      href: "/app/financials",
      badges: [badge("Financials", "neutral"), meeting ? badge("presented", "success") : badge("presentation gap", "warn")],
      links: compact([
        bundleLink("Financials", financial.fiscalYear, "/app/financials"),
        meeting ? bundleLink("Presented at meeting", meeting.title, `/app/meetings/${String(meeting._id)}`) : undefined,
        hasStatementDocument ? bundleLink("Statements", "Statement document", "/app/documents") : undefined,
      ]),
      counts: { documents: hasStatementDocument ? 1 : 0, meetings: meeting ? 1 : 0 },
      gaps: compact([
        !meeting ? gap("financials_agm_gap", "No presentation meeting linked", "warn") : undefined,
        !hasStatementDocument ? gap("financials_statement_gap", "No statement document linked", "warn") : undefined,
      ]),
    }));
  }

  for (const workflowPackage of workflowPackages) {
    const packageId = String(workflowPackage._id);
    const sourceDocumentIds = workflowPackage.supportingDocumentIds ?? [];
    bundles.push(bundle({
      key: `workflowPackage:${packageId}`,
      type: "workflow_package",
      title: workflowPackage.packageName,
      date: workflowPackage.effectiveDate ?? workflowPackage.updatedAtISO,
      status: workflowPackage.status,
      href: "/app/workflow-packages",
      badges: [badge("Workflow package", "neutral"), badge(workflowPackage.status ?? "draft", toneForBundleStatus(workflowPackage.status))],
      links: compact([
        bundleLink("Workflow package", workflowPackage.packageName, "/app/workflow-packages"),
        sourceDocumentIds.length ? bundleLink("Documents", `${sourceDocumentIds.length} supporting documents`, "/app/documents", sourceDocumentIds.length) : undefined,
      ]),
      counts: { documents: sourceDocumentIds.length, signers: (workflowPackage.signerRoster ?? []).length, parts: (workflowPackage.parts ?? []).length },
      gaps: compact([
        /collecting_signatures|ready|draft/i.test(String(workflowPackage.status ?? "")) && (workflowPackage.signerRoster ?? []).length > 0
          ? gap("workflow_package_in_progress", "Package still in progress", "info")
          : undefined,
      ]),
    }));
  }

  if (archiveAccessions.length || sourceEvidence.length || recordsLocations.length) {
    bundles.push(bundle({
      key: "archive:record-custody",
      type: "archive",
      title: "Records archive and source evidence",
      date: latestDate([...archiveAccessions.map((row: any) => row.dateReceived), ...sourceEvidence.map((row: any) => row.createdAtISO)]),
      status: "Evidence",
      href: "/app/records-archive",
      badges: [badge("Archive", "neutral"), badge("source custody", "info")],
      links: compact([
        archiveAccessions.length ? bundleLink("Archive", `${archiveAccessions.length} accessions`, "/app/records-archive", archiveAccessions.length) : undefined,
        recordsLocations.length ? bundleLink("Records location", `${recordsLocations.length} locations`, "/app/inspections", recordsLocations.length) : undefined,
        sourceEvidence.length ? bundleLink("Source evidence", `${sourceEvidence.length} evidence rows`, "/app/meeting-evidence", sourceEvidence.length) : undefined,
      ]),
      counts: {
        archiveAccessions: archiveAccessions.length,
        sourceEvidence: sourceEvidence.length,
        restrictedSources: sourceEvidence.filter((row: any) => /restricted/i.test(`${row.sensitivity ?? ""} ${row.accessLevel ?? ""}`)).length,
        recordsLocations: recordsLocations.length,
      },
      gaps: [],
    }));
  }

  return bundles.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

function byId(rows: any[]) {
  return new Map<string, any>(rows.map((row) => [String(row._id), row]));
}

function firstByField(rows: any[], field: string) {
  const result = new Map<string, any>();
  for (const row of rows) {
    const value = row[field];
    if (!value) continue;
    const key = String(value);
    if (!result.has(key)) result.set(key, row);
  }
  return result;
}

function groupByField(rows: any[], field: string) {
  return groupBy(rows, (row) => row[field]);
}

function groupBy(rows: any[], keyFor: (row: any) => unknown) {
  const result = new Map<string, any[]>();
  for (const row of rows) {
    const value = keyFor(row);
    if (!value) continue;
    const key = String(value);
    if (!key) continue;
    const bucket = result.get(key) ?? [];
    bucket.push(row);
    result.set(key, bucket);
  }
  return result;
}

function targetKey(type: unknown, id: unknown) {
  if (!type || !id) return "";
  return `${String(type)}:${String(id)}`;
}

function targetRows(index: Map<string, any[]>, types: string[], id: unknown) {
  const value = String(id ?? "");
  if (!value) return [];
  return types.flatMap((type) => index.get(targetKey(type, value)) ?? []);
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map((value) => value ? String(value) : "").filter(Boolean)));
}

function compact(values: any[]) {
  return values.filter(Boolean);
}

function bundle(value: any) {
  return value;
}

function badge(label: string, tone = "neutral") {
  return { label, tone };
}

function bundleLink(kind: string, label: string, href: string, count?: number) {
  return { kind, label, href, count };
}

function gap(key: string, label: string, severity: string, detail?: string) {
  return { key, label, severity, detail };
}

function latestDate(values: unknown[]) {
  return uniqueStrings(values).sort((a, b) => String(b).localeCompare(String(a)))[0];
}

function shortText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function toneForBundleStatus(status?: string) {
  const value = String(status ?? "").toLowerCase();
  if (/active|approved|current|filed|complete|verified|carried|published|ready/.test(value)) return "success";
  if (/review|draft|pending|circulating|collecting|open|submitted|consultation/.test(value)) return "warn";
  if (/failed|rejected|cancelled|superseded|ceased|lapsed|withdrawn/.test(value)) return "danger";
  return "neutral";
}

function minuteBookItemPreview(row: any) {
  return pick(row, [
    "_id",
    "title",
    "recordType",
    "effectiveDate",
    "status",
    "documentIds",
    "meetingId",
    "minutesId",
    "filingId",
    "policyId",
    "workflowPackageId",
    "writtenResolutionId",
    "signatureIds",
    "sourceEvidenceIds",
    "archivedAtISO",
    "notes",
  ]);
}

function meetingPreview(row: any) {
  return pick(row, ["_id", "title", "type", "scheduledAt", "status", "minutesId", "noticeSentAt"]);
}

function minutesPreview(row: any) {
  return pick(row, ["_id", "meetingId", "heldAt", "approvedAt", "approvedInMeetingId", "sourceDocumentIds", "sourceExternalIds"]);
}

function filingPreview(row: any) {
  return pick(row, ["_id", "kind", "periodLabel", "dueDate", "filedAt", "status", "receiptDocumentId", "stagedPacketDocumentId", "sourceDocumentIds"]);
}

function policyPreview(row: any) {
  return pick(row, [
    "_id",
    "policyName",
    "policyNumber",
    "owner",
    "effectiveDate",
    "reviewDate",
    "ceasedDate",
    "docxDocumentId",
    "pdfDocumentId",
    "adoptedAtMeetingId",
    "adoptedInMinutesId",
    "adoptingMotionEvidenceId",
    "requiredSigners",
    "signatureRequired",
    "status",
  ]);
}

function workflowPackagePreview(row: any) {
  return pick(row, ["_id", "packageName", "eventType", "effectiveDate", "status", "supportingDocumentIds", "signerRoster", "parts"]);
}

function signaturePreview(row: any) {
  return pick(row, ["_id", "entityType", "entityId", "signerName", "signerRole", "signedAtISO"]);
}

function sourceEvidencePreview(row: any) {
  return pick(row, ["_id", "sourceDocumentId", "externalSystem", "externalId", "sourceTitle", "sourceDate", "evidenceKind", "targetTable", "targetId", "sensitivity", "accessLevel", "summary", "status", "createdAtISO"]);
}

function motionEvidencePreview(row: any) {
  return pick(row, ["_id", "meetingId", "minutesId", "meetingTitle", "meetingDate", "motionText", "outcome", "status", "sourceDocumentIds", "sourceExternalIds"]);
}

function archiveAccessionPreview(row: any) {
  return pick(row, ["_id", "title", "accessionNumber", "containerType", "location", "custodian", "dateReceived", "dateRange", "status", "sourceDocumentIds", "sourceExternalIds"]);
}

function meetingMaterialPreview(row: any) {
  return pick(row, ["_id", "meetingId", "documentId", "agendaItemId", "agendaLabel", "label", "order", "requiredForMeeting", "accessLevel", "availabilityStatus", "createdAtISO"]);
}

function attendancePreview(row: any) {
  return pick(row, ["_id", "meetingId", "minutesId", "meetingTitle", "meetingDate", "personName", "attendanceStatus", "quorumCounted", "sourceDocumentIds", "sourceExternalIds"]);
}

function communicationCampaignPreview(row: any) {
  return pick(row, ["_id", "meetingId", "kind", "channel", "audience", "subject", "status", "memberCount", "deliveredCount", "createdAtISO", "sentAtISO"]);
}

function communicationDeliveryPreview(row: any) {
  return pick(row, ["_id", "campaignId", "meetingId", "recipientName", "channel", "subject", "status", "sentAtISO"]);
}

function noticeDeliveryPreview(row: any) {
  return pick(row, ["_id", "meetingId", "campaignId", "recipientName", "channel", "subject", "status", "sentAtISO"]);
}

function agmRunPreview(row: any) {
  return pick(row, ["_id", "meetingId", "step", "noticeSentAt", "financialsPresentedAt", "electionsCompletedAt", "minutesApprovedAt", "annualReportFiledAt", "annualReportFilingId", "updatedAtISO"]);
}

function financialPreview(row: any) {
  return pick(row, ["_id", "fiscalYear", "periodEnd", "auditStatus", "presentedAtMeetingId", "statementsDocId"]);
}

function electionPreview(row: any) {
  return pick(row, ["_id", "meetingId", "title", "status", "opensAtISO", "closesAtISO", "evidenceDocumentId", "resultsSummary"]);
}

function proxyPreview(row: any) {
  return pick(row, ["_id", "meetingId", "grantorName", "proxyHolderName", "signedAtISO", "revokedAtISO"]);
}

function memberProposalPreview(row: any) {
  return pick(row, ["_id", "meetingId", "title", "submittedByName", "submittedAtISO", "signatureCount", "includedInAgenda", "status"]);
}

function taskPreview(row: any) {
  return pick(row, ["_id", "title", "status", "priority", "dueDate", "meetingId", "filingId", "workflowId", "documentId", "eventId", "tags"]);
}

function bylawAmendmentPreview(row: any) {
  return pick(row, ["_id", "title", "status", "updatedAtISO", "resolutionMeetingId", "resolutionPassedAtISO", "filingId", "filedAtISO", "sourceDocumentIds"]);
}

function writtenResolutionPreview(row: any) {
  return pick(row, ["_id", "title", "kind", "circulatedAtISO", "completedAtISO", "signatures", "requiredCount", "status"]);
}

function agendaPreview(row: any) {
  return pick(row, ["_id", "meetingId", "title", "status", "updatedAtISO", "createdAtISO"]);
}

function agendaItemPreview(row: any) {
  return pick(row, ["_id", "agendaId", "order", "type", "title", "outcome", "resolutionId", "createdAtISO"]);
}

function recordsLocationPreview(row: any) {
  return pick(row, ["_id", "address", "noticePostedAtOffice", "postedAtISO", "computerProvidedForInspection"]);
}

function pick(row: any, keys: string[]) {
  const result: Record<string, any> = {};
  for (const key of keys) {
    if (row[key] !== undefined) result[key] = row[key];
  }
  return result;
}

function minuteBookChecks({
  items,
  documents,
  binderDocuments,
  meetings,
  minutes,
  filings,
  policies,
  workflowPackages,
  signatures,
  motionEvidence,
  archiveAccessions,
  writtenResolutions,
}: Record<string, any[]>) {
  const categorySet = new Set(binderDocuments.map((doc) => doc.category));
  const missingBasics = ["Constitution", "Bylaws", "Minutes"].filter((category) => !categorySet.has(category));
  const signatureEntityKeys = new Set(signatures.map((signature) => `${signature.entityType}:${signature.entityId}`));
  const missingSignatureItems = items.filter((item) => {
    const type = String(item.recordType ?? "").toLowerCase();
    const needsSignature = /resolution|minutes|minute|policy|filing|package/.test(type) ||
      item.policyId ||
      item.workflowPackageId ||
      item.minutesId;
    if (!needsSignature) return false;
    if ((item.signatureIds ?? []).length > 0) return false;
    return !signatureEntityKeys.has(`minuteBookItems:${String(item._id)}`) &&
      !signatureEntityKeys.has(`minuteBookItem:${String(item._id)}`);
  });
  const openFilings = filings.filter((filing) => !/filed|submitted|complete/i.test(String(filing.status ?? "")));
  const unresolvedMotions = motionEvidence.filter((motion) =>
    /needsreview|needs review|extracted|pending|unknown/i.test(`${motion.status ?? ""} ${motion.outcome ?? ""}`),
  );
  const paperArchiveDocs = documents.filter((doc) =>
    [doc.title, doc.category, ...(doc.tags ?? [])].join(" ").toLowerCase().includes("paper minute book") ||
    [doc.title, doc.category, ...(doc.tags ?? [])].join(" ").toLowerCase().includes("paper archive"),
  );
  const packageGaps = workflowPackages.filter((pkg) =>
    !/filed|archived|cancelled/i.test(String(pkg.status ?? "")) &&
    ((pkg.signerRoster ?? []).length > 0 || (pkg.supportingDocumentIds ?? []).length > 0),
  );
  const policyReviewGaps = policies.filter((policy) =>
    !policy.reviewDate || (policy.reviewDate < todayDate() && !/ceased|superseded/i.test(String(policy.status ?? ""))),
  );
  const policyAdoptionGaps = policies.filter((policy) =>
    policy.status === "Active" &&
    !policy.adoptedAtMeetingId &&
    !policy.adoptedInMinutesId &&
    !policy.adoptingMotionEvidenceId,
  );
  const writtenResolutionItemIds = new Set(items.map((item) => String(item.writtenResolutionId ?? "")).filter(Boolean));
  const writtenResolutionGaps = writtenResolutions.filter((resolution) =>
    resolution.status === "Carried" && !writtenResolutionItemIds.has(String(resolution._id)),
  );
  const minutesMeetingIds = new Set(minutes.map((row) => String(row.meetingId ?? "")).filter(Boolean));
  const meetingsWithoutMinutes = meetings.filter((meeting) => !meeting.minutesId && !minutesMeetingIds.has(String(meeting._id)));

  return [
    check("missing_core_documents", "Missing constitution/bylaws/minutes", missingBasics.length, "danger", missingBasics.join(", ")),
    check("missing_signatures", "Records missing signatures", missingSignatureItems.length, "warn", "Minute-book records that appear to require signatures but have none linked."),
    check("open_filings", "Open or unfiled filings", openFilings.length, "warn", "Filings still need submission evidence or completion."),
    check("unresolved_resolutions", "Unresolved resolution evidence", unresolvedMotions.length, "warn", "Imported motions still need review or final outcomes."),
    check("policy_adoption_gaps", "Policies missing adoption records", policyAdoptionGaps.length, "warn", "Active policies should link the adopting meeting, minutes, or motion evidence."),
    check("written_resolution_spine_gaps", "Written resolutions outside manual spine", writtenResolutionGaps.length, "warn", "Carried written resolutions should be linked to a minute-book spine row."),
    check("paper_archive_gap", "Paper minute-book archive gap", archiveAccessions.length || paperArchiveDocs.length ? 0 : 1, "info", "No archive accession or document tag for the paper minute book."),
    check("workflow_package_gaps", "Workflow packages in progress", packageGaps.length, "info", "Packages with signers or documents that are not filed/archived."),
    check("policy_review_gaps", "Policy review gaps", policyReviewGaps.length, "warn", "Policies missing review dates or past due for review."),
    check("meeting_minutes_gap", "Meetings without minutes", meetingsWithoutMinutes.length, "warn", "Meetings that do not have minutes linked through meetings.minutesId or minutes.meetingId."),
  ];
}

function check(key: string, label: string, count: number, severity: string, detail: string) {
  return { key, label, count, severity, detail, ok: count === 0 };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
