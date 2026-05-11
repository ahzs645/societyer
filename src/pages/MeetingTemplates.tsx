import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import { ArrowLeft, BookOpen, ChevronDown, Copy, MinusCircle, Pencil, Plus, Save, Sparkles, Star, Trash2, X } from "lucide-react";
import { Select } from "../components/Select";

type TemplateItemDraft = {
  title: string;
  depth: 0 | 1;
  sectionType: string;
  presenter: string;
  details: string;
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
  details: "",
  motionTemplateId: "",
  motionText: "",
};

const STANDARD_MOTIONS = {
  adoptAgenda: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented.",
  adoptPreviousMinutes: "BE IT RESOLVED THAT the minutes of the previous meeting, as circulated, be approved.",
  adjournment: "BE IT RESOLVED THAT the meeting be adjourned.",
};

type AgendaLibraryEntry = {
  id: string;
  label: string;
  summary: string;
  items: TemplateItemDraft[];
};

const AGENDA_ITEM_LIBRARY: AgendaLibraryEntry[] = [
  {
    id: "call-to-order",
    label: "Call to order",
    summary: "Opening section with call-to-order wording.",
    items: [
      { ...EMPTY_ITEM, title: "Call to order", sectionType: "discussion" },
      { ...EMPTY_ITEM, title: "Call to order", depth: 1, sectionType: "discussion", presenter: "Chair", details: "The chair called the meeting to order at {{calledToOrderTime}}." },
    ],
  },
  {
    id: "territory-acknowledgement-bc",
    label: "Territory acknowledgement",
    summary: "BC-specific acknowledgement, editable for the society.",
    items: [
      {
        ...EMPTY_ITEM,
        title: "Indigenous acknowledgement",
        sectionType: "discussion",
        details: "Acknowledgement that the meeting is taking place on the unceded and ancestral territory of the Lheidli T'enneh, part of the Dakelh (Carrier) First Nations.",
      },
    ],
  },
  {
    id: "approval-of-agenda",
    label: "Approval of agenda",
    summary: "Standard recurring agenda adoption motion.",
    items: [
      { ...EMPTY_ITEM, title: "Approval of the Agenda", sectionType: "motion" },
      { ...EMPTY_ITEM, title: "Agenda to be approved as presented", depth: 1, sectionType: "motion", motionText: STANDARD_MOTIONS.adoptAgenda },
    ],
  },
  {
    id: "previous-minutes",
    label: "Previous minutes",
    summary: "Uses previous meeting title/date when instantiated.",
    items: [
      { ...EMPTY_ITEM, title: "Minutes", sectionType: "motion" },
      {
        ...EMPTY_ITEM,
        title: "Adoption of the minutes of {{previousMeetingTitle}} of {{previousMeetingDate}}, as presented",
        depth: 1,
        sectionType: "motion",
        motionText: "BE IT RESOLVED THAT the minutes of {{previousMeetingTitle}} of {{previousMeetingDate}}, as presented, be approved.",
      },
    ],
  },
  {
    id: "board-reports",
    label: "Board reports",
    summary: "Board report section with public-session notes.",
    items: [
      { ...EMPTY_ITEM, title: "Reports", sectionType: "report" },
      {
        ...EMPTY_ITEM,
        title: "Reports from Board of Directors",
        depth: 1,
        sectionType: "report",
        presenter: "Board of Directors",
        details: "Updates from each board member. Public-session reports are shared in this section.",
      },
    ],
  },
  {
    id: "open-discussion",
    label: "Open discussion",
    summary: "Discussion space for members in attendance.",
    items: [
      {
        ...EMPTY_ITEM,
        title: "Open Discussion",
        depth: 1,
        sectionType: "discussion",
        presenter: "All members in attendance",
        details: "All members in attendance are provided an opportunity to discuss how they are feeling, how the semester is going, and other items as desired.",
      },
    ],
  },
  {
    id: "in-camera",
    label: "In-camera",
    summary: "Motion to move into closed session.",
    items: [
      { ...EMPTY_ITEM, title: "In-Camera", sectionType: "motion" },
      {
        ...EMPTY_ITEM,
        title: "Motion to move to the In-Camera portion of the meeting",
        depth: 1,
        sectionType: "motion",
        motionText: "BE IT RESOLVED THAT the meeting move to the in-camera portion of the meeting.",
      },
    ],
  },
  {
    id: "adjournment",
    label: "Adjournment",
    summary: "Standard adjournment motion with time placeholder.",
    items: [
      { ...EMPTY_ITEM, title: "Adjournment", sectionType: "motion" },
      {
        ...EMPTY_ITEM,
        title: "Motion that the meeting adjourn at {{adjournedAt}}",
        depth: 1,
        sectionType: "motion",
        motionText: "BE IT RESOLVED THAT the meeting be adjourned at {{adjournedAt}}.",
      },
    ],
  },
  {
    id: "nugss-board-meeting",
    label: "NUGSS-style board agenda",
    summary: "Call to order, acknowledgement, agenda, minutes, reports, in-camera, adjournment.",
    items: [],
  },
];

