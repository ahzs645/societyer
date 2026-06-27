// WorkflowDetail: intake-field wizard modal and its trigger.
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
import { Select } from "../components/Select";
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
  IntakeField,
  IntakeFieldType,
  inferIntakeFieldType,
  slugifyFieldKey,
  uniqueFieldKey,
} from "./WorkflowDetail.internal.intakeFields";


export function IntakeFieldSetup({
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

export function IntakeFieldWizardModal({
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
                  <Select
                    value={current.type}
                    onChange={(value) => updateCurrent({ type: value as IntakeFieldType })}
                    options={[
                      { value: "text", label: "Text" },
                      { value: "textarea", label: "Long text" },
                      { value: "email", label: "Email" },
                      { value: "phone", label: "Phone" },
                      { value: "date", label: "Date" },
                      { value: "checkbox", label: "Checkbox" },
                      { value: "person", label: "Person picker" },
                    ]}
                  />
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
