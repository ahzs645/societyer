import type { AutosaveDraft, AutosaveDraftSink } from "./meetingDraftStore";
export type NotesSaveState = "saved" | "pending" | "saving" | "error";

export type NotesAutosaveSnapshot = {
  value: string;
  saveState: NotesSaveState;
  error: string | null;
  recovered: boolean;
  /** Someone else saved changes that overlap this draft's: keep both, or load theirs. */
  conflict?: boolean;
};

const lines = (text: string) => text.split("\n");

/** The lines `next` changed in `base`: one region, between their common start and end. */
function changedRegion(base: string[], next: string[]) {
  let start = 0;
  while (start < base.length && start < next.length && base[start] === next[start]) start += 1;
  let tail = 0;
  while (tail < base.length - start && tail < next.length - start && base[base.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  return { start, end: base.length - tail, lines: next.slice(start, next.length - tail) };
}

/**
 * Both sides' edits to the notes, when they don't touch the same lines: two
 * people adding lines at the end (or anywhere else) both keep theirs. Null
 * when the edits overlap and a person has to choose.
 */
export function mergeNoteTexts(base: string, mine: string, theirs: string): string | null {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  // Both wrote into empty notes: keep both.
  if (!base.trim()) return `${theirs.trimEnd()}\n${mine.trimStart()}`;
  const original = lines(base);
  const a = changedRegion(original, lines(mine));
  const b = changedRegion(original, lines(theirs));
  const join = (first: typeof a, second: typeof a) => [
    ...original.slice(0, first.start), ...first.lines, ...original.slice(first.end, second.start), ...second.lines, ...original.slice(second.end),
  ].join("\n");
  // Both only added lines at the same place: theirs first, then mine.
  if (a.start === a.end && b.start === b.end && a.start === b.start) return join(b, { ...a, start: b.end, end: b.end });
  if (a.end <= b.start && !(a.start === b.start && a.start === a.end && b.start !== b.end)) return join(a, b);
  if (b.end <= a.start && !(a.start === b.start && b.start === b.end && a.start !== a.end)) return join(b, a);
  return null;
}

/** Their saved notes, then the lines this draft changed underneath, so nothing is lost. */
export function keepBothNoteTexts(base: string, mine: string, theirs: string): string {
  const added = changedRegion(lines(base), lines(mine)).lines.join("\n").trim();
  return added ? `${theirs.trimEnd()}\n\n${added}` : theirs;
}

/**
 * Serialize note writes and retain the base text until the server accepts a
 * save. In particular, a subscription echo cannot replace a newer local draft,
 * and a failed flush rejects so callers cannot convert unsaved notes to minutes.
 */
export function createNotesAutosave(
  initial: string | undefined,
  save: (value: string, expected: string | null) => Promise<unknown>,
  durable?: AutosaveDraftSink<string, string | null>,
) {
  let baseline: string | null = initial ?? null;
  let latestServer: string | null = baseline;
  let serverVersion = 0;
  let queued: string | null = null;
  let inFlight: Promise<void> | null = null;
  let snapshot: NotesAutosaveSnapshot = { value: initial ?? "", saveState: "saved", error: null, recovered: false, conflict: false };
  let revision: string | null = null;
  const persist = () => { revision = durable?.write({ value: snapshot.value, baseline }) ?? null; };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<NotesAutosaveSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  /**
   * The server moved on while this draft waited: put this draft's edits on
   * top of the newer notes when they don't overlap. Returns whether it did.
   */
  const rebase = (): boolean => {
    if (queued === null || snapshot.recovered || latestServer === baseline) return false;
    const merged = mergeNoteTexts(baseline ?? "", queued, latestServer ?? "");
    if (merged === null) {
      publish({ conflict: true });
      return false;
    }
    baseline = latestServer;
    queued = merged;
    publish({ value: merged, saveState: "pending", error: null, conflict: false });
    persist();
    return true;
  };

  const flush = (): Promise<void> => {
    if (snapshot.recovered) return Promise.reject(new Error("Review the recovered notes, then choose Save recovered draft."));
    if (inFlight) return inFlight;
    if (queued === null) return Promise.resolve();
    // Start in a microtask so every caller receives the same in-flight promise,
    // including a second blur/convert event in this render.
    const run = Promise.resolve().then(async () => {
      while (queued !== null) {
        const next = queued;
        const submittedRevision = revision;
        queued = null;
        if (next === (baseline ?? "")) {
          durable?.acknowledge(submittedRevision);
          baseline = latestServer;
          publish({ value: baseline ?? "", saveState: "saved", error: null });
          continue;
        }
        publish({ saveState: "saving", error: null });
        try {
          const baselineBefore = baseline;
          const observedBefore = serverVersion;
          durable?.assertActive();
          await save(next, baseline);
          const newerServerValue = serverVersion > observedBefore
            && latestServer !== baselineBefore && latestServer !== next;
          if (!newerServerValue) latestServer = next;
          baseline = next;
          durable?.acknowledge(submittedRevision);
          if (queued !== null) persist();
          if (queued === null && newerServerValue) {
            baseline = latestServer;
            publish({ value: latestServer ?? "", saveState: "saved", error: null });
          } else {
            publish({ saveState: queued === null ? "saved" : "pending", error: null });
          }
        } catch (error) {
          // Keep a more recent keystroke if it arrived while this save ran.
          queued = queued ?? next;
          // Someone else's save is already here and doesn't overlap: combine and try again.
          if (rebase()) continue;
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
      persist();
    },
    receiveServer(value: string | undefined) {
      latestServer = value ?? null;
      serverVersion += 1;
      // A failed save waiting on newer notes from someone else: combine and retry.
      if (!inFlight && snapshot.saveState === "error" && rebase()) {
        void flush().catch(() => undefined);
        return;
      }
      if (queued !== null || inFlight || snapshot.saveState === "error") return;
      baseline = latestServer;
      publish({ value: value ?? "", saveState: "saved", error: null });
    },
    restore(draft: AutosaveDraft<string, string | null>) {
      if (inFlight) return;
      baseline = draft.baseline;
      queued = draft.value;
      publish({ value: draft.value, saveState: "pending", error: null, recovered: true });
      persist();
    },
    saveRecovered() {
      publish({ recovered: false });
      return flush();
    },
    /** Explicitly discard a conflicting draft after the user has reviewed it. */
    useLatestServer() {
      if (inFlight) return;
      baseline = latestServer;
      queued = null;
      durable?.discardCurrent();
      publish({ value: latestServer ?? "", saveState: "saved", error: null, recovered: false, conflict: false });
    },
    /** A conflict: keep their saved notes and put this draft's changed lines under them. */
    keepBoth() {
      if (inFlight || queued === null) return Promise.resolve();
      const combined = keepBothNoteTexts(baseline ?? "", queued, latestServer ?? "");
      baseline = latestServer;
      queued = combined;
      publish({ value: combined, saveState: "pending", error: null, conflict: false });
      persist();
      return flush();
    },
    flush,
  };
}
