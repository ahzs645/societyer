import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { ClipboardList, Plus, Trash2, ArrowUp, ArrowDown, BookOpen } from "lucide-react";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";

const ITEM_TYPES = ["discussion", "motion", "report", "break", "executive_session"] as const;

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

  const selected = useQuery(
    api.agendas.get,
    selectedAgendaId ? { agendaId: selectedAgendaId } : "skip",
  );

  const createAgenda = useMutation(api.agendas.create);
  const addItem = useMutation(api.agendas.addItem);
  const removeItem = useMutation(api.agendas.removeItem);
  const reorder = useMutation(api.agendas.reorderItems);
  const updateItem = useMutation(api.agendas.updateItem);
  const addBacklogToAgenda = useMutation(api.motionBacklog.addToAgenda);

  const meetingById = useMemo(() => {
    const map = new Map<string, any>();
    (meetings ?? []).forEach((m: any) => map.set(m._id, m));
    return map;
  }, [meetings]);

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

  const handleAddItem = async (type: string, extra: Partial<{
    title: string;
    motionTemplateId: Id<"motionTemplates">;
  }> = {}) => {
    if (!selectedAgendaId) return;
    await addItem({
      agendaId: selectedAgendaId,
      type,
      title: extra.title ?? defaultTitleForType(type),
      motionTemplateId: extra.motionTemplateId,
    });
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!selected) return;
    const ids = selected.items.map((i) => i._id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorder({ agendaId: selected.agenda._id, orderedItemIds: ids });
  };

  const handleAddBacklogItem = async (backlogId: string) => {
    if (!selectedAgendaId || !backlogId) return;
    const result = await addBacklogToAgenda({ backlogId, agendaId: selectedAgendaId });
    toast.success(result.reused ? "Backlog motion already on this agenda" : "Backlog motion added to agenda");
  };

  return (
    <div className="page">
      <PageHeader
        title="Agenda builder"
        icon={<ClipboardList size={16} />}
        iconColor="orange"
        subtitle="Draft board-meeting agendas, add motions from the library, and lock before sending notice."
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">New agenda</h2>
        </div>
        <div className="card__body row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            value={newMeetingId}
            onChange={(e) => setNewMeetingId(e.target.value)}
            style={{ flex: "1 1 220px", minWidth: 0 }}
          >
            <option value="">Select meeting…</option>
            {(meetings ?? []).map((m: any) => (
              <option key={m._id} value={m._id}>
                {m.title} — {formatDate(m.scheduledAt)}
              </option>
            ))}
          </select>
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
                className="btn"
                style={{
                  justifyContent: "space-between",
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

      {selected && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">{selected.agenda.title}</h2>
            <span className="card__subtitle">
              {selected.items.length} items · status {selected.agenda.status}
            </span>
          </div>
          <div className="card__body col" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {ITEM_TYPES.map((t) => (
                <button key={t} className="btn" onClick={() => handleAddItem(t)}>
                  <Plus size={12} /> {t.replace("_", " ")}
                </button>
              ))}
              <select
                className="input"
                defaultValue=""
                onChange={(e) => {
                  const templateId = e.target.value as Id<"motionTemplates"> | "";
                  if (!templateId) return;
                  const t = (templates ?? []).find((x: any) => x._id === templateId);
                  handleAddItem("motion", {
                    title: t?.title ?? "Motion",
                    motionTemplateId: templateId,
                  });
                  e.target.value = "";
                }}
              >
                <option value="">
                  Add from motion library…
                </option>
                {(templates ?? []).map((t: any) => (
                  <option key={t._id} value={t._id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <select
                className="input"
                defaultValue=""
                onChange={(e) => {
                  const backlogId = e.target.value;
                  if (!backlogId) return;
                  handleAddBacklogItem(backlogId);
                  e.target.value = "";
                }}
              >
                <option value="">
                  Add from motion backlog...
                </option>
                {(backlog ?? [])
                  .filter((item: any) => item.status !== "Archived" && item.status !== "Adopted")
                  .map((item: any) => (
                    <option key={item._id} value={item._id}>
                      {item.title} ({item.status})
                    </option>
                  ))}
              </select>
            </div>

            <div className="col" style={{ gap: 8 }}>
              {selected.items.length === 0 && (
                <div className="muted">Add items above to start building this agenda.</div>
              )}
              {selected.items.map((item, i) => (
                <div
                  key={item._id}
                  className="card"
                  style={{ padding: 12, border: "1px solid var(--border)" }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="row" style={{ gap: 6, alignItems: "center" }}>
                        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>#{i + 1}</span>
                        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{item.type}</span>
                        {item.timeAllottedMinutes && (
                          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                            · {item.timeAllottedMinutes} min
                          </span>
                        )}
                      </div>
                      <input
                        className="input"
                        value={item.title}
                        onChange={(e) =>
                          updateItem({ itemId: item._id, title: e.target.value })
                        }
                        style={{ width: "100%", marginTop: 4 }}
                      />
                      {item.type === "motion" && (
                        <textarea
                          className="input"
                          value={item.motionText ?? ""}
                          onChange={(e) =>
                            updateItem({ itemId: item._id, motionText: e.target.value })
                          }
                          placeholder="Motion text"
                          rows={3}
                          style={{ width: "100%", marginTop: 6 }}
                        />
                      )}
                    </div>
                    <div className="col" style={{ gap: 4 }}>
                      <button className="btn" onClick={() => handleMove(i, -1)} disabled={i === 0}>
                        <ArrowUp size={12} />
                      </button>
                      <button
                        className="btn"
                        onClick={() => handleMove(i, 1)}
                        disabled={i === selected.items.length - 1}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button className="btn" onClick={() => removeItem({ itemId: item._id })}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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
