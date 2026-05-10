import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import { BookOpen, Copy, Pencil, Plus, Save, Sparkles, Star, Trash2, X } from "lucide-react";

type TemplateItemDraft = {
  title: string;
  depth: 0 | 1;
  sectionType: string;
  presenter: string;
  motionTemplateId: string;
  motionText: string;
};

type TemplateDraft = {
  name: string;
  description: string;
  meetingType: string;
  isDefault: boolean;
  items: TemplateItemDraft[];
};

const EMPTY_ITEM: TemplateItemDraft = {
  title: "",
  depth: 0,
  sectionType: "discussion",
  presenter: "",
  motionTemplateId: "",
  motionText: "",
};

const EMPTY_DRAFT: TemplateDraft = {
  name: "",
  description: "",
  meetingType: "Board",
  isDefault: false,
  items: [
    { ...EMPTY_ITEM, title: "Welcome and call to order" },
    { ...EMPTY_ITEM, title: "Adopt agenda", sectionType: "motion" },
    { ...EMPTY_ITEM, title: "Adopt previous minutes", sectionType: "motion" },
    { ...EMPTY_ITEM, title: "Adjournment", sectionType: "motion" },
  ],
};

const SECTION_TYPES = ["discussion", "motion", "report", "decision", "other"];
const MEETING_TYPES = ["Board", "Committee", "AGM", "SGM", "Other"];

