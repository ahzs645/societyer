import { useCallback, useRef } from "react";
import { useToast } from "../components/Toast";

/**
 * Undo-first feedback for reversible actions.
 *
 * Instead of asking "Are you sure?" before archiving, hiding, dismissing or
 * removing something that can be put back, run the action straight away and
 * offer Undo in the toast. Keep `useConfirm` for actions with no inverse
 * (permanent deletes, sends, signatures, filings).
 *
 *   const undoable = useUndoableAction();
 *   await undoable({
 *     message: "Task archived",
 *     run: () => update({ id, patch: { status: "Archived" } }),
 *     undo: () => update({ id, patch: { status: previous } }),
 *   });
 *
 * - `run` executes immediately. If it throws, an error toast is shown and no
 *   Undo is offered; the promise resolves to `false`.
 * - The toast carries an Undo button for `duration` ms (default 8s).
 * - Clicking Undo calls `undo`; a failed undo shows "Couldn't undo — try
 *   again" with a retry button instead of failing silently.
 * - Calls sharing a `dedupeKey` collapse into one toast, and a second call
 *   while the first is still running is ignored (double clicks).
 * - The toast stack is an `aria-live="polite"` region and every toast is a
 *   `role="status"`, so the outcome and the Undo result are announced.
 */
export type UndoableActionOptions = {
  /** Toast title once the action has run, e.g. "Task archived". */
  message: string;
  description?: string;
  /** The action itself. Omit when the change has already been made (e.g. after a prompt). */
  run?: () => unknown | Promise<unknown>;
  /** Puts things back. Must be safe to call once. */
  undo: () => unknown | Promise<unknown>;
  /** Shown if `run` throws. Defaults to the error message. */
  errorMessage?: string;
  /** Toast after a successful undo. `false` for none. Default "Undone". */
  undoneMessage?: string | false;
  undoLabel?: string;
  /** Collapses repeat toasts and ignores re-entrant calls with the same key. */
  dedupeKey?: string;
  /** How long Undo stays available, in ms. */
  duration?: number;
};

const DEFAULT_UNDO_MS = 8000;

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function useUndoableAction() {
  const toast = useToast();
  const inFlight = useRef(new Set<string>());

  return useCallback(
    async (options: UndoableActionOptions): Promise<boolean> => {
      const {
        message,
        description,
        run,
        undo,
        errorMessage,
        undoneMessage = "Undone",
        undoLabel = "Undo",
        dedupeKey,
        duration = DEFAULT_UNDO_MS,
      } = options;

      if (dedupeKey) {
        if (inFlight.current.has(dedupeKey)) return false;
        inFlight.current.add(dedupeKey);
      }

      try {
        if (run) await run();
      } catch (error) {
        toast.error(errorMessage ?? "Something went wrong", {
          description: errorText(error, "Try again in a moment."),
          dedupeKey,
        });
        return false;
      } finally {
        if (dedupeKey) inFlight.current.delete(dedupeKey);
      }

      let undone = false;
      const attemptUndo = async () => {
        if (undone) return;
        undone = true;
        try {
          await undo();
          if (undoneMessage) toast.info(undoneMessage, { description: message, dedupeKey });
        } catch (error) {
          undone = false;
          toast.error("Couldn't undo — try again", {
            description: errorText(error, message),
            dedupeKey,
            action: { label: "Try again", onClick: () => void attemptUndo() },
          });
        }
      };

      toast.success(message, {
        description,
        dedupeKey,
        duration,
        action: { label: undoLabel, onClick: () => void attemptUndo() },
      });
      return true;
    },
    [toast],
  );
}
