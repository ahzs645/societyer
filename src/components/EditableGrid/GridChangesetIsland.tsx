import { Loader2 } from "lucide-react";

/**
 * Floating "N changes · Discard · Save" island for a grid's pending
 * changeset. Frosted, elevated, and pinned to the bottom of its scroll area.
 */
export function GridChangesetIsland({
  count,
  onDiscard,
  onSave,
  saving = false,
  saveLabel = "Save",
  blockedReason,
  noun = "change",
}: {
  count: number;
  onDiscard: () => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  /** Explains why Save is unavailable (e.g. "Fix 2 cells first"). */
  blockedReason?: string | null;
  noun?: string;
}) {
  if (count === 0 && !saving) return null;
  return (
    <div className="egrid-island" role="region" aria-label="Unsaved changes">
      <span className="egrid-island__count" aria-live="polite">
        <strong>{count}</strong> {count === 1 ? noun : `${noun}s`}
      </span>
      {blockedReason && <span className="egrid-island__blocked">{blockedReason}</span>}
      <span className="egrid-island__actions">
        <button type="button" className="btn btn--sm btn--ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </button>
        <button type="button" className="btn btn--sm btn--accent" onClick={onSave} disabled={saving || Boolean(blockedReason)}>
          {saving && <Loader2 size={14} className="spin" aria-hidden="true" />}
          {saving ? "Saving…" : saveLabel}
        </button>
      </span>
    </div>
  );
}
