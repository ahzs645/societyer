import { useParams, Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../components/Toast";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { formatDate, formatDateTime } from "../lib/format";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowLeft, FileText, Save, Mic, FileDown, Gavel, ClipboardCheck, Upload, ExternalLink, Download, RefreshCw, Printer, ShieldCheck, AlertTriangle } from "lucide-react";
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
import {
  accessLevelLabel,
  availabilityLabel,
  availabilityTone,
  buildAccessGrantCandidates,
  getPackageReadiness,
  grantKey,
  isMaterialExpired,
  materialAccessSummary,
  materialEffectiveStatus,
  syncLabel,
  syncTone,
} from "../features/meetings/lib/meetingMaterialAccess";
import { renderMeetingPackHtml } from "../features/meetings/lib/meetingPackExport";
import { MeetingMaterialDrawer } from "../features/meetings/components/MeetingMaterialDrawer";
import {
  type StructuredMinutesEdit,
  structuredEditFromMinutes,
  structuredPatchFromEdit,
} from "../features/meetings/lib/structuredMinutes";

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
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
  const users = useQuery(
    api.users.list,
    society ? { societyId: society._id } : "skip",
  );
  const committees = useQuery(
    api.committees.list,
    society ? { societyId: society._id } : "skip",
  );
  const allDocuments = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const motionPeople = personLinkCandidates(members, directors);
  const directorNames = (directors ?? []).flatMap((d: any) => [`${d.firstName} ${d.lastName}`, ...(Array.isArray(d.aliases) ? d.aliases : [])]);
  const generate = useAction(api.minutes.generateDraft);
  const updateMeeting = useMutation(api.meetings.update);
  const markSourceReview = useMutation(api.meetings.markSourceReview);
  const setPackageReviewStatus = useMutation(api.meetings.setPackageReviewStatus);
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
  const [sourceReviewNote, setSourceReviewNote] = useState("");
  const [packageReviewNote, setPackageReviewNote] = useState("");

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
  const packageReadiness = getPackageReadiness(packageMaterials);
  const sourceReviewStatus = meeting.sourceReviewStatus ?? minutes?.sourceReviewStatus ?? "not_applicable";
  const packageReviewStatus = meeting.packageReviewStatus ?? inferredPackageReviewStatus(packageMaterials, sourceReviewStatus);
  const packageReviewBlockers = getPackageReviewBlockers(packageMaterials, sourceReviewStatus);
  const grantCandidates = materialDraft
    ? buildAccessGrantCandidates(materialDraft.grantSubjectType, {
        meeting,
        minutes,
        users,
        members,
        directors,
        committees,
      })
    : [];

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

  const openMaterialDrawer = (agendaLabel?: string, material?: any) => {
    setMaterialDraft({
      id: material?._id,
      documentId: material?.documentId ?? "",
      agendaLabel: material?.agendaLabel ?? agendaLabel ?? "",
      label: material?.label ?? "",
      order: material?.order ?? packageMaterials.length + 1,
      requiredForMeeting: material?.requiredForMeeting ?? true,
      accessLevel: material?.accessLevel ?? "board",
      accessGrants: material?.accessGrants ?? [],
      availabilityStatus: material?.availabilityStatus ?? materialEffectiveStatus(material) ?? "available",
      syncStatus: material?.syncStatus ?? "online",
      expiresAtISO: (material?.expiresAtISO ?? "").slice(0, 10),
      notes: material?.notes ?? "",
      grantSubjectType: "attendee",
      grantSubjectId: "",
      grantSubjectLabel: "",
      grantAccess: "view",
    });
  };

  const saveMaterial = async () => {
    if (!materialDraft?.documentId) {
      toast.error("Choose a document to attach.");
      return;
    }
    await attachMeetingMaterial({
      id: materialDraft.id || undefined,
      societyId: meeting.societyId,
      meetingId: meeting._id,
      documentId: materialDraft.documentId,
      agendaLabel: materialDraft.agendaLabel || undefined,
      label: materialDraft.label || undefined,
      order: Number(materialDraft.order) || packageMaterials.length + 1,
      requiredForMeeting: !!materialDraft.requiredForMeeting,
      accessLevel: materialDraft.accessLevel || "board",
      accessGrants: materialDraft.accessGrants ?? [],
      availabilityStatus: materialDraft.availabilityStatus || "available",
      syncStatus: materialDraft.syncStatus || "online",
      expiresAtISO: materialDraft.expiresAtISO || "",
      notes: materialDraft.notes || undefined,
    });
    setMaterialDraft(null);
    toast.success(materialDraft.id ? "Meeting material updated" : "Material added to meeting package");
  };

  const addAccessGrant = () => {
    if (!materialDraft) return;
    const selected = grantCandidates.find((candidate) => candidate.id === materialDraft.grantSubjectId);
    const subjectLabel = materialDraft.grantSubjectType === "group"
      ? materialDraft.grantSubjectLabel.trim()
      : selected?.label ?? "";
    if (!subjectLabel) {
      toast.error("Choose an access target.");
      return;
    }
    const nextGrant = {
      subjectType: materialDraft.grantSubjectType,
      subjectId: selected?.id || undefined,
      subjectLabel,
      access: materialDraft.grantAccess || "view",
    };
    const key = grantKey(nextGrant);
    const nextGrants = [
      ...(materialDraft.accessGrants ?? []).filter((grant: any) => grantKey(grant) !== key),
      nextGrant,
    ];
    setMaterialDraft({
      ...materialDraft,
      accessGrants: nextGrants,
      grantSubjectId: "",
      grantSubjectLabel: "",
    });
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

  const completeSourceReview = async () => {
    await markSourceReview({
      id: meeting._id,
      status: "source_reviewed",
      notes: sourceReviewNote.trim() || undefined,
      actingUserId,
    });
    setSourceReviewNote("");
    toast.success("Source review completed");
  };

  const reopenSourceReview = async () => {
    await markSourceReview({
      id: meeting._id,
      status: "imported_needs_review",
      notes: sourceReviewNote.trim() || "Source review reopened.",
      actingUserId,
    });
    toast.success("Source review reopened");
  };

  const markPackageReady = async () => {
    if (packageReviewBlockers.length > 0) {
      toast.error("Package still needs review", packageReviewBlockers[0]);
      return;
    }
    await setPackageReviewStatus({
      id: meeting._id,
      status: "ready",
      notes: packageReviewNote.trim() || undefined,
      actingUserId,
    });
    setPackageReviewNote("");
    toast.success("Board package marked ready");
  };

  const sendPackageBackToReview = async () => {
    await setPackageReviewStatus({
      id: meeting._id,
      status: "needs_review",
      notes: packageReviewNote.trim() || "Package returned to review.",
      actingUserId,
    });
    toast.success("Package returned to review");
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
              <div className="stat__label">Pack readiness</div>
              <div className="stat__value">{packageReadiness.ready}/{packageReadiness.total}</div>
              <div className="stat__sub">{packageReadiness.needsAttention} need attention</div>
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

          <div className="panel" style={{ padding: 12, borderRadius: 8, marginBottom: 16 }}>
            <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong>
                  <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Governance review gate
                </strong>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                  Source data, required materials, and board package readiness.
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Badge tone={sourceReviewTone(sourceReviewStatus)}>{sourceReviewLabel(sourceReviewStatus)}</Badge>
                <Badge tone={packageReviewTone(packageReviewStatus)}>{packageReviewLabel(packageReviewStatus)}</Badge>
                {packageReviewBlockers.length > 0 && (
                  <Badge tone="warn">
                    <AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                    {packageReviewBlockers.length} blocker{packageReviewBlockers.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>

            <div className="two-col" style={{ marginTop: 12 }}>
              <div className="col" style={{ gap: 8 }}>
                <Detail label="Source review">
                  <Badge tone={sourceReviewTone(sourceReviewStatus)}>{sourceReviewLabel(sourceReviewStatus)}</Badge>
                </Detail>
                {(meeting.sourceReviewNotes || minutes?.sourceReviewNotes) && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>
                    {meeting.sourceReviewNotes ?? minutes?.sourceReviewNotes}
                  </div>
                )}
                {sourceReviewStatus === "imported_needs_review" || sourceReviewStatus === "rejected" ? (
                  <>
                    <textarea
                      className="textarea"
                      rows={2}
                      value={sourceReviewNote}
                      onChange={(event) => setSourceReviewNote(event.target.value)}
                      placeholder="Review note"
                    />
                    <button className="btn-action btn-action--primary" onClick={completeSourceReview}>
                      <ShieldCheck size={12} /> Mark source reviewed
                    </button>
                  </>
                ) : sourceReviewStatus === "source_reviewed" ? (
                  <button className="btn-action" onClick={reopenSourceReview}>
                    Reopen source review
                  </button>
                ) : (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No imported source review is open.</div>
                )}
              </div>

              <div className="col" style={{ gap: 8 }}>
                <Detail label="Package review">
                  <Badge tone={packageReviewTone(packageReviewStatus)}>{packageReviewLabel(packageReviewStatus)}</Badge>
                </Detail>
                {packageReviewBlockers.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-secondary)", fontSize: "var(--fs-sm)" }}>
                    {packageReviewBlockers.slice(0, 4).map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                ) : (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No package blockers detected.</div>
                )}
                {meeting.packageReviewNotes && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>{meeting.packageReviewNotes}</div>
                )}
                <textarea
                  className="textarea"
                  rows={2}
                  value={packageReviewNote}
                  onChange={(event) => setPackageReviewNote(event.target.value)}
                  placeholder="Package review note"
                />
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn-action btn-action--primary"
                    onClick={markPackageReady}
                    disabled={packageReviewBlockers.length > 0}
                  >
                    <ClipboardCheck size={12} /> Mark package ready
                  </button>
                  {packageReviewStatus === "ready" || packageReviewStatus === "released" ? (
                    <button className="btn-action" onClick={sendPackageBackToReview}>Return to review</button>
                  ) : null}
                </div>
              </div>
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
                      {topicMaterials.map((material: any) => {
                        const status = materialEffectiveStatus(material);
                        return (
                          <div key={material._id} className="panel" style={{ padding: 10, borderRadius: 8 }}>
                            <div className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                              <FileText size={12} style={{ marginTop: 3 }} />
                              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                                <Link to={`/app/documents/${material.document?._id}`}>
                                  {material.label || material.document?.title || "Document"}
                                </Link>
                                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                                  {materialAccessSummary(material)}
                                </div>
                              </div>
                              <Badge tone={availabilityTone(status)}>{availabilityLabel(status)}</Badge>
                              {material.syncStatus && <Badge tone={syncTone(material.syncStatus)}>{syncLabel(material.syncStatus)}</Badge>}
                              {material.requiredForMeeting && <Badge tone="warn">Required</Badge>}
                              {material.expiresAtISO && (
                                <Badge tone={isMaterialExpired(material) ? "danger" : "neutral"}>
                                  Expires {formatDate(material.expiresAtISO)}
                                </Badge>
                              )}
                              <Badge tone={(material.accessGrants ?? []).length ? "info" : "neutral"}>
                                {(material.accessGrants ?? []).length ? `${material.accessGrants.length} grant${material.accessGrants.length === 1 ? "" : "s"}` : accessLevelLabel(material.accessLevel)}
                              </Badge>
                              <button
                                className="btn btn--ghost btn--sm"
                                style={{ marginLeft: "auto" }}
                                onClick={() => openMaterialDrawer(material.agendaLabel, material)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => removeMeetingMaterial({ id: material._id })}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
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

      <MeetingMaterialDrawer
        materialDraft={materialDraft}
        setMaterialDraft={setMaterialDraft}
        allDocuments={allDocuments ?? []}
        agenda={agenda}
        grantCandidates={grantCandidates}
        onClose={() => setMaterialDraft(null)}
        onSave={saveMaterial}
        onAddAccessGrant={addAccessGrant}
      />

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

function inferredPackageReviewStatus(materials: any[], sourceReviewStatus: string) {
  if (getPackageReviewBlockers(materials, sourceReviewStatus).length > 0) return "needs_review";
  return materials.length > 0 ? "ready" : "draft";
}

function getPackageReviewBlockers(materials: any[], sourceReviewStatus: string) {
  const blockers: string[] = [];
  if (sourceReviewStatus === "imported_needs_review") {
    blockers.push("Imported meeting or minutes data still needs source review.");
  }
  if (sourceReviewStatus === "rejected") {
    blockers.push("Imported source data was rejected.");
  }
  const requiredNotReady = materials.filter((material) => material.requiredForMeeting && materialNeedsAttention(material));
  if (requiredNotReady.length > 0) {
    blockers.push(`${requiredNotReady.length} required material${requiredNotReady.length === 1 ? "" : "s"} not available.`);
  }
  const documentReview = materials.filter((material) =>
    material.requiredForMeeting &&
    ["in_review", "needs_signature", "blocked"].includes(material.document?.reviewStatus ?? ""),
  );
  if (documentReview.length > 0) {
    blockers.push(`${documentReview.length} required document${documentReview.length === 1 ? "" : "s"} still in document review.`);
  }
  return blockers;
}

function materialNeedsAttention(material: any) {
  const status = materialEffectiveStatus(material);
  return status === "pending" || status === "expired" || status === "withdrawn";
}

function sourceReviewLabel(status: string) {
  if (status === "imported_needs_review") return "Source review";
  if (status === "source_reviewed") return "Source reviewed";
  if (status === "rejected") return "Source rejected";
  return "Manual source";
}

function sourceReviewTone(status: string) {
  if (status === "source_reviewed") return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "imported_needs_review") return "warn" as const;
  return "neutral" as const;
}

function packageReviewLabel(status: string) {
  if (status === "needs_review") return "Package review";
  if (status === "ready") return "Package ready";
  if (status === "released") return "Released";
  return "Package draft";
}

function packageReviewTone(status: string) {
  if (status === "ready" || status === "released") return "success" as const;
  if (status === "needs_review") return "warn" as const;
  return "neutral" as const;
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
