import { meetingFieldValuesMatch } from "../../../../shared/meetingConcurrency";

type MotionValue = { motionId?: string; text: string };
type SaveState = "saved" | "pending" | "saving" | "error";

/**
 * Keep edits until their mutation settles. Local row tokens let a just-created
 * motion receive its server ID without losing text typed while it was saving.
 * MotionEditor changes one row at a time, appends, or removes; it does not reorder.
 */
export function createMotionAutosave<T extends MotionValue>(
  initial: T[],
  save: (value: T[], expected: T[]) => Promise<T[]>,
) {
  let baseline = initial;
  let latestServer = initial;
  let serverVersion = 0;
  let queued = false;
  let inFlight: Promise<void> | null = null;
  let tokenCounter = 0;
  const token = () => ++tokenCounter;
  let tokens = initial.map(token);
  let snapshot: { value: T[]; saveState: SaveState; error: string | null } = {
    value: initial, saveState: "saved", error: null,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };

  const flush = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (!queued) return Promise.resolve();
    const run = Promise.resolve().then(async () => {
      while (queued) {
        queued = false;
        const submitted = snapshot.value;
        const submittedTokens = tokens;
        if (meetingFieldValuesMatch(submitted, baseline)) {
          baseline = latestServer;
          tokens = latestServer.map(token);
          publish({ value: latestServer, saveState: "saved", error: null });
          continue;
        }
        publish({ saveState: "saving", error: null });
        try {
          const baselineBefore = baseline;
          const observedBefore = serverVersion;
          const canonical = await save(submitted, baseline);
          if (canonical.length !== submitted.length) throw new Error("The saved motion list changed unexpectedly. Your local changes are still here; reload the saved motions to review them.");
          const newerServerValue = serverVersion > observedBefore
            && !meetingFieldValuesMatch(latestServer, baselineBefore)
            && !meetingFieldValuesMatch(latestServer, canonical);
          if (!newerServerValue) latestServer = canonical;
          baseline = canonical;
          if (queued) {
            const submittedByToken = new Map(submittedTokens.map((id, index) => [id, index]));
            const rebased = snapshot.value.map((row, index) => {
              const sourceIndex = submittedByToken.get(tokens[index]);
              if (sourceIndex === undefined) return row;
              const before = submitted[sourceIndex] as Record<string, unknown>;
              const after = row as Record<string, unknown>;
              const changes: Record<string, unknown> = {};
              for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
                if (!meetingFieldValuesMatch(before[key], after[key])) changes[key] = after[key];
              }
              return { ...canonical[sourceIndex], ...changes } as T;
            });
            publish({ value: rebased, saveState: "pending", error: null });
          } else {
            baseline = latestServer;
            tokens = latestServer.map(token);
            publish({ value: latestServer, saveState: "saved", error: null });
          }
        } catch (error) {
          queued = true;
          publish({ saveState: "error", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }
    });
    inFlight = run.finally(() => {
      inFlight = null;
      if (!queued && snapshot.saveState === "saved" && !meetingFieldValuesMatch(baseline, latestServer)) {
        baseline = latestServer;
        tokens = latestServer.map(token);
        publish({ value: latestServer, saveState: "saved", error: null });
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
    change(value: T[]) {
      const previous = snapshot.value;
      tokens = value.map((row, index) => {
        const oldIndex = previous.findIndex((candidate) => candidate === row || (row.motionId && row.motionId === candidate.motionId));
        if (oldIndex !== -1) return tokens[oldIndex];
        // A patch replaces one object without changing the list's structure.
        if (value.length === previous.length) return tokens[index];
        return token();
      });
      queued = true;
      publish({ value, saveState: "pending", error: null });
    },
    receiveServer(value: T[]) {
      latestServer = value;
      serverVersion += 1;
      if (queued || inFlight || snapshot.saveState === "error") return;
      baseline = value;
      tokens = value.map(token);
      publish({ value, saveState: "saved", error: null });
    },
    useLatestServer() {
      if (inFlight) return;
      baseline = latestServer;
      queued = false;
      tokens = latestServer.map(token);
      publish({ value: latestServer, saveState: "saved", error: null });
    },
    flush,
  };
}
