import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Select } from "@/components/Select";
import type {
  AddressValue,
  EmailsValue,
  FieldMetadata,
  FileValue,
  FullNameValue,
  LinksValue,
  PhonesValue,
} from "../../types";
import { COUNTRY_OPTIONS } from "../countryOptions";
import { normalizeEmails, normalizeLinks, normalizePhones } from "./display/StructuredFieldDisplays";

export type StructuredFieldInputProps = {
  value: unknown;
  field: FieldMetadata;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
};

export function AddressInput({ value, onCommit, onCancel }: StructuredFieldInputProps) {
  const [draft, setDraft] = useState<AddressValue>(() => normalizeAddress(value));
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => { firstInput.current?.focus(); firstInput.current?.select(); }, []);
  const set = (key: keyof AddressValue, next: string) => setDraft((current) => ({ ...current, [key]: next || null }));

  return (
    <div className="record-cell__structured-editor record-cell__address-editor" role="group" aria-label="Edit address">
      <EditorField label="Address 1" wide><input ref={firstInput} value={draft.addressStreet1 ?? ""} onChange={(event) => set("addressStreet1", event.target.value)} /></EditorField>
      <EditorField label="Address 2" wide><input value={draft.addressStreet2 ?? ""} onChange={(event) => set("addressStreet2", event.target.value)} /></EditorField>
      <EditorField label="City"><input value={draft.addressCity ?? ""} onChange={(event) => set("addressCity", event.target.value)} /></EditorField>
      <EditorField label="State"><input value={draft.addressState ?? ""} onChange={(event) => set("addressState", event.target.value)} /></EditorField>
      <EditorField label="Post Code"><input value={draft.addressPostcode ?? ""} onChange={(event) => set("addressPostcode", event.target.value)} /></EditorField>
      <EditorField label="Country">
        <Select
          size="sm"
          value={draft.addressCountry ?? ""}
          onChange={(next) => set("addressCountry", next)}
          options={COUNTRY_OPTIONS}
          placeholder="No country"
          clearable
          clearLabel="No country"
          searchable
          menuMinWidth={220}
        />
      </EditorField>
      <EditorActions onCancel={onCancel} onApply={() => onCommit(cleanObject(draft))} />
    </div>
  );
}

export function FullNameInput({ value, onCommit, onCancel }: StructuredFieldInputProps) {
  const [draft, setDraft] = useState<FullNameValue>(() => normalizeFullName(value));
  const firstInput = useRef<HTMLInputElement>(null);
  useEffect(() => { firstInput.current?.focus(); firstInput.current?.select(); }, []);
  const set = (key: keyof FullNameValue, next: string) => setDraft((current) => ({ ...current, [key]: next || null }));
  return (
    <div className="record-cell__structured-editor" role="group" aria-label="Edit full name">
      <EditorField label="Prefix"><input ref={firstInput} value={draft.honorificPrefix ?? ""} onChange={(event) => set("honorificPrefix", event.target.value)} /></EditorField>
      <EditorField label="First name"><input value={draft.firstName ?? ""} onChange={(event) => set("firstName", event.target.value)} /></EditorField>
      <EditorField label="Middle name"><input value={draft.middleName ?? ""} onChange={(event) => set("middleName", event.target.value)} /></EditorField>
      <EditorField label="Last name"><input value={draft.lastName ?? ""} onChange={(event) => set("lastName", event.target.value)} /></EditorField>
      <EditorField label="Suffix" wide><input value={draft.honorificSuffix ?? ""} onChange={(event) => set("honorificSuffix", event.target.value)} /></EditorField>
      <EditorActions onCancel={onCancel} onApply={() => onCommit(cleanObject(draft))} />
    </div>
  );
}

export function RichTextInput({ value, onCommit, onCancel }: StructuredFieldInputProps) {
  const [draft, setDraft] = useState(String(value ?? ""));
  return (
    <div className="record-cell__structured-editor record-cell__long-editor">
      <label><span>Rich text</span><textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <EditorActions onCancel={onCancel} onApply={() => onCommit(draft)} />
    </div>
  );
}

