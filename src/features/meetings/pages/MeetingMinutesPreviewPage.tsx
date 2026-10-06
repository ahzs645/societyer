import { minutesEvidenceOptions } from "../lib/minutesEvidence";
import { usePermissions } from "../../../hooks/usePermissions";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../../../convex/_generated/dataModel";
import { ArrowLeft, FileDown, FileText, Printer } from "lucide-react";
import { Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { SeedPrompt } from "../../../pages/_helpers";
import { useSociety } from "../../../hooks/useSociety";
import { formatDate } from "../../../lib/format";
import { exportWordDocx } from "../../../lib/docx";
import { exportPdfDownload, printPdfDocument } from "../../../lib/pdf";
import { renderMinutesHtml } from "../lib/minutesRenderer";
import { minutesMotionsForDisplay, motionRowToEmbedded } from "../../../../shared/minutesMotions";
import { MinutesDocumentPreview } from "../components/MinutesDocumentPreview";
import { getQuorumSnapshot, personLinkCandidates } from "../components/MeetingDetailSupport";
import { motionPersonDisplayName } from "../../../components/MotionEditor";
import { agendaEntriesFromRecord, formalMinutesExportBlockers } from "../lib/meetingDetailHelpers";
import { useToast } from "../../../components/Toast";
import { readStoredAgendaNumberingMode } from "../lib/agendaNumbering";
import { MINUTES_EXPORT_STYLES, type MinutesExportStyleId } from "../lib/minutesExportStyles";
import {
  MINUTES_EXPORT_PREF_PREFIX,
  readStoredExportBool,
  readStoredMinutesStyle,
} from "../lib/minutesExportPrefs";
import { minuteSectionIndexForAgendaEntry } from "../lib/sourceAgendaNavigation";

export function MeetingMinutesPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const liveMotionRows = useQuery(api.motions.listForMinutes, minutes ? { minutesId: minutes._id } : "skip");
  const displayMotions = useMemo(() => {
    if (!minutes) return [] as any[];
    if (minutes.approvedAt || Array.isArray(minutes.motionSnapshots)) return minutesMotionsForDisplay(minutes) as any[];
    return liveMotionRows === undefined
      ? minutesMotionsForDisplay(minutes) as any[]
      : (liveMotionRows as any[]).map(motionRowToEmbedded);
  }, [minutes, liveMotionRows]);
  const agendaRecord = useQuery(api.agendas.getForMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  // Needed to resolve ID-linked movers/seconders to display names, so this
  // page's exports match the meeting-detail Export tab output.
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society && loaded && can("directors:read") ? { societyId: society._id } : "skip");
  const minutesSignatures = useQuery(api.signatures.listForEntity, loaded && can("documents:read") && minutes ? { entityType: "minutes", subjectId: minutes._id as string } : "skip");
  const meetingConflicts = useQuery(api.conflicts.forMeeting, loaded && can("conflicts:read") && id ? { meetingId: id as Id<"meetings"> } : "skip");
  const meetingProxies = useQuery(api.proxies.forMeeting, loaded && can("proxies:read") && id ? { meetingId: id as Id<"meetings"> } : "skip");
  const meetingPackage = useQuery(api.meetingMaterials.packageForMeeting, loaded && can("meetings:read") && id ? { meetingId: id as Id<"meetings"> } : "skip");
  const [minutesExportStyle, setMinutesExportStyle] = useState<MinutesExportStyleId>(readStoredMinutesStyle);
  const [sourceFidelityInExport, setSourceFidelityInExport] = useState(() => readStoredExportBool("sourceFidelity", true));
  const [includeTranscriptInExport, setIncludeTranscriptInExport] = useState(() => readStoredExportBool("includeTranscript", false));
  const [includeActionItemsInExport, setIncludeActionItemsInExport] = useState(() => readStoredExportBool("includeActionItems", true));
  const [includeDiscussionSummaryInExport, setIncludeDiscussionSummaryInExport] = useState(() => readStoredExportBool("includeDiscussionSummary", false));
  const [includeApprovalInExport, setIncludeApprovalInExport] = useState(() => readStoredExportBool("includeApproval", true));
  const [includeSignaturesInExport, setIncludeSignaturesInExport] = useState(() => readStoredExportBool("includeSignatures", true));
  const [includePlaceholdersInExport, setIncludePlaceholdersInExport] = useState(() => readStoredExportBool("includePlaceholders", false));
  const toast = useToast();

  useEffect(() => {
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}style`, minutesExportStyle);
  }, [minutesExportStyle]);

  useEffect(() => {
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}sourceFidelity`, String(sourceFidelityInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeTranscript`, String(includeTranscriptInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeActionItems`, String(includeActionItemsInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeDiscussionSummary`, String(includeDiscussionSummaryInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeApproval`, String(includeApprovalInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeSignatures`, String(includeSignaturesInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includePlaceholders`, String(includePlaceholdersInExport));
  }, [
    sourceFidelityInExport,
    includeActionItemsInExport,
    includeApprovalInExport,
    includeDiscussionSummaryInExport,
    includePlaceholdersInExport,
    includeSignaturesInExport,
    includeTranscriptInExport,
  ]);

  if (society === undefined || meeting === undefined || minutes === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (meeting === null) {
    return (
      <div className="page">
        Meeting not found — it may have been deleted.{" "}
        <Link to="/app/meetings">Back to meetings</Link>
      </div>
    );
  }
  if (!minutes) return <div className="page">No minutes recorded for this meeting.</div>;

  const agendaTree = agendaEntriesFromRecord(minutes?.adoptedAgenda ?? agendaRecord) ?? [];
  const quorumSnapshot = getQuorumSnapshot(minutes, meeting);
  const motionPeople = personLinkCandidates(members, directors);
  const selectedMinutesExportStyle =
    MINUTES_EXPORT_STYLES.find((style) => style.id === minutesExportStyle) ??
    MINUTES_EXPORT_STYLES[0];
  const formalExportBlockers = formalMinutesExportBlockers({
    meeting,
    minutes,
    agendaItemCount: agendaTree.length,
    motions: displayMotions,
  });
  const publicCopy = minutesExportStyle === "board-public";
  const canDownload = can("exports:download");
  const rawSections = minutes.sections ?? [];
  const hiddenSections = new Set<number>();
  if (publicCopy) rawSections.forEach((section: any, index: number) => {
    if (section.publicVisible !== false) return;
    hiddenSections.add(index);
    if ((section.depth ?? 0) === 0) for (let child = index + 1; child < rawSections.length && rawSections[child].depth === 1; child++) hiddenSections.add(child);
  });
  const visibleSections = rawSections.filter((_: any, index: number) => !hiddenSections.has(index));
  const visibleAgendaTree = agendaTree.filter(entry => {
    const sectionIndex = minuteSectionIndexForAgendaEntry(entry, rawSections);
    return sectionIndex === null || !hiddenSections.has(sectionIndex);
  });
  const indexRemap = new Map<number, number>();
  rawSections.forEach((_: any, index: number) => { if (!hiddenSections.has(index)) indexRemap.set(index, indexRemap.size); });
  const visibleMotions = displayMotions.filter((motion: any) => motion.sectionIndex == null || !hiddenSections.has(motion.sectionIndex));

  const bodyHtml = renderMinutesHtml({
    society: {
      name: society.name,
      incorporationNumber: society.incorporationNumber ?? null,
      logoUrl: (society as any).logoUrl ?? null,
      letterheadUrl: (society as any).letterheadUrl ?? null,
    },
    meeting: {
      title: meeting.title,
      type: meeting.type,
      scheduledAt: meeting.scheduledAt,
      location: meeting.location ?? null,
      electronic: !!meeting.electronic,
      noticeSentAt: meeting.noticeSentAt ?? null,
      agendaItems: visibleAgendaTree.filter((entry) => entry.depth === 0).map((entry) => entry.title),
      agendaItemTree: visibleAgendaTree,
      ...(minutes.adoptedMeeting ?? {}),
    },
    minutes: {
      heldAt: minutes.heldAt,
      consentItems: minutes.consentItems,
      conditionalDecisions: minutes.conditionalDecisions,
      decisionRequirements: minutes.decisionRequirements,
      attendanceEvents: minutes.attendanceEvents,
      quorumCheckpoints: minutes.quorumCheckpoints,
      futureMeetingSuggestions: minutes.futureMeetingSuggestions,
      sourceMeetingRecord: publicCopy ? undefined : minutes.sourceMeetingRecord,
      sourceTransposition: publicCopy ? undefined : minutes.sourceTransposition,
      linkedTasks: publicCopy ? undefined : meetingPackage?.tasks,

      chairName: minutes.chairName ?? null,
      secretaryName: minutes.secretaryName ?? null,
      recorderName: minutes.recorderName ?? null,
      calledToOrderAt: minutes.calledToOrderAt ?? null,
      adjournedAt: minutes.adjournedAt ?? null,
      remoteParticipation: minutes.remoteParticipation ?? null,
      detailedAttendance: minutes.detailedAttendance ?? null,
      attendees: minutes.attendees,
      absent: minutes.absent,
      quorumMet: minutes.quorumMet,
      quorumStatus: minutes.quorumStatus,
      quorumRequired: quorumSnapshot.required,
      quorumSourceLabel: quorumSnapshot.label,
      discussion: publicCopy && (minutes.sourceMeetingRecord || minutes.sourceTransposition) ? "" : minutes.discussion,
      sections: visibleSections,
      motions: visibleMotions.map((m: any) => ({
        ...m,
        movedBy: motionPersonDisplayName(m.movedBy, motionPeople, { memberId: m.movedByMemberId, directorId: m.movedByDirectorId }),
        secondedBy: motionPersonDisplayName(m.secondedBy, motionPeople, { memberId: m.secondedByMemberId, directorId: m.secondedByDirectorId }),
        sectionIndex: publicCopy && m.sectionIndex != null ? indexRemap.get(m.sectionIndex) : m.sectionIndex,
      })) as any,
      decisions: minutes.decisions,
      actionItems: minutes.actionItems as any,
      approvedAt: minutes.approvedAt ?? null,
      nextMeetingAt: minutes.nextMeetingAt ?? null,
      nextMeetingLocation: minutes.nextMeetingLocation ?? null,
      nextMeetingNotes: minutes.nextMeetingNotes ?? null,
      sessionSegments: minutes.sessionSegments ?? null,
      appendices: minutes.appendices ?? null,
      agmDetails: minutes.agmDetails ?? null,
      historicalActions: publicCopy ? null : minutes.historicalActions ?? null,
      quorumEvents: publicCopy ? null : minutes.quorumEvents ?? null,
      sourceVersions: publicCopy ? null : minutes.sourceVersions ?? null,
      draftTranscript: publicCopy ? null : minutes.draftTranscript ?? null,
    },
    styleId: minutesExportStyle,
    options: {
      sourceFidelity: sourceFidelityInExport && !publicCopy,
      publicOnly: publicCopy,
      includeTranscript: includeTranscriptInExport,
      includeActionItems: includeActionItemsInExport,
      includeDiscussionSummary: includeDiscussionSummaryInExport,
      includeApprovalBlock: includeApprovalInExport,
      includeSignatures: includeSignaturesInExport,
      includePlaceholders: includePlaceholdersInExport,
      // Match the agenda editor's numbering preference so exported headings
      // read the same as the on-screen section list.
      agendaNumberingMode: readStoredAgendaNumberingMode(),
      ...(minutes.adoptedExportEvidence ?? minutesEvidenceOptions(minutesSignatures ?? [], meetingConflicts ?? [], meetingProxies ?? [], directors ?? [], displayMotions)),
    },
  });

  const exportPreviewToWord = () => {
    if (!canDownload) return;
    if (formalExportBlockers.length) {
      toast.error("Final minutes export is blocked", formalExportBlockers.join(" "));
      return;
    }
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    void exportWordDocx({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.docx`,
      title: `${meeting.title} - Minutes`,
      bodyHtml,
    });
  };

  const exportPreviewToPdf = async () => {
    if (!canDownload) return;
    if (formalExportBlockers.length) {
      toast.error("Final minutes export is blocked", formalExportBlockers.join(" "));
      return;
    }
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await exportPdfDownload({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.pdf`,
      title: `${meeting.title} - Minutes`,
      bodyHtml,
    });
  };

  const printPreview = async () => {
    if (!canDownload) return;
    if (formalExportBlockers.length) {
      toast.error("Final minutes export is blocked", formalExportBlockers.join(" "));
      return;
    }
    await printPdfDocument({
      title: `${meeting.title} - Minutes`,
      bodyHtml,
    });
  };

  return (
    <div className="page page--wide meeting-preview-page">
      <div className="meeting-preview-page__header">
        <div>
          <Link to={`/app/meetings/${meeting._id}`} className="row muted" style={{ marginBottom: 6, fontSize: "var(--fs-sm)" }}>
            <ArrowLeft size={12} /> Back to meeting
          </Link>
          <h1>{meeting.title}</h1>
          <p>{selectedMinutesExportStyle.label} · {selectedMinutesExportStyle.source}</p>
        </div>
        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
          <button className="btn-action" onClick={() => window.close()}>Close page</button>
          <button className="btn-action btn-action--primary" onClick={exportPreviewToWord} disabled={!canDownload || formalExportBlockers.length > 0}>
            <FileDown size={12} /> Export Word
          </button>
          <button className="btn-action" onClick={exportPreviewToPdf} disabled={!canDownload || formalExportBlockers.length > 0}>
            <FileDown size={12} /> Download PDF
          </button>
          <button className="btn-action" onClick={printPreview} disabled={!canDownload || formalExportBlockers.length > 0}>
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      <div className="meeting-preview-page__layout">
        <aside className="meeting-preview-page__settings">
          {!minutes.approvedAt && <p className="muted">{minutes.sourceMeetingRecord || minutes.sourceTransposition ? "Source record · approval not recorded" : "Draft minutes · approval not recorded"}</p>}
          {formalExportBlockers.length > 0 && (
            <div className="callout callout--warn" role="status">
              <div className="callout__body callout__body--list">
                <strong className="callout__title">Final export blocked</strong>
                <ul className="callout__list">
                  {formalExportBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
                <div className="callout__note">You can still review this preview.</div>
              </div>
            </div>
          )}
          <Field label="Style">
            <Select
              value={minutesExportStyle}
              onChange={(value) => setMinutesExportStyle(value as MinutesExportStyleId)}
              options={MINUTES_EXPORT_STYLES.map((style) => ({ value: style.id, label: style.label }))}
              className="input"
            />
          </Field>
          <div className="col" style={{ gap: 6 }}>
            {(minutes.sourceMeetingRecord || minutes.sourceTransposition) && <label><input type="checkbox" checked={sourceFidelityInExport && !publicCopy} disabled={publicCopy} onChange={(event) => setSourceFidelityInExport(event.target.checked)} /> Complete source record</label>}
            <label><input type="checkbox" checked={includeTranscriptInExport} onChange={(event) => setIncludeTranscriptInExport(event.target.checked)} /> Include transcript</label>
            <label><input type="checkbox" checked={includeActionItemsInExport} onChange={(event) => setIncludeActionItemsInExport(event.target.checked)} /> Include action items</label>
            <label><input type="checkbox" checked={includeDiscussionSummaryInExport} onChange={(event) => setIncludeDiscussionSummaryInExport(event.target.checked)} /> Include discussion summary</label>
            <label><input type="checkbox" checked={includeApprovalInExport} onChange={(event) => setIncludeApprovalInExport(event.target.checked)} /> Include approval block</label>
            <label><input type="checkbox" checked={includeSignaturesInExport} onChange={(event) => setIncludeSignaturesInExport(event.target.checked)} /> Include signature lines</label>
            <label><input type="checkbox" checked={includePlaceholdersInExport} onChange={(event) => setIncludePlaceholdersInExport(event.target.checked)} /> Show placeholders</label>
          </div>
        </aside>
        <div className="minutes-preview minutes-preview--standalone">
          {bodyHtml ? (
            <MinutesDocumentPreview bodyHtml={bodyHtml} />
          ) : (
            <div className="minutes-preview__empty">
              <FileText size={20} aria-hidden="true" />
              <strong>Nothing to render yet.</strong>
              <p className="muted">
                Add agenda items, discussion notes, decisions, motions, or action items
                on this meeting and they'll appear here in the selected export style.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
