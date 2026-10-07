/** Stage 8: cross-document reconciliation (deterministic joins).
 * - draft vs approved minutes of the same meeting; approval evidenced by a later
 *   "adopt the minutes of <date>" motion of the same body;
 * - carry-forward of action items across consecutive meetings of a body;
 * - policy versions → the motion that adopted them;
 * - record gaps: cited minutes that are missing, draft-only meetings, AGM per calendar year. */
import type { IntakeExtractionResult, IntakeFileRecord } from "./bundle";
import { agendaEvidencedMeetings, annotateFiscalYearEndChanges, classRecordGaps, linkPolicyAdoptions } from "./classStages";
import { bodyKeyFor, meetingKey } from "./entities";
import { textSimilarity } from "./eval";

export type MinutesSummary = {
  fileId: string;
  fileName: string;
  bodyKey: string;
  date?: string;
  recordStatus: string;
  adopts: Array<{ date?: string; body?: string; motionIndex: number; text: string }>;
  actions: Array<{ index: number; text: string; assignee?: string; due?: string }>;
  policiesAdopted: Array<{ motionIndex: number; text: string }>;
};

export type ReconciledMeeting = {
  meetingKey: string;
  bodyKey: string;
  date: string;
  files: Array<{ fileId: string; recordStatus: string }>;
  canonicalFileId: string;
  status: "approved" | "approved_by_motion" | "draft_only" | "recorded";
  approvedBy?: { meetingKey: string; fileId: string; motionIndex: number };
};
export type ReconcileLink = { kind: "draft-of" | "duplicate-of" | "approved-by-motion" | "policy-adopted-by" | "action-carried-forward"; from: string; to: string; detail?: string };
export type RecordGap = {
  kind: "missing_minutes" | "draft_only_minutes" | "agm_missing_for_year" | "body_month_without_minutes"
    // WP-L: gaps found through agendas/packages, references, filings and policy versions.
    | "meeting_without_minutes" | "unresolved_reference" | "annual_report_evidence_missing" | "policy_without_adoption" | "fiscal_year_end_change";
  bodyKey?: string;
  date?: string;
  year?: number;
  citedBy?: { fileId: string; motionIndex: number };
  severity: "statutory" | "bylaw" | "practice";
  explanation: string;
  /** Source files that evidence the gap (agenda of a meeting without minutes, the citing document …). */
  evidence?: Array<{ fileId: string; text?: string }>;
};
export type ActionChain = { bodyKey: string; items: Array<{ meetingKey: string; fileId: string; index: number; text: string; assignee?: string }>; latestStatus: "open" | "carried_forward" };

const STATUS_RANK: Record<string, number> = { signed: 4, approved: 3, recorded: 2, unknown: 1, draft: 0 };

