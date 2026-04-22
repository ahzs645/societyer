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
import { ArrowLeft, ClipboardCheck, Download, ExternalLink, EyeOff, FileDown, Printer } from "lucide-react";
import type { Motion } from "../components/MotionEditor";
import {
  MINUTES_EXPORT_STYLES,
  MinutesExportStyleId,
  exportWordDoc,
  getMinutesStyleGaps,
  openPrintableDocument,
  renderMinutesHtml,
} from "../lib/exportWord";
import { redactText, RedactOptions } from "../lib/redactPii";
import { getLegalGuideRules, resolveJurisdictionCode } from "../lib/jurisdictionGuideTracks";
import {
  buildAccessGrantCandidates,
  getPackageReadiness,
  grantKey,
  materialEffectiveStatus,
} from "../features/meetings/lib/meetingMaterialAccess";
import { renderMeetingPackHtml } from "../features/meetings/lib/meetingPackExport";
import { MeetingMaterialDrawer } from "../features/meetings/components/MeetingMaterialDrawer";
import { MeetingPackageHub } from "../features/meetings/components/MeetingPackageHub";
import { MeetingMinutesColumn } from "../features/meetings/components/MeetingMinutesColumn";
import { MeetingSidebarColumn } from "../features/meetings/components/MeetingSidebarColumn";
import {
  addRedactionName,
  getMeetingJoinDetails,
  getPackageReviewBlockers,
  getQuorumSnapshot,
  importTranscriptNote,
  inferredPackageReviewStatus,
  isImportTranscriptMetadata,
  namesFromDiscussion,
  parseAgenda,
  parseDocumentMetadata,
  parseLines,
  personLinkCandidates,
  sourceExternalIdsForMinutes,
} from "../features/meetings/components/MeetingDetailSupport";
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

  const importTranscriptVtt = async (file: File) => {
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
    }
  };

  const saveTranscriptEditText = async () => {
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

      <MeetingPackageHub
        meeting={meeting}
        minutes={minutes}
        agenda={agenda}
        packageMaterials={packageMaterials}
        openPackageTasks={openPackageTasks}
        joinDetails={joinDetails}
        packageReadiness={packageReadiness}
        sourceReviewStatus={sourceReviewStatus}
        packageReviewStatus={packageReviewStatus}
        packageReviewBlockers={packageReviewBlockers}
        sourceReviewNote={sourceReviewNote}
        packageReviewNote={packageReviewNote}
        setSourceReviewNote={setSourceReviewNote}
        setPackageReviewNote={setPackageReviewNote}
        openMaterialDrawer={openMaterialDrawer}
        startJoinEdit={startJoinEdit}
        downloadMeetingPack={downloadMeetingPack}
        completeSourceReview={completeSourceReview}
        reopenSourceReview={reopenSourceReview}
        markPackageReady={markPackageReady}
        sendPackageBackToReview={sendPackageBackToReview}
        removeMeetingMaterial={removeMeetingMaterial}
      />

      <div className="two-col">
        <MeetingMinutesColumn
          meeting={meeting}
          minutes={minutes}
          agenda={agenda}
          agendaEdit={agendaEdit}
          setAgendaEdit={setAgendaEdit}
          saveAgenda={saveAgenda}
          attendanceEdit={attendanceEdit}
          setAttendanceEdit={setAttendanceEdit}
          startAttendanceEdit={startAttendanceEdit}
          saveAttendance={saveAttendance}
          structuredEdit={structuredEdit}
          setStructuredEdit={setStructuredEdit}
          startStructuredEdit={startStructuredEdit}
          saveStructuredDetails={saveStructuredDetails}
          quorumSnapshot={quorumSnapshot}
          quorumLegalGuides={quorumLegalGuides}
          members={members}
          directors={directors}
          directorNames={directorNames}
          motionPeople={motionPeople}
          saveMotions={saveMotions}
          transcript={transcript}
          setTranscript={setTranscript}
          transcriptOnFile={transcriptOnFile}
          busy={busy}
          runGenerate={runGenerate}
        />

        <MeetingSidebarColumn
          meeting={meeting}
          minutes={minutes}
          society={society}
          selectedMinutesExportStyle={selectedMinutesExportStyle}
          minutesExportStyle={minutesExportStyle}
          setMinutesExportStyle={setMinutesExportStyle}
          includeTranscriptInExport={includeTranscriptInExport}
          setIncludeTranscriptInExport={setIncludeTranscriptInExport}
          includeActionItemsInExport={includeActionItemsInExport}
          setIncludeActionItemsInExport={setIncludeActionItemsInExport}
          includeApprovalInExport={includeApprovalInExport}
          setIncludeApprovalInExport={setIncludeApprovalInExport}
          includeSignaturesInExport={includeSignaturesInExport}
          setIncludeSignaturesInExport={setIncludeSignaturesInExport}
          includePlaceholdersInExport={includePlaceholdersInExport}
          setIncludePlaceholdersInExport={setIncludePlaceholdersInExport}
          exportToWord={exportToWord}
          exportToPdf={exportToPdf}
          exportPublicMinutes={exportPublicMinutes}
          minutesExportGaps={minutesExportGaps}
          quorumSnapshot={quorumSnapshot}
          quorumLegalGuides={quorumLegalGuides}
          legalGuideDateISO={legalGuideDateISO}
          linkedSourceCount={linkedSourceCount}
          sourceDocuments={sourceDocuments}
          minutesSourceExternalIds={minutesSourceExternalIds}
          vttInputRef={vttInputRef}
          audioInputRef={audioInputRef}
          transcriptOnFile={transcriptOnFile}
          transcriptProvider={transcriptProvider}
          transcriptionJob={transcriptionJob}
          transcriptStatusTone={transcriptStatusTone}
          transcriptEdit={transcriptEdit}
          savingTranscript={savingTranscript}
          pipelineBusy={pipelineBusy}
          audioFile={audioFile}
          importNote={importNote}
          setTranscriptEdit={setTranscriptEdit}
          setAudioFile={setAudioFile}
          importTranscriptVtt={importTranscriptVtt}
          saveTranscriptEditText={saveTranscriptEditText}
          uploadAudioAndRun={uploadAudioAndRun}
        />
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
