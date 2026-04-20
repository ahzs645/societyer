import { useParams, Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../components/Toast";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { formatDate, formatDateTime } from "../lib/format";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowLeft, FileText, Save, Mic, FileDown, Gavel, ClipboardCheck, Upload, ExternalLink, Download, RefreshCw } from "lucide-react";
import { MotionEditor, Motion } from "../components/MotionEditor";
import { Checkbox } from "../components/Controls";
import { exportWordDoc, renderMinutesHtml } from "../lib/exportWord";
import { redactText, RedactOptions } from "../lib/redactPii";
import { EyeOff } from "lucide-react";
import { SignaturePanel } from "../components/SignaturePanel";

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const meeting = useQuery(api.meetings.get, id ? { id: id as Id<"meetings"> } : "skip");
  const minutes = useQuery(api.minutes.getByMeeting, id ? { meetingId: id as Id<"meetings"> } : "skip");
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
  const directorNames = (directors ?? []).map((d: any) => `${d.firstName} ${d.lastName}`);
  const generate = useAction(api.minutes.generateDraft);
  const updateMeeting = useMutation(api.meetings.update);
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

  useEffect(() => {
    if (!meeting) return;
    if (meeting.quorumComputedAtISO && meeting.quorumSourceLabel) return;
    void backfillMeetingQuorum({ id: meeting._id });
  }, [backfillMeetingQuorum, meeting?._id, meeting?.quorumComputedAtISO, meeting?.quorumSourceLabel]);

  useEffect(() => {
    if (!minutes) return;
    if (minutes.quorumComputedAtISO && minutes.quorumSourceLabel && minutes.quorumRequired != null) return;
    void backfillMinutesQuorum({ id: minutes._id });
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
  const transcriptStatusTone =
    transcriptionJob?.status === "complete"
      ? "success"
      : transcriptionJob?.status === "failed"
      ? "danger"
      : "warn";

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

  const exportToWord = () => {
    if (!meeting || !minutes || !society) return;
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const bodyHtml = renderMinutesHtml({
      society: { name: society.name, incorporationNumber: society.incorporationNumber ?? null },
      meeting: {
        title: meeting.title,
        type: meeting.type,
        scheduledAt: meeting.scheduledAt,
        location: meeting.location ?? null,
        electronic: !!meeting.electronic,
      },
      minutes: {
        heldAt: minutes.heldAt,
        attendees: minutes.attendees,
        absent: minutes.absent,
        quorumMet: minutes.quorumMet,
        quorumRequired: quorumSnapshot.required,
        quorumSourceLabel: quorumSnapshot.label,
        discussion: minutes.discussion,
        motions: minutes.motions as any,
        decisions: minutes.decisions,
        actionItems: minutes.actionItems as any,
        approvedAt: minutes.approvedAt ?? null,
        draftTranscript: minutes.draftTranscript ?? null,
      },
    });
    exportWordDoc({
      filename: `${safe}-minutes-${formatDate(minutes.heldAt, "yyyy-MM-dd")}.doc`,
      title: `${meeting.title} — Minutes`,
      bodyHtml,
    });
    toast.success("Minutes exported", "Opens in Word, Pages, or Google Docs.");
  };

  const exportPublicMinutes = () => {
    if (!meeting || !minutes || !society) return;
    const pii = redactOpts();
    const redact = (s: string) => redactText(s, pii);
    const safe = (meeting.title || "meeting").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const bodyHtml = renderMinutesHtml({
      society: { name: society.name, incorporationNumber: society.incorporationNumber ?? null },
      meeting: {
        title: meeting.title,
        type: meeting.type,
        scheduledAt: meeting.scheduledAt,
        location: meeting.location ?? null,
        electronic: !!meeting.electronic,
      },
      minutes: {
        heldAt: minutes.heldAt,
        attendees: minutes.attendees.map(redact),
        absent: minutes.absent.map(redact),
        quorumMet: minutes.quorumMet,
        quorumRequired: quorumSnapshot.required,
        quorumSourceLabel: quorumSnapshot.label,
        discussion: redact(minutes.discussion),
        motions: (minutes.motions as any[]).map((m) => ({
          ...m,
          text: redact(m.text),
          movedBy: m.movedBy ? redact(m.movedBy) : undefined,
          secondedBy: m.secondedBy ? redact(m.secondedBy) : undefined,
        })),
        decisions: minutes.decisions.map(redact),
        actionItems: (minutes.actionItems as any[]).map((a) => ({
          ...a,
          text: redact(a.text),
          assignee: a.assignee ? redact(a.assignee) : undefined,
        })),
        approvedAt: minutes.approvedAt ?? null,
        draftTranscript: null, // never include transcripts in public copy
      },
    });
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
      minutes.attendees.forEach((n: string) => addRedactionName(names, n));
      minutes.absent.forEach((n: string) => addRedactionName(names, n));
      minutes.actionItems.forEach((item: any) => addRedactionName(names, item.assignee));
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
            {minutes && (
              <button className="btn-action" onClick={exportToWord} title="Download as .doc (opens in Word, Pages, or Google Docs)">
                <FileDown size={12} /> Export to Word
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
                          <Badge tone="info">Rule: {quorumSnapshot.label}</Badge>
                        )}
                        <button className="btn-action" onClick={startAttendanceEdit}>
                          Edit attendance
                        </button>
                      </div>
                      <AttendanceDetails present={minutes.attendees} absent={minutes.absent} />
                    </div>
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
              <Detail label="Quorum required">{meeting.quorumRequired ?? "—"}</Detail>
              <Detail label="Quorum rule">{quorumSnapshot.label || meeting.quorumSourceLabel || "—"}</Detail>
            </div>
          </div>

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
    </div>
  );
}

function AttendanceDetails({ present, absent }: { present: string[]; absent: string[] }) {
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
                <td>{row.name}</td>
                <td>{row.role || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
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
