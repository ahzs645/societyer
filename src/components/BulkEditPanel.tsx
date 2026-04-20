import { useState } from "react";
import { Drawer, Field, Button, Banner } from "./ui";
import { Select } from "./Select";
import { DatePicker } from "./DatePicker";

export type BulkEditField = {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "date";
  options?: string[];
};

/** Drawer for editing one field across many selected rows. Caller passes the
 * selected rows and an `onCommit(field, value)` callback that patches each
 * row — typically via a convex mutation loop. */
export function BulkEditPanel<T>({
  open,
  onClose,
  selectedCount,
  fields,
  onCommit,
  title,
}: {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  fields: BulkEditField[];
  onCommit: (fieldId: string, value: string) => Promise<void>;
  title?: string;
}) {
  const [fieldId, setFieldId] = useState<string>(fields[0]?.id ?? "");
  const [value, setValue] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = fields.find((f) => f.id === fieldId);

  const handleCommit = async () => {
    if (!field) return;
    setBusy(true);
    setError(null);
    try {
      await onCommit(field.id, value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update rows");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title ?? `Edit ${selectedCount} row${selectedCount === 1 ? "" : "s"}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="accent" onClick={handleCommit} disabled={busy || !field}>
            {busy ? "Updating…" : `Update ${selectedCount}`}
          </Button>
        </>
      }
    >
      <Banner tone="info">
        Changes will apply to all {selectedCount} selected row{selectedCount === 1 ? "" : "s"}. This cannot be undone.
      </Banner>
      <Field label="Field">
        <Select
          value={fieldId}
          onChange={(v) => { setFieldId(v); setValue(""); }}
          options={fields.map((f) => ({ value: f.id, label: f.label }))}
        />
      </Field>
      <Field label="New value">
        {field?.type === "select" && field.options ? (
          <Select
            value={value}
            onChange={setValue}
            options={field.options.map((o) => ({ value: o, label: o }))}
          />
        ) : field?.type === "date" ? (
          <DatePicker value={value} onChange={setValue} />
        ) : (
          <input
            className="input"
            type={field?.type === "number" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
    </Drawer>
  );
}
