import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { AvatarGroup } from "../components/primitives";
import { Select } from "../components/Select";
import { ColorPicker } from "../components/ColorPicker";
import { Plus, Users, Target, UsersRound as UsersIcon } from "lucide-react";
import { formatDateTime } from "../lib/format";

const CADENCES = ["Weekly", "Biweekly", "Monthly", "Quarterly", "Ad-hoc"];
const COLORS = ["#3b5bdb", "#0a8f4e", "#a86400", "#c9264a", "#6f42c1", "#0e7490"];

export function CommitteesPage() {
  const society = useSociety();
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const allTasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const allGoals = useQuery(api.goals.list, society ? { societyId: society._id } : "skip");
  const allMembers = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.committees.create);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setForm({ name: "", description: "", cadence: "Monthly", color: COLORS[0] });
    setOpen(true);
  };
  const save = async () => {
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title="Committees"
        icon={<UsersIcon size={16} />}
        iconColor="pink"
        subtitle="Standing and ad-hoc committees — each with its own cadence, roster, tasks, and goals."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew}>
            <Plus size={12} /> New committee
          </button>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {committees?.map((c: any) => {
          const tasks = (allTasks ?? []).filter((t: any) => t.committeeId === c._id);
          const open = tasks.filter((t: any) => t.status !== "Done").length;
          const goals = (allGoals ?? []).filter((g: any) => g.committeeId === c._id);
          return (
            <Link key={c._id} to={`/app/committees/${c._id}`} className="card" style={{ display: "block" }}>
              <div className="card__head">
                <span className="color-chip" style={{ background: c.color }} />
                <h2 className="card__title" style={{ marginRight: "auto" }}>{c.name}</h2>
                <Badge tone={c.status === "Active" ? "success" : "warn"}>{c.status}</Badge>
              </div>
              <div className="card__body col">
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  {c.description || "No description yet."}
                </div>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <Badge>{c.cadence}</Badge>
                  {c.nextMeetingAt && (
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      Next: {formatDateTime(c.nextMeetingAt)}
                    </span>
                  )}
                </div>
                <div className="row" style={{ gap: 16, marginTop: 4 }}>
                  <div className="row" style={{ gap: 4 }}>
                    <Users size={12} className="muted" />
                    <CommitteeMemberCount committeeId={c._id} />
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <Target size={12} className="muted" />
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {goals.length} goal{goals.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginLeft: "auto" }}>
                    {open} open task{open === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
        {committees?.length === 0 && (
          <div className="card">
            <div className="card__body muted">No committees yet — create one.</div>
          </div>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New committee"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save}>Create</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Mission"><input className="input" value={form.mission ?? ""} onChange={(e) => setForm({ ...form, mission: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Cadence">
              <Select
                value={form.cadence}
                onChange={(v) => setForm({ ...form, cadence: v })}
                options={CADENCES.map((c) => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Cadence notes"><input className="input" placeholder="e.g. 2nd Tuesday of each month at 6:30pm" value={form.cadenceNotes ?? ""} onChange={(e) => setForm({ ...form, cadenceNotes: e.target.value })} /></Field>
            <Field label="Color">
              <ColorPicker
                value={form.color ?? ""}
                onChange={(c) => setForm({ ...form, color: c })}
                palette={COLORS}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function CommitteeMemberCount({ committeeId }: { committeeId: any }) {
  const detail = useQuery(api.committees.detail, { id: committeeId });
  const count = detail?.members?.length ?? 0;
  return (
    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
      {count} member{count === 1 ? "" : "s"}
    </span>
  );
}
