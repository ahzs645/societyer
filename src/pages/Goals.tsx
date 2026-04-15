import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Progress, Segmented } from "../components/primitives";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { Plus, Target } from "lucide-react";
import { formatDate } from "../lib/format";

const STATUSES = ["NotStarted", "OnTrack", "AtRisk", "OffTrack", "Completed"];
const CATEGORIES = ["Strategic", "Operational", "Program", "Fundraising", "Governance"];

export function GoalsPage() {
  const society = useSociety();
  const goals = useQuery(api.goals.list, society ? { societyId: society._id } : "skip");
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.goals.create);
  const [filter, setFilter] = useState<"all" | "active" | "atrisk" | "done">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const all = goals ?? [];
  const filtered = all.filter((g: any) => {
    if (filter === "active") return g.status !== "Completed";
    if (filter === "atrisk") return g.status === "AtRisk" || g.status === "OffTrack";
    if (filter === "done") return g.status === "Completed";
    return true;
  });

  const openNew = () => {
    setForm({
      title: "",
      category: "Strategic",
      status: "NotStarted",
      startDate: new Date().toISOString().slice(0, 10),
      targetDate: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
      progressPercent: 0,
      milestones: [],
      keyResults: [],
    });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Goals"
        icon={<Target size={16} />}
        iconColor="red"
        subtitle="Strategic, program, and operational goals — tracked with milestones and key results."
        actions={
          <>
            <Segmented
              value={filter}
              onChange={setFilter}
              items={[
                { id: "all", label: "All" },
                { id: "active", label: "Active" },
                { id: "atrisk", label: "At risk" },
                { id: "done", label: "Completed" },
              ]}
            />
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New goal
            </button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))", gap: 16 }}>
        {filtered.map((g: any) => {
          const committee = (committees ?? []).find((c: any) => c._id === g.committeeId);
          const total = g.milestones.length;
          const done = g.milestones.filter((m: any) => m.done).length;
          return (
            <Link key={g._id} to={`/app/goals/${g._id}`} className="card" style={{ display: "block" }}>
              <div className="card__head">
                <Target size={14} className="muted" />
                <h2 className="card__title" style={{ marginRight: "auto" }}>{g.title}</h2>
                <Badge tone={goalTone(g.status)}>{labelStatus(g.status)}</Badge>
              </div>
              <div className="card__body col" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Badge>{g.category}</Badge>
                  {committee && (
                    <Badge>
                      <span className="color-chip" style={{ background: committee.color, marginRight: 4 }} />
                      {committee.name}
                    </Badge>
                  )}
                </div>
                {g.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{g.description}</div>}
                <div className="row" style={{ gap: 8 }}>
                  <Progress value={g.progressPercent} tone={g.status === "AtRisk" || g.status === "OffTrack" ? "warn" : undefined} />
                  <span className="mono" style={{ minWidth: 40, textAlign: "right" }}>{g.progressPercent}%</span>
                </div>
                <div className="row" style={{ fontSize: "var(--fs-sm)", color: "var(--text-tertiary)" }}>
                  <span>{done}/{total} milestones</span>
                  <span style={{ marginLeft: "auto" }}>Target {formatDate(g.targetDate)}</span>
                </div>
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="card">
            <div className="card__body muted">No goals match.</div>
          </div>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New goal"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Create</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(v) => setForm({ ...form, category: v })}
                  options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v })}
                  options={STATUSES.map((s) => ({ value: s, label: labelStatus(s) }))}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start">
                <DatePicker value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
              </Field>
              <Field label="Target">
                <DatePicker value={form.targetDate} onChange={(v) => setForm({ ...form, targetDate: v })} />
              </Field>
            </div>
            <Field label="Committee (optional)">
              <Select
                value={form.committeeId ?? ""}
                onChange={(v) => setForm({ ...form, committeeId: v || undefined })}
                clearable
                searchable
                options={(committees ?? []).map((c: any) => ({ value: c._id, label: c.name }))}
              />
            </Field>
            <Field label="Owner"><input className="input" value={form.ownerName ?? ""} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export function goalTone(status: string) {
  return status === "OnTrack" || status === "Completed"
    ? ("success" as const)
    : status === "AtRisk"
      ? ("warn" as const)
      : status === "OffTrack"
        ? ("danger" as const)
        : ("neutral" as const);
}
export function labelStatus(s: string) {
  return s === "NotStarted" ? "Not started"
    : s === "OnTrack" ? "On track"
    : s === "AtRisk" ? "At risk"
    : s === "OffTrack" ? "Off track"
    : s;
}
