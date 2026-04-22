import { useParams, Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../components/Toast";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { formatDate, formatDateTime } from "../lib/format";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowLeft, FileText, Save, Mic, FileDown, Gavel, ClipboardCheck, Upload, ExternalLink, Download, RefreshCw, Printer } from "lucide-react";
import { MotionEditor, Motion } from "../components/MotionEditor";
import { Checkbox } from "../components/Controls";
import {
  MINUTES_EXPORT_STYLES,
  MinutesExportStyleId,
  exportWordDoc,
  getMinutesStyleGaps,
  openPrintableDocument,
  renderMinutesHtml,
} from "../lib/exportWord";
import { redactText, RedactOptions } from "../lib/redactPii";
import { EyeOff } from "lucide-react";
import { SignaturePanel } from "../components/SignaturePanel";
import { LegalGuideInline, LegalGuideTrackList } from "../components/LegalGuide";
import { getLegalGuideRules, resolveJurisdictionCode } from "../lib/jurisdictionGuideTracks";

type StructuredMinutesEdit = {
  chairName: string;
  secretaryName: string;
  recorderName: string;
  calledToOrderAt: string;
  adjournedAt: string;
  remoteUrl: string;
  remoteMeetingId: string;
  remotePasscode: string;
  remoteInstructions: string;
  detailedAttendance: string;
  sections: string;
  nextMeetingAt: string;
  nextMeetingLocation: string;
  nextMeetingNotes: string;
  sessionSegments: string;
  appendices: string;
  financialStatementsPresented: boolean;
  financialStatementsNotes: string;
  directorElectionNotes: string;
  directorAppointments: string;
  specialResolutionExhibits: string;
};

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const meetingPackage = useQuery(api.meetingMaterials.packageForMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const sourceDocumentIds = ((minutes as any)?.sourceDocumentIds ?? []) as Id<"documents">[];
  const sourceDocuments = useQuery(
    api.documents.getMany,
    sourceDocumentIds.length > 0 ? { ids: sourceDocumentIds } : "skip",
  );
  const transcriptRecord = useQuery(
    api.transcripts.getByMeeting,
    id ? { meetingId: id as Id<"meetings"> } : "skip",
  );
  const directors = useQuery(
    api.directors.list,
    society ? { societyId: society._id } : "skip",
  );
  const members = useQuery(
    api.members.list,
    society ? { societyId: society._id } : "skip",
  );
  const allDocuments = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const motionPeople = personLinkCandidates(members, directors);
  const directorNames = (directors ?? []).flatMap((d: any) => [`${d.firstName} ${d.lastName}`, ...(Array.isArray(d.aliases) ? d.aliases : [])]);
  const generate = useAction(api.minutes.generateDraft);
  const updateMeeting = useMutation(api.meetings.update);
  const attachMeetingMaterial = useMutation(api.meetingMaterials.attach);
  const removeMeetingMaterial = useMutation(api.meetingMaterials.remove);
  const backfillMeetingQuorum = useMutation(api.meetings.backfillQuorumSnapshot);
  const updateMinutes = useMutation(api.minutes.update);
  const backfillMinutesQuorum = useMutation(api.minutes.backfillQuorumSnapshot);
  const saveTranscriptText = useMutation(api.transcripts.saveText);
  const importVtt = useMutation(api.transcripts.importVtt);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const runPipeline = useAction(api.transcripts.runPipeline);
  const transcriptionJob = useQuery(
    api.transcripts.jobForMeeting,
    id ? { meetingId: id as Id<"meetings"> } : "skip",
  );
  const toast = useToast();
  const vttInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [transcriptEdit, setTranscriptEdit] = useState<string | null>(null);
  const [agendaEdit, setAgendaEdit] = useState<string | null>(null);
  const [attendanceEdit, setAttendanceEdit] = useState<{
    attendees: string;
    absent: string;
    quorumMet: boolean;
  } | null>(null);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [structuredEdit, setStructuredEdit] = useState<StructuredMinutesEdit | null>(null);
  const [minutesExportStyle, setMinutesExportStyle] = useState<MinutesExportStyleId>("standard");
  const [includeTranscriptInExport, setIncludeTranscriptInExport] = useState(true);
  const [includeActionItemsInExport, setIncludeActionItemsInExport] = useState(true);
  const [includeApprovalInExport, setIncludeApprovalInExport] = useState(true);
  const [includeSignaturesInExport, setIncludeSignaturesInExport] = useState(true);
  const [includePlaceholdersInExport, setIncludePlaceholdersInExport] = useState(false);
  const [materialDraft, setMaterialDraft] = useState<any | null>(null);
  const [joinEdit, setJoinEdit] = useState<any | null>(null);

  useEffect(() => {
    if (!meeting) return;
    if (meeting.quorumComputedAtISO && meeting.quorumSourceLabel) return;
    void backfillMeetingQuorum({ id: meeting._id }).catch(() => undefined);
  }, [backfillMeetingQuorum, meeting?._id, meeting?.quorumComputedAtISO, meeting?.quorumSourceLabel]);

  useEffect(() => {
    if (!minutes) return;
    if (minutes.quorumComputedAtISO && minutes.quorumSourceLabel && minutes.quorumRequired != null) return;
    void backfillMinutesQuorum({ id: minutes._id }).catch(() => undefined);
  }, [backfillMinutesQuorum, minutes?._id, minutes?.quorumComputedAtISO, minutes?.quorumRequired, minutes?.quorumSourceLabel]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!meeting) return <div className="page">Loading…</div>;

  const agenda = parseAgenda(meeting.agendaJson);
  const minutesSourceExternalIds = sourceExternalIdsForMinutes(minutes);
  const linkedSourceCount = (sourceDocuments ?? []).length || minutesSourceExternalIds.length;
  const minutesDraftTranscript = minutes?.draftTranscript ?? "";
  const minutesDraftMetadata = parseDocumentMetadata(minutesDraftTranscript);
  const minutesDraftIsImportMetadata = isImportTranscriptMetadata(minutesDraftMetadata);
  const transcriptOnFile = transcriptRecord?.text ?? (minutesDraftIsImportMetadata ? "" : minutesDraftTranscript);
  const importNote = minutesDraftIsImportMetadata ? importTranscriptNote(minutesDraftMetadata) : null;
  const transcriptProvider = transcriptOnFile
    ? transcriptRecord?.provider ?? (minutesDraftTranscript ? "manual" : null)
    : null;
  const quorumSnapshot = getQuorumSnapshot(minutes, meeting);
  const legalGuideDateISO = minutes?.heldAt ?? meeting.scheduledAt;
  const quorumLegalGuides = getLegalGuideRules({
    jurisdictionCode: resolveJurisdictionCode(society),
    dateISO: legalGuideDateISO,
    topics: ["quorum", "model_bylaws_quorum"],
  });
  const selectedMinutesExportStyle =
    MINUTES_EXPORT_STYLES.find((style) => style.id === minutesExportStyle) ??
    MINUTES_EXPORT_STYLES[0];
  const minutesExportGaps = minutes
    ? getMinutesStyleGaps({
        styleId: minutesExportStyle,
        meeting: {
          title: meeting.title,
          type: meeting.type,
          scheduledAt: meeting.scheduledAt,
          location: meeting.location ?? null,
          electronic: !!meeting.electronic,
          noticeSentAt: meeting.noticeSentAt ?? null,
          agendaItems: agenda,
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
          motions: minutes.motions as any,
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
      })
    : [];
  const transcriptStatusTone =
    transcriptionJob?.status === "complete"
      ? "success"
      : transcriptionJob?.status === "failed"
      ? "danger"
      : "warn";
  const packageMaterials = meetingPackage?.materials ?? [];
  const packageTasks = meetingPackage?.tasks ?? [];
  const openPackageTasks = packageTasks.filter((task: any) => task.status !== "Done");
  const joinDetails = getMeetingJoinDetails(meeting, minutes);

  const runGenerate = async () => {
    const sourceTranscript = transcript.trim() || transcriptOnFile.trim();
    if (!sourceTranscript) return;
    setBusy(true);
    try {
      await generate({ meetingId: meeting._id, transcript: sourceTranscript });
      setTranscript("");
    } finally {
      setBusy(false);
    }
  };

  const uploadAudioAndRun = async (draftMinutes: boolean) => {
    if (!audioFile) {
      toast.error("Choose an audio or video file first.");
      return;
    }
    setPipelineBusy(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": audioFile.type || "application/octet-stream" },
        body: audioFile,
      });
      if (!uploadRes.ok) throw new Error("Audio upload failed.");
      const { storageId } = await uploadRes.json();
      await runPipeline({
        societyId: meeting.societyId,
        meetingId: meeting._id,
        storageId,
        sourceFileName: audioFile.name,
        sourceMimeType: audioFile.type || undefined,
        draftMinutes,
      });
      setAudioFile(null);
      if (audioInputRef.current) audioInputRef.current.value = "";
      toast.success(draftMinutes ? "Transcribed and drafted minutes." : "Transcript saved from audio.");
    } catch (err: any) {
      toast.error(err?.message ?? "Pipeline failed");
    } finally {
      setPipelineBusy(false);
    }
  };

  const markHeld = () => updateMeeting({ id: meeting._id, patch: { status: "Held" } });

  const minutesRenderPayload = (redact?: (value: string) => string) => {
    if (!minutes) return null;
    const tx = (value?: string | null) => (value && redact ? redact(value) : value);
    return {
      heldAt: minutes.heldAt,
      chairName: tx(minutes.chairName),
      secretaryName: tx(minutes.secretaryName),
      recorderName: tx(minutes.recorderName),
      calledToOrderAt: minutes.calledToOrderAt ?? null,
      adjournedAt: minutes.adjournedAt ?? null,
      remoteParticipation: redact
        ? {
            ...(minutes.remoteParticipation ?? {}),
            instructions: tx(minutes.remoteParticipation?.instructions),
          }
        : minutes.remoteParticipation ?? null,
      detailedAttendance: (minutes.detailedAttendance ?? []).map((row: any) => ({
        ...row,
        name: tx(row.name),
        roleTitle: tx(row.roleTitle),
        affiliation: tx(row.affiliation),
        memberIdentifier: tx(row.memberIdentifier),
        proxyFor: tx(row.proxyFor),
        notes: tx(row.notes),
      })),
      attendees: redact ? minutes.attendees.map(redact) : minutes.attendees,
      absent: redact ? minutes.absent.map(redact) : minutes.absent,
      quorumMet: minutes.quorumMet,
      quorumRequired: quorumSnapshot.required,
      quorumSourceLabel: quorumSnapshot.label,
      discussion: tx(minutes.discussion) ?? "",
      sections: (minutes.sections ?? []).map((section: any) => ({
        ...section,
        presenter: tx(section.presenter),
        discussion: tx(section.discussion),
        decisions: (section.decisions ?? []).map((value: string) => tx(value) ?? ""),
        actionItems: (section.actionItems ?? []).map((item: any) => ({
          ...item,
          text: tx(item.text) ?? "",
          assignee: tx(item.assignee),
        })),
      })),
      motions: (minutes.motions as any[]).map((m) => ({
        ...m,
        text: tx(m.text) ?? "",
        movedBy: tx(m.movedBy),
        secondedBy: tx(m.secondedBy),
      })),
      decisions: redact ? minutes.decisions.map(redact) : minutes.decisions,
      actionItems: (minutes.actionItems as any[]).map((a) => ({
        ...a,
        text: tx(a.text) ?? "",
        assignee: tx(a.assignee),
      })),
      approvedAt: minutes.approvedAt ?? null,
      nextMeetingAt: minutes.nextMeetingAt ?? null,
      nextMeetingLocation: tx(minutes.nextMeetingLocation),
      nextMeetingNotes: tx(minutes.nextMeetingNotes),
      sessionSegments: (minutes.sessionSegments ?? []).map((segment: any) => ({
        ...segment,
        title: tx(segment.title),
        notes: tx(segment.notes),
      })),
      appendices: (minutes.appendices ?? []).map((row: any) => ({
        ...row,
        title: tx(row.title) ?? "",
        type: tx(row.type),
        reference: tx(row.reference),
        notes: tx(row.notes),
      })),
      agmDetails: minutes.agmDetails
        ? {
            ...minutes.agmDetails,
            financialStatementsNotes: tx(minutes.agmDetails.financialStatementsNotes),
            directorElectionNotes: tx(minutes.agmDetails.directorElectionNotes),
            directorAppointments: (minutes.agmDetails.directorAppointments ?? []).map((row: any) => ({
              ...row,
              name: tx(row.name) ?? "",
              roleTitle: tx(row.roleTitle),
              affiliation: tx(row.affiliation),
              notes: tx(row.notes),
            })),
            specialResolutionExhibits: (minutes.agmDetails.specialResolutionExhibits ?? []).map((row: any) => ({
              ...row,
              title: tx(row.title) ?? "",
              reference: tx(row.reference),
              notes: tx(row.notes),
            })),
          }
        : null,
      draftTranscript: redact ? null : minutes.draftTranscript ?? null,
    };
  };

  const renderExportBody = (redact?: (value: string) => string) => {
    const payload = minutesRenderPayload(redact);
    if (!payload) return "";
    return renderMinutesHtml({
      society: { name: society.name, incorporationNumber: society.incorporationNumber ?? null },
      meeting: {
        title: meeting.title,
        type: meeting.type,
        scheduledAt: meeting.scheduledAt,
        location: meeting.location ?? null,
        electronic: !!meeting.electronic,
        noticeSentAt: meeting.noticeSentAt ?? null,
        agendaItems: agenda,
      },
      minutes: payload,
      styleId: minutesExportStyle,
      options: {
        includeTranscript: redact ? false : includeTranscriptInExport,
        includeActionItems: includeActionItemsInExport,
        includeApprovalBlock: includeApprovalInExport,
        includeSignatures: includeSignaturesInExport,
        includePlaceholders: includePlaceholdersInExport,
      },
    });
  };

  const exportToWord = () => {
    if (!meeting || !minutes || !society) return;
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const bodyHtml = renderExportBody();
    exportWordDoc({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.doc`,
      title: `${meeting.title} — Minutes`,
      bodyHtml,
    });
    toast.success("Minutes exported", "Opens in Word, Pages, or Google Docs.");
  };

  const exportToPdf = () => {
    if (!meeting || !minutes || !society) return;
    const opened = openPrintableDocument({
      title: `${meeting.title} — Minutes`,
      bodyHtml: renderExportBody(),
    });
    if (opened) toast.success("Printable minutes opened", "Use the print dialog to save as PDF.");
    else toast.error("Popup blocked", "Allow popups for this site to open the printable PDF view.");
  };

  const exportPublicMinutes = () => {
    if (!meeting || !minutes || !society) return;
    const pii = redactOpts();
    const redact = (s: string) => redactText(s, pii);
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const bodyHtml = renderExportBody(redact);
    exportWordDoc({
      filename: `${safe}-public-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.doc`,
      title: `${meeting.title} — Public minutes`,
      bodyHtml,
    });
    toast.success("Public minutes exported", "Emails, phones, addresses & names redacted.");
  };

  /** Names to scrub: every current member + director. Emails/phones/postal codes use the regex rules. */
  const redactOpts = (): RedactOptions => {
    const names: string[] = [];
    (directors ?? []).forEach((d: any) => addRedactionName(names, `${d.firstName} ${d.lastName}`));
    // Members query isn't loaded on this page by default; use attendees & absent
    // from the minutes as a fallback signal for which names appear in the text.
    if (minutes) {
      addRedactionName(names, minutes.chairName);
      addRedactionName(names, minutes.secretaryName);
      addRedactionName(names, minutes.recorderName);
      minutes.attendees.forEach((n: string) => addRedactionName(names, n));
      minutes.absent.forEach((n: string) => addRedactionName(names, n));
      (minutes.detailedAttendance ?? []).forEach((row: any) => {
        addRedactionName(names, row.name);
        addRedactionName(names, row.proxyFor);
      });
      minutes.actionItems.forEach((item: any) => addRedactionName(names, item.assignee));
      (minutes.sections ?? []).forEach((section: any) => {
        addRedactionName(names, section.presenter);
        namesFromDiscussion(section.discussion ?? "").forEach((n) => addRedactionName(names, n));
      });
      namesFromDiscussion(minutes.discussion).forEach((n) => addRedactionName(names, n));
    }
    return { names: Array.from(new Set(names)), typeLabels: true };
  };

  const saveMotions = (next: Motion[]) =>
    minutes ? updateMinutes({ id: minutes._id, patch: { motions: next } }) : undefined;

  const saveAgenda = async () => {
    const next = parseLines(agendaEdit ?? "");
    await updateMeeting({
      id: meeting._id,
      patch: {
        agendaJson: next.length ? JSON.stringify(next) : undefined,
      },
    });
    setAgendaEdit(null);
    toast.success("Agenda saved");
  };

  const startAttendanceEdit = () => {
    if (!minutes) return;
    setAttendanceEdit({
      attendees: minutes.attendees.join("\n"),
      absent: minutes.absent.join("\n"),
      quorumMet: minutes.quorumMet,
    });
  };

  const saveAttendance = async () => {
    if (!minutes || !attendanceEdit) return;
    const attendees = parseLines(attendanceEdit.attendees);
    const absent = parseLines(attendanceEdit.absent);
    await updateMinutes({
      id: minutes._id,
      patch: { attendees, absent, quorumMet: attendanceEdit.quorumMet },
    });
    await updateMeeting({
      id: meeting._id,
      patch: { attendeeIds: attendees },
    });
    setAttendanceEdit(null);
    toast.success("Attendance saved");
  };

  const startStructuredEdit = () => {
    if (!minutes) return;
    setStructuredEdit(structuredEditFromMinutes(minutes));
  };

  const saveStructuredDetails = async () => {
    if (!minutes || !structuredEdit) return;
    await updateMinutes({
      id: minutes._id,
      patch: structuredPatchFromEdit(structuredEdit),
    });
    setStructuredEdit(null);
    toast.success("Structured minutes details saved");
  };

  const openMaterialDrawer = (agendaLabel?: string) => {
    setMaterialDraft({
      documentId: "",
      agendaLabel: agendaLabel ?? "",
      label: "",
      order: packageMaterials.length + 1,
      requiredForMeeting: true,
      accessLevel: "board",
      notes: "",
    });
  };

  const saveMaterial = async () => {
    if (!materialDraft?.documentId) {
      toast.error("Choose a document to attach.");
      return;
    }
    await attachMeetingMaterial({
      societyId: meeting.societyId,
      meetingId: meeting._id,
      documentId: materialDraft.documentId,
      agendaLabel: materialDraft.agendaLabel || undefined,
      label: materialDraft.label || undefined,
      order: Number(materialDraft.order) || packageMaterials.length + 1,
      requiredForMeeting: !!materialDraft.requiredForMeeting,
      accessLevel: materialDraft.accessLevel || "board",
      notes: materialDraft.notes || undefined,
    });
    setMaterialDraft(null);
    toast.success("Material added to meeting package");
  };

  const startJoinEdit = () => {
    setJoinEdit({
      remoteUrl: meeting.remoteUrl ?? minutes?.remoteParticipation?.url ?? "",
      remoteMeetingId: meeting.remoteMeetingId ?? minutes?.remoteParticipation?.meetingId ?? "",
      remotePasscode: meeting.remotePasscode ?? minutes?.remoteParticipation?.passcode ?? "",
      remoteInstructions: meeting.remoteInstructions ?? minutes?.remoteParticipation?.instructions ?? "",
    });
  };

  const saveJoinDetails = async () => {
    if (!joinEdit) return;
    await updateMeeting({
      id: meeting._id,
      patch: {
        remoteUrl: joinEdit.remoteUrl || undefined,
        remoteMeetingId: joinEdit.remoteMeetingId || undefined,
        remotePasscode: joinEdit.remotePasscode || undefined,
        remoteInstructions: joinEdit.remoteInstructions || undefined,
      },
    });
    setJoinEdit(null);
    toast.success("Meeting link saved");
  };

  const downloadMeetingPack = () => {
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const html = renderMeetingPackHtml({
      meeting,
      agenda,
      materials: packageMaterials,
      tasks: packageTasks,
      minutes,
      joinDetails,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}-meeting-pack.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const transcriptCard = (
    <div className="card meeting-notes-card">
      <div className="card__head">
        <h2 className="card__title">
          <Mic size={14} />
          Transcript / notes
        </h2>
        <span className="card__subtitle">
          {transcriptOnFile
            ? `${transcriptOnFile.length.toLocaleString()} characters on file`
            : "No audio transcript on file"}
        </span>
        {transcriptProvider && <Badge tone="info">{transcriptProvider}</Badge>}
        {transcriptionJob && (
          <Badge tone={transcriptStatusTone}>
            {transcriptionJob.status} ({transcriptionJob.provider})
          </Badge>
        )}
      </div>
      <input
        ref={vttInputRef}
        type="file"
        accept=".vtt,text/vtt"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setSavingTranscript(true);
          try {
            await importVtt({
              societyId: meeting.societyId,
              meetingId: meeting._id,
              vttText: await file.text(),
            });
            toast.success(`Transcript imported from ${file.name}.`);
          } catch (err: any) {
            toast.error(err?.message ?? "VTT import failed");
          } finally {
            setSavingTranscript(false);
            if (vttInputRef.current) vttInputRef.current.value = "";
          }
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,video/*"
        style={{ display: "none" }}
        onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
      />
      <div className="card__body meeting-notes-body">
        {transcriptEdit !== null ? (
          <textarea
            className="textarea meeting-notes-editor"
            value={transcriptEdit}
            onChange={(e) => setTranscriptEdit(e.target.value)}
            placeholder="Add meeting notes or paste the raw transcript here."
          />
        ) : transcriptOnFile ? (
          <pre className="meeting-transcript-preview">{transcriptOnFile}</pre>
        ) : importNote ? (
          <div className="meeting-note">
            <div className="meeting-note__title">Import note</div>
            <p>{importNote}</p>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            No notes added yet.
          </div>
        )}

        <div className="meeting-notes-actions">
          {transcriptEdit === null ? (
            <>
              <button
                className="btn-action"
                disabled={savingTranscript || pipelineBusy}
                onClick={() => setTranscriptEdit(transcriptOnFile)}
              >
                {transcriptOnFile ? "Edit" : "Add notes"}
              </button>
              <button
                className="btn-action"
                disabled={savingTranscript || pipelineBusy}
                onClick={() => vttInputRef.current?.click()}
              >
                <Upload size={12} /> Import VTT
              </button>
              <button
                className="btn-action"
                disabled={savingTranscript || pipelineBusy}
                onClick={() => audioInputRef.current?.click()}
              >
                <Upload size={12} /> {audioFile ? "Change audio" : "Choose audio"}
              </button>
            </>
          ) : (
            <>
              <button className="btn-action" onClick={() => setTranscriptEdit(null)}>
                Cancel
              </button>
              <button
                className="btn-action btn-action--primary"
                disabled={savingTranscript}
                onClick={async () => {
                  setSavingTranscript(true);
                  try {
                    await saveTranscriptText({
                      societyId: meeting.societyId,
                      meetingId: meeting._id,
                      text: transcriptEdit ?? "",
                      provider: "manual",
                    });
                    setTranscriptEdit(null);
                    toast.success((transcriptEdit ?? "").trim() ? "Transcript saved." : "Transcript cleared.");
                  } catch (err: any) {
                    toast.error(err?.message ?? "Transcript save failed");
                  } finally {
                    setSavingTranscript(false);
                  }
                }}
              >
                <Save size={12} /> {savingTranscript ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>

        <div className="meeting-audio-tools">
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            VTT/audio imports are optional.
          </div>
          <div className="meeting-audio-actions">
            {audioFile ? (
              <Badge tone="info">{audioFile.name}</Badge>
            ) : (
              <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>No audio selected.</span>
            )}
            <button className="btn-action" onClick={() => audioInputRef.current?.click()}>
              <Upload size={12} /> {audioFile ? "Change file" : "Choose file"}
            </button>
            <button
              className="btn-action btn-action--primary"
              disabled={!audioFile || pipelineBusy}
              onClick={() => uploadAudioAndRun(false)}
            >
              <Mic size={12} /> {pipelineBusy ? "Transcribing…" : "Transcribe"}
            </button>
            {!minutes && (
              <button
                className="btn-action"
                disabled={!audioFile || pipelineBusy}
                onClick={() => uploadAudioAndRun(true)}
              >
                <Sparkles size={12} /> {pipelineBusy ? "Running…" : "Draft minutes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page page--narrow">
      <Link to="/app/meetings" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All meetings
      </Link>
      <PageHeader
        title={meeting.title}
        subtitle={`${meeting.type} · ${formatDateTime(meeting.scheduledAt)} · ${meeting.location ?? "—"}`}
        actions={
          <>
            <Badge tone={meeting.status === "Held" ? "success" : meeting.status === "Cancelled" ? "danger" : "warn"}>
              {meeting.status}
            </Badge>
            {meeting.status !== "Held" && (
              <button className="btn-action" onClick={markHeld}>Mark held</button>
            )}
            {meeting.type === "AGM" && (
              <Link className="btn-action" to={`/app/meetings/${meeting._id}/agm`}>
                <ClipboardCheck size={12} /> AGM workflow
              </Link>
            )}
            {joinDetails.url && (
              <a className="btn-action" href={joinDetails.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> Join
              </a>
            )}
            <button className="btn-action" onClick={downloadMeetingPack}>
              <Download size={12} /> Meeting pack
            </button>
            {minutes && (
              <button className="btn-action" onClick={exportToWord} title="Download as .doc (opens in Word, Pages, or Google Docs)">
                <FileDown size={12} /> Export to Word
              </button>
            )}
            {minutes && (
              <button className="btn-action" onClick={exportToPdf} title="Open a printable copy you can save as PDF">
                <Printer size={12} /> Print / PDF
              </button>
            )}
            {minutes && (
              <button
                className="btn-action"
                onClick={exportPublicMinutes}
                title="Same export with PII (emails, phones, addresses, names) auto-redacted for public posting"
              >
                <EyeOff size={12} /> Export public copy
              </button>
            )}
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">Meeting package hub</h2>
            <p className="card__subtitle">
              Agenda topics, linked materials, attendees, join details, minutes, and open actions.
            </p>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            <button className="btn-action" onClick={() => openMaterialDrawer()}>
              <FileText size={12} /> Add material
            </button>
            <button className="btn-action" onClick={startJoinEdit}>
              <ExternalLink size={12} /> {joinDetails.url ? "Edit join link" : "Add join link"}
            </button>
            <button className="btn-action btn-action--primary" onClick={downloadMeetingPack}>
              <Download size={12} /> Download pack
            </button>
          </div>
        </div>
        <div className="card__body">
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            <div className="stat">
              <div className="stat__label">Agenda topics</div>
              <div className="stat__value">{agenda.length}</div>
              <div className="stat__sub">editable below</div>
            </div>
            <div className="stat">
              <div className="stat__label">Materials</div>
              <div className="stat__value">{packageMaterials.length}</div>
              <div className="stat__sub">{packageMaterials.filter((m: any) => m.requiredForMeeting).length} required</div>
            </div>
            <div className="stat">
              <div className="stat__label">Attendees</div>
              <div className="stat__value">{minutes?.attendees.length ?? meeting.attendeeIds?.length ?? 0}</div>
              <div className="stat__sub">{minutes ? "from minutes" : "scheduled roster"}</div>
            </div>
            <div className="stat">
              <div className="stat__label">Open actions</div>
              <div className="stat__value">{openPackageTasks.length}</div>
              <div className="stat__sub">linked meeting tasks</div>
            </div>
          </div>

          <div className="two-col">
            <div className="col" style={{ gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>Agenda materials</strong>
                <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Group materials by agenda label</span>
              </div>
              {(agenda.length ? agenda : ["General materials"]).map((topic) => {
                const topicMaterials = packageMaterials.filter((material: any) => (material.agendaLabel || "General materials") === topic);
                return (
                  <div key={topic} className="panel" style={{ padding: 12, borderRadius: 8 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                      <strong>{topic}</strong>
                      <button className="btn btn--ghost btn--sm" onClick={() => openMaterialDrawer(topic)}>
                        Add
                      </button>
                    </div>
                    <div className="col" style={{ gap: 6, marginTop: 8 }}>
                      {topicMaterials.map((material: any) => (
                        <div key={material._id} className="row" style={{ gap: 8 }}>
                          <FileText size={12} />
                          <Link to={`/app/documents/${material.document?._id}`}>{material.label || material.document?.title || "Document"}</Link>
                          {material.requiredForMeeting && <Badge tone="warn">Required</Badge>}
                          <Badge tone="neutral">{material.accessLevel}</Badge>
                          <button
                            className="btn btn--ghost btn--sm"
                            style={{ marginLeft: "auto" }}
                            onClick={() => removeMeetingMaterial({ id: material._id })}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      {topicMaterials.length === 0 && (
                        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No linked materials.</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="col" style={{ gap: 10 }}>
              <div className="panel" style={{ padding: 12, borderRadius: 8 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>Join meeting</strong>
                  {joinDetails.provider && <Badge tone="info">{joinDetails.provider}</Badge>}
                </div>
                {joinDetails.url ? (
                  <div className="col" style={{ gap: 6, marginTop: 8 }}>
                    <a className="btn btn--accent btn--sm" href={joinDetails.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> Join meeting
                    </a>
                    {joinDetails.meetingId && <Detail label="Meeting ID">{joinDetails.meetingId}</Detail>}
                    {joinDetails.passcode && <Detail label="Passcode">{joinDetails.passcode}</Detail>}
                    {joinDetails.instructions && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{joinDetails.instructions}</div>}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>No remote meeting link saved.</div>
                )}
              </div>
              <div className="panel" style={{ padding: 12, borderRadius: 8 }}>
                <strong>Open actions</strong>
                <div className="col" style={{ gap: 6, marginTop: 8 }}>
                  {openPackageTasks.slice(0, 5).map((task: any) => (
                    <Link key={task._id} to="/app/tasks" className="row" style={{ gap: 6 }}>
                      <Badge tone={task.priority === "High" ? "danger" : task.priority === "Medium" ? "warn" : "neutral"}>{task.priority}</Badge>
                      <span>{task.title}</span>
                    </Link>
                  ))}
                  {openPackageTasks.length === 0 && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No open tasks linked to this meeting.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Agenda</h2>
              <span className="card__subtitle">
                {agenda.length ? `${agenda.length} item${agenda.length === 1 ? "" : "s"}` : "No agenda items yet"}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {agendaEdit === null ? (
                  <button className="btn-action" onClick={() => setAgendaEdit(agenda.join("\n"))}>
                    Edit agenda
                  </button>
                ) : (
                  <>
                    <button className="btn-action" onClick={() => setAgendaEdit(null)}>Cancel</button>
                    <button className="btn-action btn-action--primary" onClick={saveAgenda}>
                      <Save size={12} /> Save agenda
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="card__body">
              {agendaEdit !== null ? (
                <Field label="Agenda items" hint="One item per line. These are stored on the meeting record and can be changed without changing the source document.">
                  <textarea
                    className="textarea"
                    rows={Math.max(8, agenda.length + 2)}
                    value={agendaEdit}
                    onChange={(event) => setAgendaEdit(event.target.value)}
                    placeholder="Call to order&#10;Confirm attendance and quorum&#10;Approve agenda"
                  />
                </Field>
              ) : agenda.length > 0 ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {agenda.map((a, i) => <li key={i} style={{ padding: "3px 0" }}>{formatSourceReferences(a)}</li>)}
                </ol>
              ) : (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  Add the meeting agenda here. Imported minutes can use this as an editable reconstruction of the source document's structure.
                </div>
              )}
            </div>
          </div>

          {minutes ? (
              <div className="card">
                <div className="card__head">
                  <h2 className="card__title"><FileText size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />Minutes</h2>
                  <span className="card__subtitle">
                    Quorum {minutes.quorumMet ? "met" : "not met"} · {minutes.attendees.length} present
                    {quorumSnapshot.required != null ? ` / ${quorumSnapshot.required} required` : ""}
                  </span>
                </div>
              <div className="card__body">
                <div className="minutes-section">
                  <h3>Attendance</h3>
                  {attendanceEdit ? (
                    <div className="col" style={{ gap: 12 }}>
                      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                        <Field label="Present" hint="One person per line.">
                          <textarea
                            className="textarea"
                            value={attendanceEdit.attendees}
                            onChange={(event) => setAttendanceEdit({ ...attendanceEdit, attendees: event.target.value })}
                            rows={6}
                          />
                        </Field>
                        <Field label="Absent / regrets" hint="One person per line.">
                          <textarea
                            className="textarea"
                            value={attendanceEdit.absent}
                            onChange={(event) => setAttendanceEdit({ ...attendanceEdit, absent: event.target.value })}
                            rows={6}
                          />
                        </Field>
                      </div>
                      <Checkbox
                        checked={attendanceEdit.quorumMet}
                        onChange={(quorumMet) => setAttendanceEdit({ ...attendanceEdit, quorumMet })}
                        label="Quorum met"
                      />
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="btn-action" onClick={() => setAttendanceEdit(null)}>Cancel</button>
                        <button className="btn-action btn-action--primary" onClick={saveAttendance}>
                          <Save size={12} /> Save attendance
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="col" style={{ gap: 8 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <Badge tone={minutes.quorumMet ? "success" : "warn"}>
                          Quorum {minutes.quorumMet ? "met" : "not met"}
                        </Badge>
                        <Badge tone="info">{minutes.attendees.length} present</Badge>
                        {quorumSnapshot.required != null && (
                          <Badge tone="neutral">{quorumSnapshot.required} required</Badge>
                        )}
                        <Badge tone="neutral">{minutes.absent.length} absent/regrets</Badge>
                        {quorumSnapshot.label && (
                          <span className="muted" style={{ flexBasis: "100%", fontSize: "var(--fs-sm)" }}>
                            Rule: {quorumSnapshot.label}
                          </span>
                        )}
                        <div style={{ flexBasis: "100%" }}>
                          <LegalGuideInline rules={quorumLegalGuides} />
                        </div>
                        <button className="btn-action" onClick={startAttendanceEdit}>
                          Edit attendance
                        </button>
                      </div>
                      <AttendanceDetails
                        present={minutes.attendees}
                        absent={minutes.absent}
                        people={personLinkCandidates(members, directors)}
                      />
                    </div>
                  )}
                </div>

                <div className="minutes-section">
                  <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <h3>Structured details</h3>
                    {structuredEdit ? (
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn-action" onClick={() => setStructuredEdit(null)}>Cancel</button>
                        <button className="btn-action btn-action--primary" onClick={saveStructuredDetails}>
                          <Save size={12} /> Save details
                        </button>
                      </div>
                    ) : (
                      <button className="btn-action" onClick={startStructuredEdit}>Edit details</button>
                    )}
                  </div>
                  {structuredEdit ? (
                    <StructuredMinutesEditor
                      value={structuredEdit}
                      onChange={setStructuredEdit}
                      isAgm={meeting.type === "AGM"}
                    />
                  ) : (
                    <StructuredMinutesSummary minutes={minutes} />
                  )}
                </div>

                <div className="minutes-section">
                  <h3>Discussion</h3>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--text-secondary)" }}>{minutes.discussion}</p>
                </div>

                <div className="minutes-section">
                  <h3>
                    <Gavel size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
                    Motions
                    {minutes.motions.length > 0 && (
                      <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                        · {minutes.motions.filter((m) => m.outcome === "Carried").length} carried
                        {" / "}
                        {minutes.motions.filter((m) => m.outcome === "Defeated").length} defeated
                        {" / "}
                        {minutes.motions.filter((m) => m.outcome === "Tabled").length} tabled
                      </span>
                    )}
                  </h3>
                  <MotionEditor
                    motions={minutes.motions as Motion[]}
                    directorNames={directorNames}
                    people={motionPeople}
                    onChange={saveMotions}
                  />
                </div>

                <div className="minutes-section">
                  <h3>Decisions</h3>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {minutes.decisions.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>

                <div className="minutes-section">
                  <h3>Action items</h3>
                  <div className="action-list">
                    {minutes.actionItems.map((a, i) => (
                      <div className="action-item" key={i}>
                        <Checkbox checked={!!a.done} onChange={() => {}} bare disabled />
                        <span className={`action-item__text${a.done ? " done" : ""}`}>{a.text}</span>
                        {a.assignee && <Badge>{a.assignee}</Badge>}
                        {a.dueDate && <span className="action-item__due">{a.dueDate}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <SignaturePanel
                  societyId={meeting.societyId}
                  entityType="minutes"
                  entityId={minutes._id}
                  title="Minutes signatures"
                />
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Generate minutes</h2>
                <span className="card__subtitle">
                  {transcriptOnFile
                    ? "Use the saved transcript below, or paste rough notes to override it for this draft."
                    : "Paste a rough transcript or notes — the AI helper will structure them."}
                </span>
              </div>
              <div className="card__body">
                <Field label="Raw transcript / rough notes">
                  <textarea
                    className="textarea"
                    style={{ minHeight: 200 }}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    placeholder="e.g.&#10;Meeting opened at 7:02pm by Elena. Quorum met.&#10;Treasurer reported Q1 revenue up 8%.&#10;Motion by Jordan to approve Q1 statements, seconded by Priya. Carried 6-0.&#10;Action: Amara to draft fundraising plan by March 1."
                  />
                </Field>
                <button
                  className="btn btn--accent"
                  disabled={(!transcript.trim() && !transcriptOnFile.trim()) || busy}
                  onClick={runGenerate}
                >
                  <Sparkles size={14} /> {busy ? "Generating…" : transcriptOnFile && !transcript.trim() ? "Generate from saved transcript" : "Generate draft minutes"}
                </button>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
                  Demo uses a heuristic parser. Wire to an LLM in <code className="mono">convex/minutes.ts</code> for production.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head"><h2 className="card__title">Meeting details</h2></div>
            <div className="card__body col">
              <Detail label="Type"><Badge tone={meeting.type === "AGM" ? "accent" : "info"}>{meeting.type}</Badge></Detail>
              <Detail label="Scheduled">{formatDateTime(meeting.scheduledAt)}</Detail>
              <Detail label="Location">{meeting.location ?? "—"}</Detail>
              <Detail label="Electronic">{meeting.electronic ? "Yes" : "No"}</Detail>
              <Detail label="Notice sent">{meeting.noticeSentAt ?? "—"}</Detail>
              <Detail label="Quorum required">{quorumSnapshot.required ?? meeting.quorumRequired ?? "—"}</Detail>
              <Detail label="Quorum rule">{quorumSnapshot.label || meeting.quorumSourceLabel || "—"}</Detail>
              <Detail label="Legal guide">
                <LegalGuideInline rules={quorumLegalGuides} />
              </Detail>
            </div>
          </div>

          {minutes && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Minutes export</h2>
                <span className="card__subtitle">{selectedMinutesExportStyle.source}</span>
              </div>
              <div className="card__body col" style={{ gap: 12 }}>
                <Field label="Style">
                  <select
                    className="input"
                    value={minutesExportStyle}
                    onChange={(event) => setMinutesExportStyle(event.target.value as MinutesExportStyleId)}
                  >
                    {MINUTES_EXPORT_STYLES.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
                  {selectedMinutesExportStyle.tone}
                </p>
                <div className="col" style={{ gap: 6 }}>
                  <Checkbox
                    checked={includeTranscriptInExport}
                    onChange={setIncludeTranscriptInExport}
                    label="Include transcript"
                  />
                  <Checkbox
                    checked={includeActionItemsInExport}
                    onChange={setIncludeActionItemsInExport}
                    label="Include action items"
                  />
                  <Checkbox
                    checked={includeApprovalInExport}
                    onChange={setIncludeApprovalInExport}
                    label="Include approval block"
                  />
                  <Checkbox
                    checked={includeSignaturesInExport}
                    onChange={setIncludeSignaturesInExport}
                    label="Include signature lines"
                  />
                  <Checkbox
                    checked={includePlaceholdersInExport}
                    onChange={setIncludePlaceholdersInExport}
                    label="Show not-recorded placeholders"
                  />
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button className="btn-action btn-action--primary" onClick={exportToWord}>
                    <FileDown size={12} /> Export Word
                  </button>
                  <button className="btn-action" onClick={exportToPdf}>
                    <Printer size={12} /> Print / PDF
                  </button>
                  <button className="btn-action" onClick={exportPublicMinutes}>
                    <EyeOff size={12} /> Public copy
                  </button>
                </div>
                <div className="minutes-export-gaps">
                  {minutesExportGaps.map((gap) => (
                    <div key={`${gap.status}-${gap.label}`} className="minutes-export-gap">
                      <div className="row" style={{ gap: 6, justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong>{gap.label}</strong>
                        <Badge tone={gapStatusTone(gap.status)}>{gapStatusLabel(gap.status)}</Badge>
                      </div>
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{gap.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {quorumLegalGuides.length > 0 && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Quorum guide tracks</h2>
                <span className="card__subtitle">{formatDate(legalGuideDateISO)}</span>
              </div>
              <div className="card__body">
                <LegalGuideTrackList
                  rules={quorumLegalGuides}
                  jurisdictionCode={resolveJurisdictionCode(society)}
                  dateISO={legalGuideDateISO}
                />
              </div>
            </div>
          )}

          {minutes && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Source documents</h2>
                <span className="card__subtitle">
                  {linkedSourceCount ? `${linkedSourceCount} linked` : "None linked"}
                </span>
              </div>
              <div className="card__body source-document-list">
                {(sourceDocuments ?? []).map((document: any) => (
                  <SourceDocumentRow
                    key={document._id}
                    document={document}
                    societyId={meeting.societyId}
                  />
                ))}
                {(sourceDocuments ?? []).length === 0 && minutesSourceExternalIds.map((externalId) => (
                  <div key={externalId} className="source-document source-document--placeholder">
                    <FileText className="source-document__icon" size={14} />
                    <div className="source-document__main">
                      <div className="source-document__title">{sourceLabelForExternalId(externalId)}</div>
                      <div className="source-document__meta">
                        <Badge tone={externalId.startsWith("paperless:") ? "info" : "neutral"}>Source reference</Badge>
                        <Badge tone="warn">No local copy</Badge>
                      </div>
                    </div>
                  </div>
                ))}
                {(sourceDocuments ?? []).length === 0 && minutesSourceExternalIds.length === 0 && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    Link source documents by importing or backfilling the meeting-minute source records.
                  </div>
                )}
              </div>
            </div>
          )}

          {transcriptCard}

          {meeting.type === "AGM" && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">AGM checklist</h2></div>
              <div className="card__body">
                <Check ok={!!meeting.noticeSentAt}>Notice sent 14–60 days in advance</Check>
                <Check ok={meeting.status === "Held"}>Meeting held</Check>
                <Check ok={!!minutes}>Minutes recorded</Check>
                <Check ok={!!minutes?.approvedAt}>Minutes approved at next meeting</Check>
                <Check ok={false}>Annual report filed within 30 days</Check>
              </div>
            </div>
          )}
        </div>
      </div>

      <Drawer
        open={!!materialDraft}
        onClose={() => setMaterialDraft(null)}
        title="Attach meeting material"
        footer={
          <>
            <button className="btn" onClick={() => setMaterialDraft(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveMaterial}>Attach</button>
          </>
        }
      >
        {materialDraft && (
          <div>
            <Field label="Document">
              <select
                className="input"
                value={materialDraft.documentId}
                onChange={(event) => setMaterialDraft({ ...materialDraft, documentId: event.target.value })}
              >
                <option value="">Choose document</option>
                {(allDocuments ?? []).map((document: any) => (
                  <option key={document._id} value={document._id}>{document.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Agenda topic">
              <select
                className="input"
                value={materialDraft.agendaLabel}
                onChange={(event) => setMaterialDraft({ ...materialDraft, agendaLabel: event.target.value })}
              >
                <option value="">General materials</option>
                {agenda.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
            <Field label="Label">
              <input className="input" value={materialDraft.label} onChange={(event) => setMaterialDraft({ ...materialDraft, label: event.target.value })} placeholder="Optional display label" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Order">
                <input className="input" type="number" min="1" value={materialDraft.order} onChange={(event) => setMaterialDraft({ ...materialDraft, order: event.target.value })} />
              </Field>
              <Field label="Access">
                <select className="input" value={materialDraft.accessLevel} onChange={(event) => setMaterialDraft({ ...materialDraft, accessLevel: event.target.value })}>
                  <option value="board">Board</option>
                  <option value="committee">Committee</option>
                  <option value="members">Members</option>
                  <option value="public">Public</option>
                  <option value="restricted">Restricted</option>
                </select>
              </Field>
            </div>
            <Checkbox
              checked={!!materialDraft.requiredForMeeting}
              onChange={(requiredForMeeting) => setMaterialDraft({ ...materialDraft, requiredForMeeting })}
              label="Required review for this meeting"
            />
            <Field label="Notes">
              <textarea className="textarea" rows={3} value={materialDraft.notes} onChange={(event) => setMaterialDraft({ ...materialDraft, notes: event.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!joinEdit}
        onClose={() => setJoinEdit(null)}
        title="Meeting join details"
        footer={
          <>
            <button className="btn" onClick={() => setJoinEdit(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveJoinDetails}>Save</button>
          </>
        }
      >
        {joinEdit && (
          <div>
            <Field label="Remote meeting URL">
              <input className="input" value={joinEdit.remoteUrl} onChange={(event) => setJoinEdit({ ...joinEdit, remoteUrl: event.target.value })} placeholder="https://..." />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Meeting ID">
                <input className="input" value={joinEdit.remoteMeetingId} onChange={(event) => setJoinEdit({ ...joinEdit, remoteMeetingId: event.target.value })} />
              </Field>
              <Field label="Passcode">
                <input className="input" value={joinEdit.remotePasscode} onChange={(event) => setJoinEdit({ ...joinEdit, remotePasscode: event.target.value })} />
              </Field>
            </div>
            <Field label="Instructions">
              <textarea className="textarea" rows={3} value={joinEdit.remoteInstructions} onChange={(event) => setJoinEdit({ ...joinEdit, remoteInstructions: event.target.value })} />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function AttendanceDetails({
  present,
  absent,
  people,
}: {
  present: string[];
  absent: string[];
  people: PersonLinkCandidate[];
}) {
  const rows = [
    ...present.map((name) => ({ status: "Present", ...parseAttendanceName(name) })),
    ...absent.map((name) => ({ status: "Absent / regrets", ...parseAttendanceName(name) })),
  ];

  if (rows.length === 0) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        No attendance names recorded yet.
      </div>
    );
  }

  return (
    <details className="attendance-details">
      <summary>
        <span>Attendance list</span>
        <span className="muted">
          {present.length} present · {absent.length} absent/regrets
        </span>
      </summary>
      <div className="attendance-table-wrap">
        <table className="attendance-table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.status}-${row.name}-${index}`}>
                <td>{row.status}</td>
                <td><LinkedPersonName name={row.name} people={people} /></td>
                <td>{row.role || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function StructuredMinutesSummary({ minutes }: { minutes: any }) {
  const chips = [
    minutes.chairName && `Chair: ${minutes.chairName}`,
    minutes.secretaryName && `Secretary: ${minutes.secretaryName}`,
    minutes.recorderName && `Recorder: ${minutes.recorderName}`,
    minutes.calledToOrderAt && `Called: ${minutes.calledToOrderAt}`,
    minutes.adjournedAt && `Adjourned: ${minutes.adjournedAt}`,
    minutes.remoteParticipation?.url && "Remote link",
    minutes.remoteParticipation?.meetingId && `Meeting ID: ${minutes.remoteParticipation.meetingId}`,
    (minutes.detailedAttendance ?? []).length ? `${minutes.detailedAttendance.length} detailed attendance rows` : "",
    (minutes.sections ?? []).length ? `${minutes.sections.length} minute sections` : "",
    (minutes.sessionSegments ?? []).length ? `${minutes.sessionSegments.length} session segments` : "",
    (minutes.appendices ?? []).length ? `${minutes.appendices.length} appendices` : "",
    minutes.nextMeetingAt && `Next: ${minutes.nextMeetingAt}`,
    minutes.agmDetails?.financialStatementsPresented && "Financials presented",
    (minutes.agmDetails?.directorAppointments ?? []).length ? `${minutes.agmDetails.directorAppointments.length} director appointments` : "",
  ].filter(Boolean);

  if (!chips.length) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        No optional structured details recorded yet. Add these to generate richer minutes styles and omit blank sections automatically.
      </div>
    );
  }

  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {chips.map((chip) => <Badge key={String(chip)} tone="neutral">{chip}</Badge>)}
    </div>
  );
}

function StructuredMinutesEditor({
  value,
  onChange,
  isAgm,
}: {
  value: StructuredMinutesEdit;
  onChange: (value: StructuredMinutesEdit) => void;
  isAgm: boolean;
}) {
  const patch = (diff: Partial<StructuredMinutesEdit>) => onChange({ ...value, ...diff });
  return (
    <div className="structured-minutes-editor">
      <div className="structured-minutes-editor__grid">
        <Field label="Chair">
          <input className="input" value={value.chairName} onChange={(event) => patch({ chairName: event.target.value })} />
        </Field>
        <Field label="Secretary">
          <input className="input" value={value.secretaryName} onChange={(event) => patch({ secretaryName: event.target.value })} />
        </Field>
        <Field label="Recorder / minute-taker">
          <input className="input" value={value.recorderName} onChange={(event) => patch({ recorderName: event.target.value })} />
        </Field>
        <Field label="Called to order" hint="ISO date/time or source text such as 5:32 pm.">
          <input className="input" value={value.calledToOrderAt} onChange={(event) => patch({ calledToOrderAt: event.target.value })} />
        </Field>
        <Field label="Adjourned" hint="ISO date/time or source text.">
          <input className="input" value={value.adjournedAt} onChange={(event) => patch({ adjournedAt: event.target.value })} />
        </Field>
        <Field label="Next meeting">
          <input className="input" value={value.nextMeetingAt} onChange={(event) => patch({ nextMeetingAt: event.target.value })} />
        </Field>
      </div>

      <div className="structured-minutes-editor__grid">
        <Field label="Remote URL">
          <input className="input" value={value.remoteUrl} onChange={(event) => patch({ remoteUrl: event.target.value })} />
        </Field>
        <Field label="Remote meeting ID">
          <input className="input" value={value.remoteMeetingId} onChange={(event) => patch({ remoteMeetingId: event.target.value })} />
        </Field>
        <Field label="Remote passcode">
          <input className="input" value={value.remotePasscode} onChange={(event) => patch({ remotePasscode: event.target.value })} />
        </Field>
      </div>

      <Field label="Remote instructions">
        <textarea className="textarea" rows={2} value={value.remoteInstructions} onChange={(event) => patch({ remoteInstructions: event.target.value })} />
      </Field>

      <Field label="Detailed attendance" hint="One row per person: status | name | role | affiliation | member ID | proxy for | quorum yes/no | notes">
        <textarea className="textarea" rows={5} value={value.detailedAttendance} onChange={(event) => patch({ detailedAttendance: event.target.value })} />
      </Field>

      <Field label="Per-agenda sections" hint="One row per section: type | title | presenter | discussion | report yes/no | decisions ; separated | action items ; separated">
        <textarea className="textarea" rows={5} value={value.sections} onChange={(event) => patch({ sections: event.target.value })} />
      </Field>

      <Field label="Session segments" hint="One row per segment: type | title | started | ended | notes">
        <textarea className="textarea" rows={3} value={value.sessionSegments} onChange={(event) => patch({ sessionSegments: event.target.value })} />
      </Field>

      <Field label="Appendices / attachments" hint="One row: title | type | reference | notes">
        <textarea className="textarea" rows={3} value={value.appendices} onChange={(event) => patch({ appendices: event.target.value })} />
      </Field>

      <div className="structured-minutes-editor__grid">
        <Field label="Next meeting location">
          <input className="input" value={value.nextMeetingLocation} onChange={(event) => patch({ nextMeetingLocation: event.target.value })} />
        </Field>
        <Field label="Next meeting notes">
          <input className="input" value={value.nextMeetingNotes} onChange={(event) => patch({ nextMeetingNotes: event.target.value })} />
        </Field>
      </div>

      {isAgm && (
        <>
          <Checkbox
            checked={value.financialStatementsPresented}
            onChange={(financialStatementsPresented) => patch({ financialStatementsPresented })}
            label="Financial statements were presented"
          />
          <Field label="Financial statement notes">
            <textarea className="textarea" rows={3} value={value.financialStatementsNotes} onChange={(event) => patch({ financialStatementsNotes: event.target.value })} />
          </Field>
          <Field label="Director election / appointment notes">
            <textarea className="textarea" rows={3} value={value.directorElectionNotes} onChange={(event) => patch({ directorElectionNotes: event.target.value })} />
          </Field>
          <Field label="Director appointments" hint="One row: status | name | role | affiliation | term | consent yes/no | votes | elected yes/no | notes">
            <textarea className="textarea" rows={4} value={value.directorAppointments} onChange={(event) => patch({ directorAppointments: event.target.value })} />
          </Field>
          <Field label="Special-resolution exhibits" hint="One row: title | reference | notes">
            <textarea className="textarea" rows={3} value={value.specialResolutionExhibits} onChange={(event) => patch({ specialResolutionExhibits: event.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

type PersonLinkCandidate = {
  id: string;
  name: string;
  aliases: string[];
  kind: "member" | "director";
};

function personLinkCandidates(members: any[] | undefined, directors: any[] | undefined): PersonLinkCandidate[] {
  return [
    ...(members ?? []).map((member: any) => ({
      id: String(member._id),
      name: `${member.firstName} ${member.lastName}`.trim(),
      aliases: Array.isArray(member.aliases) ? member.aliases : [],
      kind: "member" as const,
    })),
    ...(directors ?? []).map((director: any) => ({
      id: String(director._id),
      name: `${director.firstName} ${director.lastName}`.trim(),
      aliases: Array.isArray(director.aliases) ? director.aliases : [],
      kind: "director" as const,
    })),
  ];
}

function LinkedPersonName({ name, people }: { name: string; people: PersonLinkCandidate[] }) {
  const key = normalizePersonName(name);
  const match = people.find((person) =>
    [person.name, ...person.aliases].some((candidate) => normalizePersonName(candidate) === key),
  );
  if (!match) return <span>{name}</span>;
  return (
    <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      <Link to={match.kind === "director" ? "/app/directors" : "/app/members"}>{name}</Link>
      <Badge tone="success">Linked</Badge>
    </span>
  );
}

function normalizePersonName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseAttendanceName(value: string) {
  const [name, ...roleParts] = value.split(/\s+-\s+/);
  return {
    name: name.trim() || value,
    role: roleParts.join(" - ").trim(),
  };
}

function SourceDocumentRow({
  document,
  societyId,
}: {
  document: any;
  societyId: Id<"societies">;
}) {
  const metadata = parseDocumentMetadata(document.content);
  const externalId = sourceExternalIdFromDocument(document, metadata);
  const sourceLabel = sourceLabelForExternalId(externalId);
  const downloadUrl = useQuery(
    api.files.getUrl,
    document.storageId ? { storageId: document.storageId } : "skip",
  );
  const pullSourceDocument = useAction(api.paperless.pullSourceDocument);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canPull = !!externalId?.match(/^paperless:\d+$/i);
  const hasActions = !!downloadUrl || (!!document.url && !downloadUrl) || canPull;

  const pull = async () => {
    if (!canPull) return;
    setBusy(true);
    try {
      const result = await pullSourceDocument({
        societyId,
        documentId: document._id,
        externalId,
      });
      toast.success(`Pulled ${result.fileName} from Paperless-ngx`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not pull the Paperless source document");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="source-document">
      <FileText className="source-document__icon" size={14} />
      <div className="source-document__main">
        <div className="source-document__title">{document.title}</div>
        <div className="source-document__meta">
          {sourceLabel ? (
            <Badge tone={externalId?.startsWith("paperless:") ? "info" : "neutral"}>{sourceLabel}</Badge>
          ) : document.category ? (
            <Badge tone="neutral">{document.category}</Badge>
          ) : null}
          {document.storageId ? (
            <Badge tone="success">Local copy</Badge>
          ) : canPull ? (
            <Badge tone="warn">No local copy</Badge>
          ) : null}
        </div>
      </div>
      {hasActions && (
        <div className="source-document__actions">
          {downloadUrl && (
            <a className="btn btn--ghost btn--sm" href={downloadUrl} target="_blank" rel="noreferrer">
              <Download size={12} /> Open
            </a>
          )}
          {document.url && !downloadUrl ? (
            <a className="btn btn--ghost btn--sm" href={document.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Open
            </a>
          ) : null}
          {canPull && (
            <button className="btn btn--ghost btn--sm" disabled={busy} onClick={pull}>
              {busy ? <RefreshCw size={12} /> : <Download size={12} />}
              {busy ? "Pulling" : document.storageId ? "Refresh" : "Pull"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function parseAgenda(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return parseLines(value);
  }
}

function parseLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function addRedactionName(names: string[], raw?: string | null) {
  const value = String(raw ?? "").trim();
  if (!value) return;
  const withoutParenthetical = value.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const withoutRole = withoutParenthetical.split(/\s+-\s+/)[0]?.trim() ?? "";
  for (const candidate of [value, withoutParenthetical, withoutRole]) {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (normalized.length >= 3) names.push(normalized);
    const firstName = normalized.match(/^([A-Z][a-zA-Z'-]{2,})\b/)?.[1];
    if (firstName) names.push(firstName);
  }
}

function namesFromDiscussion(text: string) {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b([A-Z][a-zA-Z'-]{2,}\s+[A-Z][a-zA-Z'-]{2,})\b/g)) {
    const value = match[1];
    if (!isLikelyNonPersonPhrase(value)) {
      names.add(value);
    }
  }
  for (const match of text.matchAll(/\bnaming\s+([^.;]+)/gi)) {
    match[1]
      .split(/,|\band\b/i)
      .map((name) => name.trim())
      .filter((name) => /^[A-Z][a-zA-Z'-]{2,}$/.test(name))
      .forEach((name) => names.add(name));
  }
  return Array.from(names);
}

function isLikelyNonPersonPhrase(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/^[A-Z]{2,}\s+[A-Z]{2,}$/.test(normalized)) return true;
  return /\b(Source PDF|Editor Chief|Bank payment|Online payment|Blackboard link)\b/i.test(normalized);
}

function sourceExternalIdsForMinutes(minutes: any) {
  if (!minutes) return [];
  if (Array.isArray(minutes.sourceExternalIds)) return minutes.sourceExternalIds.map(String);
  const parsed = parseDocumentMetadata(minutes.draftTranscript);
  return Array.isArray(parsed.sourceExternalIds) ? parsed.sourceExternalIds.map(String) : [];
}

function parseDocumentMetadata(value: unknown): Record<string, any> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isImportTranscriptMetadata(metadata: Record<string, any>) {
  return (
    typeof metadata.importSessionId === "string" ||
    Array.isArray(metadata.sourceExternalIds) ||
    /not an audio transcript/i.test(String(metadata.note ?? ""))
  );
}

function importTranscriptNote(metadata: Record<string, any>) {
  const note = typeof metadata.note === "string" ? metadata.note.trim() : "";
  return note || "Imported from source documents; no audio transcript is attached.";
}

function sourceExternalIdFromDocument(document: any, metadata = parseDocumentMetadata(document.content)) {
  const externalId = typeof metadata.externalId === "string" ? metadata.externalId : "";
  if (externalId) return externalId;
  return document.tags?.find?.((tag: string) => tag.startsWith("paperless:"));
}

function sourceLabelForExternalId(externalId: string | undefined) {
  const paperlessId = externalId?.match(/^paperless:(\d+)$/i)?.[1];
  if (paperlessId) return `Paperless #${paperlessId}`;
  return externalId ?? "";
}

function formatSourceReferences(value: string) {
  return value.replace(/\bpaperless:(\d+)\b/gi, "Paperless #$1");
}

function getMeetingJoinDetails(meeting: any, minutes: any) {
  const url =
    meeting.remoteUrl ??
    minutes?.remoteParticipation?.url ??
    (isUrl(meeting.location) ? meeting.location : "");
  return {
    url,
    meetingId: meeting.remoteMeetingId ?? minutes?.remoteParticipation?.meetingId ?? "",
    passcode: meeting.remotePasscode ?? minutes?.remoteParticipation?.passcode ?? "",
    instructions: meeting.remoteInstructions ?? minutes?.remoteParticipation?.instructions ?? "",
    provider: providerForUrl(url),
  };
}

function isUrl(value: unknown) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function providerForUrl(value: string) {
  const lower = value.toLowerCase();
  if (!lower) return "";
  if (lower.includes("zoom.")) return "Zoom";
  if (lower.includes("teams.microsoft") || lower.includes("teams.live")) return "Teams";
  if (lower.includes("webex.")) return "Webex";
  if (lower.includes("gotomeeting.") || lower.includes("goto.com")) return "GoToMeeting";
  return "Online";
}

function renderMeetingPackHtml({
  meeting,
  agenda,
  materials,
  tasks,
  minutes,
  joinDetails,
}: {
  meeting: any;
  agenda: string[];
  materials: any[];
  tasks: any[];
  minutes: any;
  joinDetails: any;
}) {
  const agendaHtml = (agenda.length ? agenda : ["General materials"])
    .map((topic) => {
      const topicMaterials = materials.filter((material) => (material.agendaLabel || "General materials") === topic);
      return `<li><strong>${escapeHtml(topic)}</strong>${topicMaterials.length ? `<ul>${topicMaterials.map((material) => `<li>${escapeHtml(material.label || material.document?.title || "Document")} ${material.requiredForMeeting ? "(required)" : ""}</li>`).join("")}</ul>` : ""}</li>`;
    })
    .join("");
  const taskHtml = tasks.length
    ? `<ul>${tasks.map((task) => `<li>${escapeHtml(task.title)} - ${escapeHtml(task.status)}${task.dueDate ? `, due ${escapeHtml(task.dueDate)}` : ""}</li>`).join("")}</ul>`
    : "<p>No linked tasks.</p>";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(meeting.title)} meeting pack</title>
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.45; margin: 32px; color: #18212f; }
      h1, h2 { margin-bottom: 6px; }
      .meta { color: #596275; margin-bottom: 20px; }
      section { border-top: 1px solid #d8dee8; padding-top: 18px; margin-top: 18px; }
      li { margin: 4px 0; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(meeting.title)}</h1>
    <div class="meta">${escapeHtml(meeting.type)} - ${escapeHtml(formatDateTime(meeting.scheduledAt))} - ${escapeHtml(meeting.location ?? "")}</div>
    <section>
      <h2>Join Details</h2>
      ${joinDetails.url ? `<p><a href="${escapeHtml(joinDetails.url)}">${escapeHtml(joinDetails.url)}</a></p>` : "<p>No remote meeting link saved.</p>"}
      ${joinDetails.meetingId ? `<p>Meeting ID: ${escapeHtml(joinDetails.meetingId)}</p>` : ""}
      ${joinDetails.passcode ? `<p>Passcode: ${escapeHtml(joinDetails.passcode)}</p>` : ""}
      ${joinDetails.instructions ? `<p>${escapeHtml(joinDetails.instructions)}</p>` : ""}
    </section>
    <section>
      <h2>Agenda And Materials</h2>
      <ol>${agendaHtml}</ol>
    </section>
    <section>
      <h2>Attendance</h2>
      <p>${minutes?.attendees?.length ? escapeHtml(minutes.attendees.join(", ")) : "Attendance not recorded."}</p>
    </section>
    <section>
      <h2>Actions</h2>
      ${taskHtml}
    </section>
    <section>
      <h2>Minutes</h2>
      <p>${minutes ? "Minutes are on file in Societyer." : "Minutes have not been drafted yet."}</p>
    </section>
  </body>
</html>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getQuorumSnapshot(minutes: any, meeting: any) {
  const required = minutes?.quorumRequired ?? meeting?.quorumRequired;
  const version = minutes?.quorumRuleVersion ?? meeting?.quorumRuleVersion;
  const effective =
    minutes?.quorumRuleEffectiveFromISO ??
    meeting?.quorumRuleEffectiveFromISO;
  const sourceLabel = minutes?.quorumSourceLabel ?? meeting?.quorumSourceLabel ?? "";
  const manualPrefix = /^Manual quorum override/i.test(sourceLabel)
    ? "Manual quorum override; "
    : "";
  const label = version
    ? `${manualPrefix}Bylaw rules v${version}${effective ? `, effective ${formatDate(effective)}` : ""}`
    : humanizeQuorumSourceLabel(sourceLabel);
  return { required, label };
}

function humanizeQuorumSourceLabel(value: string) {
  return value.replace(/effective (\d{4}-\d{2}-\d{2})/i, (_match, date) => `effective ${formatDate(date)}`);
}

function structuredEditFromMinutes(minutes: any): StructuredMinutesEdit {
  return {
    chairName: minutes.chairName ?? "",
    secretaryName: minutes.secretaryName ?? "",
    recorderName: minutes.recorderName ?? "",
    calledToOrderAt: minutes.calledToOrderAt ?? "",
    adjournedAt: minutes.adjournedAt ?? "",
    remoteUrl: minutes.remoteParticipation?.url ?? "",
    remoteMeetingId: minutes.remoteParticipation?.meetingId ?? "",
    remotePasscode: minutes.remoteParticipation?.passcode ?? "",
    remoteInstructions: minutes.remoteParticipation?.instructions ?? "",
    detailedAttendance: serializeDetailedAttendance(minutes.detailedAttendance ?? []),
    sections: serializeSections(minutes.sections ?? []),
    nextMeetingAt: minutes.nextMeetingAt ?? "",
    nextMeetingLocation: minutes.nextMeetingLocation ?? "",
    nextMeetingNotes: minutes.nextMeetingNotes ?? "",
    sessionSegments: serializeSessionSegments(minutes.sessionSegments ?? []),
    appendices: serializeAppendices(minutes.appendices ?? []),
    financialStatementsPresented: !!minutes.agmDetails?.financialStatementsPresented,
    financialStatementsNotes: minutes.agmDetails?.financialStatementsNotes ?? "",
    directorElectionNotes: minutes.agmDetails?.directorElectionNotes ?? "",
    directorAppointments: serializeDirectorAppointments(minutes.agmDetails?.directorAppointments ?? []),
    specialResolutionExhibits: serializeSpecialResolutionExhibits(minutes.agmDetails?.specialResolutionExhibits ?? []),
  };
}

function structuredPatchFromEdit(edit: StructuredMinutesEdit) {
  const remoteParticipation = compactObject({
    url: cleanOptional(edit.remoteUrl),
    meetingId: cleanOptional(edit.remoteMeetingId),
    passcode: cleanOptional(edit.remotePasscode),
    instructions: cleanOptional(edit.remoteInstructions),
  });
  const agmDetails = compactObject({
    financialStatementsPresented: edit.financialStatementsPresented || undefined,
    financialStatementsNotes: cleanOptional(edit.financialStatementsNotes),
    directorElectionNotes: cleanOptional(edit.directorElectionNotes),
    directorAppointments: parseDirectorAppointments(edit.directorAppointments),
    specialResolutionExhibits: parseSpecialResolutionExhibits(edit.specialResolutionExhibits),
  });
  return {
    chairName: cleanOptional(edit.chairName),
    secretaryName: cleanOptional(edit.secretaryName),
    recorderName: cleanOptional(edit.recorderName),
    calledToOrderAt: cleanOptional(edit.calledToOrderAt),
    adjournedAt: cleanOptional(edit.adjournedAt),
    remoteParticipation,
    detailedAttendance: parseDetailedAttendance(edit.detailedAttendance),
    sections: parseSections(edit.sections),
    nextMeetingAt: cleanOptional(edit.nextMeetingAt),
    nextMeetingLocation: cleanOptional(edit.nextMeetingLocation),
    nextMeetingNotes: cleanOptional(edit.nextMeetingNotes),
    sessionSegments: parseSessionSegments(edit.sessionSegments),
    appendices: parseAppendices(edit.appendices),
    agmDetails,
  };
}

function cleanOptional(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function compactObject<T extends Record<string, any>>(value: T): T | undefined {
  return Object.values(value).some((entry) => Array.isArray(entry) ? entry.length > 0 : entry !== undefined && entry !== "")
    ? value
    : undefined;
}

function parseDetailedAttendance(value: string) {
  return parsePipeRows(value).map((parts) => ({
    status: parts[0] || "present",
    name: parts[1] || parts[0] || "Unknown",
    roleTitle: cleanOptional(parts[2]),
    affiliation: cleanOptional(parts[3]),
    memberIdentifier: cleanOptional(parts[4]),
    proxyFor: cleanOptional(parts[5]),
    quorumCounted: parseOptionalBoolean(parts[6]),
    notes: cleanOptional(parts[7]),
  })).filter((row) => row.name !== "Unknown" || row.notes);
}

function serializeDetailedAttendance(rows: any[]) {
  return rows.map((row) => [
    row.status,
    row.name,
    row.roleTitle,
    row.affiliation,
    row.memberIdentifier,
    row.proxyFor,
    row.quorumCounted == null ? "" : row.quorumCounted ? "yes" : "no",
    row.notes,
  ].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseSections(value: string) {
  return parsePipeRows(value).map((parts) => ({
    type: cleanOptional(parts[0]),
    title: parts[1] || parts[0] || "Section",
    presenter: cleanOptional(parts[2]),
    discussion: cleanOptional(parts[3]),
    reportSubmitted: parseOptionalBoolean(parts[4]),
    decisions: splitSemi(parts[5]),
    actionItems: splitSemi(parts[6]).map((text) => ({ text, done: false })),
  })).filter((row) => row.title !== "Section" || row.discussion);
}

function serializeSections(rows: any[]) {
  return rows.map((row) => [
    row.type,
    row.title,
    row.presenter,
    row.discussion,
    row.reportSubmitted == null ? "" : row.reportSubmitted ? "yes" : "no",
    (row.decisions ?? []).join("; "),
    (row.actionItems ?? []).map((item: any) => item.text).join("; "),
  ].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseSessionSegments(value: string) {
  return parsePipeRows(value).map((parts) => ({
    type: parts[0] || "public",
    title: cleanOptional(parts[1]),
    startedAt: cleanOptional(parts[2]),
    endedAt: cleanOptional(parts[3]),
    notes: cleanOptional(parts[4]),
  })).filter((row) => row.type || row.notes);
}

function serializeSessionSegments(rows: any[]) {
  return rows.map((row) => [row.type, row.title, row.startedAt, row.endedAt, row.notes].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseAppendices(value: string) {
  return parsePipeRows(value).map((parts) => ({
    title: parts[0] || "Appendix",
    type: cleanOptional(parts[1]),
    reference: cleanOptional(parts[2]),
    notes: cleanOptional(parts[3]),
  })).filter((row) => row.title !== "Appendix" || row.reference || row.notes);
}

function serializeAppendices(rows: any[]) {
  return rows.map((row) => [row.title, row.type, row.reference, row.notes].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseDirectorAppointments(value: string) {
  return parsePipeRows(value).map((parts) => ({
    status: cleanOptional(parts[0]),
    name: parts[1] || parts[0] || "Unknown",
    roleTitle: cleanOptional(parts[2]),
    affiliation: cleanOptional(parts[3]),
    term: cleanOptional(parts[4]),
    consentRecorded: parseOptionalBoolean(parts[5]),
    votesReceived: numberOrUndefined(parts[6]),
    elected: parseOptionalBoolean(parts[7]),
    notes: cleanOptional(parts[8]),
  })).filter((row) => row.name !== "Unknown");
}

function serializeDirectorAppointments(rows: any[]) {
  return rows.map((row) => [
    row.status,
    row.name,
    row.roleTitle,
    row.affiliation,
    row.term,
    row.consentRecorded == null ? "" : row.consentRecorded ? "yes" : "no",
    row.votesReceived,
    row.elected == null ? "" : row.elected ? "yes" : "no",
    row.notes,
  ].map((part) => part ?? "").join(" | ")).join("\n");
}

function parseSpecialResolutionExhibits(value: string) {
  return parsePipeRows(value).map((parts) => ({
    title: parts[0] || "Exhibit",
    reference: cleanOptional(parts[1]),
    notes: cleanOptional(parts[2]),
  })).filter((row) => row.title !== "Exhibit" || row.reference || row.notes);
}

function serializeSpecialResolutionExhibits(rows: any[]) {
  return rows.map((row) => [row.title, row.reference, row.notes].map((part) => part ?? "").join(" | ")).join("\n");
}

function parsePipeRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|").map((part) => part.trim()));
}

function splitSemi(value: string | undefined) {
  return String(value ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseOptionalBoolean(value: string | undefined) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  if (["yes", "y", "true", "1", "counted", "recorded"].includes(text)) return true;
  if (["no", "n", "false", "0", "not counted", "not recorded"].includes(text)) return false;
  return undefined;
}

function numberOrUndefined(value: string | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function gapStatusTone(status: "available" | "missing" | "not_collected"): "success" | "warn" | "danger" {
  if (status === "available") return "success";
  if (status === "missing") return "warn";
  return "danger";
}

function gapStatusLabel(status: "available" | "missing" | "not_collected") {
  if (status === "available") return "Ready";
  if (status === "missing") return "Missing";
  return "Not collected";
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between" }}>
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="row" style={{ padding: "4px 0" }}>
      <span style={{ color: ok ? "var(--success)" : "var(--text-tertiary)" }}>{ok ? "✓" : "○"}</span>
      <span style={{ color: ok ? "var(--text-primary)" : "var(--text-secondary)" }}>{children}</span>
    </div>
  );
}
