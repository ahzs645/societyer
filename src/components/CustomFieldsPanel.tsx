import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "./ui";

type Props = {
  societyId: any;
  entityType: "members" | "directors" | "volunteers" | "employees";
  entityId: any;
  /** Heading displayed at the top of the panel. Defaults to "Custom fields". */
  title?: string;
};

// Renders a compact form for every custom field definition on this entity
// type. Changes blur-save to `customFields.setValue`. If no definitions
// exist yet, shows a helpful empty state with a link to the admin page.
export function CustomFieldsPanel({ societyId, entityType, entityId, title = "Custom fields" }: Props) {
  const definitions = useQuery(api.customFields.listDefinitions, { societyId, entityType });
  const values = useQuery(api.customFields.listValues, entityId ? { entityType, entityId } : "skip");
  const setValue = useMutation(api.customFields.setValue);
  const clearValue = useMutation(api.customFields.clearValue);

  const valuesByDef = useMemo(() => {
    const map = new Map<string, any>();
    for (const v of values ?? []) map.set(String(v.definitionId), v);
    return map;
  }, [values]);

  if (!definitions) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        Loading custom fields…
      </div>
    );
  }
  if (definitions.length === 0) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        No custom fields defined for {entityType}.{" "}
        <a className="link" href="/app/custom-fields">
          Add one
        </a>
        .
      </div>
    );
  }

  return (
    <div className="custom-fields-panel">
      <div className="field__label">{title}</div>
      {definitions.map((def: any) => {
        const current = valuesByDef.get(String(def._id));
        return (
          <CustomFieldInput
            key={def._id}
            def={def}
            value={current?.value}
            onSave={async (next) => {
              if (next === undefined || next === "" || next === null) {
                await clearValue({ entityType, entityId, definitionId: def._id });
              } else {
                await setValue({
                  societyId,
                  definitionId: def._id,
                  entityType,
                  entityId,
                  value: next,
                });
              }
            }}
          />
        );
      })}
    </div>
  );
}

function CustomFieldInput({
  def,
  value,
  onSave,
}: {
  def: any;
  value: any;
  onSave: (next: any) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<any>(value ?? "");
  const externalRef = useState(value)[0];
  // Simple sync when parent value updates due to reactive query.
  if (value !== externalRef && draft !== value) {
    // Only overwrite if user hasn't typed yet (draft === externalRef).
    if (draft === externalRef) setDraft(value ?? "");
  }

  const label = def.required ? `${def.label} *` : def.label;

  if (def.kind === "boolean") {
    return (
      <label className="workflow-checkbox">
        <input
          type="checkbox"
          checked={Boolean(draft)}
          onChange={(e) => {
            setDraft(e.target.checked);
            onSave(e.target.checked);
          }}
        />
        <span>{label}</span>
      </label>
    );
  }

  if (def.kind === "date") {
    return (
      <Field label={label}>
        <input
          className="input"
          type="date"
          value={typeof draft === "string" ? draft : ""}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onSave(draft)}
        />
        {def.description && (
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>
            {def.description}
          </div>
        )}
      </Field>
    );
  }

  if (def.kind === "number") {
    return (
      <Field label={label}>
        <input
          className="input"
          type="number"
          value={draft === "" || draft == null ? "" : String(draft)}
          onChange={(e) => setDraft(e.target.value === "" ? "" : Number(e.target.value))}
          onBlur={() => onSave(draft === "" ? undefined : draft)}
        />
        {def.description && (
          <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>
            {def.description}
          </div>
        )}
      </Field>
    );
  }

  const inputType = def.kind === "email" ? "email" : def.kind === "phone" ? "tel" : "text";
  return (
    <Field label={label}>
      <input
        className="input"
        type={inputType}
        value={draft ?? ""}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(draft)}
      />
      {def.description && (
        <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>
          {def.description}
        </div>
      )}
    </Field>
  );
}
