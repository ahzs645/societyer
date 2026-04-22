import { FileText, Gavel, Save, Sparkles } from "lucide-react";
import { Badge, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline } from "../../../components/LegalGuide";
import { MotionEditor, type Motion } from "../../../components/MotionEditor";
import { SignaturePanel } from "../../../components/SignaturePanel";
import {
  AttendanceDetails,
  StructuredMinutesEditor,
  StructuredMinutesSummary,
  formatSourceReferences,
  personLinkCandidates,
} from "./MeetingDetailSupport";

export function MeetingMinutesColumn({
  meeting,
  minutes,
  agenda,
  agendaEdit,
  setAgendaEdit,
  saveAgenda,
  attendanceEdit,
  setAttendanceEdit,
  startAttendanceEdit,
  saveAttendance,
  structuredEdit,
  setStructuredEdit,
  startStructuredEdit,
  saveStructuredDetails,
  quorumSnapshot,
  quorumLegalGuides,
  members,
  directors,
  directorNames,
  motionPeople,
  saveMotions,
  transcript,
  setTranscript,
  transcriptOnFile,
  busy,
  runGenerate,
}: {
  meeting: any;
  minutes: any;
  agenda: string[];
  agendaEdit: string | null;
  setAgendaEdit: (value: string | null) => void;
  saveAgenda: () => void | Promise<void>;
  attendanceEdit: any;
  setAttendanceEdit: (value: any) => void;
  startAttendanceEdit: () => void;
  saveAttendance: () => void | Promise<void>;
  structuredEdit: any;
  setStructuredEdit: (value: any) => void;
  startStructuredEdit: () => void;
  saveStructuredDetails: () => void | Promise<void>;
  quorumSnapshot: any;
  quorumLegalGuides: any[];
  members: any;
  directors: any;
  directorNames: string[];
  motionPeople: any[];
  saveMotions: (next: Motion[]) => void | Promise<void> | undefined;
  transcript: string;
  setTranscript: (value: string) => void;
  transcriptOnFile: string;
  busy: boolean;
  runGenerate: () => void | Promise<void>;
}) {
  return (
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
  );
}
