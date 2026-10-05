import { useState } from "react";
import { Upload } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import { Field } from "@/components/ui";
import { parseMeetingTemplateImport, type ImportedMeetingTemplate } from "../lib/templateImport";

export function MeetingTemplateImportButton({ societyId, existingNames }: { societyId: Id<"societies">; existingNames: string[] }) {
  const { can } = usePermissions();
  const canWrite = can("meetings:write");
  const create = usePermissionedMutation(api.meetingTemplates.create, canWrite);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  let template: ImportedMeetingTemplate | undefined;
  let parseError = "";
  if (text.trim()) {
    try { template = parseMeetingTemplateImport(text); } catch (e) { parseError = e instanceof Error ? e.message : String(e); }
  }
  const duplicate = template && existingNames.some(name => name.trim().toLowerCase() === template!.name.toLowerCase());
  const save = async () => {
    if (!canWrite || !template || duplicate || saving) return;
    setSaving(true);
    setError("");
    try {
      await create({ societyId, ...template });
      toast.success("Meeting template imported", template.name);
      setOpen(false);
      setText("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  };
  if (!canWrite) return null;
  return <>
    <button className="btn-action" onClick={() => { setError(""); setOpen(true); }}><Upload size={12} /> Import template</button>
    <Modal open={open && canWrite} title="Import meeting template" onClose={() => { if (!saving) setOpen(false); }} footer={<>
      <button className="btn-action" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
      <button className="btn-action btn-action--primary" disabled={!template || !!duplicate || saving} onClick={() => { void save(); }}>{saving ? "Importing..." : "Import template"}</button>
    </>}>
      <p>Choose a JSON template or paste its content, then review the agenda before importing.</p>
      <Field label="Template JSON file"><input className="input" type="file" accept=".json,application/json" disabled={saving} onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setText("");
        if (file.size > 1_000_000) { setError("Template JSON must be smaller than 1 MB."); return; }
        try { setText(await file.text()); setError(""); } catch { setText(""); setError("Could not read this file."); }
      }} /></Field>
      <Field label="Template JSON" hint='One object with name, meetingType and items: [{"title":"Welcome","depth":0,"sectionType":"discussion"}].'><textarea className="textarea" rows={8} value={text} disabled={saving} onChange={e => { setText(e.target.value); setError(""); }} /></Field>
      {(error || parseError || duplicate) && <p role="alert">{error || parseError || "A template with this name already exists. Change the name to import another copy."}</p>}
      {template && <div><strong>{template.name}</strong><p>{template.meetingType || "Any meeting type"} · {template.items.length} agenda items</p><ol>{template.items.map((item, i) => <li key={i} style={{ marginLeft: item.depth === 1 ? 20 : 0 }}>{item.title}{item.motionText && <p className="muted">{item.motionText}</p>}</li>)}</ol></div>}
    </Modal>
  </>;
}
