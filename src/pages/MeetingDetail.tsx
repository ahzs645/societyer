import { useParams, Link, useSearchParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../components/Toast";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Tabs } from "../components/primitives";
import { Menu } from "../components/Menu";
import { formatDate, formatDateTime } from "../lib/format";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookMarked, ClipboardCheck, Download, ExternalLink, EyeOff, FileDown, FileText, Gavel, MoreHorizontal, PackageCheck, Plus, Printer, RotateCcw, Settings2 } from "lucide-react";
import { MotionEditor, isAdjournmentMotion, motionPersonDisplayName, type Motion, type MotionEditorHandle } from "../components/MotionEditor";
import {
  MINUTES_EXPORT_STYLES,
  MinutesExportStyleId,
  exportWordDocx,
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
  parseAgendaItems,
  parseDocumentMetadata,
  type AgendaItemEntry,
  personLinkCandidates,
  sourceExternalIdsForMinutes,
} from "../features/meetings/components/MeetingDetailSupport";
const MINUTES_EXPORT_PREF_PREFIX = "societyer.minutesExport.";
type MeetingDetailTab = "overview" | "minutes" | "motions" | "package" | "export" | "sources";

function readStoredMinutesStyle(): MinutesExportStyleId {
  if (typeof window === "undefined") return "numbered-agenda";
  const stored = window.localStorage.getItem(`${MINUTES_EXPORT_PREF_PREFIX}style`);
  return MINUTES_EXPORT_STYLES.some((style) => style.id === stored)
    ? stored as MinutesExportStyleId
    : "numbered-agenda";
}

