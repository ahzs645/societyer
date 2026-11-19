import { Plus, Trash2 } from "lucide-react";
import { Field } from "../../components/ui";
import { DatePicker } from "../../components/DatePicker";
import type { PortalAccessEntry } from "./types";

/** Who holds registry portal access (Online Filing Centre, BC Registry): name, role, when it changed, notes. */
export function PortalAccessEditor({ value, onChange }: { value: readonly PortalAccessEntry[]; onChange: (value: PortalAccessEntry[]) => void }) {
  const update = (index: number, patch: Partial<PortalAccessEntry>) => onChange(value.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  return (
    <fieldset className="org-portal-access">
      <legend className="field__label">Registry portal access</legend>
      {value.length === 0 && <p className="muted org-portal-access__empty">No one recorded. Add who can file in the registry's online portal.</p>}
      {value.map((entry, index) => (
        <div className="org-portal-access__row" key={index}>
          <div className="org-portal-access__fields">
            <Field label="Name"><input className="input" value={entry.name} onChange={(event) => update(index, { name: event.target.value })} /></Field>
            <Field label="Role"><input className="input" value={entry.role ?? ""} placeholder="e.g. Online Filing Centre access" onChange={(event) => update(index, { role: event.target.value })} /></Field>
            <Field label="Updated"><DatePicker value={entry.updatedAtISO?.slice(0, 10) ?? ""} onChange={(next) => update(index, { updatedAtISO: next || undefined })} /></Field>
            <Field label="Notes"><input className="input" value={entry.notes ?? ""} onChange={(event) => update(index, { notes: event.target.value })} /></Field>
          </div>
          <button className="btn btn--ghost btn--sm btn--icon" type="button" aria-label={`Remove ${entry.name.trim() || "this person"}`} onClick={() => onChange(value.filter((_, at) => at !== index))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button className="btn btn--sm org-portal-access__add" type="button" onClick={() => onChange([...value, { name: "" }])}>
        <Plus size={12} /> Person
      </button>
    </fieldset>
  );
}

/** The entries to save: trimmed, blank rows dropped. A row with details but no name is kept so saving explains it. */
export function cleanPortalAccess(value: readonly PortalAccessEntry[] | undefined): PortalAccessEntry[] {
  return (value ?? [])
    .map((entry) => ({
      name: entry.name.trim(),
      ...(entry.role?.trim() ? { role: entry.role.trim() } : {}),
      ...(entry.updatedAtISO?.trim() ? { updatedAtISO: entry.updatedAtISO.trim() } : {}),
      ...(entry.notes?.trim() ? { notes: entry.notes.trim() } : {}),
    }))
    .filter((entry) => entry.name || entry.role || entry.updatedAtISO || entry.notes);
}
