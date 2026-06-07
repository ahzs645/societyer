// Private sub-components/helpers for WorkflowDetail.tsx (node panels, field/mapping editors, modals).

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "../components/Toast";
import { Badge, Drawer, Field } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Modal } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import {
  ArrowLeft,
  Bot,
  ClipboardList,
  ExternalLink,
  FileText,
  FormInput,
  History,
  Mail,
  Pause,
  Play,
  Plus,
  Power,
  Save,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { formatDateTime } from "../lib/format";


import {
  FIELD_LABELS,
  IntakeFieldType,
  IntakeField,
  TemplateToken,
  slugifyFieldKey,
  inferIntakeFieldType,
  normalizeIntakeFields,
  uniqueFieldKey,
  configuredIntakeFields,
} from "./WorkflowDetail.internal.part1";
import {
  PdfPickerModal,
  suggestMappingForField,
  summariseMappings,
  FieldMappingWizardModal,
} from "./WorkflowDetail.internal.part3";

function intakePayloadFromState(fields: IntakeField[], values: Record<string, any>) {
  const payload: Record<string, any> = {};
  for (const field of fields) {
    const value = field.type === "checkbox" ? Boolean(values[field.key]) : values[field.key] ?? "";
    payload[field.key] = value;
    // Preserve AcroForm label lookups and older mappings that used the label as the key.
    payload[field.label] = value;
  }
  return payload;
}


function missingRequiredIntakeFields(fields: IntakeField[], values: Record<string, any>) {
  return fields
    .filter((field) => {
      if (!field.required) return false;
      const value = values[field.key];
      if (field.type === "person") {
        return !value || typeof value !== "object" || (!value.recordId && !value.name);
      }
      if (field.type === "checkbox") return !Boolean(value);
      return value == null || String(value).trim() === "";
    })
    .map((field) => field.label);
}


function AccessPersonPicker({
  societyId,
  field,
  value,
  onChange,
}: {
  societyId: string;
  field: IntakeField;
  value: any;
  onChange: (value: any) => void;
}) {
  const categoryOptions = (field.categories?.length
    ? field.categories
    : ["directors", "volunteers", "employees"]
  ).filter((category) => ["directors", "volunteers", "employees"].includes(category));
  const selectedCategory = typeof value?.category === "string" ? value.category : categoryOptions[0];
  const societyArg = { societyId: societyId as any };
  const directors = useQuery(api.directors.list, selectedCategory === "directors" ? societyArg : "skip");
  const volunteers = useQuery(api.volunteers.list, selectedCategory === "volunteers" ? societyArg : "skip");
  const employees = useQuery(api.employees.list, selectedCategory === "employees" ? societyArg : "skip");
  const people =
    selectedCategory === "directors"
      ? directors ?? []
      : selectedCategory === "volunteers"
        ? volunteers ?? []
        : selectedCategory === "employees"
          ? employees ?? []
          : [];

  const labelForCategory = (category: string) =>
    category === "directors" ? "Directors" : category === "volunteers" ? "Volunteers" : "Employees";
  const displayName = (person: any) => {
    const full = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
    return full || person.name || person.email || "Unnamed";
  };
  const roleForPerson = (person: any) => {
    if (selectedCategory === "directors") return person.position || "Director";
    if (selectedCategory === "volunteers") return person.roleWanted || person.status || "Volunteer";
    if (selectedCategory === "employees") return person.role || person.employmentType || "Employee";
    return "";
  };
  const selectedId = typeof value?.recordId === "string" ? value.recordId : "";

  const updateCategory = (category: string) => {
    onChange({
      category,
      recordId: "",
      name: "",
      email: "",
      role: "",
    });
  };

  const updatePerson = (recordId: string) => {
    const person = people.find((row: any) => String(row._id) === recordId);
    if (!person) {
      onChange({
        category: selectedCategory,
        recordId: "",
        name: "",
        email: "",
        role: "",
      });
      return;
    }
    onChange({
      category: selectedCategory,
      recordId,
      name: displayName(person),
      email: person.email ?? "",
      role: roleForPerson(person),
    });
  };

  return (
    <div className="person-ref-picker">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select
          className="input"
          value={selectedCategory}
          onChange={(event) => updateCategory(event.target.value)}
        >
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {labelForCategory(category)}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={selectedId}
          onChange={(event) => updatePerson(event.target.value)}
        >
          <option value="">Pick individual</option>
          {people.map((person: any) => (
            <option key={person._id} value={person._id}>
              {displayName(person)}
              {person.email ? ` · ${person.email}` : ""}
            </option>
          ))}
        </select>
      </div>
      {selectedCategory && people.length === 0 && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
          No {labelForCategory(selectedCategory).toLowerCase()} are available yet.
        </div>
      )}
    </div>
  );
}