export function reconcileMinutes(summaries: MinutesSummary[]): { meetings: ReconciledMeeting[]; links: ReconcileLink[]; gaps: RecordGap[] } {
  const byKey = new Map<string, MinutesSummary[]>();
  for (const summary of summaries) {
    if (!summary.date) continue;
    const key = meetingKey(summary.bodyKey, summary.date);
    byKey.set(key, [...(byKey.get(key) ?? []), summary]);
  }
  const links: ReconcileLink[] = [];
  const gaps: RecordGap[] = [];
  const meetings: ReconciledMeeting[] = [];
  // Index adoption motions: "adopt the minutes of <date>" approves that body's meeting.
  const adoptions = new Map<string, { meetingKey: string; fileId: string; motionIndex: number }>();
  const datesByBody = new Map<string, string[]>();
  for (const key of byKey.keys()) {
    const [bodyKey, date] = key.split("@");
    datesByBody.set(bodyKey, [...(datesByBody.get(bodyKey) ?? []), date].sort());
  }
  for (const summary of summaries) {
    for (const adopt of summary.adopts) {
      if (!summary.date) continue;
      if (!adopt.date) {
        // "Minutes approved" without a date: the body's previous meeting in the corpus (within ~5 months).
        const previous = (datesByBody.get(summary.bodyKey) ?? []).filter((date) => date < summary.date! && Date.parse(summary.date!) - Date.parse(date) <= 150 * 86400000).pop();
        if (previous) {
          const key = meetingKey(summary.bodyKey, previous);
          if (!adoptions.has(key)) adoptions.set(key, { meetingKey: meetingKey(summary.bodyKey, summary.date), fileId: summary.fileId, motionIndex: adopt.motionIndex });
        }
        continue;
      }
      if (adopt.date >= summary.date) continue;
      const key = meetingKey(summary.bodyKey, adopt.date);
      if (!adoptions.has(key)) adoptions.set(key, { meetingKey: meetingKey(summary.bodyKey, summary.date), fileId: summary.fileId, motionIndex: adopt.motionIndex });
      if (!byKey.has(key)) {
        // Minutes adopted by a later meeting but absent from the corpus.
        const nearby = [...byKey.keys()].find((existing) => existing.startsWith(`${summary.bodyKey}@`) && Math.abs(Date.parse(existing.split("@")[1]) - Date.parse(adopt.date!)) <= 2 * 86400000);
        if (!nearby) gaps.push({ kind: "missing_minutes", bodyKey: summary.bodyKey, date: adopt.date, citedBy: { fileId: summary.fileId, motionIndex: adopt.motionIndex }, severity: "practice", explanation: `Minutes of ${adopt.date} are adopted by the ${summary.date} meeting ("${adopt.text.slice(0, 120)}") but no minutes for that meeting were found.` });
      }
    }
  }
  for (const [key, group] of byKey) {
    const sorted = [...group].sort((a, b) => (STATUS_RANK[b.recordStatus] ?? 1) - (STATUS_RANK[a.recordStatus] ?? 1) || a.fileName.localeCompare(b.fileName));
    const canonical = sorted[0];
    for (const other of sorted.slice(1)) {
      links.push({ kind: other.recordStatus === "draft" && canonical.recordStatus !== "draft" ? "draft-of" : "duplicate-of", from: other.fileId, to: canonical.fileId });
    }
    const approvedBy = adoptions.get(key);
    if (approvedBy) links.push({ kind: "approved-by-motion", from: canonical.fileId, to: approvedBy.fileId, detail: approvedBy.motionIndex >= 0 ? `motion #${approvedBy.motionIndex + 1} of ${approvedBy.meetingKey}` : `approval statement in ${approvedBy.meetingKey}` });
    const anyApproved = sorted.some((summary) => summary.recordStatus === "approved" || summary.recordStatus === "signed");
    const status: ReconciledMeeting["status"] = approvedBy ? "approved_by_motion" : anyApproved ? "approved" : sorted.every((summary) => summary.recordStatus === "draft") ? "draft_only" : "recorded";
    if (status === "draft_only") gaps.push({ kind: "draft_only_minutes", bodyKey: canonical.bodyKey, date: canonical.date, severity: "practice", explanation: `Only a DRAFT of the ${canonical.date} minutes exists and no later motion adopting them was found.` });
    meetings.push({ meetingKey: key, bodyKey: canonical.bodyKey, date: canonical.date!, files: sorted.map((summary) => ({ fileId: summary.fileId, recordStatus: summary.recordStatus })), canonicalFileId: canonical.fileId, status, ...(approvedBy ? { approvedBy } : {}) });
  }
  // One gap per missing meeting, whichever copy cited it.
  const seen = new Set<string>();
  const uniqueGaps = gaps.filter((gap) => {
    const key = `${gap.kind}|${gap.bodyKey}|${gap.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { meetings: meetings.sort((a, b) => a.date.localeCompare(b.date) || a.bodyKey.localeCompare(b.bodyKey)), links, gaps: uniqueGaps };
}

/** Carry-forward: the same action (similar text, same assignee) in consecutive meetings of a body. */
export function carryForwardActions(summaries: MinutesSummary[], threshold = 0.6): { chains: ActionChain[]; links: ReconcileLink[] } {
  const byBody = new Map<string, MinutesSummary[]>();
  for (const summary of summaries) if (summary.date) byBody.set(summary.bodyKey, [...(byBody.get(summary.bodyKey) ?? []), summary]);
  const chains: ActionChain[] = [];
  const links: ReconcileLink[] = [];
  for (const [bodyKey, group] of byBody) {
    const ordered = group.sort((a, b) => a.date!.localeCompare(b.date!));
    const open: ActionChain[] = [];
    for (const summary of ordered) {
      const key = meetingKey(bodyKey, summary.date!);
      for (const action of summary.actions) {
        const match = open.find((chain) => {
          const last = chain.items[chain.items.length - 1];
          if (last.meetingKey === key) return false;
          const sameAssignee = !last.assignee || !action.assignee || last.assignee.toLowerCase() === action.assignee.toLowerCase();
          return sameAssignee && textSimilarity(last.text, action.text) >= threshold;
        });
        const item = { meetingKey: key, fileId: summary.fileId, index: action.index, text: action.text, assignee: action.assignee };
        if (match) {
          const last = match.items[match.items.length - 1];
          links.push({ kind: "action-carried-forward", from: `${last.fileId}#action${last.index}`, to: `${summary.fileId}#action${action.index}` });
          match.items.push(item);
          match.latestStatus = "carried_forward";
        } else {
          const chain: ActionChain = { bodyKey, items: [item], latestStatus: "open" };
          open.push(chain);
          chains.push(chain);
        }
      }
    }
  }
  return { chains: chains.filter((chain) => chain.items.length > 1), links };
}

