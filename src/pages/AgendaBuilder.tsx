import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { ArrowDown, ArrowUp, ClipboardList, ExternalLink, IndentDecrease, IndentIncrease, Plus, Save, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { Select } from "../components/Select";

const ITEM_TYPES = ["discussion", "motion", "report", "break", "executive_session"] as const;
const STATUS_OPTIONS = ["Draft", "Published", "Finalized"] as const;

type AgendaDraftItem = {
  title: string;
  depth: 0 | 1;
  type: string;
  presenter: string;
  details: string;
  timeAllottedMinutes: string;
  motionTemplateId: string;
  motionBacklogId: string;
  motionText: string;
};

export function AgendaBuilderPage() {
  const society = useSociety();
  const toast = useToast();

  const agendas = useQuery(
    api.agendas.listForSociety,
    society ? { societyId: society._id } : "skip",
  );
  const meetings = useQuery(
    api.meetings.list,
    society ? { societyId: society._id } : "skip",
  );
  const templates = useQuery(
    api.motionTemplates.list,
    society ? { societyId: society._id } : "skip",
  );
  const backlog = useQuery(
    api.motionBacklog.list,
    society ? { societyId: society._id } : "skip",
  );

  const [selectedAgendaId, setSelectedAgendaId] = useState<Id<"agendas"> | null>(null);
  const [newMeetingId, setNewMeetingId] = useState<string>("");
  const [newTitle, setNewTitle] = useState("");
  const [draftStatus, setDraftStatus] = useState<string>("Draft");
  const [draftItems, setDraftItems] = useState<AgendaDraftItem[]>([]);

  const selected = useQuery(
    api.agendas.get,
    selectedAgendaId ? { agendaId: selectedAgendaId } : "skip",
  );

  const createAgenda = useMutation(api.agendas.create);
  const syncAgenda = useMutation(api.agendas.syncForMeeting);
  const startMinutesFromAgenda = useMutation(api.agendas.startMinutesFromAgenda);

  const meetingById = useMemo(() => {
    const map = new Map<string, any>();
    (meetings ?? []).forEach((m: any) => map.set(m._id, m));
    return map;
  }, [meetings]);

  useEffect(() => {
    if (!selected) return;
    setDraftStatus(selected.agenda.status ?? "Draft");
    setDraftItems((selected.items ?? []).map((item: any) => ({
      title: item.title ?? "",
      depth: item.depth === 1 ? 1 : 0,
      type: item.type ?? "discussion",
      presenter: item.presenter ?? "",
      details: item.details ?? "",
      timeAllottedMinutes: item.timeAllottedMinutes == null ? "" : String(item.timeAllottedMinutes),
      motionTemplateId: item.motionTemplateId ? String(item.motionTemplateId) : "",
      motionBacklogId: item.motionBacklogId ? String(item.motionBacklogId) : "",
      motionText: item.motionText ?? "",
    })));
  }, [selected?.agenda?._id, selected?.agenda?.updatedAtISO, selected?.items?.length]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const handleCreate = async () => {
    if (!newMeetingId || !newTitle.trim()) {
      toast.info("Pick a meeting and give the agenda a title.");
      return;
    }
    const id = await createAgenda({
      societyId: society._id,
      meetingId: newMeetingId as Id<"meetings">,
      title: newTitle.trim(),
    });
    setSelectedAgendaId(id);
    setNewTitle("");
    setNewMeetingId("");
    toast.success("Agenda created");
  };

  const handleAddItem = (type: string, extra: Partial<{
    title: string;
    motionTemplateId: Id<"motionTemplates">;
    motionBacklogId: Id<"motionBacklog">;
    motionText: string;
  }> = {}) => {
    setDraftItems((current) => [...current, {
      type,
      title: extra.title ?? defaultTitleForType(type),
      depth: 0,
      presenter: "",
      details: "",
      timeAllottedMinutes: "",
      motionTemplateId: extra.motionTemplateId ? String(extra.motionTemplateId) : "",
      motionBacklogId: extra.motionBacklogId ? String(extra.motionBacklogId) : "",
      motionText: extra.motionText ?? "",
    }]);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const next = draftItems.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraftItems(next);
  };

  const patchDraftItem = (index: number, patch: Partial<AgendaDraftItem>) => {
    setDraftItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const removeDraftItem = (index: number) => {
    setDraftItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveSelectedAgenda = async () => {
    if (!selected || !society) return;
    const items = draftItems
      .map((item) => ({
        title: item.title.trim(),
        depth: item.depth,
        type: item.type,
        presenter: item.presenter.trim() || undefined,
        details: item.details.trim() || undefined,
        timeAllottedMinutes: item.timeAllottedMinutes ? Number(item.timeAllottedMinutes) : undefined,
        motionTemplateId: item.motionTemplateId ? item.motionTemplateId as Id<"motionTemplates"> : undefined,
        motionBacklogId: item.motionBacklogId ? item.motionBacklogId as Id<"motionBacklog"> : undefined,
        motionText: item.motionText.trim() || undefined,
      }))
      .filter((item) => item.title);
    await syncAgenda({
      societyId: society._id,
      meetingId: selected.agenda.meetingId,
      title: selected.agenda.title,
      status: draftStatus,
      items,
    });
    if (items.length > 0) {
      const result = await startMinutesFromAgenda({ agendaId: selected.agenda._id });
      toast.success(result.reused ? "Agenda saved; meeting minutes record is ready" : "Agenda saved; minutes record created");
      return;
    }
    toast.success("Agenda saved");
  };

  const finalized = draftStatus === "Finalized";

  return (
    <div className="page agenda-builder">
      <PageHeader
        title="Agenda builder"
        icon={<ClipboardList size={16} />}
        iconColor="orange"
        subtitle="Draft agendas against meeting records. Saving an agenda with items creates or updates the matching minutes record."
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">New agenda</h2>
        </div>
        <div className="card__body row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Select value={newMeetingId} onChange={value => setNewMeetingId(value)} options={[{
  value: "",
  label: "Select meeting…"
}, ...(meetings ?? []).map((m: any) => ({
  value: m._id,
  label: [m.title, "—", formatDate(m.scheduledAt)].join(" ")
}))]} className="input" style={{
  flex: "1 1 220px",
  minWidth: 0
}} />
          <input
            className="input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Agenda title (e.g. Board — May 2026)"
            style={{ flex: "1 1 220px", minWidth: 0 }}
          />
          <button className="btn btn--accent" onClick={handleCreate}>
            <Plus size={14} /> Create
          </button>
        </div>
      </div>

      <div className="agenda-builder__workspace">
        <aside className="agenda-builder__sidebar">
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Your agendas</h2>
            </div>
            <div className="card__body col" style={{ gap: 4 }}>
              {(agendas ?? []).length === 0 && <div className="muted">No agendas yet.</div>}
              {(agendas ?? []).map((a: any) => {
                const meeting = meetingById.get(a.meetingId);
                const active = a._id === selectedAgendaId;
                return (
                  <button
                    key={a._id}
                    onClick={() => setSelectedAgendaId(a._id)}
                    className="btn agenda-builder__agenda-button"
                    style={{
                      background: active ? "var(--bg-subtle)" : undefined,
                    }}
                  >
                    <span>
                      <strong>{a.title}</strong>
                      {meeting && <span className="muted"> — {formatDate(meeting.scheduledAt)}</span>}
                    </span>
                    <span className="muted">{a.status}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="agenda-builder__main">
          {selected ? (
            <div className="card">
          <div className="card__head">
            <h2 className="card__title">{selected.agenda.title}</h2>
            <span className="card__subtitle">
              {draftItems.length} items · {draftStatus}
            </span>
            <div className="row" style={{ gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
              <Select value={draftStatus} onChange={value => setDraftStatus(value)} options={[...STATUS_OPTIONS.map(status => ({
  value: status,
  label: status
}))]} className="input" />
              <Link className="btn" to={`/app/meetings/${selected.agenda.meetingId}?tab=minutes`}>
                <ExternalLink size={12} /> Open meeting
              </Link>
              <button className="btn btn--accent" onClick={saveSelectedAgenda}>
                <Save size={12} /> Save agenda
              </button>
            </div>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            {finalized && (
              <div className="notice notice--info">
                This agenda is finalized. Change the status back to Draft or Published before editing agenda items.
              </div>
            )}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {ITEM_TYPES.map((t) => (
                <button key={t} className="btn" onClick={() => handleAddItem(t)} disabled={finalized}>
                  <Plus size={12} /> {t.replace("_", " ")}
                </button>
              ))}
              <Select
                value=""
                onChange={(value) => {
                  const templateId = value as Id<"motionTemplates"> | "";
                  if (!templateId) return;
                  const t = (templates ?? []).find((x: any) => x._id === templateId);
                  handleAddItem("motion", {
                    title: t?.title ?? "Motion",
                    motionTemplateId: templateId,
                    motionText: t?.body ?? "",
                  });
                }}
                disabled={finalized}
                options={[
                  { value: "", label: "Add from motion library..." },
                  ...(templates ?? []).map((template: any) => ({ value: template._id, label: template.title })),
                ]}
                className="input"
              />
              <Select
                value=""
                onChange={(value) => {
                  const backlogId = value;
                  if (!backlogId) return;
                  const item = (backlog ?? []).find((row: any) => row._id === backlogId);
                  handleAddItem("motion", {
                    title: item?.title ?? "Backlog motion",
                    motionBacklogId: backlogId as Id<"motionBacklog">,
                    motionText: item?.motionText ?? item?.text ?? "",
                  });
                }}
                disabled={finalized}
                options={[
                  { value: "", label: "Add from motion backlog..." },
                  ...(backlog ?? [])
                    .filter((item: any) => item.status !== "Archived" && item.status !== "Adopted")
                    .map((item: any) => ({ value: item._id, label: `${item.title} (${item.status})` })),
                ]}
                className="input"
              />
            </div>

            <div className="col" style={{ gap: 8 }}>
              {draftItems.length === 0 && (
                <div className="muted">Add items above to start building this agenda.</div>
              )}
              {draftItems.map((item, i) => (
                <div
                  key={`${i}-${item.title}`}
                  className="card"
                  style={{ padding: 12, border: "1px solid var(--border)" }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>#{i + 1}</span>
                        <Select value={item.type} onChange={value => patchDraftItem(i, {
  type: value
})} options={[...ITEM_TYPES.map(type => ({
  value: type,
  label: type.replace("_", " ")
}))]} className="input" disabled={finalized} />
                        <button className="btn" onClick={() => patchDraftItem(i, { depth: 0 })} disabled={finalized || item.depth === 0} title="Outdent item">
                          <IndentDecrease size={12} />
                        </button>
                        <button className="btn" onClick={() => patchDraftItem(i, { depth: 1 })} disabled={finalized || item.depth === 1 || i === 0} title="Indent item">
                          <IndentIncrease size={12} />
                        </button>
                        {item.timeAllottedMinutes && (
                          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                            · {item.timeAllottedMinutes} min
                          </span>
                        )}
                      </div>
                      <input
                        className="input"
                        value={item.title}
                        disabled={finalized}
                        onChange={(e) => patchDraftItem(i, { title: e.target.value })}
                        style={{ width: "100%", marginTop: 4 }}
                      />
                      <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <input
                          className="input"
                          value={item.presenter}
                          disabled={finalized}
                          onChange={(e) => patchDraftItem(i, { presenter: e.target.value })}
                          placeholder="Presenter"
                          style={{ flex: "1 1 180px" }}
                        />
                        <input
                          className="input"
                          value={item.timeAllottedMinutes}
                          disabled={finalized}
                          onChange={(e) => patchDraftItem(i, { timeAllottedMinutes: e.target.value.replace(/[^\d]/g, "") })}
                          placeholder="Minutes"
                          inputMode="numeric"
                          style={{ flex: "0 1 110px" }}
                        />
                      </div>
                      <textarea
                        className="input"
                        value={item.details}
                        disabled={finalized}
                        onChange={(e) => patchDraftItem(i, { details: e.target.value })}
                        placeholder="Agenda details / starter minutes notes"
                        rows={2}
                        style={{ width: "100%", marginTop: 6 }}
                      />
                      {item.type === "motion" && (
                        <textarea
                          className="input"
                          value={item.motionText ?? ""}
                          disabled={finalized}
                          onChange={(e) => patchDraftItem(i, { motionText: e.target.value })}
                          placeholder="Motion text"
                          rows={3}
                          style={{ width: "100%", marginTop: 6 }}
                        />
                      )}
                    </div>
                    <div className="col" style={{ gap: 4 }}>
                      <button className="btn" onClick={() => handleMove(i, -1)} disabled={finalized || i === 0}>
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="btn"
                        onClick={() => handleMove(i, 1)}
                        disabled={finalized || i === draftItems.length - 1}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button className="btn" onClick={() => removeDraftItem(i)} disabled={finalized}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
            </div>
          ) : (
            <div className="card">
              <div className="card__body">
                <div className="muted">Select an agenda to edit it.</div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function defaultTitleForType(type: string): string {
  switch (type) {
    case "motion": return "New motion";
    case "report": return "Report";
    case "break": return "Break";
    case "executive_session": return "In-camera session";
    default: return "Discussion item";
  }
}