function documentDefaults(workflow: any) {
  const cfg = workflow?.config ?? {};
  if (cfg.pdfTemplateKey !== "unbc_affiliate_id") return {};
  return {
    category: cfg.documentCategory ?? "WorkflowGenerated",
    tags: Array.isArray(cfg.documentTags) ? cfg.documentTags : ["workflow-generated", "unbc-affiliate-id"],
    retentionYears: typeof cfg.documentRetentionYears === "number" ? cfg.documentRetentionYears : 10,
    titleTemplate:
      cfg.documentTitleTemplate ??
      "UNBC Affiliate ID Request - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
    changeNote: cfg.documentChangeNote ?? "Generated by UNBC Affiliate ID Request workflow.",
  };
}


function emailDefaults(workflow: any) {
  const cfg = workflow?.config ?? {};
  if (cfg.pdfTemplateKey !== "unbc_affiliate_id") return {};
  return {
    to: cfg.emailTo ?? "employmentprocessing@unbc.ca",
    subject:
      cfg.emailSubject ??
      "Completed affiliate status request form - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
    body:
      cfg.emailBody ??
      [
        "Hello,",
        "",
        "Please see the attached completed UNBC affiliate status request form for {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}.",
        "",
        "The generated PDF is attached for processing.",
        "",
        "Thanks,",
        "{{intake.name_of_requesting_manager}}",
      ].join("\n"),
  };
}


function workflowTemplateTokens(workflow: any): TemplateToken[] {
  const intakeTokens = configuredIntakeFields(workflow).map((field) => ({
    group: "Intake",
    label: field.label,
    value: `{{intake.${field.key}}}`,
  }));
  return [
    ...intakeTokens,
    { group: "Document", label: "Generated PDF title", value: "{{document.title}}" },
    { group: "Document", label: "Generated PDF file name", value: "{{document.fileName}}" },
    { group: "Document", label: "Document category", value: "{{document.category}}" },
    { group: "Workflow", label: "Workflow name", value: "{{workflow.name}}" },
    { group: "Workflow", label: "Run ID", value: "{{run.id}}" },
    { group: "User", label: "Launcher name", value: "{{currentUser.name}}" },
    { group: "User", label: "Launcher email", value: "{{currentUser.email}}" },
    { group: "Dynamic", label: "Today", value: "{{today}}" },
  ];
}


type NodeSetupPanelProps = {
  node: any;
  workflow: any;
  documents: any[];
  onLaunch: () => void;
  launchDisabled?: boolean;
  onSave: (patch: Record<string, any>) => Promise<void>;
};


