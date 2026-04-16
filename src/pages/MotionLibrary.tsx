import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { BookOpen, Plus, Trash2, Sparkles } from "lucide-react";
import { useToast } from "../components/Toast";

const CATEGORIES = ["governance", "finance", "membership", "operations", "bylaws", "other"];

type FormState = {
  title: string;
  body: string;
  category: string;
  requiresSpecialResolution: boolean;
  notes: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  category: "governance",
  requiresSpecialResolution: false,
  notes: "",
};

export function MotionLibraryPage() {
  const society = useSociety();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<Id<"motionTemplates"> | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const templates = useQuery(
    api.motionTemplates.list,
    society ? { societyId: society._id } : "skip",
  );
  const create = useMutation(api.motionTemplates.create);
  const update = useMutation(api.motionTemplates.update);
  const remove = useMutation(api.motionTemplates.remove);
  const seed = useMutation(api.motionTemplates.seedDefaults);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.info("Title and body are required.");
      return;
    }
    if (editingId) {
      await update({ templateId: editingId, ...form });
      toast.success("Updated");
    } else {
      await create({ societyId: society._id, ...form });
      toast.success("Motion added");
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const edit = (t: any) => {
    setEditingId(t._id);
    setForm({
      title: t.title,
      body: t.body,
      category: t.category,
      requiresSpecialResolution: t.requiresSpecialResolution ?? false,
      notes: t.notes ?? "",
    });
  };

  const filtered = (templates ?? []).filter(
    (t: any) => filter === "all" || t.category === filter,
  );

  return (
    <div className="page">
      <PageHeader
        title="Motion library"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="Reusable motion text — add from here when building an agenda."
        actions={
          (templates?.length ?? 0) === 0 && (
            <button
              className="btn"
              onClick={async () => {
                const res = await seed({ societyId: society._id });
                toast.success(`Added ${res.inserted} starter motions`);
              }}
            >
              <Sparkles size={14} /> Seed 10 starter motions
            </button>
          )
        }
      />

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">{editingId ? "Edit motion" : "New motion"}</h2>
        </div>
        <div className="card__body col" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="input"
            placeholder='Body ("BE IT RESOLVED THAT…")'
            rows={4}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select
              className="input"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={form.requiresSpecialResolution}
                onChange={(e) =>
                  setForm((f) => ({ ...f, requiresSpecialResolution: e.target.checked }))
                }
              />
              <span>Requires special resolution</span>
            </label>
          </div>
          <input
            className="input"
            placeholder="Notes (optional — e.g. filing deadlines)"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--accent" onClick={save}>
              <Plus size={14} /> {editingId ? "Save changes" : "Add motion"}
            </button>
            {editingId && (
              <button
                className="btn"
                onClick={() => {
                  setForm(EMPTY_FORM);
                  setEditingId(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Templates</h2>
          <span className="card__subtitle">{filtered.length} shown</span>
        </div>
        <div className="card__body col" style={{ gap: 8 }}>
          <select
            className="input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {filtered.map((t: any) => (
            <div key={t._id} className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8, alignItems: "baseline" }}>
                    <strong>{t.title}</strong>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{t.category}</span>
                    {t.requiresSpecialResolution && (
                      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>· special resolution</span>
                    )}
                    {t.usageCount > 0 && (
                      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>· used {t.usageCount}×</span>
                    )}
                  </div>
                  <div className="muted" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{t.body}</div>
                  {t.notes && <div className="muted" style={{ marginTop: 4, fontSize: "var(--fs-sm)" }}>Notes: {t.notes}</div>}
                </div>
                <div className="col" style={{ gap: 4 }}>
                  <button className="btn" onClick={() => edit(t)}>Edit</button>
                  <button className="btn" onClick={() => remove({ templateId: t._id })}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
