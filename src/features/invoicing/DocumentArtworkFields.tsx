import { useEffect, useState } from "react";
import { Field } from "../../components/ui";
import { cleanDocumentImage, cleanDocumentLink, sanitizeDocumentHtml } from "../../../shared/documentRichContent";

export async function readDocumentImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 175_000) throw new Error("Choose a PNG or JPEG image smaller than 175 KB.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read image.")); reader.readAsDataURL(file);
  });
  return cleanDocumentImage(data);
}

export function DocumentImageUpload({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [error, setError] = useState("");
  const upload = async (file?: File) => {
    if (!file) return;
    try { onChange(await readDocumentImage(file)); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not read image."); }
  };
  return <div className="document-designer__image-control"><Field label={label} hint="PNG or JPEG, up to 175 KB. Stored with the design."><input className="input" type="file" accept="image/png,image/jpeg" onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></Field>{value && <div className="document-designer__image-preview"><img src={value} alt={label} /><button className="btn btn--sm" type="button" onClick={() => { onChange(""); setError(""); }}>Remove {label.toLowerCase()}</button></div>}{error && <p className="field__error" role="alert">{error}</p>}</div>;
}

export function DocumentHttpsLinkField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState("");
  useEffect(() => { setDraft(value); setError(""); }, [value]);
  const apply = () => {
    try { const normalized = cleanDocumentLink(draft); if (normalized && !normalized.startsWith("https://")) throw new Error("Use an HTTPS payment link."); onChange(normalized); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not apply payment link."); }
  };
  return <div><Field label="Online payment HTTPS link"><input className="input" type="url" value={draft} maxLength={2000} onBlur={apply} onChange={(event) => setDraft(event.target.value)} /></Field><button className="btn btn--sm" type="button" onClick={apply}>Apply online payment link</button>{draft !== value && <p className="muted">Link changes are not applied yet.</p>}{error && <p className="field__error" role="alert">{error}</p>}</div>;
}

/** Markup is applied as a complete, validated fragment; incomplete typing never enters a snapshot. */
export function DocumentRichEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(value); setError(""); }, [value]);
  const apply = () => {
    try { const normalized = sanitizeDocumentHtml(draft); onChange(normalized); setDraft(normalized); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not apply rich content."); }
  };
  const insertImage = async (file?: File) => {
    if (!file) return;
    try { const image = await readDocumentImage(file); setDraft((current) => `${current}<p><img src="${image}" alt="Document artwork" width="160"></p>`); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not read rich image."); }
  };
  return <div className="document-designer__rich-editor"><Field label={label} hint="Supports paragraphs, headings, bold, italic, lists, tables, links and uploaded images. Apply the content to include it in previews and saved documents."><textarea className="input textarea" rows={5} value={draft} maxLength={500_000} onChange={(event) => setDraft(event.target.value)} /></Field><div className="document-designer__reorder"><button type="button" className="btn btn--sm" onClick={() => setDraft((current) => `${current}<p>Text</p>`)}>Insert paragraph</button><button type="button" className="btn btn--sm" onClick={() => setDraft((current) => `${current}<ul><li>Item</li></ul>`)}>Insert list</button><button type="button" className="btn btn--sm" onClick={apply}>Apply {label.toLowerCase()}</button></div><Field label={`${label} image`}><input className="input" type="file" accept="image/png,image/jpeg" onChange={(event) => { void insertImage(event.target.files?.[0]); event.target.value = ""; }} /></Field>{draft !== value && <p className="muted">Changes are not applied yet.</p>}{error && <p className="field__error" role="alert">{error}</p>}</div>;
}
