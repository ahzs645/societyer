import { useEffect, useState } from "react";
import { DatePicker } from "../../components/DatePicker";
import { Drawer, Field } from "../../components/ui";

/** "I've filed it": the filing date (organization today by default) and an optional reference. */
export function MarkFiledDrawer({
  open,
  registry,
  today,
  onClose,
  onSave,
}: {
  open: boolean;
  registry: string;
  today: string;
  onClose: () => void;
  onSave: (values: { submittedOn: string; reference?: string }) => Promise<void>;
}) {
  const [submittedOn, setSubmittedOn] = useState(today);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmittedOn(today);
    setReference("");
    setError(null);
    setSaving(false);
  }, [open, today]);

  const save = async () => {
    if (!submittedOn) { setError("Enter the date you filed."); return; }
    if (submittedOn > today) { setError("The filing date can't be in the future."); return; }
    setSaving(true);
    try {
      await onSave({ submittedOn, reference: reference.trim() || undefined });
    } catch (err: any) {
      setError(err?.message ?? "This couldn't be saved.");
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="I've filed it"
      className="setup-sheet"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Mark as filed"}
          </button>
        </>
      }
    >
      <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="setup-form__lead">
          Tell Societyer you've sent your filing to {registry}. This doesn't file anything. You can undo it if you haven't filed yet.
        </p>
        <Field label="Filed on" required error={error ?? undefined}>
          <DatePicker value={submittedOn} max={today} clearable={false} onChange={(value) => { setSubmittedOn(value); setError(null); }} />
        </Field>
        <Field label="Reference or confirmation number" hint="Optional. From the registry's receipt or confirmation email.">
          <input className="input" value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}
