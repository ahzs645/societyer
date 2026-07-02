import { useEffect, useState } from "react";
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
import { MinutesDocumentPreview } from "../components/MinutesDocumentPreview";
import { getQuorumSnapshot, personLinkCandidates } from "../components/MeetingDetailSupport";
import { motionPersonDisplayName } from "../../../components/MotionEditor";
import { agendaEntriesFromRecord } from "../lib/meetingDetailHelpers";
import { readStoredAgendaNumberingMode } from "../lib/agendaNumbering";
import { MINUTES_EXPORT_STYLES, type MinutesExportStyleId } from "../lib/minutesExportStyles";
import {
  MINUTES_EXPORT_PREF_PREFIX,
  readStoredExportBool,
  readStoredMinutesStyle,
} from "../lib/minutesExportPrefs";

export function MeetingMinutesPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const agendaRecord = useQuery(api.agendas.getForMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  // Needed to resolve ID-linked movers/seconders to display names, so this
  // page's exports match the meeting-detail Export tab output.
  const members = useQuery(api.members.list, society ? { societyId: society._id } : "skip");
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const [minutesExportStyle, setMinutesExportStyle] = useState<MinutesExportStyleId>(readStoredMinutesStyle);
  const [includeTranscriptInExport, setIncludeTranscriptInExport] = useState(() => readStoredExportBool("includeTranscript", false));
  const [includeActionItemsInExport, setIncludeActionItemsInExport] = useState(() => readStoredExportBool("includeActionItems", true));
  const [includeDiscussionSummaryInExport, setIncludeDiscussionSummaryInExport] = useState(() => readStoredExportBool("includeDiscussionSummary", false));
  const [includeApprovalInExport, setIncludeApprovalInExport] = useState(() => readStoredExportBool("includeApproval", true));
  const [includeSignaturesInExport, setIncludeSignaturesInExport] = useState(() => readStoredExportBool("includeSignatures", true));
  const [includePlaceholdersInExport, setIncludePlaceholdersInExport] = useState(() => readStoredExportBool("includePlaceholders", false));

  useEffect(() => {
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}style`, minutesExportStyle);
  }, [minutesExportStyle]);

  useEffect(() => {
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeTranscript`, String(includeTranscriptInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeActionItems`, String(includeActionItemsInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeDiscussionSummary`, String(includeDiscussionSummaryInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeApproval`, String(includeApprovalInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includeSignatures`, String(includeSignaturesInExport));
    window.localStorage.setItem(`${MINUTES_EXPORT_PREF_PREFIX}includePlaceholders`, String(includePlaceholdersInExport));
  }, [
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

  const agendaTree = agendaEntriesFromRecord(agendaRecord) ?? [];
  const quorumSnapshot = getQuorumSnapshot(minutes, meeting);
  const motionPeople = personLinkCandidates(members, directors);
  const selectedMinutesExportStyle =
    MINUTES_EXPORT_STYLES.find((style) => style.id === minutesExportStyle) ??
    MINUTES_EXPORT_STYLES[0];

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
      agendaItems: agendaTree.filter((entry) => entry.depth === 0).map((entry) => entry.title),
      agendaItemTree: agendaTree,
    },
    minutes: {
      heldAt: minutes.heldAt,
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
      quorumRequired: quorumSnapshot.required,
      quorumSourceLabel: quorumSnapshot.label,
      discussion: minutes.discussion,
      sections: minutes.sections ?? null,
      motions: (minutes.motions as any[]).map((m: any) => ({
        ...m,
        movedBy: motionPersonDisplayName(m.movedBy, motionPeople, { memberId: m.movedByMemberId, directorId: m.movedByDirectorId }),
        secondedBy: motionPersonDisplayName(m.secondedBy, motionPeople, { memberId: m.secondedByMemberId, directorId: m.secondedByDirectorId }),
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
      draftTranscript: minutes.draftTranscript ?? null,
    },
    styleId: minutesExportStyle,
    options: {
      includeTranscript: includeTranscriptInExport,
      includeActionItems: includeActionItemsInExport,
      includeDiscussionSummary: includeDiscussionSummaryInExport,
      includeApprovalBlock: includeApprovalInExport,
      includeSignatures: includeSignaturesInExport,
      includePlaceholders: includePlaceholdersInExport,
      // Match the agenda editor's numbering preference so exported headings
      // read the same as the on-screen section list.
      agendaNumberingMode: readStoredAgendaNumberingMode(),
    },
  });

  const exportPreviewToWord = () => {
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    void exportWordDocx({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.docx`,
      title: `${meeting.title} - Minutes`,
      bodyHtml,
    });
  };

  const exportPreviewToPdf = async () => {
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await exportPdfDownload({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.pdf`,
      title: `${meeting.title} - Minutes`,
      bodyHtml,
    });
  };

  const printPreview = async () => {
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
          <button className="btn-action btn-action--primary" onClick={exportPreviewToWord}>
            <FileDown size={12} /> Export Word
          </button>
          <button className="btn-action" onClick={exportPreviewToPdf}>
            <FileDown size={12} /> Download PDF
          </button>
          <button className="btn-action" onClick={printPreview}>
            <Printer size={12} /> Print
          </button>
        </div>
      </div>

      <div className="meeting-preview-page__layout">
        <aside className="meeting-preview-page__settings">
          <Field label="Style">
            <Select
              value={minutesExportStyle}
              onChange={(value) => setMinutesExportStyle(value as MinutesExportStyleId)}
              options={MINUTES_EXPORT_STYLES.map((style) => ({ value: style.id, label: style.label }))}
              className="input"
            />
          </Field>
          <div className="col" style={{ gap: 6 }}>
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
