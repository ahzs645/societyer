import { useParams, Link } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useToast } from "../components/Toast";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useRef, useState } from "react";
import { Sparkles, ArrowLeft, FileText, Save, Mic, FileDown, Gavel, ClipboardCheck, Upload } from "lucide-react";
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
  const transcriptRecord = useQuery(
    api.transcripts.getByMeeting,
    id ? { meetingId: id as Id<"meetings"> } : "skip",
  );
  const directors = useQuery(
    api.directors.list,
    society ? { societyId: society._id } : "skip",
  );
  const directorNames = (directors ?? []).map((d: any) => `${d.firstName} ${d.lastName}`);
  const generate = useMutation(api.minutes.generateDraft);
  const updateMeeting = useMutation(api.meetings.update);
  const updateMinutes = useMutation(api.minutes.update);
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
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!meeting) return <div className="page">Loading…</div>;

  const agenda: string[] = meeting.agendaJson ? JSON.parse(meeting.agendaJson) : [];
  const transcriptOnFile = transcriptRecord?.text ?? minutes?.draftTranscript ?? "";
  const transcriptProvider = transcriptOnFile
    ? transcriptRecord?.provider ?? (minutes?.draftTranscript ? "manual" : null)
    : null;
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
        discussion: minutes.discussion,
        motions: minutes.motions as any,
        decisions: minutes.decisions,
        actionItems: minutes.actionItems as any,
        approvedAt: minutes.approvedAt ?? null,
        draftTranscript: minutes.draftTranscript ?? null,
      },
    });
    exportWordDoc({
      filename: `${safe}-minutes-${minutes.heldAt.slice(0, 10)}.doc`,
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
      filename: `${safe}-public-minutes-${minutes.heldAt.slice(0, 10)}.doc`,
      title: `${meeting.title} — Public minutes`,
      bodyHtml,
    });
    toast.success("Public minutes exported", "Emails, phones, addresses & names redacted.");
  };

  /** Names to scrub: every current member + director. Emails/phones/postal codes use the regex rules. */
  const redactOpts = (): RedactOptions => {
    const names: string[] = [];
    (directors ?? []).forEach((d: any) => names.push(`${d.firstName} ${d.lastName}`));
    // Members query isn't loaded on this page by default; use attendees & absent
    // from the minutes as a fallback signal for which names appear in the text.
    if (minutes) {
      minutes.attendees.forEach((n: string) => names.push(n));
      minutes.absent.forEach((n: string) => names.push(n));
    }
    return { names, typeLabels: true };
  };

  const saveMotions = (next: Motion[]) =>
    minutes ? updateMinutes({ id: minutes._id, patch: { motions: next } }) : undefined;

  return (
    <div className="page">
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
          {agenda.length > 0 && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">Agenda</h2></div>
              <div className="card__body">
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {agenda.map((a, i) => <li key={i} style={{ padding: "3px 0" }}>{a}</li>)}
                </ol>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Mic size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />
                Transcript
              </h2>
              <span className="card__subtitle">
                {transcriptOnFile
                  ? `${transcriptOnFile.length.toLocaleString()} characters on file`
                  : "Transcript is optional. Add one from pasted text, a .vtt file, or a transcribed recording."}
              </span>
              {transcriptProvider && <Badge tone="info">{transcriptProvider}</Badge>}
              {transcriptionJob && (
                <Badge tone={transcriptStatusTone}>
                  {transcriptionJob.status} ({transcriptionJob.provider})
                </Badge>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
                {transcriptEdit === null ? (
                  <>
                    <button
                      className="btn-action"
                      disabled={savingTranscript || pipelineBusy}
                      onClick={() => setTranscriptEdit(transcriptOnFile)}
                    >
                      {transcriptOnFile ? "Edit" : "Add transcript"}
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
            <div className="card__body">
              {transcriptEdit !== null ? (
                <textarea
                  className="textarea"
                  style={{ minHeight: 200, fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)" }}
                  value={transcriptEdit}
                  onChange={(e) => setTranscriptEdit(e.target.value)}
                  placeholder="Paste the raw meeting transcript here. It stays linked to this meeting and any minutes."
                />
              ) : transcriptOnFile ? (
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-sm)",
                    color: "var(--text-secondary)",
                    maxHeight: 280,
                    overflow: "auto",
                  }}
                >
                  {transcriptOnFile}
                </pre>
              ) : (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  No transcript added yet. Meetings can exist without one, and you can add it later.
                </div>
              )}

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>
                  Import a `.vtt` caption file, or upload audio/video to transcribe it. Transcription can save the
                  transcript by itself or draft minutes in one step.
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {audioFile ? (
                    <Badge tone="info">{audioFile.name}</Badge>
                  ) : (
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>No audio file selected.</span>
                  )}
                  <button className="btn-action" onClick={() => audioInputRef.current?.click()}>
                    <Upload size={12} /> {audioFile ? "Change file" : "Choose file"}
                  </button>
                  <button
                    className="btn-action btn-action--primary"
                    disabled={!audioFile || pipelineBusy}
                    onClick={() => uploadAudioAndRun(false)}
                  >
                    <Mic size={12} /> {pipelineBusy ? "Transcribing…" : "Transcribe audio"}
                  </button>
                  {!minutes && (
                    <button
                      className="btn-action"
                      disabled={!audioFile || pipelineBusy}
                      onClick={() => uploadAudioAndRun(true)}
                    >
                      <Sparkles size={12} /> {pipelineBusy ? "Running…" : "Transcribe + draft minutes"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {minutes ? (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title"><FileText size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />Minutes</h2>
                <span className="card__subtitle">
                  Quorum {minutes.quorumMet ? "met" : "not met"} · {minutes.attendees.length} attendees
                </span>
              </div>
              <div className="card__body">
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
            </div>
          </div>

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