export function RawJsonInput({ value, onCommit, onCancel }: StructuredFieldInputProps) {
  const [draft, setDraft] = useState(() => {
    try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); }
  });
  const [error, setError] = useState("");
  const apply = () => {
    try { onCommit(JSON.parse(draft)); } catch { setError("Enter valid JSON before applying."); }
  };
  return (
    <div className="record-cell__structured-editor record-cell__long-editor">
      <label><span>JSON</span><textarea autoFocus className="mono" value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} /></label>
      {error ? <div className="record-cell__editor-error" role="alert">{error}</div> : null}
      <EditorActions onCancel={onCancel} onApply={apply} />
    </div>
  );
}

export function EmailsInput(props: StructuredFieldInputProps) {
  return <MultiValueInput {...props} label="Email" initial={normalizeEmails(props.value)} type="email" toValue={(items) => ({ primaryEmail: items[0] ?? "", additionalEmails: items.slice(1) } satisfies EmailsValue)} />;
}

export function PhonesInput(props: StructuredFieldInputProps) {
  return <MultiValueInput {...props} label="Phone" initial={normalizePhones(props.value)} type="tel" toValue={(items) => ({ primaryPhoneNumber: items[0] ?? "", additionalPhones: items.slice(1).map((number) => ({ number })) } satisfies PhonesValue)} />;
}

export function LinksInput(props: StructuredFieldInputProps) {
  return <MultiValueInput {...props} label="URL" initial={normalizeLinks(props.value).map((link) => link.url)} type="url" toValue={(items) => ({ primaryLinkUrl: items[0] ?? "", primaryLinkLabel: null, secondaryLinks: items.slice(1).map((url) => ({ url, label: null })) } satisfies LinksValue)} />;
}

export function FilesInput(props: StructuredFieldInputProps) {
  const files = Array.isArray(props.value) ? props.value as FileValue[] : [];
  return <MultiValueInput {...props} label="File label" initial={files.map((file) => file.label || file.name)} toValue={(items) => items.map((name, index) => ({ fileId: files[index]?.fileId ?? `file-${index}-${name}`, name: files[index]?.name ?? name, label: name, url: files[index]?.url ?? null, mimeType: files[index]?.mimeType ?? null }))} />;
}

function MultiValueInput({ initial, label, type = "text", onCommit, onCancel, toValue }: StructuredFieldInputProps & { initial: string[]; label: string; type?: string; toValue: (items: string[]) => unknown }) {
  const [items, setItems] = useState(() => initial.length ? initial : [""]);
  const cleanItems = useMemo(() => items.map((item) => item.trim()).filter(Boolean), [items]);
  const setItem = (index: number, value: string) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  return (
    <div className="record-cell__structured-editor record-cell__multi-value-editor" role="group" aria-label={`Edit ${label.toLowerCase()} values`}>
      <div className="record-cell__multi-value-list">
        {items.map((item, index) => (
          <div className="record-cell__multi-value-row" key={index}>
            <input autoFocus={index === 0} type={type} aria-label={`${label} ${index + 1}`} value={item} onChange={(event) => setItem(index, event.target.value)} />
            <button type="button" aria-label={`Remove ${label.toLowerCase()} ${index + 1}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button type="button" className="record-cell__add-value" onClick={() => setItems((current) => [...current, ""])}><Plus size={13} /> Add {label.toLowerCase()}</button>
      <EditorActions onCancel={onCancel} onApply={() => onCommit(toValue(cleanItems))} />
    </div>
  );
}

function EditorField({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? "record-cell__editor-field record-cell__editor-field--wide" : "record-cell__editor-field"}><span>{label}</span>{children}</label>;
}

function EditorActions({ onCancel, onApply }: { onCancel: () => void; onApply: () => void }) {
  return <div className="record-cell__editor-actions"><button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button><button type="button" className="btn btn--accent" onClick={onApply}>Apply</button></div>;
}

function normalizeAddress(value: unknown): AddressValue {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, any>;
  return {
    addressStreet1: source.addressStreet1 ?? source.street ?? null,
    addressStreet2: source.addressStreet2 ?? source.unit ?? null,
    addressCity: source.addressCity ?? source.city ?? null,
    addressState: source.addressState ?? source.provinceState ?? null,
    addressPostcode: source.addressPostcode ?? source.postalCode ?? null,
    addressCountry: source.addressCountry ?? source.country ?? null,
  };
}

function normalizeFullName(value: unknown): FullNameValue {
  if (value && typeof value === "object") return value as FullNameValue;
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
}

function cleanObject<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry === "" ? null : entry])) as T;
}