function NodeSetupPanel({ node, workflow, documents, onLaunch, launchDisabled, onSave }: NodeSetupPanelProps) {
  const cfg = node.config ?? {};
  const recipeCfg = workflow?.config ?? {};
  const emailCfg = { ...emailDefaults(workflow), ...cfg };

  const blurbs: Record<string, string> = {
    manual_trigger: "A person starts this workflow from inside Societyer. No external setup required.",
    form: "Collects structured input before handing off to later steps. Define the fields to collect.",
    pdf_fill: "Picks up a fillable PDF from Documents, fills mapped AcroForm fields, and saves the output as a new document version.",
    document_create: "Saves the output of a prior step into Documents with a category and retention policy.",
    email: "Queues a manual-send Outbox draft with templated content and the generated document attached.",
    ai_agent: "Runs a permissioned Societyer AI agent. The prompt can include workflow and intake variables.",
    external_n8n: "Hands execution to an n8n workflow via its webhook URL. n8n then calls back to progress the timeline.",
  };
  const launchLabel =
    typeof cfg.launchLabel === "string" && cfg.launchLabel.trim()
      ? cfg.launchLabel.trim()
      : "Launch workflow";

  return (
    <div className="workflow-sidepanel__section workflow-setup">
      <div className="field__label">Setup</div>
      <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>
        {blurbs[node.type] ?? "No setup options for this node type."}
      </p>

      {node.type === "manual_trigger" && (
        <>
          <button
            type="button"
            className="btn btn--accent btn--sm"
            disabled={launchDisabled}
            onClick={onLaunch}
          >
            <Play size={12} /> {launchLabel}
          </button>
          <LabeledInput
            label="Trigger label"
            value={cfg.launchLabel ?? ""}
            placeholder="Launch workflow"
            onSave={(v) => onSave({ launchLabel: v })}
          />
        </>
      )}

      {node.type === "form" && (
        <IntakeFieldSetup
          fields={normalizeIntakeFields(
            cfg.fields,
            recipeCfg.intakeFields ??
              recipeCfg.pdfFields ??
              (recipeCfg.sampleAffiliate && typeof recipeCfg.sampleAffiliate === "object"
                ? Object.keys(recipeCfg.sampleAffiliate)
                : FIELD_LABELS),
          )}
          onSave={(fields) => onSave({ fields })}
        />
      )}

      {node.type === "pdf_fill" && (
        <PdfFillSetup
          node={node}
          cfg={cfg}
          intakeFields={configuredIntakeFields(workflow)}
          documents={documents}
          recipeFields={Array.isArray(recipeCfg.pdfFields) ? recipeCfg.pdfFields : []}
          onSave={onSave}
        />
      )}

      {node.type === "document_create" && (
        <DocumentCreateSetup
          cfg={cfg}
          defaults={documentDefaults(workflow)}
          onSave={onSave}
        />
      )}

      {node.type === "email" && (
        <>
          <LabeledInput
            label="To"
            value={emailCfg.to ?? ""}
            placeholder="recipient@example.com"
            onSave={(v) => onSave({ to: v })}
          />
          <LabeledInput
            label="Subject"
            value={emailCfg.subject ?? ""}
            placeholder="Completed affiliate status request form"
            onSave={(v) => onSave({ subject: v })}
          />
          <TemplateTextarea
            label="Body"
            value={emailCfg.body ?? ""}
            placeholder={"Hello,\n\nHere is the completed affiliate status request form.\n\nThanks,"}
            tokens={workflowTemplateTokens(workflow)}
            onSave={(v) => onSave({ body: v })}
          />
        </>
      )}

      {node.type === "ai_agent" && (
        <>
          <LabeledInput
            label="Agent key"
            value={cfg.agentKey ?? "compliance_analyst"}
            placeholder="compliance_analyst"
            onSave={(v) => onSave({ agentKey: v })}
          />
          <TemplateTextarea
            label="Prompt template"
            value={cfg.promptTemplate ?? "Review {{workflow.name}} with this workflow input: {{input}}"}
            placeholder="Review {{workflow.name}} with this workflow input: {{input}}"
            tokens={workflowTemplateTokens(workflow)}
            onSave={(v) => onSave({ promptTemplate: v })}
          />
        </>
      )}

      {node.type === "external_n8n" && (
        <>
          <LabeledInput
            label="Webhook URL override"
            value={cfg.webhookUrl ?? ""}
            placeholder={workflow?.providerConfig?.externalWebhookUrl ?? "https://n8n.example.com/webhook/..."}
            onSave={(v) => onSave({ webhookUrl: v })}
          />
          <LabeledInput
            label="n8n node name"
            value={cfg.nodeName ?? ""}
            placeholder="Fill UNBC ID PDF"
            onSave={(v) => onSave({ nodeName: v })}
          />
        </>
      )}

      {node.type !== "manual_trigger" && (
        <div className="workflow-setup__footer">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled
            title={node.type === "ai_agent" ? "AI agent steps run as part of the workflow." : "Test harness ships with Phase 2 — executing nodes individually."}
          >
            <Play size={12} /> Test node
          </button>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            {node.type === "ai_agent"
              ? "AI agent output is stored on the workflow run step."
              : "Runner support for user-edited nodes is staged; config saved here will wire in once execution lands."}
          </span>
        </div>
      )}
    </div>
  );
}


