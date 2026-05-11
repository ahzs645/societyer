import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, CalendarPlus, ClipboardList, FileText, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { Select } from "../components/Select";

const EMPTY_FORM = {
  title: "",
  motionText: "",
  category: "governance",
  priority: "normal",
  notes: "",
};

export function MotionBacklogPage() {
  const society = useSociety();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
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

  if (society === undefined) return <div className="page">Loading...</div>;
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
      category: form.category,
      priority: form.priority,
      notes: form.notes.trim() || undefined,
    });
    setForm(EMPTY_FORM);
    toast.success("Motion added to backlog");
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
    <div className="page motion-backlog">
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

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">New backlog motion</h2>
            </div>
            <div className="card__body col" style={{ gap: 12 }}>
              <Field label="Title">
                <input
                  className="input"
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="Adopt PIPA privacy policy"
                />
              </Field>
              <Field label="Motion text">
                <textarea
                  className="textarea"
                  rows={5}
                  value={form.motionText}
                  onChange={(event) => setForm({ ...form, motionText: event.target.value })}
                  placeholder="BE IT RESOLVED THAT..."
                />
              </Field>
              <div className="two-col" style={{ gap: 12 }}>
                <Field label="Category">
                  <Select value={form.category} onChange={value => setForm({
  ...form,
  category: value
})} options={[...["privacy", "governance", "finance", "membership", "operations", "bylaws", "other"].map(category => ({
  value: category,
  label: formatLabel(category)
}))]} className="input" />
                </Field>
                <Field label="Priority">
                  <Select value={form.priority} onChange={value => setForm({
  ...form,
  priority: value
})} options={[{
  value: "high",
  label: "High"
}, {
  value: "normal",
  label: "Normal"
}, {
  value: "low",
  label: "Low"
}]} className="input" />
                </Field>
              </div>
              <Field label="Notes">
                <input
                  className="input"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Threshold, attachment, or setup note"
                />
              </Field>
              <button className="btn btn--accent" onClick={save}>
                <Plus size={14} /> Add to backlog
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Backlog</h2>
              <span className="card__subtitle">{(backlog ?? []).length} motion{(backlog ?? []).length === 1 ? "" : "s"}</span>
            </div>
            <div className="card__body col" style={{ gap: 10 }}>
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
                            <Badge tone="neutral">{formatLabel(item.category)}</Badge>
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
                        <Select value={agendaTargets[String(item._id)] ?? ""} onChange={value => setAgendaTargets({
  ...agendaTargets,
  [String(item._id)]: value
})} options={[{
  value: "",
  label: "Choose agenda..."
}, ...(agendas ?? []).map((agenda: any) => ({
  value: agenda._id,
  label: [agenda.title, agenda.meetingId && meetingById.get(String(agenda.meetingId)) ? ` - ${formatDate(meetingById.get(String(agenda.meetingId)).scheduledAt)}` : ""].join(" ")
}))]} className="input" />
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
                <Select value={minutesMeetingId} onChange={value => setMinutesMeetingId(value)} options={[{
  value: "",
  label: "Choose meeting..."
}, ...(meetings ?? []).map((meeting: any) => ({
  value: meeting._id,
  label: [meeting.title, "-", formatDate(meeting.scheduledAt)].join(" ")
}))]} className="input" />
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

function formatLabel(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): "success" | "warn" | "info" | "neutral" {
  if (status === "Adopted") return "success";
  if (status === "Agenda" || status === "MinutesDraft") return "info";
  if (status === "Deferred") return "warn";
  return "neutral";
}
