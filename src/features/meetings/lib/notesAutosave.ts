export type NotesSaveState = "saved" | "pending" | "saving" | "error";

export type NotesAutosaveSnapshot = {
  value: string;
  saveState: NotesSaveState;
  error: string | null;
};

/**
 * Serialize note writes and retain the base text until the server accepts a
 * save. In particular, a subscription echo cannot replace a newer local draft,
 * and a failed flush rejects so callers cannot convert unsaved notes to minutes.
 */
export function createNotesAutosave(
  initial: string | undefined,
  save: (value: string, expected: string | null) => Promise<unknown>,
) {
  let baseline: string | null = initial ?? null;
  let latestServer: string | null = baseline;
  let serverVersion = 0;
  let queued: string | null = null;
  let inFlight: Promise<void> | null = null;
  let snapshot: NotesAutosaveSnapshot = { value: initial ?? "", saveState: "saved", error: null };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<NotesAutosaveSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const flush = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (queued === null) return Promise.resolve();
    // Start in a microtask so every caller receives the same in-flight promise,
    // including a second blur/convert event in this render.
    const run = Promise.resolve().then(async () => {
      while (queued !== null) {
        const next = queued;
        queued = null;
        if (next === (baseline ?? "")) {
          baseline = latestServer;
          publish({ value: baseline ?? "", saveState: "saved", error: null });
          continue;
        }
        publish({ saveState: "saving", error: null });
        try {
          const baselineBefore = baseline;
          const observedBefore = serverVersion;
          await save(next, baseline);
          const newerServerValue = serverVersion > observedBefore
            && latestServer !== baselineBefore && latestServer !== next;
          if (!newerServerValue) latestServer = next;
          baseline = next;
          if (queued === null && newerServerValue) {
            baseline = latestServer;
            publish({ value: latestServer ?? "", saveState: "saved", error: null });
          } else {
            publish({ saveState: queued === null ? "saved" : "pending", error: null });
          }
        } catch (error) {
          // Keep a more recent keystroke if it arrived while this save ran.
          queued = queued ?? next;
          publish({
            saveState: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    });
    inFlight = run.finally(() => {
      inFlight = null;
      // A subscription can arrive after save() resolves but before this drain's
      // promise settles. Do not leave the editor displaying an older saved copy.
      if (queued === null && snapshot.saveState === "saved" && baseline !== latestServer) {
        baseline = latestServer;
        publish({ value: latestServer ?? "", saveState: "saved", error: null });
      }
    });
    return inFlight;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    change(value: string) {
      queued = value;
      publish({ value, saveState: "pending", error: null });
    },
    receiveServer(value: string | undefined) {
      latestServer = value ?? null;
      serverVersion += 1;
      if (queued !== null || inFlight || snapshot.saveState === "error") return;
      baseline = latestServer;
      publish({ value: value ?? "", saveState: "saved", error: null });
    },
    /** Explicitly discard a conflicting draft after the user has reviewed it. */
    useLatestServer() {
      if (inFlight) return;
      baseline = latestServer;
      queued = null;
      publish({ value: latestServer ?? "", saveState: "saved", error: null });
    },
    flush,
  };
}