function LabeledInput({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  // Reset local draft when the parent value changes (e.g. selecting a different node).
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }
  return (
    <Field label={label}>
      <input
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </Field>
  );
}


function LabeledTextarea({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }
  return (
    <Field label={label}>
      <textarea
        className="textarea"
        value={draft}
        placeholder={placeholder}
        rows={4}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
      />
    </Field>
  );
}


function TemplateTextarea({
  label,
  value,
  placeholder,
  tokens,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  tokens: TemplateToken[];
  onSave: (next: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [slash, setSlash] = useState<{ start: number; term: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastExternal = useRef(value);
  if (lastExternal.current !== value) {
    lastExternal.current = value;
    if (draft !== value) setDraft(value);
  }

  const filteredTokens = slash
    ? tokens
        .filter((token) => `${token.group} ${token.label} ${token.value}`.toLowerCase().includes(slash.term))
        .slice(0, 8)
    : [];

  const detectSlash = (text: string, cursor: number) => {
    const start = text.lastIndexOf("/", cursor - 1);
    if (start < 0) return null;
    const before = start === 0 ? "" : text[start - 1];
    const term = text.slice(start + 1, cursor);
    if (before && !/\s/.test(before)) return null;
    if (/\s/.test(term)) return null;
    return { start, term: term.toLowerCase() };
  };

  const updateDraft = (next: string, cursor: number) => {
    setDraft(next);
    setSlash(detectSlash(next, cursor));
  };

  const insertToken = (token: TemplateToken) => {
    const textarea = textareaRef.current;
    if (!textarea || !slash) return;
    const cursor = textarea.selectionStart ?? draft.length;
    const next = `${draft.slice(0, slash.start)}${token.value}${draft.slice(cursor)}`;
    setDraft(next);
    setSlash(null);
    requestAnimationFrame(() => {
      const nextCursor = slash.start + token.value.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <Field label={label}>
      <div className="template-textarea">
        <textarea
          ref={textareaRef}
          className="textarea"
          value={draft}
          placeholder={placeholder}
          rows={7}
          onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)}
          onKeyUp={(event) => {
            const target = event.currentTarget;
            setSlash(detectSlash(target.value, target.selectionStart));
          }}
          onBlur={() => {
            window.setTimeout(() => setSlash(null), 120);
            if (draft !== value) onSave(draft);
          }}
        />
        {slash && filteredTokens.length > 0 && (
          <div className="template-token-menu">
            {filteredTokens.map((token) => (
              <button
                key={`${token.group}-${token.value}`}
                type="button"
                className="template-token-menu__item"
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertToken(token);
                }}
              >
                <span className="template-token-menu__group">{token.group}</span>
                <span className="template-token-menu__label">{token.label}</span>
                <span className="template-token-menu__value mono">{token.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
        Type / to insert workflow, intake, document, or date fields.
      </div>
    </Field>
  );
}


function FieldListEditor({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint?: string;
  value: string[];
  onSave: (next: string[]) => void | Promise<void>;
}) {
  const asText = value.join("\n");
  const [draft, setDraft] = useState(asText);
  const lastExternal = useRef(asText);
  if (lastExternal.current !== asText) {
    lastExternal.current = asText;
    if (draft !== asText) setDraft(asText);
  }
  return (
    <Field label={label}>
      <textarea
        className="textarea"
        rows={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          if (next.join("\n") !== value.join("\n")) onSave(next);
        }}
      />
      {hint && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </Field>
  );
}


function DocumentCreateSetup({
  cfg,
  defaults,
  onSave,
}: {
  cfg: Record<string, any>;
  defaults: Record<string, any>;
  onSave: (patch: Record<string, any>) => Promise<void>;
}) {
  const category = cfg.category ?? defaults.category ?? "";
  const tags = Array.isArray(cfg.tags) ? cfg.tags : Array.isArray(defaults.tags) ? defaults.tags : [];
  const retentionYears = cfg.retentionYears ?? defaults.retentionYears ?? 10;
  const titleTemplate = cfg.titleTemplate ?? defaults.titleTemplate ?? "";
  const changeNote = cfg.changeNote ?? defaults.changeNote ?? "";

  return (
    <>
      <LabeledInput
        label="Category"
        value={category}
        placeholder="WorkflowGenerated"
        onSave={(v) => onSave({ category: v })}
      />
      <LabeledInput
        label="Generated document title"
        value={titleTemplate}
        placeholder="UNBC Affiliate ID Request - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}"
        onSave={(v) => onSave({ titleTemplate: v })}
      />
      <LabeledInput
        label="Retention years"
        value={String(retentionYears)}
        placeholder="10"
        onSave={(v) => {
          const parsed = Number(v);
          return onSave({ retentionYears: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined });
        }}
      />
      <LabeledInput
        label="Tags (comma-separated)"
        value={tags.join(", ")}
        placeholder="workflow-generated, unbc-affiliate-id"
        onSave={(v) =>
          onSave({
            tags: v
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }
      />
      <LabeledTextarea
        label="Version note"
        value={changeNote}
        placeholder="Generated by workflow."
        onSave={(v) => onSave({ changeNote: v })}
      />
    </>
  );
}


function IntakeFieldSetup({
  fields,
  onSave,
}: {
  fields: IntakeField[];
  onSave: (next: IntakeField[]) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const requiredCount = fields.filter((field) => field.required).length;
  const byType = fields.reduce<Record<string, number>>((acc, field) => {
    acc[field.type] = (acc[field.type] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(byType)
    .map(([type, count]) => `${count} ${type}`)
    .join(" · ");

  return (
    <>
      <Field label="Intake fields">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            <strong>{fields.length} fields configured</strong>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {fields.length === 0
                ? "Open the wizard to define what the launch form collects."
                : `${requiredCount} required${breakdown ? ` · ${breakdown}` : ""}`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setOpen(true)}
          >
            {fields.length === 0 ? "Start wizard" : "Edit fields"}
          </button>
        </div>
      </Field>
      <IntakeFieldWizardModal
        open={open}
        onClose={() => setOpen(false)}
        fields={fields}
        onSave={async (next) => {
          await onSave(next);
          setOpen(false);
        }}
      />
    </>
  );
}


function IntakeFieldWizardModal({
  open,
  onClose,
  fields,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  fields: IntakeField[];
  onSave: (next: IntakeField[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<IntakeField[]>(fields);
  const [stepIndex, setStepIndex] = useState(0);
  const [newField, setNewField] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(fields);
    setStepIndex(0);
    setNewField("");
  }, [open, fields]);

  const safeIndex = Math.min(stepIndex, Math.max(0, draft.length - 1));
  const current = draft[safeIndex];
  const usedKeys = (exceptIndex?: number) =>
    new Set(draft.map((field, idx) => (idx === exceptIndex ? "" : field.key)).filter(Boolean));

  const updateCurrent = (patch: Partial<IntakeField>) => {
    if (!current) return;
    setDraft((prev) =>
      prev.map((field, idx) => {
        if (idx !== safeIndex) return field;
        const next = { ...field, ...patch };
        if (patch.key !== undefined) {
          next.key = uniqueFieldKey(slugifyFieldKey(patch.key), usedKeys(idx));
        }
        return next;
      }),
    );
  };

  const addField = () => {
    const label = newField.trim();
    if (!label) return;
    const nextField: IntakeField = {
      key: uniqueFieldKey(slugifyFieldKey(label), usedKeys()),
      label,
      type: inferIntakeFieldType(label),
      required: false,
    };
    setDraft((prev) => [...prev, nextField]);
    setNewField("");
    setStepIndex(draft.length);
  };

  const removeCurrent = () => {
    if (!current) return;
    setDraft((prev) => prev.filter((_, idx) => idx !== safeIndex));
    setStepIndex((idx) => Math.max(0, idx - 1));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Configure intake fields"
      footer={
        <>
          <div className="muted" style={{ marginRight: "auto", fontSize: "var(--fs-sm)" }}>
            {draft.length} fields · {draft.filter((field) => field.required).length} required
          </div>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--accent" onClick={() => onSave(draft)}>
            Save fields
          </button>
        </>
      }
    >
      <div className="mapping-wizard">
        <aside className="mapping-wizard__sidebar">
          <div className="field__label">Fields</div>
          <div className="mapping-wizard__list">
            {draft.length === 0 && (
              <div className="muted" style={{ padding: 8, fontSize: "var(--fs-sm)" }}>
                Add a field below.
              </div>
            )}
            {draft.map((field, idx) => (
              <button
                key={`${field.key}-${idx}`}
                type="button"
                className={`mapping-wizard__item${idx === safeIndex ? " is-active" : ""}`}
                onClick={() => setStepIndex(idx)}
              >
                <span className="mapping-wizard__item-label">{field.label}</span>
                <span className="mapping-wizard__item-badge is-done">{field.type}</span>
              </button>
            ))}
          </div>
          <div className="mapping-wizard__add">
            <input
              className="input"
              placeholder="Add field label"
              value={newField}
              onChange={(event) => setNewField(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addField();
                }
              }}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addField}
              disabled={!newField.trim()}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </aside>

        <section className="mapping-wizard__main">
          {!current ? (
            <div className="muted" style={{ padding: 16 }}>
              Add an intake field to configure launch form inputs.
            </div>
          ) : (
            <>
              <div className="mapping-wizard__stepper muted" style={{ fontSize: "var(--fs-xs)" }}>
                Field {safeIndex + 1} of {draft.length}
              </div>
              <h3 className="mapping-wizard__field">{current.label}</h3>

              <div className="intake-field-grid">
                <Field label="Label">
                  <input
                    className="input"
                    value={current.label}
                    onChange={(event) => updateCurrent({ label: event.target.value })}
                  />
                </Field>
                <Field label="Downstream key">
                  <input
                    className="input mono"
                    value={current.key}
                    onChange={(event) => updateCurrent({ key: event.target.value })}
                  />
                </Field>
                <Field label="Type">
                  <select
                    className="input"
                    value={current.type}
                    onChange={(event) => updateCurrent({ type: event.target.value as IntakeFieldType })}
                  >
                    <option value="text">Text</option>
                    <option value="textarea">Long text</option>
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="date">Date</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="person">Person picker</option>
                  </select>
                </Field>
                <Field label="Default value">
                  {current.type === "checkbox" ? (
                    <label className="workflow-checkbox">
                      <input
                        type="checkbox"
                        checked={Boolean(current.defaultValue)}
                        onChange={(event) => updateCurrent({ defaultValue: event.target.checked })}
                      />
                      <span>Checked by default</span>
                    </label>
                  ) : (
                    <input
                      className="input"
                      value={typeof current.defaultValue === "string" ? current.defaultValue : ""}
                      onChange={(event) => updateCurrent({ defaultValue: event.target.value })}
                    />
                  )}
                </Field>
              </div>

              <label className="workflow-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(current.required)}
                  onChange={(event) => updateCurrent({ required: event.target.checked })}
                />
                <span>Required at launch</span>
              </label>

              <Field label="Help text">
                <MarkdownEditor
                  rows={3}
                  value={current.helpText ?? ""}
                  onChange={(markdown) => updateCurrent({ helpText: markdown })}
                />
              </Field>

              <div className="mapping-wizard__row-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={removeCurrent}
                >
                  <Trash2 size={12} /> Remove field
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}


function PdfFillSetup({
  node,
  cfg,
  intakeFields,
  documents,
  recipeFields,
  onSave,
}: {
  node: any;
  cfg: Record<string, any>;
  intakeFields: IntakeField[];
  documents: any[];
  recipeFields: string[];
  onSave: (patch: Record<string, any>) => Promise<void>;
}) {
  const pdfs = (documents ?? []).filter(
    (doc: any) => doc.mimeType === "application/pdf" || /\.pdf$/i.test(doc.fileName ?? ""),
  );
  const selectedDoc = pdfs.find((doc: any) => doc._id === cfg.templateDocumentId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const inspectPdfTemplate = useAction(api.workflows.inspectPdfTemplate);
  const toast = useToast();

  const mappings: Record<string, any> = (cfg.fieldMappings && typeof cfg.fieldMappings === "object")
    ? cfg.fieldMappings
    : {};
  const currentFields: string[] = Array.isArray(cfg.fields) && cfg.fields.length > 0
    ? cfg.fields
    : recipeFields.length > 0
      ? recipeFields
      : Object.keys(mappings);
  const mappingSummary = summariseMappings(currentFields, mappings);
  const inspection = cfg.fieldInspection && typeof cfg.fieldInspection === "object"
    ? cfg.fieldInspection
    : null;

  const autoDetectFields = async () => {
    if (!selectedDoc) return;
    setDetecting(true);
    try {
      const result = await inspectPdfTemplate({ documentId: selectedDoc._id });
      const detected = Array.isArray(result?.fields)
        ? result.fields.map((field: any) => String(field.name)).filter(Boolean)
        : [];
      if (detected.length === 0) {
        toast.error("No fillable PDF fields found");
        return;
      }
      const nextMappings = { ...mappings };
      for (const field of detected) {
        if (nextMappings[field]) continue;
        nextMappings[field] = suggestMappingForField(field, intakeFields) ?? { kind: "empty" };
      }
      await onSave({
        fields: detected,
        fieldMappings: nextMappings,
        fieldInspection: {
          detectedAtISO: result.detectedAtISO,
          fieldCount: result.fieldCount,
          pageCount: result.pageCount,
          tables: result.tables ?? [],
        },
      });
      toast.success(
        "PDF fields detected",
        `${detected.length} fields${result?.tables?.length ? ` · ${result.tables.length} table group(s)` : ""}`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Could not inspect the PDF");
    } finally {
      setDetecting(false);
    }
  };

  return (
    <>
      <Field label="PDF template">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            {selectedDoc ? (
              <>
                <strong>{selectedDoc.title ?? selectedDoc.fileName}</strong>
                {selectedDoc.fileName && selectedDoc.fileName !== selectedDoc.title && (
                  <span className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>
                    {selectedDoc.fileName}
                  </span>
                )}
              </>
            ) : (
              <span className="muted">No template selected.</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setPickerOpen(true)}
            >
              {selectedDoc ? "Change template" : "Browse PDFs"}
            </button>
            {selectedDoc && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onSave({ templateDocumentId: undefined })}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {pdfs.length === 0 && (
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
            Upload a fillable PDF in <span className="mono">/app/documents</span> to see it here.
          </div>
        )}
      </Field>

      <PdfPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        pdfs={pdfs}
        selectedId={cfg.templateDocumentId}
        onPick={async (id) => {
          await onSave({ templateDocumentId: id });
          setPickerOpen(false);
        }}
      />

      <Field label="Field mapping">
        <div className="pdf-picker-trigger">
          <div className="pdf-picker-trigger__label">
            <strong>
              {mappingSummary.mapped} of {mappingSummary.total} fields mapped
            </strong>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              {mappingSummary.mapped === 0
                ? "Open the wizard to map each AcroForm field to a value."
                : mappingSummary.breakdown}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMapperOpen(true)}
          >
            {mappingSummary.mapped === 0 ? "Start mapping" : "Edit mapping"}
          </button>
        </div>
      </Field>

      <FieldMappingWizardModal
        open={mapperOpen}
        onClose={() => setMapperOpen(false)}
        fields={currentFields}
        mappings={mappings}
        intakeFields={intakeFields}
        onFieldsChange={(fields) => onSave({ fields })}
        onMappingsChange={(next) => onSave({ fieldMappings: next })}
      />

      {inspection && (
        <Field label="Detected structure">
          <div className="workflow-codebox">
            {inspection.fieldCount ?? currentFields.length} fields
            {Array.isArray(inspection.tables) && inspection.tables.length > 0
              ? ` · ${inspection.tables.map((table: any) => `${table.label}: ${table.rowCount} rows`).join(" · ")}`
              : " · no repeated field tables detected"}
          </div>
        </Field>
      )}

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!selectedDoc || detecting}
          title={selectedDoc ? "Read AcroForm field names from the selected PDF." : "Pick a PDF template first."}
          onClick={autoDetectFields}
        >
          {detecting ? "Detecting..." : "Auto-detect fields"}
        </button>
      </div>
    </>
  );
}

// Full-screen picker with a left list + right preview iframe.


export {
  intakePayloadFromState,
  missingRequiredIntakeFields,
  AccessPersonPicker,
  documentDefaults,
  emailDefaults,
  workflowTemplateTokens,
  NodeSetupPanel,
  LabeledInput,
  LabeledTextarea,
  TemplateTextarea,
  FieldListEditor,
  DocumentCreateSetup,
  IntakeFieldSetup,
  IntakeFieldWizardModal,
  PdfFillSetup,
};

export type {
  NodeSetupPanelProps,
};
