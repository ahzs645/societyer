import { ExternalLink, FileText } from "lucide-react";
import type {
  AddressValue,
  EmailsValue,
  FileValue,
  FullNameValue,
  LinksValue,
  PhonesValue,
} from "../../../types";
import type { FieldDisplayProps } from "../FieldDisplay";

const empty = <span className="record-cell__empty">—</span>;

export function AddressFieldDisplay({ value }: FieldDisplayProps) {
  const address = (value ?? {}) as AddressValue;
  const text = [
    [address.addressStreet1, address.addressStreet2].filter(Boolean).join(", "),
    [address.addressCity, address.addressState, address.addressPostcode].filter(Boolean).join(", "),
    address.addressCountry,
  ].filter(Boolean).join(", ");
  return text ? <span className="record-cell__text" title={text}>{text}</span> : empty;
}

export function FullNameFieldDisplay({ value }: FieldDisplayProps) {
  const name = (value ?? {}) as FullNameValue;
  const text = [name.honorificPrefix, name.firstName, name.middleName, name.lastName, name.honorificSuffix]
    .filter(Boolean).join(" ");
  return text ? <span className="record-cell__text">{text}</span> : empty;
}

export function RichTextFieldDisplay({ value }: FieldDisplayProps) {
  const text = String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text ? <span className="record-cell__text">{text}</span> : empty;
}

export function RawJsonFieldDisplay({ value }: FieldDisplayProps) {
  if (value == null || value === "") return empty;
  let text: string;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  return <span className="record-cell__text mono" title={text}>{text}</span>;
}

export function EmailsFieldDisplay({ value }: FieldDisplayProps) {
  const emails = normalizeEmails(value);
  if (!emails.length) return empty;
  return <div className="record-cell__chip-group">{emails.map((email) => (
    <a key={email} className="record-cell__link" href={`mailto:${email}`} onClick={(event) => event.stopPropagation()}>{email}</a>
  ))}</div>;
}

export function PhonesFieldDisplay({ value }: FieldDisplayProps) {
  const phones = normalizePhones(value);
  if (!phones.length) return empty;
  return <div className="record-cell__chip-group">{phones.map((phone) => (
    <a key={phone} className="record-cell__link" href={`tel:${phone.replace(/[^\d+]/g, "")}`} onClick={(event) => event.stopPropagation()}>{phone}</a>
  ))}</div>;
}

export function LinksFieldDisplay({ value }: FieldDisplayProps) {
  const links = normalizeLinks(value);
  if (!links.length) return empty;
  return <div className="record-cell__chip-group">{links.map((link) => (
    <a key={link.url} className="record-cell__link" href={link.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
      {link.label || compactUrl(link.url)} <ExternalLink size={10} />
    </a>
  ))}</div>;
}

export function FilesFieldDisplay({ value }: FieldDisplayProps) {
  const files = Array.isArray(value) ? value as FileValue[] : [];
  if (!files.length) return empty;
  return <div className="record-cell__chip-group">{files.map((file) => (
    file.url ? <a key={file.fileId} className="record-cell__link" href={file.url} target="_blank" rel="noopener noreferrer"><FileText size={11} />{file.label || file.name}</a>
      : <span key={file.fileId} className="record-cell__chip record-cell__chip--gray"><FileText size={11} />{file.label || file.name}</span>
  ))}</div>;
}

export function normalizeEmails(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const data = (value ?? {}) as EmailsValue;
  return [data.primaryEmail, ...(data.additionalEmails ?? [])].filter(Boolean).map(String);
}

export function normalizePhones(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry: any) => String(entry?.number ?? entry)).filter(Boolean);
  const data = (value ?? {}) as PhonesValue;
  const primary = [data.primaryPhoneCallingCode, data.primaryPhoneNumber].filter(Boolean).join(" ");
  return [primary, ...(data.additionalPhones ?? []).map((phone) => [phone.callingCode, phone.number].filter(Boolean).join(" "))].filter(Boolean);
}

export function normalizeLinks(value: unknown): Array<{ url: string; label?: string | null }> {
  if (Array.isArray(value)) return value.map((entry: any) => typeof entry === "string" ? { url: entry } : entry).filter((entry) => entry.url);
  const data = (value ?? {}) as LinksValue;
  return [data.primaryLinkUrl ? { url: data.primaryLinkUrl, label: data.primaryLinkLabel } : null, ...(data.secondaryLinks ?? [])]
    .filter((entry): entry is { url: string; label?: string | null } => !!entry?.url);
}

function compactUrl(url: string) {
  try { const parsed = new URL(url); return parsed.hostname + (parsed.pathname === "/" ? "" : parsed.pathname); } catch { return url; }
}
