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
import { ArrowLeft, BookMarked, ClipboardCheck, Download, ExternalLink, FileDown, FileText, Gavel, MoreHorizontal, PackageCheck, Plus, Printer, RotateCcw, Settings2 } from "lucide-react";
import { MotionEditor, isAdjournmentMotion, motionPersonDisplayName, type Motion, type MotionEditorHandle } from "../components/MotionEditor";
import { escapeHtml } from "../lib/html";
import { exportWordDocx } from "../lib/docx";
import { exportPdfDownload } from "../lib/pdf";
import { downloadStoredZip } from "../lib/zip";
import {
  MINUTES_EXPORT_STYLES,
  MinutesExportStyleId,
  getMinutesStyleGaps,
  renderMinutesHtml,
} from "../features/meetings/lib/minutesRenderer";
import { redactText, RedactOptions } from "../lib/redactPii";
import { getLegalGuideRules, resolveJurisdictionCode } from "../lib/jurisdictionGuideTracks";
import {
  buildAccessGrantCandidates,
  getPackageReadiness,
  grantKey,
  materialEffectiveStatus,
} from "../features/meetings/lib/meetingMaterialAccess";
import {
  agendaEntriesFromRecord,
  agendaItemsFromRecord,
  attendanceRowsForDirectors,
  buildEmlMessage,
  buildMeetingOutboxEmail,
  hasStartedMinutesDraft,
  isCurrentDirector,
  sanitizeAttachmentFileName,
  slugifyFilePart,
} from "../features/meetings/lib/meetingDetailHelpers";
import { renderMeetingPackHtml } from "../features/meetings/lib/meetingPackExport";
import { MeetingMaterialDrawer } from "../features/meetings/components/MeetingMaterialDrawer";
import { MeetingPackageHub } from "../features/meetings/components/MeetingPackageHub";
import { MeetingMinutesColumn } from "../features/meetings/components/MeetingMinutesColumn";
import { MeetingSidebarColumn } from "../features/meetings/components/MeetingSidebarColumn";
import { MinutesDraftEmptyState } from "../features/meetings/components/MinutesDraftEmptyState";
import { MinutesDocumentPreview } from "../features/meetings/components/MinutesDocumentPreview";
import { useConfirm } from "../components/Modal";
import { Select } from "../components/Select";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  MINUTES_EXPORT_PREF_PREFIX,
  readStoredExportBool,
  readStoredMinutesStyle,
} from "../features/meetings/lib/minutesExportPrefs";
import {
  addRedactionName,
  getMeetingJoinDetails,
  getPackageReviewBlockers,
  getQuorumSnapshot,
  importTranscriptNote,
  inferredPackageReviewStatus,
  isImportTranscriptMetadata,
  namesFromDiscussion,
  parseAgendaItems,
  parseDocumentMetadata,
  type AgendaItemEntry,
  personLinkCandidates,
  sourceExternalIdsForMinutes,
} from "../features/meetings/components/MeetingDetailSupport";
type MeetingDetailTab = "overview" | "minutes" | "motions" | "package" | "export" | "sources";

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const agendaRecord = useQuery(api.agendas.getForMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
  const meetingPackage = useQuery(
    api.meetingMaterials.packageForMeeting,
    id ? { meetingId: id as Id<"meetings">, actingUserId } : "skip",
  );
  const sourceDocumentIds = ((minutes as any)?.sourceDocumentIds ?? []) as Id<"documents">[];
  const sourceDocuments = useQuery(
    api.documents.getMany,
    sourceDocumentIds.length > 0 ? { ids: sourceDocumentIds, actingUserId } : "skip",
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
  const allDocuments = useQuery(api.documents.list, society ? { societyId: society._id, actingUserId } : "skip");
  // Sibling meetings power the "approved at meeting" picker — minutes are
  // typically adopted at a later meeting, so we let the user point at it.
  const allMeetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
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
  const syncAgendaForMeeting = useMutation(api.agendas.syncForMeeting);
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
  const confirm = useConfirm();
  const vttInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const motionEditorRef = useRef<MotionEditorHandle | null>(null);
  // Dedupes concurrent ensureMinutes() calls — without this, rapid motion
  // saves before the `minutes` query refreshes would each trigger their own
  // createMinutes insert, leaving orphan records.
  const ensureMinutesInFlight = useRef<Promise<Id<"minutes"> | null> | null>(null);
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
  // Drawer state for recording minutes approval (date + the meeting at which
  // the minutes were adopted). null = closed.
  const [approvalEdit, setApprovalEdit] = useState<{ approvedAt: string; approvedInMeetingId: string } | null>(null);
  const [minutesExportStyle, setMinutesExportStyle] = useState<MinutesExportStyleId>(readStoredMinutesStyle);
  const [includeTranscriptInExport, setIncludeTranscriptInExport] = useState(() => readStoredExportBool("includeTranscript", false));
  const [includeActionItemsInExport, setIncludeActionItemsInExport] = useState(() => readStoredExportBool("includeActionItems", true));
  const [includeDiscussionSummaryInExport, setIncludeDiscussionSummaryInExport] = useState(() => readStoredExportBool("includeDiscussionSummary", false));
  const [includeApprovalInExport, setIncludeApprovalInExport] = useState(() => readStoredExportBool("includeApproval", true));
  const [includeSignaturesInExport, setIncludeSignaturesInExport] = useState(() => readStoredExportBool("includeSignatures", true));
  const [includePlaceholdersInExport, setIncludePlaceholdersInExport] = useState(() => readStoredExportBool("includePlaceholders", false));
  // Always default OFF on page load: persisting would risk a user reopening the
  // tab and silently re-exporting a redacted file thinking it's the full copy.
  const [publicCopyMode, setPublicCopyMode] = useState(false);
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

  // Generates a minutes draft. With no argument, uses the transcript on file
  // (or the local edit buffer if the user is mid-edit). Pass `overrideText`
  // to draft from a pasted/inline transcript without it having to be saved as
  // a transcript record first — used by the Minutes-tab empty-state CTA.
  // Defined above the early returns because the `?intent=draft-minutes`
  // effect needs to call it.
  const runGenerate = async (overrideText?: string) => {
    if (!meeting) {
      toast.error("Meeting not loaded yet.");
      return;
    }
    const draftRaw = String(minutes?.draftTranscript ?? "");
    const draftMeta = parseDocumentMetadata(draftRaw);
    const draftIsImportMeta = isImportTranscriptMetadata(draftMeta);
    const onFile = transcriptRecord?.text ?? (draftIsImportMeta ? "" : draftRaw);
    const sourceTranscript = (overrideText ?? "").trim() || transcript.trim() || onFile.trim();
    if (!sourceTranscript) {
      toast.error("Add a transcript first.");
      return;
    }
    setBusy(true);
    try {
      await generate({ meetingId: meeting._id, transcript: sourceTranscript });
      setTranscript("");
      toast.success("Minutes drafted from transcript.");
    } catch (err: any) {
      toast.error(err?.message ?? "Drafting minutes failed");
    } finally {
      setBusy(false);
    }
  };

  // Wrapper for the Sources-tab "Draft from transcript" button — guards
  // against silently overwriting minutes the user has already started or
  // approved. Empty-state CTA paths skip this wrapper since the CTA only
  // renders when minutes are still a skeleton.
  const runGenerateWithOverwriteGuard = async () => {
    if (hasStartedMinutesDraft(minutes)) {
      const ok = await confirm({
        title: "Replace existing minutes?",
        message: minutes?.approvedAt
          ? "These minutes have been approved. Re-drafting will overwrite the existing minutes — including the approval record."
          : "These minutes already have content. Re-drafting will overwrite what's there with a fresh AI draft from the transcript on file.",
        confirmLabel: "Replace minutes",
        tone: "warn",
      });
      if (!ok) return;
    }
    await runGenerate();
  };

  // Used by the Minutes-tab empty-state CTA when a user pastes a transcript
  // inline. Saves it as the meeting's canonical transcript first so it isn't
  // lost on reload, then runs the AI draft against the same text.
  const draftFromPastedTranscript = async (pastedText: string) => {
    if (!meeting) {
      toast.error("Meeting not loaded yet.");
      return;
    }
    const trimmed = pastedText.trim();
    if (!trimmed) {
      toast.error("Paste a transcript first.");
      return;
    }
    setBusy(true);
    try {
      await saveTranscriptText({
        societyId: meeting.societyId,
        meetingId: meeting._id,
        text: trimmed,
        provider: "manual",
      });
      await generate({ meetingId: meeting._id, transcript: trimmed });
      toast.success("Minutes drafted from pasted transcript.");
    } catch (err: any) {
      toast.error(err?.message ?? "Drafting minutes failed");
    } finally {
      setBusy(false);
    }
  };

  // Handles the `?intent=draft-minutes` handoff from the DraftMinutesPicker
  // quick action. Always lands the user on the Minutes tab — never auto-
  // switches to Sources — because the Minutes tab now has its own draft CTA
  // (paste, upload, or one-click from a saved transcript). Auto-fire only
  // when minutes are still a skeleton AND a transcript is already on file;
  // otherwise the user makes the call from the CTA. Ref-gated so this only
  // fires once per arrival.
  const handledDraftIntentRef = useRef(false);
  useEffect(() => {
    if (handledDraftIntentRef.current) return;
    if (searchParams.get("intent") !== "draft-minutes") return;
    if (!meeting) return;
    if (transcriptRecord === undefined) return;
    if (minutes === undefined) return;
    handledDraftIntentRef.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("intent");
        if (next.get("tab") !== "minutes") next.set("tab", "minutes");
        return next;
      },
      { replace: true },
    );
    if (hasStartedMinutesDraft(minutes)) {
      // Don't auto-clobber existing work — the user can hit the explicit
      // re-draft button if that's what they meant.
      toast.info("Minutes already drafted. Edit below or use the Draft button to re-run.");
      return;
    }
    const onFile = (transcriptRecord?.text ?? "").trim();
    if (onFile) {
      void runGenerate();
    } else {
      toast.info("Paste a transcript or upload audio below to draft these minutes.");
    }
  }, [meeting?._id, minutes, transcriptRecord, searchParams, setSearchParams]);

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

  const agendaTree = agendaEntriesFromRecord(agendaRecord) ?? parseAgendaItems(meeting.agendaJson);
  const canonicalAgendaItems = agendaItemsFromRecord(agendaRecord);
  const agenda = agendaTree.map((entry) => entry.title);
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
  // Compute the gap report against a stub minutes when none has been
  // bootstrapped yet, so the Overview/Export panel surfaces what's missing
  // from the start (attendance, motions, chair/secretary, etc.) instead of
  // showing an empty placeholder until the user saves the agenda.
  const minutesExportGaps = getMinutesStyleGaps({
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
      heldAt: minutes?.heldAt ?? meeting.scheduledAt,
      chairName: minutes?.chairName ?? null,
      secretaryName: minutes?.secretaryName ?? null,
      recorderName: minutes?.recorderName ?? null,
      calledToOrderAt: minutes?.calledToOrderAt ?? null,
      adjournedAt: minutes?.adjournedAt ?? null,
      remoteParticipation: minutes?.remoteParticipation ?? null,
      detailedAttendance: minutes?.detailedAttendance ?? null,
      attendees: minutes?.attendees ?? [],
      absent: minutes?.absent ?? [],
      quorumMet: minutes?.quorumMet ?? false,
      quorumRequired: quorumSnapshot.required,
      quorumSourceLabel: quorumSnapshot.label,
      discussion: minutes?.discussion ?? "",
      sections: minutes?.sections ?? null,
      motions: (minutes?.motions ?? []) as any,
      decisions: minutes?.decisions ?? [],
      actionItems: (minutes?.actionItems ?? []) as any,
      approvedAt: minutes?.approvedAt ?? null,
      nextMeetingAt: minutes?.nextMeetingAt ?? null,
      nextMeetingLocation: minutes?.nextMeetingLocation ?? null,
      nextMeetingNotes: minutes?.nextMeetingNotes ?? null,
      sessionSegments: minutes?.sessionSegments ?? null,
      appendices: minutes?.appendices ?? null,
      agmDetails: minutes?.agmDetails ?? null,
      draftTranscript: minutes?.draftTranscript ?? null,
    },
  });
  const transcriptStatusTone =
    transcriptionJob?.status === "complete"
      ? "success"
      : transcriptionJob?.status === "failed"
      ? "danger"
      : "warn";
  const packageMaterials = meetingPackage?.materials ?? [];
  const linkedTasks = meetingPackage?.tasks ?? [];
  const linkableTasks = ((societyTasks ?? []) as any[]).filter((task: any) => !task.meetingId);
  const currentDirectors = ((directors ?? []) as any[]).filter(isCurrentDirector);
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

  // Notice tracking for regular meetings (the AGM workflow has its own step).
  // Toggling is reversible, so no confirm — clearing sets the field to
  // undefined, which Convex removes from the record.
  const toggleNoticeSent = async () => {
    await updateMeeting({
      id: meeting._id,
      patch: { noticeSentAt: meeting.noticeSentAt ? undefined : new Date().toISOString() },
    });
    toast.success(
      meeting.noticeSentAt ? "Notice cleared" : "Notice marked sent",
      meeting.noticeSentAt
        ? "The meeting no longer has a notice-sent date."
        : `Recorded ${formatDate(new Date().toISOString())}.`,
    );
  };

  // Record/clear approval of THIS meeting's minutes. Minutes are normally
  // adopted at a later meeting, so the drawer captures both the approval date
  // and (optionally) which meeting adopted them.
  const startApprovalEdit = () => {
    if (!minutes) return;
    setApprovalEdit({
      approvedAt: (minutes.approvedAt ?? new Date().toISOString()).slice(0, 10),
      approvedInMeetingId: (minutes.approvedInMeetingId as string | undefined) ?? "",
    });
  };
  const saveApproval = async () => {
    if (!minutes || !approvalEdit) return;
    await updateMinutes({
      id: minutes._id,
      patch: {
        approvedAt: new Date(`${approvalEdit.approvedAt}T00:00:00`).toISOString(),
        approvedInMeetingId: approvalEdit.approvedInMeetingId
          ? (approvalEdit.approvedInMeetingId as Id<"meetings">)
          : undefined,
      },
    });
    setApprovalEdit(null);
    toast.success("Minutes approval recorded", `Approved ${formatDate(approvalEdit.approvedAt)}.`);
  };
  const clearApproval = async () => {
    if (!minutes) return;
    await updateMinutes({ id: minutes._id, patch: { approvedAt: undefined, approvedInMeetingId: undefined } });
    setApprovalEdit(null);
    toast.success("Approval cleared", "These minutes are no longer marked approved.");
  };

  // Section indices to omit from the public copy. A depth=0 (root) section
  // flagged publicVisible:false cascades to its trailing depth=1 children —
  // they belong to the same agenda group, so hiding the root hides them too.
  // A depth=1 section can be hidden on its own without affecting siblings.
  const computeHiddenSectionIndices = (sections: any[]): Set<number> => {
    const hidden = new Set<number>();
    for (let i = 0; i < sections.length; i += 1) {
      const section = sections[i];
      if (section?.publicVisible === false) {
        hidden.add(i);
        if ((section?.depth ?? 0) === 0) {
          for (let j = i + 1; j < sections.length && (sections[j]?.depth ?? 0) === 1; j += 1) {
            hidden.add(j);
          }
        }
      }
    }
    return hidden;
  };

  const minutesRenderPayload = (redact?: (value: string) => string, publicOnly = false) => {
    if (!minutes) return null;
    const tx = (value?: string | null) => (value && redact ? redact(value) : value);
    // When publicOnly is set, drop sections the user has flagged as private.
    // Motions reference their section by index, so we have to remap the
    // surviving motions' sectionIndex to the new positions; motions assigned
    // to a removed section are dropped entirely. Unassigned motions pass
    // through unchanged.
    const rawSections = (minutes.sections ?? []) as any[];
    const hiddenIndices = publicOnly ? computeHiddenSectionIndices(rawSections) : new Set<number>();
    const sectionIndexRemap = new Map<number, number>();
    let nextSectionIndex = 0;
    rawSections.forEach((_, i) => {
      if (!hiddenIndices.has(i)) sectionIndexRemap.set(i, nextSectionIndex++);
    });
    const visibleSections = rawSections.filter((_, i) => !hiddenIndices.has(i));
    const visibleMotions = publicOnly
      ? (minutes.motions as any[]).filter((m) => m.sectionIndex == null || !hiddenIndices.has(m.sectionIndex))
      : (minutes.motions as any[]);
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
      sections: visibleSections.map((section: any) => ({
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
      motions: visibleMotions.map((m) => ({
        ...m,
        text: tx(m.text) ?? "",
        movedBy: tx(motionPersonDisplayName(m.movedBy, motionPeople, { memberId: m.movedByMemberId, directorId: m.movedByDirectorId })),
        secondedBy: tx(motionPersonDisplayName(m.secondedBy, motionPeople, { memberId: m.secondedByMemberId, directorId: m.secondedByDirectorId })),
        sectionIndex: publicOnly && m.sectionIndex != null ? sectionIndexRemap.get(m.sectionIndex) : m.sectionIndex,
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

  // True when there's anything worth putting in the export: at least one
  // agenda item, a non-empty section, a motion, a decision, an action item,
  // or some discussion text. Once a user deletes every agenda item, an
  // auto-bootstrapped minutes record can still produce a "valid" but
  // contentless preview (just attendance + quorum) — this check folds that
  // case back into the empty state.
  const hasExportableContent = (() => {
    if (agendaTree.length > 0) return true;
    if (!minutes) return false;
    if ((minutes.discussion ?? "").trim()) return true;
    const sections = (minutes.sections ?? []) as any[];
    if (sections.some((section) =>
      (section.title ?? "").trim() ||
      (section.discussion ?? "").trim() ||
      (section.decisions ?? []).some((d: string) => (d ?? "").trim()) ||
      (section.actionItems ?? []).length > 0,
    )) return true;
    if (((minutes.motions ?? []) as any[]).length > 0) return true;
    if (((minutes.decisions ?? []) as string[]).some((d) => (d ?? "").trim())) return true;
    if (((minutes.actionItems ?? []) as any[]).length > 0) return true;
    return false;
  })();

  const renderExportBody = (redact?: (value: string) => string, publicOnly = false) => {
    const payload = minutesRenderPayload(redact, publicOnly);
    if (!payload || !hasExportableContent) return "";
    // Sections and agendaTree are seeded in lockstep (index N in sections maps
    // to entry N in agendaTree), so we reuse the section-hide set to strip
    // matching agenda entries. Without this filter, the "Agenda Items" header
    // some styles render (numbered-agenda, formal-agm) still leaks hidden
    // titles even though the section bodies and motions are gone.
    const hiddenIndices = publicOnly && minutes
      ? computeHiddenSectionIndices((minutes.sections ?? []) as any[])
      : new Set<number>();
    const visibleAgendaTree = hiddenIndices.size
      ? agendaTree.filter((_, i) => !hiddenIndices.has(i))
      : agendaTree;
    return renderMinutesHtml({
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

  // Both export buttons funnel through this so the Public-copy toggle picks
  // the same redact function, file slug, and dialog title regardless of
  // format. Returns null when there's nothing to export.
  const buildExportArgs = (extension: "docx" | "pdf") => {
    if (!meeting || !minutes || !society) return null;
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const redact = publicCopyMode ? (s: string) => redactText(s, redactOpts()) : undefined;
    const bodyHtml = renderExportBody(redact, publicCopyMode);
    const slug = publicCopyMode ? "public-minutes" : "minutes";
    const titleSuffix = publicCopyMode ? "Public minutes" : "Minutes";
    return {
      filename: `${safe}-${slug}-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.${extension}`,
      title: `${meeting.title} — ${titleSuffix}`,
      bodyHtml,
    };
  };

  const exportToWord = () => {
    const args = buildExportArgs("docx");
    if (!args) return;
    void exportWordDocx(args);
    toast.success(
      publicCopyMode ? "Public minutes exported" : "Minutes exported",
      publicCopyMode
        ? "Word (.docx) with PII redacted and hidden sections stripped."
        : "Downloaded as a Word (.docx) document.",
    );
  };

  const exportToPdf = async () => {
    const args = buildExportArgs("pdf");
    if (!args) return;
    await exportPdfDownload(args);
    toast.success(
      publicCopyMode ? "Public PDF exported" : "PDF exported",
      publicCopyMode
        ? "PDF with PII redacted and hidden sections stripped."
        : "Downloaded as a PDF file.",
    );
  };

  const openMinutesPreviewPage = () => {
    if (!meeting || !minutes) return;
    window.open(`/app/meetings/${meeting._id}/preview`, "_blank", "noopener,noreferrer");
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

  // Auto-bootstrap a minimal minutes record so motions can be recorded even
  // before an agenda has been saved. Mirrors the bootstrap done by saveAgenda
  // but with empty sections, so the Motions tab is no longer a dead end when
  // the user hasn't touched the agenda yet.
  const ensureMinutes = async (): Promise<Id<"minutes"> | null> => {
    if (minutes) return minutes._id;
    if (ensureMinutesInFlight.current) return ensureMinutesInFlight.current;
    const attendees = Array.isArray(meeting.attendeeIds) ? meeting.attendeeIds.map(String) : [];
    const quorumRequired = quorumSnapshot.required ?? meeting.quorumRequired;
    const promise = (async () =>
      await createMinutes({
        societyId: meeting.societyId,
        meetingId: meeting._id,
        heldAt: meeting.scheduledAt,
        attendees,
        absent: [],
        quorumMet: quorumRequired == null ? false : attendees.length >= quorumRequired,
        quorumRequired: quorumRequired ?? undefined,
        discussion: "",
        sections: [],
        motions: [],
        decisions: [],
        actionItems: [],
      }))();
    ensureMinutesInFlight.current = promise;
    try {
      return await promise;
    } finally {
      ensureMinutesInFlight.current = null;
    }
  };

  const saveMotions = async (next: Motion[]) => {
    const minutesId = minutes?._id ?? (await ensureMinutes());
    if (!minutesId) return;
    await updateMinutes({ id: minutesId, patch: { motions: next } });
  };

  const saveMinuteSections = async (next: any[]) => {
    if (!minutes) return;
    await updateMinutes({ id: minutes._id, patch: { sections: next } });
    // Keep meeting.agendaJson in sync with section titles AND depth so the
    // sidebar agenda card and the right-side Agenda record never drift apart.
    // Tracked alongside the source section so duplicate-titled sections each
    // contribute their own presenter/details instead of all collapsing to the
    // first match via title-based find().
    const nextAgenda: Array<AgendaItemEntry & { source: any }> = [];
    let hasRoot = false;
    for (const section of next) {
      const title = String(section?.title ?? "").trim();
      if (!title) continue;
      const rawDepth = section?.depth === 1 ? 1 : 0;
      // A child without a preceding root is impossible on the agenda side, so
      // demote leading children to roots to stay consistent.
      const depth: 0 | 1 = rawDepth === 1 && hasRoot ? 1 : 0;
      nextAgenda.push({ title, depth, source: section });
      if (depth === 0) hasRoot = true;
    }
    await syncAgendaForMeeting({
      societyId: meeting.societyId,
      meetingId: meeting._id,
      title: agendaRecord?.agenda?.title || `${meeting.title} agenda`,
      items: nextAgenda.map((entry) => ({
        title: entry.title,
        depth: entry.depth,
        // Honour the saved section type (set via the Motion/Report pills in
        // the section header) ahead of title-based inference, otherwise the
        // agenda re-sync silently overwrites the user's pill choice on save.
        type: entry.source?.type || inferAgendaSectionType(entry.title),
        presenter: entry.source?.presenter || undefined,
        details: entry.source?.discussion || undefined,
      })),
    });
    await updateMeeting({
      id: meeting._id,
      patch: {
        agendaJson: JSON.stringify(
          nextAgenda.map(({ title, depth }) => ({ title, depth })),
        ),
      },
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

    await syncAgendaForMeeting({
      societyId: meeting.societyId,
      meetingId: meeting._id,
      title: agendaRecord?.agenda?.title || `${meeting.title} agenda`,
      items: cleaned.map((entry) => ({
        title: entry.title,
        depth: entry.depth,
        type: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.type ?? inferAgendaSectionType(entry.title),
        presenter: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.presenter,
        details: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.details,
        timeAllottedMinutes: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.timeAllottedMinutes,
        motionTemplateId: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.motionTemplateId,
        motionBacklogId: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.motionBacklogId,
        motionText: canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase())?.motionText,
      })),
    });
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
        sections: next.map((entry) => {
          const metadata = canonicalAgendaItems?.find((item) => item.title.trim().toLowerCase() === entry.title.trim().toLowerCase());
          return {
            ...buildSectionFromTitle(entry.title, entry.depth),
            type: metadata?.type ?? inferAgendaSectionType(entry.title),
            presenter: metadata?.presenter,
            discussion: metadata?.details ?? "",
          };
        }),
        motions: (canonicalAgendaItems ?? [])
          .map((item, index) => ({
            text: String(item.motionText ?? "").trim(),
            outcome: "Pending",
            resolutionType: "Ordinary",
            sectionIndex: index,
            sectionTitle: item.title,
          }))
          .filter((motion) => motion.text),
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

      // Queue per-title so each duplicate-titled agenda entry consumes its own
      // matching section instead of all resolving to the first one (which
      // would clobber sibling sections' content).
      const sectionsByTitle = new Map<string, any[]>();
      for (const section of existingSections) {
        const key = normalize(section?.title ?? "");
        if (!key) continue;
        const queue = sectionsByTitle.get(key) ?? [];
        queue.push(section);
        sectionsByTitle.set(key, queue);
      }

      // Preserve existing section content when titles match; always overwrite
      // depth from the agenda since the agenda is the source of truth for
      // hierarchy. Brand-new titles get a fresh empty section at the correct
      // depth.
      const aligned = next.map((entry) => {
        const existing = sectionsByTitle.get(normalize(entry.title))?.shift();
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
    setAttendanceEdit({
      people: existing,
      quorumMet: minutes.quorumMet,
    });
  };

  const autofillCurrentDirectors = () => {
    const directorRows = attendanceRowsForDirectors(currentDirectors);
    if (!directorRows.length) {
      toast.info("No current directors found", "Directors must be active and not past their end date.");
      return;
    }
    const existing = attendanceEdit?.people ?? [];
    const existingNames = new Set(existing.map((person: any) => person.name.trim().toLowerCase()).filter(Boolean));
    const additions = directorRows.filter((person) => !existingNames.has(person.name.toLowerCase()));
    setAttendanceEdit({
      people: [...existing, ...additions],
      quorumMet: attendanceEdit?.quorumMet ?? minutes?.quorumMet ?? false,
    });
    toast.success("Current directors added", `${additions.length} director${additions.length === 1 ? "" : "s"} added to attendance.`);
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
      society: society
        ? {
            name: society.name,
            incorporationNumber: society.incorporationNumber ?? null,
            logoUrl: (society as any).logoUrl ?? null,
            letterheadUrl: (society as any).letterheadUrl ?? null,
          }
        : undefined,
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

  const downloadOutboxPackage = async () => {
    if (!meeting || !society) return;
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const subject = `${meeting.title} package - ${formatDateTime(meeting.scheduledAt)}`;
    const materials = packageMaterials.map((material: any, index: number) => {
      const doc = material.document ?? {};
      return {
        number: index + 1,
        label: material.label || doc.title || "Document",
        agendaLabel: material.agendaLabel || "General materials",
        fileName: doc.fileName ?? null,
        paperlessUrl: doc.paperlessDocumentUrl ?? doc.paperlessUrl ?? null,
        paperlessId: doc.paperlessDocumentId ?? null,
        documentId: doc._id ?? material.documentId ?? null,
        downloadUrl: doc.downloadUrl ?? null,
        mimeType: doc.mimeType ?? "application/octet-stream",
        content: doc.content ?? null,
        url: doc.url ?? null,
        storage: doc.storageId || doc.storageKey ? "Uploaded in Societyer" : "Reference only",
        notes: material.notes ?? "",
      };
    });
    const packHtml = renderMeetingPackHtml({
      society: {
        name: society.name,
        incorporationNumber: society.incorporationNumber ?? null,
        logoUrl: (society as any).logoUrl ?? null,
        letterheadUrl: (society as any).letterheadUrl ?? null,
      },
      meeting,
      agenda,
      materials: packageMaterials,
      tasks: linkedTasks,
      minutes,
      joinDetails,
    });
    const body = buildMeetingOutboxEmail({
      societyName: society.name,
      meeting,
      joinDetails,
      materials,
      packageReviewStatus,
      packageReviewBlockers,
    });
    const files: Record<string, string | Uint8Array | ArrayBuffer | Blob> = {
      "email/subject.txt": subject,
      "email/body.txt": body,
      "meeting-pack.html": packHtml,
      "agenda.txt": agenda.length ? agenda.map((item, index) => `${index + 1}. ${item}`).join("\n") : "No agenda items recorded.",
      "attachments-manifest.json": JSON.stringify({
        generatedAtISO: new Date().toISOString(),
        society: society.name,
        meeting: {
          id: meeting._id,
          title: meeting.title,
          type: meeting.type,
          scheduledAt: meeting.scheduledAt,
          location: meeting.location ?? null,
          packageReviewStatus,
        },
        materials,
        tasks: linkedTasks.map((task: any) => ({
          id: task._id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate ?? null,
        })),
        note: "When source files were available to this browser, binary attachments are embedded under attachments/files and in email/message.eml. Reference-only records include .txt and .url files.",
      }, null, 2),
    };
    if (minutes) {
      files["minutes-preview.html"] = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(meeting.title)} minutes</title></head><body>${renderExportBody()}</body></html>`;
    }
    const emlAttachments: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }> = [];
    const failedDownloads: string[] = [];
    for (const material of materials) {
      const slug = `${String(material.number).padStart(2, "0")}-${slugifyFilePart(material.label)}`;
      files[`attachments/${slug}.txt`] = [
        `Label: ${material.label}`,
        `Agenda: ${material.agendaLabel}`,
        `Document ID: ${material.documentId ?? "not linked"}`,
        `File name: ${material.fileName ?? "metadata only"}`,
        `Paperless ID: ${material.paperlessId ?? "not linked"}`,
        `Paperless URL: ${material.paperlessUrl ?? "not linked"}`,
        `Storage: ${material.storage}`,
        `Source URL: ${material.url ?? "not linked"}`,
        `Download URL embedded: ${material.downloadUrl ? "yes" : "no"}`,
        material.notes ? `Notes: ${material.notes}` : "",
      ].filter(Boolean).join("\n");
      if (material.paperlessUrl) {
        files[`attachments/${slug}.url`] = `[InternetShortcut]\nURL=${material.paperlessUrl}\n`;
      }
      if (material.url) {
        files[`attachments/${slug}-source.url`] = `[InternetShortcut]\nURL=${material.url}\n`;
      }
      const fileName = sanitizeAttachmentFileName(
        material.fileName || `${slug}${material.content ? ".txt" : ".bin"}`,
        `${slug}.bin`,
      );
      if (material.content) {
        const textName = fileName.includes(".") ? fileName : `${fileName}.txt`;
        files[`attachments/files/${slug}-${textName}`] = material.content;
        emlAttachments.push({
          fileName: textName,
          mimeType: material.mimeType || "text/plain",
          bytes: new TextEncoder().encode(material.content),
        });
      } else if (material.downloadUrl) {
        try {
          const response = await fetch(material.downloadUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          files[`attachments/files/${slug}-${fileName}`] = bytes;
          emlAttachments.push({
            fileName,
            mimeType: material.mimeType || response.headers.get("content-type") || "application/octet-stream",
            bytes,
          });
        } catch (err: any) {
          failedDownloads.push(`${material.label}: ${err?.message ?? "download failed"}`);
        }
      }
    }
    files["email/message.eml"] = buildEmlMessage({ subject, body, attachments: emlAttachments });
    if (failedDownloads.length) {
      files["attachments/download-errors.txt"] = failedDownloads.join("\n");
    }
    downloadStoredZip({
      filename: `${safe}-outbox-package-${formatDate(meeting.scheduledAt, "yyyy-MM-dd")}.zip`,
      files,
    });
    toast.success(
      "Outbox package generated",
      emlAttachments.length
        ? `ZIP includes ${emlAttachments.length} binary attachment${emlAttachments.length === 1 ? "" : "s"} and an openable .eml draft.`
        : "ZIP includes an openable .eml draft plus references for materials without downloadable files.",
    );
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
  const createTaskForMeeting = async (input: { title: string; priority: string; status: string; dueDate?: string }): Promise<string | undefined> => {
    if (!society || !meeting?._id) return undefined;
    const taskId = await createTask({
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
    return taskId ? String(taskId) : undefined;
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
                  id: "governance",
                  label: "Governance",
                  items: [
                    {
                      id: "notice-sent",
                      label: meeting.noticeSentAt ? "Clear notice sent" : "Mark notice sent",
                      icon: <ClipboardCheck size={12} />,
                      onSelect: toggleNoticeSent,
                    },
                    {
                      id: "record-approval",
                      label: minutes?.approvedAt ? "Edit minutes approval" : "Record minutes approval",
                      icon: <FileText size={12} />,
                      disabled: !minutes,
                      onSelect: startApprovalEdit,
                    },
                  ],
                },
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
                      label: "Export PDF",
                      icon: <Printer size={12} />,
                      disabled: !minutes,
                      onSelect: exportToPdf,
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
          { id: "minutes", label: "Agenda & minutes", icon: <FileText size={12} /> },
          { id: "motions", label: "Motions", count: businessMotions.length, icon: <Gavel size={12} /> },
          { id: "package", label: "Package", count: packageMaterials.length, icon: <PackageCheck size={12} /> },
          { id: "export", label: "Export", icon: <Settings2 size={12} /> },
          { id: "sources", label: "Sources", count: linkedSourceCount, icon: <Download size={12} /> },
        ]}
      />

      <div className="meeting-detail-tabpanel">
        {activeTab === "overview" && (
          <>
          <div className="meeting-governance-strip">
            <div className="meeting-governance-strip__item">
              <div className="meeting-governance-strip__label">Notice of meeting</div>
              <div className="meeting-governance-strip__value">
                {meeting.noticeSentAt ? (
                  <Badge tone="success">Sent {formatDate(meeting.noticeSentAt)}</Badge>
                ) : (
                  <Badge tone="warn">Not sent</Badge>
                )}
              </div>
              <button className="btn-action" type="button" onClick={toggleNoticeSent}>
                {meeting.noticeSentAt ? "Clear" : "Mark sent"}
              </button>
            </div>
            <div className="meeting-governance-strip__item">
              <div className="meeting-governance-strip__label">Minutes approval</div>
              <div className="meeting-governance-strip__value">
                {minutes?.approvedAt ? (
                  <Badge tone="success">
                    Approved {formatDate(minutes.approvedAt)}
                    {minutes.approvedInMeetingId
                      ? ` · ${
                          (allMeetings ?? []).find((m: any) => m._id === minutes.approvedInMeetingId)?.title ??
                          "linked meeting"
                        }`
                      : ""}
                  </Badge>
                ) : minutes ? (
                  <Badge tone="warn">Not approved</Badge>
                ) : (
                  <span className="muted">No minutes yet</span>
                )}
              </div>
              <button
                className="btn-action"
                type="button"
                onClick={startApprovalEdit}
                disabled={!minutes}
                title={minutes ? undefined : "Start the minutes first"}
              >
                {minutes?.approvedAt ? "Edit" : "Record approval"}
              </button>
            </div>
          </div>
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
              publicCopyMode={publicCopyMode}
              setPublicCopyMode={setPublicCopyMode}
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
              publicCopyMode={publicCopyMode}
              setPublicCopyMode={setPublicCopyMode}
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
          </>
        )}

        {activeTab === "minutes" && !hasStartedMinutesDraft(minutes) && (
          <MinutesDraftEmptyState
            transcriptOnFile={transcriptOnFile}
            audioInputRef={audioInputRef}
            audioFile={audioFile}
            busy={busy || pipelineBusy}
            onDraftFromPastedText={draftFromPastedTranscript}
            onDraftFromSavedTranscript={runGenerate}
            onUploadAudioAndDraft={() => uploadAudioAndRun(true)}
          />
        )}

        {activeTab === "minutes" && (
          <MeetingMinutesColumn
            minutes={minutes}
            agenda={agendaTree.map((entry) => entry.title)}
            agendaTree={agendaTree}
            agendaEdit={agendaEdit}
            setAgendaEdit={setAgendaEdit}
            saveAgenda={saveAgenda}
            attendanceEdit={attendanceEdit}
            setAttendanceEdit={setAttendanceEdit}
            startAttendanceEdit={startAttendanceEdit}
            autofillCurrentDirectors={autofillCurrentDirectors}
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
            createTaskForMeeting={createTaskForMeeting}
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
                  {businessMotions.filter((motion: any) => motion.outcome === "Tabled" || motion.outcome === "Deferred").length} tabled/deferred
                  {(() => {
                    const pending = businessMotions.filter(
                      (motion: any) => !motion.outcome || motion.outcome === "Pending",
                    ).length;
                    return pending ? ` / ${pending} pending` : "";
                  })()}
                </span>
              ) : null}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button
                  className="btn-action btn-action--primary"
                  type="button"
                  onClick={() => motionEditorRef.current?.startAdding()}
                >
                  <Plus size={12} /> Add motion
                </button>
              </div>
            </div>
            <div className="card__body">
              <MotionEditor
                ref={motionEditorRef}
                motions={(minutes?.motions ?? []) as Motion[]}
                directorNames={directorNames}
                people={motionPeople}
                agendaSections={(minutes?.sections ?? []).map((section: any) => ({
                  title: section.title || "Untitled section",
                  discussion: section.discussion ?? "",
                  decisions: section.decisions ?? [],
                }))}
                onChange={saveMotions}
                onAddToBacklog={addMotionToBacklog}
                hideInlineAdd
              />
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
            downloadOutboxPackage={downloadOutboxPackage}
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
          // Mirror the toggle so the preview shows exactly what the Export
          // Word / Export PDF buttons will produce — redacted + section-filtered
          // when public copy mode is on, full minutes otherwise.
          const previewHtml = renderExportBody(
            publicCopyMode ? (s: string) => redactText(s, redactOpts()) : undefined,
            publicCopyMode,
          );
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
                publicCopyMode={publicCopyMode}
              setPublicCopyMode={setPublicCopyMode}
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
                <MinutesDocumentPreview bodyHtml={previewHtml} />
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
            publicCopyMode={publicCopyMode}
            setPublicCopyMode={setPublicCopyMode}
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
            draftFromTranscript={runGenerateWithOverwriteGuard}
            draftingFromTranscript={busy}
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
              <MarkdownEditor rows={3} value={joinEdit.remoteInstructions} onChange={(markdown) => setJoinEdit({ ...joinEdit, remoteInstructions: markdown })} />
            </Field>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!approvalEdit}
        onClose={() => setApprovalEdit(null)}
        title="Record minutes approval"
        footer={
          <>
            {minutes?.approvedAt && (
              <button className="btn btn--danger" onClick={clearApproval} style={{ marginRight: "auto" }}>
                Clear approval
              </button>
            )}
            <button className="btn" onClick={() => setApprovalEdit(null)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveApproval} disabled={!approvalEdit?.approvedAt}>
              Save
            </button>
          </>
        }
      >
        {approvalEdit && (
          <div>
            <p className="muted" style={{ marginTop: 0 }}>
              Minutes are usually adopted at the next meeting. Record when these minutes were
              approved and, if you like, which meeting adopted them.
            </p>
            <Field label="Approved on">
              <input
                className="input"
                type="date"
                value={approvalEdit.approvedAt}
                onChange={(event) => setApprovalEdit({ ...approvalEdit, approvedAt: event.target.value })}
              />
            </Field>
            <Field label="Approved at meeting">
              <Select
                value={approvalEdit.approvedInMeetingId}
                onChange={(value) => setApprovalEdit({ ...approvalEdit, approvedInMeetingId: value })}
                options={[
                  { value: "", label: "Not specified" },
                  ...(allMeetings ?? [])
                    .filter((m: any) => m._id !== meeting._id)
                    .map((m: any) => ({
                      value: m._id as string,
                      label: `${m.title} · ${formatDate(m.scheduledAt)}`,
                    })),
                ]}
              />
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