/** Policy version → adopting motion: same title, motion on or before the version date (within a window). */
export function linkPolicyVersions(
  policies: Array<{ fileId: string; title: string; date?: string }>,
  motions: Array<{ meetingKey: string; fileId: string; motionIndex: number; date: string; policyText: string }>,
  windowDays = 120,
): ReconcileLink[] {
  const links: ReconcileLink[] = [];
  for (const policy of policies) {
    const scored = motions
      .map((motion) => ({ motion, score: textSimilarity(policy.title, motion.policyText) }))
      .filter(({ motion, score }) => score >= 0.5 && (!policy.date || Math.abs(Date.parse(motion.date) - Date.parse(policy.date)) <= windowDays * 86400000))
      .sort((a, b) => b.score - a.score || (policy.date ? Math.abs(Date.parse(a.motion.date) - Date.parse(policy.date)) - Math.abs(Date.parse(b.motion.date) - Date.parse(policy.date)) : 0));
    const best = scored[0];
    if (best) links.push({ kind: "policy-adopted-by", from: policy.fileId, to: `${best.motion.fileId}#motion${best.motion.motionIndex}`, detail: `${best.motion.meetingKey} (title similarity ${best.score.toFixed(2)})` });
  }
  return links;
}

/** Record gaps from rules: an AGM in every calendar year (BC Societies Act s. 71 / typical bylaws). */
export function agmGaps(meetings: ReconciledMeeting[], fromYear: number, toYear: number, evidence: Array<{ year: number; kind: string }> = []): RecordGap[] {
  const gaps: RecordGap[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const held = meetings.some((meeting) => (meeting.bodyKey === "agm" || meeting.bodyKey === "joint") && meeting.date.startsWith(String(year)));
    if (held) continue;
    const other = evidence.filter((item) => item.year === year).map((item) => item.kind);
    gaps.push({ kind: "agm_missing_for_year", year, severity: "statutory", explanation: `No AGM minutes found for ${year}${other.length ? ` (other AGM evidence: ${[...new Set(other)].join(", ")})` : ""}. An AGM must be held in every calendar year.` });
  }
  return gaps;
}

/** Body × month timeline of minutes found (feeds the coverage heat-map). */
export function bodyTimeline(meetings: ReconciledMeeting[]): Record<string, Record<string, ReconciledMeeting["status"]>> {
  const out: Record<string, Record<string, ReconciledMeeting["status"]>> = {};
  for (const meeting of meetings) {
    out[meeting.bodyKey] ??= {};
    out[meeting.bodyKey][meeting.date.slice(0, 7)] = meeting.status;
  }
  return out;
}

/** Stage 8 (reconciliation) over extractions and their classified files:
 * meetings (copies grouped, drafts linked to adopted versions), action
 * carry-forward, and record gaps (cited-but-missing minutes, draft-only
 * minutes, years without AGM minutes). Shared by the pipeline and the
 * portable `intake:reconcileRun` mutation (server-side extraction runs). */