function readStoredExportBool(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(`${MINUTES_EXPORT_PREF_PREFIX}${key}`);
  if (stored == null) return fallback;
  return stored === "true";
}

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
  const createMinutes = useMutation(api.minutes.create);
  const updateTask = useMutation(api.tasks.update);
  const createTask = useMutation(api.tasks.create);
  const societyTasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const backfillMinutesQuorum = useMutation(api.minutes.backfillQuorumSnapshot);
  const createBacklogFromMinutesMotion = useMutation(api.motionBacklog.createFromMinutesMotion);
  const createBacklogFromMinutesSection = useMutation(api.motionBacklog.createFromMinutesSection);
  const createTemplateFromMeeting = useMutation(api.meetingTemplates.createFromMeeting);
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
  const motionEditorRef = useRef<MotionEditorHandle | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [transcriptEdit, setTranscriptEdit] = useState<string | null>(null);
  const [agendaEdit, setAgendaEdit] = useState<AgendaItemEntry[] | null>(null);
  const [attendanceEdit, setAttendanceEdit] = useState<{
    people: { name: string; status: "present" | "absent" }[];
    quorumMet: boolean;
  } | null>(null);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [minutesExportStyle, setMinutesExportStyle] = useState<MinutesExportStyleId>(readStoredMinutesStyle);
  const [includeTranscriptInExport, setIncludeTranscriptInExport] = useState(() => readStoredExportBool("includeTranscript", true));
  const [includeActionItemsInExport, setIncludeActionItemsInExport] = useState(() => readStoredExportBool("includeActionItems", true));
  const [includeDiscussionSummaryInExport, setIncludeDiscussionSummaryInExport] = useState(() => readStoredExportBool("includeDiscussionSummary", false));
  const [includeApprovalInExport, setIncludeApprovalInExport] = useState(() => readStoredExportBool("includeApproval", true));
  const [includeSignaturesInExport, setIncludeSignaturesInExport] = useState(() => readStoredExportBool("includeSignatures", true));
  const [includePlaceholdersInExport, setIncludePlaceholdersInExport] = useState(() => readStoredExportBool("includePlaceholders", false));
  // Drive the tab from the `?tab=` URL param so deep links (e.g. the Draft
  // minutes quick-action) can land users directly on the right tab. The
  // setter writes back to the URL so the address bar reflects what's shown
  // and the back button restores the previous tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const TAB_VALUES: MeetingDetailTab[] = ["overview", "minutes", "motions", "package", "export", "sources"];
  const tabFromUrl = searchParams.get("tab") as MeetingDetailTab | null;
  const activeTab: MeetingDetailTab = tabFromUrl && TAB_VALUES.includes(tabFromUrl) ? tabFromUrl : "overview";
  const setActiveTab = (next: MeetingDetailTab) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "overview") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };
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

  useEffect(() => {
    if (!minutes) return;
    if (minutes.quorumComputedAtISO && minutes.quorumSourceLabel && minutes.quorumRequired != null) return;
    void backfillMinutesQuorum({ id: minutes._id }).catch(() => undefined);
  }, [backfillMinutesQuorum, minutes?._id, minutes?.quorumComputedAtISO, minutes?.quorumRequired, minutes?.quorumSourceLabel]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!meeting) return <div className="page">Loading…</div>;

  const agendaTree = parseAgendaItems(meeting.agendaJson);
  const agenda = parseAgenda(meeting.agendaJson);
  const businessMotions = ((minutes?.motions ?? []) as Motion[]).filter((motion) => !isAdjournmentMotion(motion));
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
  const linkedTasks = meetingPackage?.tasks ?? [];
  const linkableTasks = ((societyTasks ?? []) as any[]).filter((task: any) => !task.meetingId);
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
  const reopenMeeting = () => updateMeeting({ id: meeting._id, patch: { status: "Scheduled" } });

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
        movedBy: tx(motionPersonDisplayName(m.movedBy, motionPeople, { memberId: m.movedByMemberId, directorId: m.movedByDirectorId })),
        secondedBy: tx(motionPersonDisplayName(m.secondedBy, motionPeople, { memberId: m.secondedByMemberId, directorId: m.secondedByDirectorId })),
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
        agendaItems: agendaTree.filter((entry) => entry.depth === 0).map((entry) => entry.title),
        agendaItemTree: agendaTree,
      },
      minutes: payload,
      styleId: minutesExportStyle,
      options: {
        includeTranscript: redact ? false : includeTranscriptInExport,
        includeActionItems: includeActionItemsInExport,
        includeDiscussionSummary: includeDiscussionSummaryInExport,
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
    exportWordDocx({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.docx`,
      title: `${meeting.title} — Minutes`,
      bodyHtml,
    });
    toast.success("Minutes exported", "Downloaded as a Word .docx file.");
  };

  const exportToPdf = () => {
    if (!meeting || !minutes || !society) return;
    openPrintableDocument({
      title: `${meeting.title} — Minutes`,
      bodyHtml: renderExportBody(),
    });
  };

  const openMinutesPreviewPage = () => {
    if (!meeting || !minutes) return;
    window.open(`/app/meetings/${meeting._id}/preview`, "_blank", "noopener,noreferrer");
  };

  const exportPublicMinutes = () => {
    if (!meeting || !minutes || !society) return;
    const pii = redactOpts();
    const redact = (s: string) => redactText(s, pii);
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const bodyHtml = renderExportBody(redact);
    exportWordDocx({
      filename: `${safe}-public-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.docx`,
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

  const saveMinuteSections = async (next: any[]) => {
    if (!minutes) return;
    await updateMinutes({ id: minutes._id, patch: { sections: next } });
    // Keep meeting.agendaJson in sync with section titles AND depth so the
    // sidebar agenda card and the right-side Agenda record never drift apart.
    const nextAgenda: AgendaItemEntry[] = [];
    let hasRoot = false;
    for (const section of next) {
      const title = String(section?.title ?? "").trim();
      if (!title) continue;
      const rawDepth = section?.depth === 1 ? 1 : 0;
      // A child without a preceding root is impossible on the agenda side, so
      // demote leading children to roots to stay consistent.
      const depth: 0 | 1 = rawDepth === 1 && hasRoot ? 1 : 0;
      nextAgenda.push({ title, depth });
      if (depth === 0) hasRoot = true;
    }
    await updateMeeting({
      id: meeting._id,
      patch: { agendaJson: JSON.stringify(nextAgenda) },
    });
  };

  const addMotionToBacklog = async (_motion: Motion, motionIndex: number) => {
    if (!minutes) return;
    const result = await createBacklogFromMinutesMotion({
      minutesId: minutes._id,
      motionIndex,
    });
    toast.success(result.reused ? "Motion already in backlog" : "Motion added to backlog");
  };

  const addSectionToBacklog = async (section: any) => {
    if (!minutes) return;
    const sectionIndex = (minutes.sections ?? []).findIndex((candidate: any) => candidate === section);
    if (sectionIndex < 0) return;
    const result = await createBacklogFromMinutesSection({
      minutesId: minutes._id,
      sectionIndex,
    });
    toast.success(result.reused ? "Agenda item already in backlog" : "Agenda item added to backlog");
  };

  const buildSectionFromTitle = (title: string, depth: 0 | 1 = 0) => ({
    title,
    type: inferAgendaSectionType(title),
    discussion: "",
    decisions: [],
    actionItems: [],
    depth,
  });

  const saveAgenda = async () => {
    // Clean: drop empty titles and force any leading depth-1 entry to depth 0
    // (a child without a preceding root is impossible on save).
    const cleaned: AgendaItemEntry[] = [];
    let hasRoot = false;
    for (const entry of agendaEdit ?? []) {
      const title = entry.title.trim();
      if (!title) continue;
      const depth: 0 | 1 = entry.depth === 1 && hasRoot ? 1 : 0;
      cleaned.push({ title, depth });
      if (depth === 0) hasRoot = true;
    }
    // Both root and sub-items become real minute sections. Depth is preserved
    // on the section so the editor and exports can render sub-numbering.
    const next = cleaned;

    await updateMeeting({
      id: meeting._id,
      patch: {
        // Always send a string — `undefined` is treated as "leave field alone",
        // which would silently undo a save that empties the agenda.
        agendaJson: JSON.stringify(cleaned),
      },
    });

    // Auto-bootstrap the minutes record on first save. This subsumes the old
    // "Create from agenda" button — saving the agenda is now the single entry
    // point that produces an editable minutes draft mirroring the agenda.
    if (!minutes && next.length) {
      const attendees = Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds.map(String) : [];
      const quorumRequired = quorumSnapshot.required ?? meeting.quorumRequired;
      await createMinutes({
        societyId: meeting.societyId,
        meetingId: meeting._id,
        heldAt: meeting.scheduledAt,
        attendees,
        absent: [],
        quorumMet: quorumRequired == null ? false : attendees.length >= quorumRequired,
        quorumRequired: quorumRequired ?? undefined,
        discussion: "",
        sections: next.map((entry) => buildSectionFromTitle(entry.title, entry.depth)),
        motions: [],
        decisions: [],
        actionItems: [],
      });
      setAgendaEdit(null);
      toast.success("Agenda saved");
      return;
    }

    // Keep agenda and minutes.sections in 1-to-1 sync: align section order to
    // the agenda, reuse existing sections by title, and create empty sections
    // for new titles. Sections whose titles were dropped from the agenda are
    // removed only if they have no recorded content; sections with data are
    // preserved as orphans so we never silently destroy recorded minutes.
    if (minutes) {
      const existingSections = ((minutes.sections ?? []) as any[]);
      const existingMotions = ((minutes.motions ?? []) as Motion[]);
      const normalize = (title: string) => title.trim().toLowerCase();
      const sectionHasDetails = (section: any) =>
        !!(
          section?.discussion ||
          section?.presenter ||
          (section?.decisions ?? []).length ||
          (section?.actionItems ?? []).length ||
          (section?.linkedTaskIds ?? []).length
        );

      const sectionsByTitle = new Map<string, any>();
      for (const section of existingSections) {
        const key = normalize(section?.title ?? "");
        if (key && !sectionsByTitle.has(key)) sectionsByTitle.set(key, section);
      }

      // Preserve existing section content when titles match; always overwrite
      // depth from the agenda since the agenda is the source of truth for
      // hierarchy. Brand-new titles get a fresh empty section at the correct
      // depth.
      const aligned = next.map((entry) => {
        const existing = sectionsByTitle.get(normalize(entry.title));
        return existing
          ? { ...existing, depth: entry.depth }
          : buildSectionFromTitle(entry.title, entry.depth);
      });

      const newTitles = new Set(next.map((entry) => normalize(entry.title)));
      const orphans = existingSections.filter((section) => {
        const key = normalize(section?.title ?? "");
        return !newTitles.has(key) && sectionHasDetails(section);
      });

      const finalSections = [...aligned, ...orphans];

      const sectionsChanged =
        finalSections.length !== existingSections.length ||
        finalSections.some((s, i) => s !== existingSections[i]);

      const titleToNewIndex = new Map<string, number>();
      finalSections.forEach((section, index) => {
        const key = normalize(section?.title ?? "");
        if (key && !titleToNewIndex.has(key)) titleToNewIndex.set(key, index);
      });

      let motionsChanged = false;
      const remappedMotions = existingMotions.map((motion) => {
        if (motion.sectionIndex == null) return motion;
        const oldSection = existingSections[motion.sectionIndex];
        if (!oldSection) return motion;
        const oldKey = normalize(oldSection?.title ?? "");
        const newIndex = titleToNewIndex.get(oldKey);
        if (newIndex == null) {
          const { sectionIndex: _sectionIndex, sectionTitle: _sectionTitle, ...rest } = motion;
          motionsChanged = true;
          return rest as Motion;
        }
        if (newIndex === motion.sectionIndex) return motion;
        motionsChanged = true;
        return { ...motion, sectionIndex: newIndex };
      });

      if (sectionsChanged || motionsChanged) {
        const patch: any = {};
        if (sectionsChanged) patch.sections = finalSections;
        if (motionsChanged) patch.motions = remappedMotions;
        await updateMinutes({ id: minutes._id, patch });
      }
    }

    setAgendaEdit(null);
    toast.success("Agenda saved");
  };

  const startAttendanceEdit = () => {
    if (!minutes) return;
    const existing = [
      ...minutes.attendees.map((name: string) => ({ name, status: "present" as const })),
      ...minutes.absent.map((name: string) => ({ name, status: "absent" as const })),
    ];
    const seedDirectors = existing.length === 0
      ? (directors ?? [])
          .map((director: any) => ({
            name: `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim(),
            status: "present" as const,
          }))
          .filter((person) => person.name)
      : [];
    setAttendanceEdit({
      people: [...existing, ...seedDirectors],
      quorumMet: minutes.quorumMet,
    });
  };

  const saveAttendance = async () => {
    if (!minutes || !attendanceEdit) return;
    const attendees = attendanceEdit.people
      .filter((p) => p.status === "present")
      .map((p) => p.name.trim())
      .filter(Boolean);
    const absent = attendanceEdit.people
      .filter((p) => p.status === "absent")
      .map((p) => p.name.trim())
      .filter(Boolean);
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
      tasks: linkedTasks,
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

  const setLinkedTaskStatus = async (taskId: string, status: string) => {
    await updateTask({
      id: taskId as Id<"tasks">,
      patch: {
        status,
        completedByUserId: status === "Done" && actingUserId ? actingUserId : undefined,
      },
    });
  };
  const linkTaskToMeeting = async (taskId: string) => {
    if (!meeting?._id) return;
    await updateTask({ id: taskId as Id<"tasks">, patch: { meetingId: meeting._id as Id<"meetings"> } });
    toast.success("Task linked to meeting");
  };
  const unlinkTaskFromMeeting = async (taskId: string) => {
    await updateTask({ id: taskId as Id<"tasks">, patch: { meetingId: undefined } });
    toast.success("Task unlinked");
  };
  const applyTaskUpdate = async (taskId: string, patch: { status?: string; completionNote?: string }) => {
    const update: any = { ...patch };
    if (patch.status === "Done" && actingUserId) update.completedByUserId = actingUserId;
    await updateTask({ id: taskId as Id<"tasks">, patch: update });
  };
  const createTaskForMeeting = async (input: { title: string; priority: string; status: string; dueDate?: string }) => {
    if (!society || !meeting?._id) return;
    await createTask({
      societyId: society._id,
      title: input.title,
      status: input.status,
      priority: input.priority,
      dueDate: input.dueDate || undefined,
      meetingId: meeting._id as Id<"meetings">,
      committeeId: meeting.committeeId ?? undefined,
      tags: [],
    });
    toast.success("Task created", input.title);
  };

  const saveCurrentMeetingAsTemplate = async () => {
    await createTemplateFromMeeting({
      meetingId: meeting._id,
      name: `${meeting.title} template`,
      description: `Created from ${meeting.title} on ${formatDate(new Date().toISOString())}.`,
      isDefault: false,
    });
    toast.success("Meeting template saved");
  };

  return (
    <div className="page page--wide meeting-detail-page">
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
            <Menu
              align="right"
              minWidth={220}
              trigger={
                <button className="btn-action" type="button" title="Meeting actions">
                  <MoreHorizontal size={12} /> Actions
                </button>
              }
              sections={[
                ...(meeting.status === "Held"
                  ? [
                      {
                        id: "status",
                        items: [
                          {
                            id: "reopen-meeting",
                            label: "Reopen meeting",
                            icon: <RotateCcw size={12} />,
                            onSelect: reopenMeeting,
                          },
                        ],
                      },
                    ]
                  : []),
                {
                  id: "package",
                  items: [
                    {
                      id: "save-template",
                      label: "Save as meeting template",
                      icon: <BookMarked size={12} />,
                      disabled: agendaTree.length === 0,
                      onSelect: saveCurrentMeetingAsTemplate,
                    },
                    {
                      id: "meeting-pack",
                      label: "Download meeting pack",
                      icon: <Download size={12} />,
                      onSelect: downloadMeetingPack,
                    },
                  ],
                },
                {
                  id: "minutes-export",
                  label: "Minutes export",
                  items: [
                    {
                      id: "preview-page",
                      label: "Open preview page",
                      icon: <ExternalLink size={12} />,
                      disabled: !minutes,
                      onSelect: openMinutesPreviewPage,
                    },
                    {
                      id: "word",
                      label: "Export to Word",
                      icon: <FileDown size={12} />,
                      disabled: !minutes,
                      onSelect: exportToWord,
                    },
                    {
                      id: "pdf",
                      label: "Print / PDF",
                      icon: <Printer size={12} />,
                      disabled: !minutes,
                      onSelect: exportToPdf,
                    },
                    {
                      id: "public",
                      label: "Export public copy",
                      icon: <EyeOff size={12} />,
                      disabled: !minutes,
                      onSelect: exportPublicMinutes,
                    },
                  ],
                },
              ]}
            />
          </>
        }
      />

      <div className="meeting-detail-summary">
        <div>
          <span>Agenda topics</span>
          <strong>{agenda.length}</strong>
        </div>
        <div>
          <span>Attendees</span>
          <strong>{minutes?.attendees.length ?? meeting.attendeeIds?.length ?? 0}</strong>
        </div>
        <div>
          <span>Motions</span>
          <strong>{businessMotions.length}</strong>
        </div>
      <div>
        <span>Materials</span>
        <strong>{packageMaterials.length}</strong>
      </div>
    </div>

      <Tabs<MeetingDetailTab>
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { id: "overview", label: "Overview", icon: <ClipboardCheck size={12} /> },
          { id: "minutes", label: "Minutes", icon: <FileText size={12} /> },
          { id: "motions", label: "Motions", count: businessMotions.length, icon: <Gavel size={12} /> },
          { id: "package", label: "Package", count: packageMaterials.length, icon: <PackageCheck size={12} /> },
          { id: "export", label: "Export", icon: <Settings2 size={12} /> },
          { id: "sources", label: "Sources", count: linkedSourceCount, icon: <Download size={12} /> },
        ]}
      />

      <div className="meeting-detail-tabpanel">
        {activeTab === "overview" && (
          <div className="meeting-overview-grid">
            <MeetingSidebarColumn
              meeting={meeting}
              minutes={minutes}
              society={society}
              visiblePanels={meeting.type === "AGM" ? ["details", "agm"] : ["details"]}
              selectedMinutesExportStyle={selectedMinutesExportStyle}
              minutesExportStyle={minutesExportStyle}
              setMinutesExportStyle={setMinutesExportStyle}
              includeTranscriptInExport={includeTranscriptInExport}
              setIncludeTranscriptInExport={setIncludeTranscriptInExport}
              includeActionItemsInExport={includeActionItemsInExport}
              setIncludeActionItemsInExport={setIncludeActionItemsInExport}
              includeDiscussionSummaryInExport={includeDiscussionSummaryInExport}
              setIncludeDiscussionSummaryInExport={setIncludeDiscussionSummaryInExport}
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
            <MeetingSidebarColumn
              meeting={meeting}
              minutes={minutes}
              society={society}
              visiblePanels={["export"]}
              exportControlsReadOnly
              selectedMinutesExportStyle={selectedMinutesExportStyle}
              minutesExportStyle={minutesExportStyle}
              setMinutesExportStyle={setMinutesExportStyle}
              includeTranscriptInExport={includeTranscriptInExport}
              setIncludeTranscriptInExport={setIncludeTranscriptInExport}
              includeActionItemsInExport={includeActionItemsInExport}
              setIncludeActionItemsInExport={setIncludeActionItemsInExport}
              includeDiscussionSummaryInExport={includeDiscussionSummaryInExport}
              setIncludeDiscussionSummaryInExport={setIncludeDiscussionSummaryInExport}
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
              showExportGaps
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
        )}

        {activeTab === "minutes" && (
          <MeetingMinutesColumn
            minutes={minutes}
            agenda={agenda}
            agendaTree={agendaTree}
            agendaEdit={agendaEdit}
            setAgendaEdit={setAgendaEdit}
            saveAgenda={saveAgenda}
            attendanceEdit={attendanceEdit}
            setAttendanceEdit={setAttendanceEdit}
            startAttendanceEdit={startAttendanceEdit}
            saveAttendance={saveAttendance}
            quorumSnapshot={quorumSnapshot}
            quorumLegalGuides={quorumLegalGuides}
            members={members}
            directors={directors}
            saveMinuteSections={saveMinuteSections}
            saveMinuteMotions={saveMotions}
            addSectionToBacklog={addSectionToBacklog}
            onOpenMotions={() => setActiveTab("motions")}
            meetingTasks={linkedTasks}
            applyTaskUpdate={applyTaskUpdate}
            transcriptOnFile={transcriptOnFile}
            transcriptEdit={transcriptEdit}
            setTranscriptEdit={setTranscriptEdit}
            saveTranscriptEditText={saveTranscriptEditText}
            savingTranscript={savingTranscript}
          />
        )}

        {activeTab === "motions" && (
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Gavel size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                Motions
              </h2>
              {businessMotions.length ? (
                <span className="card__subtitle">
                  {businessMotions.filter((motion: any) => motion.outcome === "Carried").length} carried
                  {" / "}
                  {businessMotions.filter((motion: any) => motion.outcome === "Defeated").length} defeated
                  {" / "}
                  {businessMotions.filter((motion: any) => motion.outcome === "Tabled").length} tabled
                </span>
              ) : null}
              {minutes && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    className="btn-action btn-action--primary"
                    type="button"
                    onClick={() => motionEditorRef.current?.startAdding()}
                  >
                    <Plus size={12} /> Add motion
                  </button>
                </div>
              )}
            </div>
            <div className="card__body">
              {minutes ? (
                <MotionEditor
                  ref={motionEditorRef}
                  motions={minutes.motions as Motion[]}
                  directorNames={directorNames}
                  people={motionPeople}
                  agendaSections={(minutes.sections ?? []).map((section: any) => ({
                    title: section.title || "Untitled section",
                    discussion: section.discussion ?? "",
                    decisions: section.decisions ?? [],
                  }))}
                  onChange={saveMotions}
                  onAddToBacklog={addMotionToBacklog}
                  hideInlineAdd
                />
              ) : (
                <div className="muted">Create minutes before recording motions.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === "package" && (
          <MeetingPackageHub
            meeting={meeting}
            minutes={minutes}
            agenda={agenda}
            packageMaterials={packageMaterials}
            linkedTasks={linkedTasks}
            linkableTasks={linkableTasks}
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
            setLinkedTaskStatus={setLinkedTaskStatus}
            linkTaskToMeeting={linkTaskToMeeting}
            unlinkTaskFromMeeting={unlinkTaskFromMeeting}
            createTaskForMeeting={createTaskForMeeting}
          />
        )}

        {activeTab === "export" && (() => {
          const previewHtml = renderExportBody();
          // When there's nothing to render, drop the two-column layout so the
          // empty-state message takes the full width — the export sidebar's
          // controls aren't actionable until there's content anyway.
          if (!previewHtml) {
            return (
              <div className="minutes-preview-empty-screen">
                <FileText size={28} aria-hidden="true" />
                <strong>Nothing to render yet.</strong>
                <p className="muted">
                  Add agenda items, discussion notes, decisions, motions, or action items
                  on this meeting and they'll appear here in the selected export style
                  ({selectedMinutesExportStyle.label}).
                </p>
              </div>
            );
          }
          return (
            <div className="meeting-export-layout">
              <MeetingSidebarColumn
                meeting={meeting}
                minutes={minutes}
                society={society}
                visiblePanels={["export"]}
                selectedMinutesExportStyle={selectedMinutesExportStyle}
                minutesExportStyle={minutesExportStyle}
                setMinutesExportStyle={setMinutesExportStyle}
                includeTranscriptInExport={includeTranscriptInExport}
                setIncludeTranscriptInExport={setIncludeTranscriptInExport}
                includeActionItemsInExport={includeActionItemsInExport}
                setIncludeActionItemsInExport={setIncludeActionItemsInExport}
                includeDiscussionSummaryInExport={includeDiscussionSummaryInExport}
                setIncludeDiscussionSummaryInExport={setIncludeDiscussionSummaryInExport}
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
              <div className="minutes-preview minutes-preview--inline">
                <div className="minutes-preview__toolbar">
                  <div>
                    <strong>{selectedMinutesExportStyle.label}</strong>
                    <p className="muted">{selectedMinutesExportStyle.tone}</p>
                  </div>
                  <button className="btn-action" onClick={openMinutesPreviewPage}>
                    <ExternalLink size={12} /> Open separate page
                  </button>
                </div>
                <div className="minutes-preview__page" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            </div>
          );
        })()}

        {activeTab === "sources" && (
          <MeetingSidebarColumn
            meeting={meeting}
            minutes={minutes}
            society={society}
            visiblePanels={["sources", "transcript"]}
            selectedMinutesExportStyle={selectedMinutesExportStyle}
            minutesExportStyle={minutesExportStyle}
            setMinutesExportStyle={setMinutesExportStyle}
            includeTranscriptInExport={includeTranscriptInExport}
            setIncludeTranscriptInExport={setIncludeTranscriptInExport}
            includeActionItemsInExport={includeActionItemsInExport}
            setIncludeActionItemsInExport={setIncludeActionItemsInExport}
            includeDiscussionSummaryInExport={includeDiscussionSummaryInExport}
            setIncludeDiscussionSummaryInExport={setIncludeDiscussionSummaryInExport}
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
        )}
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

function inferAgendaSectionType(title: string) {
  const normalized = title.toLowerCase();
  if (/\bmotion|resolution|approve|approval|vote\b/.test(normalized)) return "motion";
  if (/\breport|financial|treasurer|chair|committee\b/.test(normalized)) return "report";
  if (/\bbreak|recess\b/.test(normalized)) return "break";
  if (/\bin[ -]?camera|executive session|closed session\b/.test(normalized)) return "executive_session";
  if (/\badjourn\b/.test(normalized)) return "other";
  return "discussion";
}

export function MeetingMinutesPreviewPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const [minutesExportStyle, setMinutesExportStyle] = useState<MinutesExportStyleId>(readStoredMinutesStyle);
  const [includeTranscriptInExport, setIncludeTranscriptInExport] = useState(() => readStoredExportBool("includeTranscript", true));
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

  if (society === undefined || !meeting || minutes === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!minutes) return <div className="page">No minutes recorded for this meeting.</div>;

  const agendaTree = parseAgendaItems(meeting.agendaJson);
  const agenda = parseAgenda(meeting.agendaJson);
  const quorumSnapshot = getQuorumSnapshot(minutes, meeting);
  const selectedMinutesExportStyle =
    MINUTES_EXPORT_STYLES.find((style) => style.id === minutesExportStyle) ??
    MINUTES_EXPORT_STYLES[0];

  const bodyHtml = renderMinutesHtml({
    society: { name: society.name, incorporationNumber: society.incorporationNumber ?? null },
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
    styleId: minutesExportStyle,
    options: {
      includeTranscript: includeTranscriptInExport,
      includeActionItems: includeActionItemsInExport,
      includeDiscussionSummary: includeDiscussionSummaryInExport,
      includeApprovalBlock: includeApprovalInExport,
      includeSignatures: includeSignaturesInExport,
      includePlaceholders: includePlaceholdersInExport,
    },
  });

  const exportPreviewToWord = () => {
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    exportWordDocx({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.docx`,
      title: `${meeting.title} — Minutes`,
      bodyHtml,
    });
  };

  const printPreview = () => {
    openPrintableDocument({
      title: `${meeting.title} — Minutes`,
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
          <button className="btn-action" onClick={printPreview}>
            <Printer size={12} /> Print / PDF
          </button>
        </div>
      </div>

      <div className="meeting-preview-page__layout">
        <aside className="meeting-preview-page__settings">
          <Field label="Style">
            <select className="input" value={minutesExportStyle} onChange={(event) => setMinutesExportStyle(event.target.value as MinutesExportStyleId)}>
              {MINUTES_EXPORT_STYLES.map((style) => (
                <option key={style.id} value={style.id}>{style.label}</option>
              ))}
            </select>
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
            <div className="minutes-preview__page" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
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
