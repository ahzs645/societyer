import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, CalendarPlus, ClipboardList, FileText, Plus, Sparkles, Trash2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { Select } from "../components/Select";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";

const EMPTY_FORM = {
  title: "",
  motionText: "",
  tags: [] as string[],
  priority: "normal",
  notes: "",
};

export function MotionBacklogPage({ embedded = false }: { embedded?: boolean } = {}) {
  const society = useSociety();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [tagDraft, setTagDraft] = useState("");
  const [isAddingBacklogMotion, setIsAddingBacklogMotion] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [agendaTargets, setAgendaTargets] = useState<Record<string, string>>({});
  const [minutesMeetingId, setMinutesMeetingId] = useState("");

  const backlog = useQuery(api.motionBacklog.list, society ? { societyId: society._id } : "skip");
  const agendas = useQuery(api.agendas.listForSociety, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");

  const create = useMutation(api.motionBacklog.create);
  const remove = useMutation(api.motionBacklog.remove);
  const seedPipaSetup = useMutation(api.motionBacklog.seedPipaSetup);
  const addToAgenda = useMutation(api.motionBacklog.addToAgenda);
  const seedToMinutes = useMutation(api.motionBacklog.seedToMinutes);

  const meetingById = useMemo(() => {
    const map = new Map<string, any>();
    (meetings ?? []).forEach((meeting: any) => map.set(String(meeting._id), meeting));
    return map;
  }, [meetings]);

  // ?intent=add (from the "Add motion" command palette action) opens the
  // composer and focuses its title field.
  const addIntentHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get("intent") !== "add") {
      addIntentHandled.current = false;
      return;
    }
    if (addIntentHandled.current) return;
    addIntentHandled.current = true;
    setIsAddingBacklogMotion(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      return next;
    }, { replace: true });
    // Focus the title once the composer has mounted.
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [searchParams, setSearchParams]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!form.title.trim() || !form.motionText.trim()) {
      toast.info("Title and motion text are required.");
      return;
    }
    await create({
      societyId: society._id,
      title: form.title.trim(),
      motionText: form.motionText.trim(),
      tags: form.tags,
      priority: form.priority,
      notes: form.notes.trim() || undefined,
    });
    setForm(EMPTY_FORM);
    setTagDraft("");
    setIsAddingBacklogMotion(false);
    toast.success("Motion added to backlog");
  };

  const addComposerTag = () => {
    const value = tagDraft.trim().toLowerCase();
    setTagDraft("");
    if (!value || form.tags.includes(value)) return;
    setForm({ ...form, tags: [...form.tags, value] });
  };

  const addPrivacySetupMotions = async () => {
    const result = await seedPipaSetup({ societyId: society._id });
    toast.success(
      result.inserted ? `Added ${result.inserted} PIPA setup motions` : "PIPA setup motions already exist",
      result.existing ? `${result.existing} already in the backlog.` : undefined,
    );
  };

  const addBacklogItemToAgenda = async (item: any) => {
    const agendaId = agendaTargets[String(item._id)];
    if (!agendaId) {
      toast.info("Choose an agenda first.");
      return;
    }
    const result = await addToAgenda({ backlogId: item._id, agendaId });
    toast.success(result.reused ? "Motion already on that agenda" : "Motion added to agenda");
  };

  const seedAgendaMotionsToMinutes = async () => {
    if (!minutesMeetingId) {
      toast.info("Choose a meeting first.");
      return;
    }
    try {
      const result = await seedToMinutes({ meetingId: minutesMeetingId });
      toast.success(`Seeded ${result.inserted} motion${result.inserted === 1 ? "" : "s"} into minutes`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not seed motions into minutes");
    }
  };

  return (
    <div className={embedded ? "motion-backlog" : "page motion-backlog"}>
      {!embedded && (
        <PageHeader
          title="Motion backlog"
          icon={<ClipboardList size={16} />}
          iconColor="orange"
          subtitle="Draft motions before a meeting, seed them into an agenda, then carry agenda motions into minutes."
          actions={(
            <>
              <button className="btn-action btn-action--primary" onClick={addPrivacySetupMotions}>
                <Sparkles size={12} /> Add PIPA setup motions
              </button>
              <Link className="btn-action" to="/app/agendas">
                <CalendarPlus size={12} /> Agendas
              </Link>
            </>
          )}
        />
      )}

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Backlog</h2>
              <span className="card__subtitle">{(backlog ?? []).length} motion{(backlog ?? []).length === 1 ? "" : "s"}</span>
              <button className="btn-action btn-action--primary motion-backlog__new" onClick={() => setIsAddingBacklogMotion((value) => !value)}>
                <Plus size={12} /> {isAddingBacklogMotion ? "Close" : "New backlog motion"}
              </button>
            </div>
            <div className="card__body col" style={{ gap: 10 }}>
              {isAddingBacklogMotion && (
                <div className="motion-backlog__composer col" style={{ gap: 12 }}>
                  <Field label="Title">
                    <input
                      ref={titleInputRef}
                      className="input"
                      value={form.title}
                      onChange={(event) => setForm({ ...form, title: event.target.value })}
                      placeholder="Adopt PIPA privacy policy"
                    />
                  </Field>
                  <Field label="Motion text">
                    <MarkdownEditor
                      rows={5}
                      value={form.motionText}
                      onChange={(markdown) => setForm({ ...form, motionText: markdown })}
                      placeholder="BE IT RESOLVED THAT..."
                    />
                  </Field>
                  <Field label="Labels">
                    <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                      {form.tags.map((tag) => (
                        <Badge key={tag} tone="neutral">
                          <span className="row" style={{ gap: 2, alignItems: "center" }}>
                            {tag}
                            <button
                              className="btn btn--ghost btn--icon"
                              style={{ padding: 0, height: 14 }}
                              aria-label={`Remove label ${tag}`}
                              onClick={() => setForm({ ...form, tags: form.tags.filter((t) => t !== tag) })}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        </Badge>
                      ))}
                      <input
                        className="input"
                        style={{ width: 120, height: 28, fontSize: 12 }}
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addComposerTag(); } }}
                        placeholder="+ label"
                        aria-label="Add label"
                      />
                    </div>
                  </Field>
                  <Field label="Priority">
                    <Select value={form.priority} onChange={(value) => setForm({ ...form, priority: value })}
                      options={[{ value: "high", label: "High" }, { value: "normal", label: "Normal" }, { value: "low", label: "Low" }]} />
                  </Field>
                  <Field label="Notes">
                    <input
                      className="input"
                      value={form.notes}
                      onChange={(event) => setForm({ ...form, notes: event.target.value })}
                      placeholder="Threshold, attachment, or setup note"
                    />
                  </Field>
                  <div className="motion-backlog__composer-actions">
                    <button className="btn btn--accent" onClick={save}>
                      <Plus size={14} /> Add to backlog
                    </button>
                    <button
                      className="btn btn--ghost"
                      onClick={() => {
                        setForm(EMPTY_FORM);
                        setIsAddingBacklogMotion(false);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {(backlog ?? []).length === 0 ? (
                <div className="empty-state empty-state--sm">
                  <BookOpen size={18} />
                  <strong>No backlog motions yet.</strong>
                  <button className="btn" onClick={addPrivacySetupMotions}>
                    <Sparkles size={14} /> Add PIPA setup motions
                  </button>
                </div>
              ) : (
                (backlog ?? []).map((item: any) => {
                  const linkedMeeting = item.targetMeetingId ? meetingById.get(String(item.targetMeetingId)) : null;
                  return (
                    <article key={item._id} className="motion-backlog__item">
                      <div className="motion-backlog__item-head">
                        <div>
                          <strong>{item.title}</strong>
                          <div className="motion-backlog__badges">
                            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                            {(item.tags ?? []).map((tag: string) => (
                              <Badge key={tag} tone="neutral">{tag}</Badge>
                            ))}
                            {item.priority && <Badge tone={item.priority === "high" ? "warn" : "neutral"}>{formatLabel(item.priority)}</Badge>}
                          </div>
                        </div>
                        <button className="btn btn--ghost btn--icon" aria-label={`Remove ${item.title}`} onClick={() => remove({ backlogId: item._id })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p>{item.motionText}</p>
                      {item.notes && <div className="muted">{item.notes}</div>}
                      {linkedMeeting && (
                        <div className="muted">
                          Linked meeting: {linkedMeeting.title} ({formatDate(linkedMeeting.scheduledAt)})
                        </div>
                      )}
                      <div className="motion-backlog__actions">
                        <Select
                          value={agendaTargets[String(item._id)] ?? ""}
                          onChange={(value) => setAgendaTargets({ ...agendaTargets, [String(item._id)]: value })}
                          options={[{ value: "", label: "Choose agenda..." }, ...(agendas ?? []).map((agenda: any) => {
                            const meeting = meetingById.get(String(agenda.meetingId));
                            return { value: agenda._id, label: `${agenda.title}${meeting ? ` - ${formatDate(meeting.scheduledAt)}` : ""}` };
                          })]}
                        />
                        <button className="btn" onClick={() => addBacklogItemToAgenda(item)}>
                          <CalendarPlus size={12} /> Add to agenda
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Agenda to minutes</h2>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <p className="muted">
                After an agenda has backlog motions and minutes exist for the meeting, seed those agenda motions into the minutes as pending motions.
              </p>
              <Field label="Meeting">
                <Select value={minutesMeetingId} onChange={(value) => setMinutesMeetingId(value)}
                  options={[{ value: "", label: "Choose meeting..." }, ...(meetings ?? []).map((meeting: any) => ({ value: meeting._id, label: `${meeting.title} - ${formatDate(meeting.scheduledAt)}` }))]} />
              </Field>
              <button className="btn btn--accent" onClick={seedAgendaMotionsToMinutes}>
                <FileText size={12} /> Seed agenda motions into minutes
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Flow</h2>
            </div>
            <div className="card__body">
              <ol className="privacy-bullet-list">
                <li>Create or seed backlog motions.</li>
                <li>Add backlog motions to a future agenda.</li>
                <li>Hold the meeting and create/generate minutes.</li>
                <li>Seed agenda motions into the minutes and record outcomes.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatLabel(value?: string) {
  if (!value) return "";
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): "success" | "warn" | "info" | "neutral" {
  if (status === "Voted") return "success";
  if (status === "Agenda" || status === "Draft") return "info";
  if (status === "Deferred" || status === "Tabled") return "warn";
  return "neutral";
}