AGENDA_ITEM_LIBRARY[AGENDA_ITEM_LIBRARY.length - 1].items = AGENDA_ITEM_LIBRARY
  .filter((entry) => entry.id !== "nugss-board-meeting")
  .flatMap((entry) => entry.items);

const SECTION_TYPES = ["discussion", "motion", "report", "decision", "other"];
const MEETING_TYPES = ["Board", "Committee", "AGM", "SGM", "Other"];

function newDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    meetingType: "Board",
    isDefault: false,
    items: [
      { ...EMPTY_ITEM, title: "Welcome and call to order" },
      { ...EMPTY_ITEM, title: "Adopt agenda", sectionType: "motion", motionText: STANDARD_MOTIONS.adoptAgenda },
      { ...EMPTY_ITEM, title: "Adopt previous minutes", sectionType: "motion", motionText: STANDARD_MOTIONS.adoptPreviousMinutes },
      { ...EMPTY_ITEM, title: "Adjournment", sectionType: "motion", motionText: STANDARD_MOTIONS.adjournment },
    ],
  };
}

export function MeetingTemplatesPage() {
  const society = useSociety();
  const toast = useToast();
  const navigate = useNavigate();
  const templates = useQuery(api.meetingTemplates.list, society ? { societyId: society._id } : "skip");
  const remove = useMutation(api.meetingTemplates.remove);
  const duplicate = useMutation(api.meetingTemplates.duplicate);
  const seed = useMutation(api.meetingTemplates.seedDefaults);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page meeting-templates-page">
      <PageHeader
        title="Meeting templates"
        icon={<BookOpen size={16} />}
        iconColor="orange"
        subtitle="Reusable agenda patterns for new meetings."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {(templates?.length ?? 0) === 0 && (
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
            )}
            <Link className="btn-action btn-action--primary" to="/app/meeting-templates/new">
              <Plus size={12} /> New template
            </Link>
          </div>
        }
      />

      <div className="card meeting-templates__saved">
        <div className="card__head">
          <div>
            <h2 className="card__title">Saved templates</h2>
            <div className="card__subtitle">{(templates ?? []).length} saved</div>
          </div>
        </div>
        <div className="card__body meeting-templates__saved-body">
          {(templates ?? []).length === 0 ? (
            <div className="meeting-templates__empty">
              <BookOpen size={18} aria-hidden="true" />
              <strong>No meeting templates yet.</strong>
              <Link className="btn btn--accent" to="/app/meeting-templates/new">
                <Plus size={14} /> Create template
              </Link>
            </div>
          ) : (
            <div className="meeting-templates__list">
              {(templates ?? []).map((template: any) => (
                <article key={template._id} className="meeting-templates__template">
                  <div className="meeting-templates__template-main">
                    <div className="meeting-templates__template-head">
                      <strong>{template.name}</strong>
                      <div className="meeting-templates__meta">
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
                  <div className="meeting-templates__template-actions">
                    <button className="btn-action btn-action--icon" type="button" onClick={() => navigate(`/app/meeting-templates/${template._id}`)} title="Edit template" aria-label={`Edit ${template.name}`}>
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn-action btn-action--icon"
                      type="button"
                      onClick={async () => {
                        const copiedId = await duplicate({ templateId: template._id });
                        toast.success("Template duplicated");
                        if (copiedId) navigate(`/app/meeting-templates/${copiedId}`);
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
  );
}

export function MeetingTemplateBuilderPage() {
  const society = useSociety();
  const toast = useToast();
  const navigate = useNavigate();
  const { templateId } = useParams<{ templateId: string }>();
  const isNew = !templateId || templateId === "new";
  const [draft, setDraft] = useState<TemplateDraft>(() => newDraft());
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeItemTab, setActiveItemTab] = useState<"details" | "motion">("details");

  const templates = useQuery(api.meetingTemplates.list, society ? { societyId: society._id } : "skip");
  const motions = useQuery(api.motionTemplates.list, society ? { societyId: society._id } : "skip");
  const create = useMutation(api.meetingTemplates.create);
  const update = useMutation(api.meetingTemplates.update);

  const template = useMemo(
    () => (templates ?? []).find((row: any) => String(row._id) === templateId),
    [templateId, templates],
  );
  const motionById = useMemo(() => {
    return new Map<string, any>((motions ?? []).map((motion: any) => [String(motion._id), motion]));
  }, [motions]);

  useEffect(() => {
    if (isNew || !template) return;
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
        details: item.details ?? "",
        motionTemplateId: item.motionTemplateId ? String(item.motionTemplateId) : "",
        motionText: item.motionText ?? "",
      })),
    });
  }, [isNew, template]);

  if (society === undefined || (!isNew && templates === undefined)) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (!isNew && !template) return <div className="page">Template not found.</div>;

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
    if (isNew) {
      const id = await create({ societyId: society._id, ...payload });
      toast.success("Meeting template created");
      navigate(id ? `/app/meeting-templates/${id}` : "/app/meeting-templates");
    } else {
      await update({ templateId: templateId as any, ...payload });
      toast.success("Meeting template updated");
      navigate("/app/meeting-templates");
    }
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
    setActiveItemIndex((current) => Math.max(0, Math.min(current >= index ? current - 1 : current, draft.items.length - 2)));
  };

  const addItem = (depth: 0 | 1 = 0) => {
    setDraft((current) => {
      const hasRoot = current.items.some((item) => item.depth === 0);
      const nextDepth: 0 | 1 = depth === 1 && hasRoot ? 1 : 0;
      const nextItems = [...current.items, { ...EMPTY_ITEM, depth: nextDepth }];
      setActiveItemIndex(nextItems.length - 1);
      setActiveItemTab("details");
      return { ...current, items: nextItems };
    });
  };

  const addLibraryEntry = (entry: AgendaLibraryEntry) => {
    setDraft((current) => {
      const hasRoot = current.items.some((item) => item.depth === 0);
      const nextItems = [
        ...current.items,
        ...entry.items.map((item, itemIndex) => ({
          ...item,
          depth: item.depth === 1 && (hasRoot || itemIndex > 0) ? 1 as const : 0 as const,
        })),
      ];
      setActiveItemIndex(Math.max(0, nextItems.length - entry.items.length));
      setActiveItemTab("details");
      return { ...current, items: nextItems };
    });
  };

  return (
    <div className="page meeting-templates-page">
      <Link to="/app/meeting-templates" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> Meeting templates
      </Link>
      <PageHeader
        title={isNew ? "New meeting template" : "Edit meeting template"}
        icon={<BookOpen size={16} />}
        iconColor="orange"
        subtitle="Build the agenda sections, nesting, roles, and recurring motions."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Link className="btn-action" to="/app/meeting-templates">
              <X size={12} /> Cancel
            </Link>
            <button className="btn-action btn-action--primary" type="button" onClick={save}>
              <Save size={12} /> Save template
            </button>
          </div>
        }
      />

      <div className="meeting-template-builder">
        <main className="card meeting-template-builder__main">
          <div className="card__head">
            <div>
              <h2 className="card__title">Agenda</h2>
              <div className="card__subtitle">{draft.items.length} item{draft.items.length === 1 ? "" : "s"}</div>
            </div>
            <button
              className="btn-action"
              type="button"
              onClick={() => addItem(0)}
            >
              <Plus size={12} /> Add item
            </button>
          </div>
          <div className="card__body">
            <div className="meeting-minutes-section-list meeting-template-section-list">
              {draft.items.map((item, index) => {
                const selectedMotion = motionById.get(item.motionTemplateId);
                const isActive = activeItemIndex === index;
                const label = agendaItemLabel(draft.items, index);
                const motionEnabled = item.sectionType === "motion" || item.motionTemplateId || item.motionText;
                return (
                  <details
                    key={index}
                    className={`meeting-minutes-section-item meeting-template-section-item${item.depth === 1 ? " meeting-minutes-section-item--child" : ""}`}
                    open={isActive}
                    onToggle={(event) => {
                      if (event.currentTarget.open) setActiveItemIndex(index);
                    }}
                  >
                    <summary className="meeting-minutes-section-item__summary">
                      <span className="meeting-minutes-section-item__title">
                        <ChevronDown size={13} aria-hidden="true" />
                        <span
                          className="meeting-minutes-section-item__title-edit"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setActiveItemIndex(index);
                          }}
                        >
                          <span className="meeting-minutes-section-item__title-index">{label}</span>
                          <input
                            className="meeting-minutes-section-item__title-input"
                            value={item.title}
                            onChange={(event) => updateItem(index, { title: event.target.value })}
                            placeholder="Agenda item title"
                            aria-label="Agenda item title"
                          />
                          <span className="meeting-template-section-item__type">
                            <Select value={item.sectionType} onChange={value => updateItem(index, {
  sectionType: value
})} options={[...SECTION_TYPES.map(type => ({
  value: type,
  label: formatLabel(type)
}))]} className="input" aria-label="Section type" />
                          </span>
                          <span className="meeting-minutes-section-item__title-presenter">
                            <input
                              className="input"
                              value={item.presenter}
                              onChange={(event) => updateItem(index, { presenter: event.target.value })}
                              placeholder="Presenter..."
                              aria-label="Presenter"
                            />
                          </span>
                        </span>
                      </span>
                      <span className="meeting-minutes-section-item__meta">
                        {motionEnabled ? "Motion" : formatLabel(item.sectionType)}
                      </span>
                      <span className="meeting-minutes-section-item__actions">
                        <button
                          className="btn-action btn-action--icon"
                          type="button"
                          title="Remove agenda item"
                          aria-label="Remove agenda item"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeItem(index);
                          }}
                        >
                          <MinusCircle size={12} />
                        </button>
                      </span>
                    </summary>

                    <div className="meeting-minutes-section-item__body">
                      <div className="meeting-minutes-section-editor">
                        <div className="meeting-minutes-section-editor__tabs" role="tablist" aria-label="Template agenda item editor">
                          <button type="button" className={`meeting-minutes-section-editor-tab${activeItemTab === "details" ? " is-active" : ""}`} onClick={() => setActiveItemTab("details")}>
                            Details
                          </button>
                          <button type="button" className={`meeting-minutes-section-editor-tab${activeItemTab === "motion" ? " is-active" : ""}`} onClick={() => setActiveItemTab("motion")}>
                            Motion
                          </button>
                        </div>
                        {activeItemTab === "details" && (
                          <div className="meeting-minutes-section-editor__panel meeting-template-section-editor__panel">
                            <Field label="Agenda level">
                              <Select value={String(item.depth)} onChange={value => updateItem(index, {
  depth: Number(value) === 1 ? 1 : 0
})} options={[{
  value: "0",
  label: "Root item"
}, {
  value: "1",
  label: "Sub-item"
}]} className="input" />
                            </Field>
                            <Field label="Section type">
                              <Select value={item.sectionType} onChange={value => updateItem(index, {
  sectionType: value
})} options={[...SECTION_TYPES.map(type => ({
  value: type,
  label: formatLabel(type)
}))]} className="input" />
                            </Field>
                            <Field label="Presenter or role">
                              <input className="input" value={item.presenter} onChange={(event) => updateItem(index, { presenter: event.target.value })} placeholder="Chair, secretary, treasurer..." />
                            </Field>
                            <Field label="Default notes">
                              <textarea
                                className="textarea"
                                rows={4}
                                value={item.details}
                                onChange={(event) => updateItem(index, { details: event.target.value })}
                                placeholder="Optional notes or speaking points for this agenda item."
                              />
                            </Field>
                          </div>
                        )}
                        {activeItemTab === "motion" && (
                          <div className="meeting-minutes-section-editor__panel">
                            <Field label="Library motion">
                              <Select value={item.motionTemplateId} onChange={value => {
  const motion = motionById.get(value);
  updateItem(index, {
    motionTemplateId: value,
    motionText: motion?.body ?? item.motionText,
    sectionType: value ? "motion" : item.sectionType
  });
}} options={[{
  value: "",
  label: "No library motion"
}, ...(motions ?? []).map((motion: any) => ({
  value: String(motion._id),
  label: motion.title
}))]} className="input" />
                            </Field>
                            <Field label="Motion text">
                              <textarea
                                className="textarea"
                                rows={4}
                                value={item.motionText}
                                onChange={(event) => updateItem(index, { motionText: event.target.value, sectionType: event.target.value.trim() ? "motion" : item.sectionType })}
                                placeholder={selectedMotion ? "Using library wording" : "Optional recurring motion text"}
                              />
                            </Field>
                          </div>
                        )}
                        <div className="meeting-template-section-editor__actions">
                          <button className="btn-action" type="button" onClick={() => addItem(0)}>
                            <Plus size={12} /> Add root item
                          </button>
                          <button className="btn-action" type="button" onClick={() => addItem(1)}>
                            <Plus size={12} /> Add sub-item
                          </button>
                        </div>
                      </div>
                    </div>
                  </details>
                );
              })}
              {draft.items.length === 0 && (
                <div className="meeting-templates__empty">
                  <BookOpen size={18} aria-hidden="true" />
                  <strong>No agenda items yet.</strong>
                  <button className="btn btn--accent" type="button" onClick={() => addItem(0)}>
                    <Plus size={14} /> Add item
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>

        <aside className="card meeting-template-builder__sidebar">
          <div className="card__head">
            <h2 className="card__title">Template details</h2>
          </div>
          <div className="card__body meeting-templates__form">
            <Field label="Name">
              <input className="input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Regular monthly board meeting" />
            </Field>
            <Field label="Meeting type">
              <Select value={draft.meetingType} onChange={value => setDraft({
  ...draft,
  meetingType: value
})} options={[...MEETING_TYPES.map(type => ({
  value: type,
  label: type
}))]} className="input" />
            </Field>
            <Field label="Description">
              <textarea className="textarea" rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Used for recurring board meetings" />
            </Field>
            <label className="meeting-templates__default-toggle">
              <input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />
              Default template
            </label>
          </div>
        </aside>

        <aside className="card meeting-template-builder__library">
          <div className="card__head">
            <h2 className="card__title">Agenda library</h2>
          </div>
          <div className="card__body meeting-template-library">
            {AGENDA_ITEM_LIBRARY.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="meeting-template-library__item"
                onClick={() => addLibraryEntry(entry)}
              >
                <strong>{entry.label}</strong>
                <span>{entry.summary}</span>
              </button>
            ))}
          </div>
        </aside>
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
      details: item.details.trim() || undefined,
      motionTemplateId: item.motionTemplateId || undefined,
      motionText: item.motionText.trim() || undefined,
    });
    if (depth === 0) hasRoot = true;
  }
  return cleaned;
}

function agendaItemLabel(items: TemplateItemDraft[], index: number) {
  let root = 0;
  let child = 0;
  for (let i = 0; i <= index; i++) {
    if (items[i]?.depth === 1 && root > 0) {
      child += 1;
    } else {
      root += 1;
      child = 0;
    }
  }
  if (items[index]?.depth === 1 && root > 0) {
    return `${root}${String.fromCharCode(96 + Math.min(child, 26))}.`;
  }
  return `${root}.`;
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