export function MeetingTemplatesPage() {
  const society = useSociety();
  const toast = useToast();
  const [editingId, setEditingId] = useState<Id<"meetingTemplates"> | null>(null);
  const [draft, setDraft] = useState<TemplateDraft>(EMPTY_DRAFT);

  const templates = useQuery(api.meetingTemplates.list, society ? { societyId: society._id } : "skip");
  const motions = useQuery(api.motionTemplates.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.meetingTemplates.create);
  const update = useMutation(api.meetingTemplates.update);
  const remove = useMutation(api.meetingTemplates.remove);
  const duplicate = useMutation(api.meetingTemplates.duplicate);
  const seed = useMutation(api.meetingTemplates.seedDefaults);

  const motionById = useMemo(() => {
    return new Map<string, any>((motions ?? []).map((motion: any) => [String(motion._id), motion]));
  }, [motions]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const reset = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const edit = (template: any) => {
    setEditingId(template._id);
    setDraft({
      name: template.name ?? "",
      description: template.description ?? "",
      meetingType: template.meetingType ?? "Board",
      isDefault: !!template.isDefault,
      items: (template.items ?? []).map((item: any) => ({
        title: item.title ?? "",
        depth: item.depth === 1 ? 1 : 0,
        sectionType: item.sectionType ?? "discussion",
        presenter: item.presenter ?? "",
        motionTemplateId: item.motionTemplateId ? String(item.motionTemplateId) : "",
        motionText: item.motionText ?? "",
      })),
    });
  };

  const save = async () => {
    const name = draft.name.trim();
    const items = cleanItems(draft.items);
    if (!name) {
      toast.info("Template name is required.");
      return;
    }
    if (items.length === 0) {
      toast.info("Add at least one agenda item.");
      return;
    }
    const payload = {
      name,
      description: draft.description.trim() || undefined,
      meetingType: draft.meetingType || undefined,
      isDefault: draft.isDefault,
      items,
    };
    if (editingId) {
      await update({ templateId: editingId, ...payload });
      toast.success("Meeting template updated");
    } else {
      await create({ societyId: society._id, ...payload });
      toast.success("Meeting template created");
    }
    reset();
  };

  const updateItem = (index: number, patch: Partial<TemplateItemDraft>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item),
    }));
  };

  const removeItem = (index: number) => {
    setDraft((current) => ({
      ...current,
      items: current.items.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="page meeting-templates-page">
      <PageHeader
        title="Meeting templates"
        icon={<BookOpen size={16} />}
        iconColor="orange"
        subtitle="Society-level agenda patterns that snapshot into new meetings."
        actions={
          (templates?.length ?? 0) === 0 && (
            <button
              className="btn-action"
              type="button"
              onClick={async () => {
                const result = await seed({ societyId: society._id });
                toast.success(`Added ${result.inserted} starter template`);
              }}
            >
              <Sparkles size={12} /> Seed starter
            </button>
          )
        }
      />

      <div className="motion-library__layout">
        <div className="card motion-library__editor">
          <div className="card__head">
            <h2 className="card__title">{editingId ? "Edit template" : "New template"}</h2>
          </div>
          <div className="card__body motion-library__form">
            <Field label="Name">
              <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Regular monthly board meeting" />
            </Field>
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <Field label="Meeting type">
                <select className="input" value={draft.meetingType} onChange={(event) => setDraft({ ...draft, meetingType: event.target.value })}>
                  {MEETING_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <label className="row" style={{ gap: 8, minHeight: 56, alignItems: "center" }}>
                <input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />
                Default template
              </label>
            </div>
            <Field label="Description">
              <input className="input" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Used for recurring board meetings" />
            </Field>

            <div className="meeting-template-editor">
              <div className="card__head" style={{ padding: 0, marginBottom: 8 }}>
                <h3 className="card__title">Agenda shape</h3>
                <button
                  className="btn-action"
                  type="button"
                  onClick={() => setDraft((current) => ({ ...current, items: [...current.items, { ...EMPTY_ITEM }] }))}
                >
                  <Plus size={12} /> Add item
                </button>
              </div>
              {draft.items.map((item, index) => {
                const selectedMotion = motionById.get(item.motionTemplateId);
                return (
                  <div key={index} className="meeting-template-editor__item">
                    <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <select
                        className="input"
                        style={{ width: 74 }}
                        value={item.depth}
                        onChange={(event) => updateItem(index, { depth: Number(event.target.value) === 1 ? 1 : 0 })}
                        aria-label="Agenda depth"
                      >
                        <option value={0}>{rootNumberLabel(draft.items, index)}</option>
                        <option value={1}>Sub</option>
                      </select>
                      <input
                        className="input"
                        value={item.title}
                        onChange={(event) => updateItem(index, { title: event.target.value })}
                        placeholder="Agenda item title"
                      />
                      <button className="btn-action btn-action--icon" type="button" onClick={() => removeItem(index)} aria-label="Remove agenda item">
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="meeting-template-editor__meta">
                      <select className="input" value={item.sectionType} onChange={(event) => updateItem(index, { sectionType: event.target.value })}>
                        {SECTION_TYPES.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}
                      </select>
                      <input className="input" value={item.presenter} onChange={(event) => updateItem(index, { presenter: event.target.value })} placeholder="Presenter or role" />
                      <select
                        className="input"
                        value={item.motionTemplateId}
                        onChange={(event) => {
                          const motion = motionById.get(event.target.value);
                          updateItem(index, {
                            motionTemplateId: event.target.value,
                            motionText: motion?.body ?? item.motionText,
                            sectionType: event.target.value ? "motion" : item.sectionType,
                          });
                        }}
                      >
                        <option value="">No library motion</option>
                        {(motions ?? []).map((motion: any) => <option key={motion._id} value={String(motion._id)}>{motion.title}</option>)}
                      </select>
                    </div>
                    {(item.sectionType === "motion" || item.motionTemplateId || item.motionText) && (
                      <textarea
                        className="textarea"
                        rows={2}
                        value={item.motionText}
                        onChange={(event) => updateItem(index, { motionText: event.target.value })}
                        placeholder={selectedMotion ? "Using library wording" : "Optional recurring motion text"}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="motion-library__actions">
              <button className="btn btn--accent" type="button" onClick={save}>
                <Save size={14} /> Save template
              </button>
              {editingId && (
                <button className="btn btn--ghost" type="button" onClick={reset}>
                  <X size={14} /> Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card motion-library__templates">
          <div className="card__head">
            <div>
              <h2 className="card__title">Templates</h2>
              <div className="card__subtitle">{(templates ?? []).length} saved</div>
            </div>
          </div>
          <div className="card__body motion-library__templates-body">
            {(templates ?? []).length === 0 ? (
              <div className="motion-library__empty">
                <BookOpen size={18} aria-hidden="true" />
                <strong>No meeting templates yet.</strong>
                <button
                  className="btn"
                  type="button"
                  onClick={async () => {
                    const result = await seed({ societyId: society._id });
                    toast.success(`Added ${result.inserted} starter template`);
                  }}
                >
                  <Sparkles size={14} /> Seed starter
                </button>
              </div>
            ) : (
              <div className="motion-library__list">
                {(templates ?? []).map((template: any) => (
                  <article key={template._id} className="motion-library__template">
                    <div className="motion-library__template-main">
                      <div className="motion-library__template-head">
                        <strong>{template.name}</strong>
                        <div className="motion-library__meta">
                          {template.isDefault && <Badge tone="success"><Star size={10} /> Default</Badge>}
                          {template.meetingType && <span className="pill pill--sm">{template.meetingType}</span>}
                          <span className="pill pill--sm">{template.items?.length ?? 0} items</span>
                        </div>
                      </div>
                      {template.description && <p>{template.description}</p>}
                      <ol className="meeting-template-summary">
                        {(template.items ?? []).slice(0, 8).map((item: any, index: number) => (
                          <li key={`${item.title}-${index}`} className={item.depth === 1 ? "is-child" : ""}>
                            {item.title}
                            {(item.motionTemplateId || item.motionText) && <span className="muted"> · motion</span>}
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="motion-library__template-actions">
                      <button className="btn-action btn-action--icon" type="button" onClick={() => edit(template)} title="Edit template" aria-label={`Edit ${template.name}`}>
                        <Pencil size={12} />
                      </button>
                      <button
                        className="btn-action btn-action--icon"
                        type="button"
                        onClick={async () => {
                          await duplicate({ templateId: template._id });
                          toast.success("Template duplicated");
                        }}
                        title="Duplicate template"
                        aria-label={`Duplicate ${template.name}`}
                      >
                        <Copy size={12} />
                      </button>
                      <button className="btn-action btn-action--icon" type="button" onClick={() => remove({ templateId: template._id })} title="Delete template" aria-label={`Delete ${template.name}`}>
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

function cleanItems(items: TemplateItemDraft[]) {
  const cleaned: any[] = [];
  let hasRoot = false;
  for (const item of items) {
    const title = item.title.trim();
    if (!title) continue;
    const depth = item.depth === 1 && hasRoot ? 1 : 0;
    cleaned.push({
      title,
      depth,
      sectionType: item.sectionType || undefined,
      presenter: item.presenter.trim() || undefined,
      motionTemplateId: item.motionTemplateId || undefined,
      motionText: item.motionText.trim() || undefined,
    });
    if (depth === 0) hasRoot = true;
  }
  return cleaned;
}

function rootNumberLabel(items: TemplateItemDraft[], index: number) {
  const rootNumber = items.slice(0, index + 1).filter((item) => item.depth === 0).length || 1;
  return String(rootNumber);
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
