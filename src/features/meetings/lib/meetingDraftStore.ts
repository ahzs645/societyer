/** Device-only recovery. Immutable revision keys keep tab acknowledgements isolated. */
export type MeetingDraftIdentity = { runtime: string; accountId: string; userId: string; societyId: string; meetingId: string };
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
export type StoredMeetingDraft<T> = { version: 1; identity: MeetingDraftIdentity; editor: string; session: string; revision: string; sequence: number; savedAt: number; payload: T };
export type RecoverableMeetingDraft<T> = StoredMeetingDraft<T> & { key: string };
export type MeetingDraftState<T> = { recoveries: RecoverableMeetingDraft<T>[]; error: string | null; savedOnDevice: boolean };
const PREFIX = "societyer.meetingDraft.v1:";
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const meetingDraftIdentityKey = (identity: MeetingDraftIdentity) => JSON.stringify([identity.runtime, identity.accountId, identity.userId, identity.societyId, identity.meetingId]);
const prefixFor = (identity: MeetingDraftIdentity, editor: string) => `${PREFIX}${encodeURIComponent(meetingDraftIdentityKey(identity))}:${encodeURIComponent(editor)}:`;
const storageFailure = "This device could not keep the latest recovery copy. Keep this editor open or copy your changes before leaving.";

export function createMeetingDraftJournal<T>(options: {
  identity: MeetingDraftIdentity | null;
  editor: string;
  storage: () => DraftStorage;
  active: () => boolean;
  valid: (value: unknown) => value is T;
}) {
  const session = id();
  let sequence = 0;
  let current: { key: string; payloadJson: string } | null = null;
  let snapshot: MeetingDraftState<T> = { recoveries: [], error: null, savedOnDevice: false };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<MeetingDraftState<T>>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const isActive = () => !!options.identity && options.active();
  const assertActive = () => { if (!isActive()) throw new Error("Your account or workspace changed. Reopen this meeting before saving the draft."); };
  const refresh = () => {
    if (!isActive()) { publish({ recoveries: [] }); return; }
    try {
      const storage = options.storage();
      if (current && storage.getItem(current.key) === null) {
        publish({ savedOnDevice: false, error: "Another tab removed this recovery copy. Keep editing to create a new copy, or save to the server before leaving." });
      }
      const prefix = prefixFor(options.identity!, options.editor);
      const newest = new Map<string, RecoverableMeetingDraft<T>>();
      let invalid = false;
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        let row: StoredMeetingDraft<T>;
        try { row = JSON.parse(storage.getItem(key) ?? "null"); }
        catch { invalid = true; continue; }
        if (!row || row.version !== 1 || row.editor !== options.editor || !row.identity
          || meetingDraftIdentityKey(row.identity) !== meetingDraftIdentityKey(options.identity!)
          || typeof row.session !== "string" || typeof row.revision !== "string"
          || key !== `${prefix}${row.session}:${row.revision}` || !Number.isFinite(row.sequence)
          || !Number.isFinite(row.savedAt) || !options.valid(row.payload)) { invalid = true; continue; }
        if (row.session === session) continue;
        const before = newest.get(row.session);
        if (!before || before.sequence < row.sequence) newest.set(row.session, { ...row, key });
      }
      publish({ recoveries: [...newest.values()].sort((a, b) => b.savedAt - a.savedAt), ...(invalid ? { error: "A recovery copy could not be read. It has been kept on this device; your saved meeting is unchanged." } : {}) });
    } catch { publish({ error: storageFailure }); }
  };
  const write = (payload: T): string | null => {
    if (!isActive()) { publish({ error: "Device recovery is unavailable until your account and workspace are verified." }); return null; }
    try {
      if (!options.valid(payload)) throw new Error("Invalid draft");
      const payloadJson = JSON.stringify(payload);
      const storage = options.storage();
      if (current?.payloadJson === payloadJson && storage.getItem(current.key) !== null) return current.key;
      const revision = id();
      const key = `${prefixFor(options.identity!, options.editor)}${session}:${revision}`;
      const row: StoredMeetingDraft<T> = { version: 1, identity: options.identity!, editor: options.editor, session, revision, sequence: ++sequence, savedAt: Date.now(), payload };
      // Store first. A quota failure must leave the last successful copy intact.
      storage.setItem(key, JSON.stringify(row));
      const previous = current;
      current = { key, payloadJson };
      publish({ error: null, savedOnDevice: true });
      if (previous) storage.removeItem(previous.key);
      return key;
    } catch { publish({ error: storageFailure, savedOnDevice: false }); return null; }
  };
  const acknowledge = (key: string | null) => {
    if (!key || !options.identity || !key.startsWith(prefixFor(options.identity, options.editor))) return;
    try {
      // Keys are immutable revisions: this can never delete a newer write,
      // including one made by another tab between a read and this removal.
      options.storage().removeItem(key);
      if (current?.key === key) { current = null; publish({ savedOnDevice: false, error: null }); }
      refresh();
    } catch { publish({ error: "The recovery copy could not be removed from this device. Your saved meeting is unchanged." }); }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, write, acknowledge, assertActive, isActive,
    currentRevision: () => current?.key ?? null,
    discardCurrent: () => acknowledge(current?.key ?? null),
    discard: (entry: RecoverableMeetingDraft<T>) => { assertActive(); acknowledge(entry.key); },
    recover(entry: RecoverableMeetingDraft<T>) {
      assertActive();
      const stored = snapshot.recoveries.find((row) => row.key === entry.key);
      if (!stored || options.storage().getItem(stored.key) === null) {
        refresh();
        throw new Error("This recovery copy is no longer available. Another tab may have restored or discarded it.");
      }
      // Fork a new editing session. Another tab can keep editing the original.
      const revision = write(stored.payload);
      if (revision) acknowledge(stored.key);
      return stored.payload;
    },
  };
}

export type MeetingDraftJournal<T> = ReturnType<typeof createMeetingDraftJournal<T>>;
export type AutosaveDraft<T, B = T> = { value: T; baseline: B };
export type AutosaveDraftSink<T, B = T> = Pick<MeetingDraftJournal<AutosaveDraft<T, B>>, "write" | "acknowledge" | "assertActive" | "discardCurrent">;
