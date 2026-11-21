/**
 * The save status an autosaving editor shows at the end of its toolbar
 * (MarkdownEditor's `toolbarEnd`): Saved, Unsaved changes, Saving…, or Not
 * saved with a Retry button. Short on purpose; the editor's own alert under the
 * text explains a failure.
 */
import { AlertCircle, Check, Circle, Loader2, RotateCcw } from "lucide-react";

export type EditorSaveState = "saved" | "pending" | "saving" | "error";

const LABELS: Record<EditorSaveState, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving…",
  error: "Not saved",
};

export function EditorSaveStatus({ state, onRetry }: {
  state: EditorSaveState;
  /** Offered while the save has failed; leave out when retrying can't help (a conflict). */
  onRetry?: () => void;
}) {
  return (
    <span className={`editor-save-status is-${state}`}>
      <span role="status" aria-live="polite">
        {state === "saved" && <Check size={12} aria-hidden="true" />}
        {state === "pending" && <Circle size={7} fill="currentColor" aria-hidden="true" />}
        {state === "saving" && <Loader2 size={12} className="editor-save-status__spin" aria-hidden="true" />}
        {state === "error" && <AlertCircle size={12} aria-hidden="true" />}
        {/* Phones show only the icon (still read out), so typing never rewraps the toolbar. */}
        <span className="editor-save-status__label">{LABELS[state]}</span>
      </span>
      {state === "error" && onRetry && (
        <button
          type="button"
          className="editor-save-status__retry"
          // Keep the editor's selection, like the formatting buttons.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRetry}
        >
          <RotateCcw size={11} aria-hidden="true" /> Retry
        </button>
      )}
    </span>
  );
}
