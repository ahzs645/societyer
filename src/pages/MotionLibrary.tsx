import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { BookOpen, Pencil, Plus, Sparkles, Tag, Trash2, X } from "lucide-react";
import { useToast } from "../components/Toast";
import { Field } from "../components/ui";
import { Select } from "../components/Select";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Checkbox } from "../components/Controls";

type FormState = {
  title: string;
  body: string;
  tags: string[];
  requiresSpecialResolution: boolean;
  notes: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  tags: [],
  requiresSpecialResolution: false,
  notes: "",
};

// Back-compat: read a template's tags, falling back to its legacy single
// `category` for rows written before the tag system.
function templateTags(t: any): string[] {
  if (Array.isArray(t.tags) && t.tags.length) return t.tags.map((x: string) => String(x));
  return t.category ? [String(t.category)] : [];
}

export function MotionLibraryPage() {
  const society = useSociety();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<Id<"motionTemplates"> | null>(
    null,
  );
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  const templates = useQuery(
    api.motionTemplates.list,
    society ? { societyId: society._id } : "skip",
  );
  const create = useMutation(api.motionTemplates.create);
  const update = useMutation(api.motionTemplates.update);
  const remove = useMutation(api.motionTemplates.remove);
  const seed = useMutation(api.motionTemplates.seedDefaults);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      toast.info("Title and body are required.");
      return;
    }
    if (editingId) {
      await update({ templateId: editingId, ...form });
      toast.success("Template updated");
    } else {
      await create({ societyId: society._id, ...form });
      toast.success("Template added");
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const edit = (t: any) => {
    setEditingId(t._id);
    setTagDraft("");
    setForm({
      title: t.title,
      body: t.body,
      tags: templateTags(t),
      requiresSpecialResolution: t.requiresSpecialResolution ?? false,
      notes: t.notes ?? "",
    });
  };

  const addFormTag = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    setForm((f) => (f.tags.includes(value) ? f : { ...f, tags: [...f.tags, value] }));
    setTagDraft("");
  };

  const removeFormTag = (tag: string) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }));
  };

  const allTags = useMemo(() => {
    const set = new Set<string>();
    (templates ?? []).forEach((t: any) => templateTags(t).forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [templates]);

  const filtered = (templates ?? []).filter((t: any) => {
    const tags = templateTags(t);
    const matchesTag = filter === "all" || tags.includes(filter);
    const q = query.trim().toLowerCase();
    const matchesQuery =
      !q ||
      [t.title, t.body, ...tags, t.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return matchesTag && matchesQuery;
  });

  return (
    <div className="page motion-library">
      <PageHeader
        title="Motion library"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="Reusable motion templates for agenda building."
        actions={
          (templates?.length ?? 0) === 0 && (
            <button
              className="btn-action"
              onClick={async () => {
                const res = await seed({ societyId: society._id });
                toast.success(`Added ${res.inserted} starter motions`);
              }}
            >
              <Sparkles size={12} /> Seed starter motions
            </button>
          )
        }
      />

      <div className="motion-library__layout">
        <div className="card motion-library__editor">
          <div className="card__head">
            <h2 className="card__title">
              {editingId ? "Edit template" : "New template"}
            </h2>
          </div>
          <div className="card__body motion-library__form">
            <Field label="Title">
              <input
                className="input"
                placeholder="Approve minutes of previous meeting"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
            </Field>
            <Field label="Motion text">
              <MarkdownEditor
                placeholder="BE IT RESOLVED THAT..."
                rows={5}
                value={form.body}
                onChange={(markdown) =>
                  setForm((f) => ({ ...f, body: markdown }))
                }
              />
            </Field>
            <Field label="Tags">
              <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                {form.tags.map((tag) => (
                  <span key={tag} className="pill pill--sm">
                    <span className="row" style={{ gap: 2, alignItems: "center" }}>
                      <Tag size={10} /> {tag}
                      <button
                        className="btn btn--ghost btn--icon"
                        style={{ padding: 0, height: 14 }}
                        aria-label={`Remove tag ${tag}`}
                        onClick={() => removeFormTag(tag)}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  </span>
                ))}
                <input
                  className="input"
                  style={{ width: 120, height: 28, fontSize: 13 }}
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFormTag(tagDraft);
                    }
                  }}
                  list="motion-library-tag-suggestions"
                  placeholder="+ tag"
                  aria-label="Add tag"
                />
                <datalist id="motion-library-tag-suggestions">
                  {allTags.map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
                <button className="btn btn--ghost btn--icon" aria-label="Add tag" onClick={() => addFormTag(tagDraft)}>
                  <Plus size={12} />
                </button>
              </div>
            </Field>
            <div className="motion-library__checkbox">
              <Checkbox
                checked={form.requiresSpecialResolution}
                onChange={(checked) =>
                  setForm((f) => ({
                    ...f,
                    requiresSpecialResolution: checked,
                  }))
                }
                label="Special resolution"
              />
            </div>
            <Field label="Notes">
              <input
                className="input"
                placeholder="Filing deadline, threshold, or source note"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </Field>
            <div className="motion-library__actions">
              <button className="btn btn--accent" onClick={save}>
                <Plus size={14} /> {editingId ? "Save changes" : "Add template"}
              </button>
              {editingId && (
                <button
                  className="btn btn--ghost"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setEditingId(null);
                  }}
                >
                  <X size={14} /> Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card motion-library__templates">
          <div className="card__head motion-library__templates-head">
            <div>
              <h2 className="card__title">Reusable templates</h2>
              <div className="card__subtitle">
                {filtered.length} of {(templates ?? []).length} shown
              </div>
            </div>
          </div>
          <div className="card__body motion-library__templates-body">
            <div className="motion-library__toolbar">
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templates"
              />
              <Select
                value={filter}
                onChange={(value) => setFilter(value)}
                options={[
                  { value: "all", label: "All tags" },
                  ...allTags.map((c) => ({ value: c, label: c })),
                ]}
              />
            </div>

            {(templates ?? []).length === 0 ? (
              <div className="motion-library__empty">
                <BookOpen size={18} aria-hidden="true" />
                <strong>No reusable templates yet.</strong>
                <button
                  className="btn"
                  onClick={async () => {
                    const res = await seed({ societyId: society._id });
                    toast.success(`Added ${res.inserted} starter motions`);
                  }}
                >
                  <Sparkles size={14} /> Seed starter motions
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="motion-library__empty">
                <strong>No templates match these filters.</strong>
              </div>
            ) : (
              <div className="motion-library__list">
                {filtered.map((t: any) => (
                  <article key={t._id} className="motion-library__template">
                    <div className="motion-library__template-main">
                      <div className="motion-library__template-head">
                        <strong>{t.title}</strong>
                        <div className="motion-library__meta">
                          {templateTags(t).map((tag: string) => (
                            <span key={tag} className="pill pill--sm">
                              {tag}
                            </span>
                          ))}
                          {t.requiresSpecialResolution && (
                            <span className="pill pill--sm pill--warn">
                              Special
                            </span>
                          )}
                          {t.usageCount > 0 && (
                            <span className="pill pill--sm">
                              Used {t.usageCount}x
                            </span>
                          )}
                        </div>
                      </div>
                      <p>{t.body}</p>
                      {t.notes && (
                        <div className="motion-library__notes">
                          Notes: {t.notes}
                        </div>
                      )}
                    </div>
                    <div className="motion-library__template-actions">
                      <button
                        className="btn-action btn-action--icon"
                        onClick={() => edit(t)}
                        title="Edit template"
                        aria-label={`Edit ${t.title}`}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="btn-action btn-action--icon"
                        onClick={() => remove({ templateId: t._id })}
                        title="Delete template"
                        aria-label={`Delete ${t.title}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