export function reconcileExtractions(
  files: Array<{ fileKey: string; name: string; classification?: { docClass?: string; date?: { iso: string }; recordStatus?: string } }>,
  extractions: Array<{ fileKey: string; docClass?: string; record: unknown; references: Array<{ kind: string; text: string; date?: string }> }>,
  options: { fiscalChanges?: ReturnType<typeof annotateFiscalYearEndChanges>; /** Run date: AGMs are not missing for the current or a future year. */ asOfISO?: string } = {},
) {
  const summaries: MinutesSummary[] = extractions.filter((extraction) => (extraction.docClass ?? "meetingMinutes") === "meetingMinutes").map((extraction) => {
    const record = extraction.record as any;
    const date = record.date?.value;
    return {
      fileId: extraction.fileKey,
      fileName: files.find((file) => file.fileKey === extraction.fileKey)?.name ?? extraction.fileKey,
      bodyKey: bodyKeyFor(record.bodyLabel?.value ?? record.body?.value),
      date: date?.precision === "day" ? date.iso : undefined,
      recordStatus: String(record.recordStatus?.value ?? "unknown"),
      adopts: [
        ...(record.motions ?? []).map((motion: any, index: number) => (motion.adoptsMinutesOf ? { date: motion.adoptsMinutesOf.value?.date, motionIndex: index, text: motion.text?.value ?? "" } : null)).filter(Boolean),
        // Approval recorded without a formal motion ("Minutes approved") is weaker evidence but still links the prior meeting.
        ...extraction.references.filter((reference) => reference.kind === "prior_minutes" && !(record.motions ?? []).some((motion: any) => motion.text?.value === reference.text)).map((reference) => ({ date: reference.date, motionIndex: -1, text: reference.text })),
      ],
      actions: (record.actionItems ?? []).map((item: any, index: number) => ({ index, text: item.text?.value ?? "", assignee: item.assigneeAsWritten?.value, due: item.due?.value?.iso })),
      policiesAdopted: (record.motions ?? []).map((motion: any, index: number) => ({ motionIndex: index, text: motion.adoptsPolicy?.value })).filter((item: any) => item.text),
    };
  });
  const reconciled = reconcileMinutes(summaries);
  const carry = carryForwardActions(summaries);
  const years = reconciled.meetings.map((meeting) => Number(meeting.date.slice(0, 4))).filter(Number.isFinite);
  const agmEvidence = files.filter((file) => file.classification?.docClass === "agmMaterial" && file.classification.date).map((file) => ({ year: Number(file.classification!.date!.iso.slice(0, 4)), kind: file.classification!.recordStatus ?? "unknown" }));
  // Class extractors (WP-L): agendas/packages evidence meetings without minutes,
  // policies link to adopting motions, and fiscal-year-end changes raise gaps.
  const classExtractions = extractions as unknown as IntakeExtractionResult[];
  const classFiles = files as unknown as IntakeFileRecord[];
  const fiscalChanges = options.fiscalChanges ?? annotateFiscalYearEndChanges(classExtractions);
  const evidencedMeetings = agendaEvidencedMeetings(classExtractions, classFiles, reconciled.meetings);
  const policyAdoptions = linkPolicyAdoptions(classExtractions, reconciled.meetings);
  // An agenda/package that evidences an AGM counts as AGM evidence for the per-year rule (held, minutes missing).
  const agmHeld = evidencedMeetings.filter((meeting) => meeting.bodyKey === "agm").map((meeting) => ({ year: Number(meeting.date.slice(0, 4)), kind: "agenda (minutes missing)" }));
  const gaps = [
    ...reconciled.gaps,
    ...(years.length ? agmGaps(reconciled.meetings, Math.min(...years), Math.min(Math.max(...years), Number((options.asOfISO ?? new Date().toISOString()).slice(0, 4)) - 1), [...agmEvidence, ...agmHeld]) : []),
    ...classRecordGaps({ extractions: classExtractions, meetings: reconciled.meetings, evidenced: evidencedMeetings, policyLinks: policyAdoptions, fiscalChanges }),
  ];
  return { reconciled, carry, gaps, evidencedMeetings, policyAdoptions, fiscalChanges };
}
