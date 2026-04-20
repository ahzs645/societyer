import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { Banner, Button } from "./ui";

export type MergeField<T> = {
  id: keyof T & string;
  label: string;
  display?: (value: any, row: T) => string;
};

/** Side-by-side merge UI — pick the winning value per field, then commit.
 * Caller supplies `onMerge(keepId, dropIds, mergedValues)`. */
export function MergeRecordsModal<T extends { _id: string }>({
  open,
  onClose,
  rows,
  fields,
  label,
  onMerge,
}: {
  open: boolean;
  onClose: () => void;
  rows: T[];
  fields: MergeField<T>[];
  label: string;
  onMerge: (keepId: string, dropIds: string[], merged: Record<string, any>) => Promise<void>;
}) {
  const initial = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (rows.length > 0) {
      for (const f of fields) {
        const first = rows.find((r) => (r as any)[f.id] != null);
        map[f.id] = String(first?._id ?? rows[0]._id);
      }
    }
    return map;
  }, [rows, fields]);
  const [winners, setWinners] = useState<Record<string, string>>(initial);
  const [keepId, setKeepId] = useState<string>(rows[0]?._id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rows.length < 2) return null;

  const merged: Record<string, any> = {};
  for (const f of fields) {
    const winnerId = winners[f.id] ?? keepId;
    const winner = rows.find((r) => r._id === winnerId);
    if (winner) merged[f.id] = (winner as any)[f.id];
  }

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const dropIds = rows.filter((r) => r._id !== keepId).map((r) => r._id);
      await onMerge(keepId, dropIds, merged);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't merge records");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Merge ${rows.length} ${label}`} size="xl">
      <div className="merge-modal">
        <Banner tone="warn">
          Merging deletes the non-winning records. Pick which record to keep and the winning value for each field.
        </Banner>

        <div className="merge-modal__winner-row">
          <span className="muted">Keep record:</span>
          <select
            className="input"
            value={keepId}
            onChange={(e) => setKeepId(e.target.value)}
          >
            {rows.map((r, i) => (
              <option key={r._id} value={r._id}>
                Record {i + 1}
              </option>
            ))}
          </select>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              {rows.map((_, i) => (
                <th key={i}>Record {i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.id}>
                <td><strong>{f.label}</strong></td>
                {rows.map((r) => {
                  const value = (r as any)[f.id];
                  const shown = f.display ? f.display(value, r) : value == null || value === "" ? "—" : String(value);
                  const isWinner = winners[f.id] === r._id;
                  return (
                    <td
                      key={r._id}
                      className={isWinner ? "merge-modal__winner" : undefined}
                      onClick={() => setWinners((w) => ({ ...w, [f.id]: r._id }))}
                      style={{ cursor: "pointer" }}
                    >
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="radio"
                          checked={isWinner}
                          onChange={() => setWinners((w) => ({ ...w, [f.id]: r._id }))}
                        />
                        {shown}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {error && <Banner tone="danger">{error}</Banner>}

        <div className="merge-modal__footer">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="accent" onClick={commit} disabled={busy}>
            {busy ? "Merging…" : `Merge into Record ${rows.findIndex((r) => r._id === keepId) + 1}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
