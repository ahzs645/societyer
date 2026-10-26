import assert from "node:assert/strict";
import { createMeetingDraftJournal, type AutosaveDraft, type DraftStorage, type MeetingDraftIdentity } from "../src/features/meetings/lib/meetingDraftStore";
import { createMeetingFormDraft, type MeetingFormPayload } from "../src/features/meetings/lib/meetingFormDraft";
import { createNotesAutosave } from "../src/features/meetings/lib/notesAutosave";
import { createMotionAutosave } from "../src/features/meetings/lib/motionAutosave";
import { assertMeetingFieldsUnchanged, meetingExpectedFields } from "../shared/meetingConcurrency";

class MemoryStorage implements DraftStorage {
  data = new Map<string, string>();
  failWrites = false;
  failReads = false;
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { if (this.failReads) throw new Error("Storage blocked"); return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error("QuotaExceededError"); this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const identity: MeetingDraftIdentity = { runtime: "convex:https://example.invalid", accountId: "test-account", userId: "test-user", societyId: "test-workspace", meetingId: "test-meeting" };
type NotesDraft = AutosaveDraft<string, string | null>;
const validNotes = (value: unknown): value is NotesDraft => {
  const row = value as NotesDraft | null;
  return !!row && typeof row.value === "string" && (row.baseline === null || typeof row.baseline === "string");
};
const notesJournal = (storage: MemoryStorage, options: { scope?: MeetingDraftIdentity; active?: () => boolean } = {}) => createMeetingDraftJournal({ identity: options.scope ?? identity, editor: "notes", storage: () => storage, active: options.active ?? (() => true), valid: validNotes });
const recoveries = (journal: ReturnType<typeof notesJournal>) => { journal.refresh(); return journal.getSnapshot().recoveries; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

// Synchronous device persistence precedes debounce, navigation and any network call.
{
  const storage = new MemoryStorage();
  let calls = 0;
  const journal = notesJournal(storage);
  const editor = createNotesAutosave("Original", async () => { calls++; throw new Error("Offline"); }, journal);
  editor.change("Typed immediately before navigation");
  const nextVisit = notesJournal(storage);
  const [entry] = recoveries(nextVisit);
  assert.equal(calls, 0);
  assert.deepEqual(entry.payload, { value: "Typed immediately before navigation", baseline: "Original" });
  await assert.rejects(editor.flush(), /Offline/);
  assert.equal(recoveries(nextVisit)[0].payload.value, "Typed immediately before navigation");

  let server = "Someone else's later edit";
  const restored = createNotesAutosave(server, async (value, baseline) => {
    calls++;
    assertMeetingFieldsUnchanged({ workingNotes: server }, { workingNotes: baseline }, "meeting");
    server = value;
  }, nextVisit);
  restored.restore(nextVisit.recover(entry));
  await assert.rejects(restored.flush(), /Review the recovered notes/);
  assert.equal(calls, 1, "restore must not submit anything automatically");
  await assert.rejects(restored.saveRecovered(), /changed while you were editing/);
  assert.equal(server, "Someone else's later edit");
  assert.equal(restored.getSnapshot().value, "Typed immediately before navigation");
  assert.equal(recoveries(notesJournal(storage))[0].payload.baseline, "Original", "recovery retains the original concurrency baseline");
}

// Every identity component isolates recovery, including demo versus live data.
{
  const storage = new MemoryStorage();
  notesJournal(storage).write({ value: "Private draft", baseline: null });
  for (const key of Object.keys(identity) as Array<keyof MeetingDraftIdentity>) {
    assert.equal(recoveries(notesJournal(storage, { scope: { ...identity, [key]: `other-${key}` } })).length, 0, `${key} must isolate device data`);
  }
  let active = true;
  const journal = notesJournal(storage, { active: () => active });
  assert.equal(recoveries(journal).length, 1);
  active = false;
  assert.equal(recoveries(journal).length, 0);
  assert.equal(journal.write({ value: "Wrong account", baseline: null }), null);
  assert.throws(journal.assertActive, /account or workspace changed/);
  assert.equal(storage.length, 1, "signout and pending membership must not erase drafts");
  active = true;
  assert.equal(recoveries(journal).length, 1, "the same verified account can recover after signing back in");
}

// Revisions are immutable. Neither stale save completion nor another tab's
// explicit discard can erase a more recent write, even during interleaving.
{
  const storage = new MemoryStorage();
  const a = notesJournal(storage);
  const old = a.write({ value: "A1", baseline: "base" })!;
  const b = notesJournal(storage);
  const [seen] = recoveries(b);
  const next = a.write({ value: "A2", baseline: "base" })!;
  b.discard(seen);
  a.acknowledge(old);
  assert.ok(storage.getItem(next));
  b.write({ value: "B1", baseline: "base" });
  a.acknowledge(next);
  assert.equal(recoveries(notesJournal(storage))[0].payload.value, "B1");

  const first = a.write({ value: "A3", baseline: "base" })!;
  const c = notesJournal(storage);
  const selected = recoveries(c).find((entry) => entry.key === first)!;
  c.recover(selected);
  assert.equal(storage.getItem(first), null);
  a.refresh();
  assert.equal(a.getSnapshot().savedOnDevice, false, "another tab's deletion cannot leave a false durability indicator");
  const rewritten = a.write({ value: "A3", baseline: "base" });
  assert.notEqual(rewritten, first, "an externally removed cached revision must be written again");
  assert.ok(storage.getItem(rewritten!));
  assert.throws(() => c.recover(selected), /no longer available/);
}

// Quota/blocked/corrupt storage never throws away the last readable version or
// makes a false claim that the latest keystrokes are durable.
{
  const storage = new MemoryStorage();
  const journal = notesJournal(storage);
  const before = journal.write({ value: "Previous copy", baseline: null })!;
  storage.failWrites = true;
  assert.equal(journal.write({ value: "Latest text", baseline: null }), null);
  assert.ok(storage.getItem(before));
  assert.equal(journal.getSnapshot().savedOnDevice, false);
  assert.match(journal.getSnapshot().error!, /Keep this editor open/);
  storage.failWrites = false;
  assert.ok(journal.write({ value: "Latest text", baseline: null }));
  assert.equal(journal.getSnapshot().error, null);
  storage.failReads = true;
  journal.refresh();
  assert.match(journal.getSnapshot().error!, /recovery copy/);
  storage.failReads = false;
  const entryKey = [...storage.data.keys()][0];
  storage.data.set(entryKey, "{broken");
  assert.equal(recoveries(notesJournal(storage)).length, 0);
  assert.ok(storage.getItem(entryKey), "unreadable drafts are not silently deleted");
}

// A pending acknowledged note is distinct from later typing. The surviving
// recovery copy must carry the newly accepted server baseline.
{
  const storage = new MemoryStorage();
  const firstSave = deferred<void>();
  let calls = 0;
  const journal = notesJournal(storage);
  const editor = createNotesAutosave("base", async () => {
    if (++calls === 1) return firstSave.promise;
    throw new Error("Offline after first save");
  }, journal);
  editor.change("submitted");
  const saving = editor.flush();
  await tick();
  editor.change("newer typing");
  firstSave.resolve();
  await assert.rejects(saving, /Offline after first save/);
  assert.deepEqual(recoveries(notesJournal(storage))[0].payload, { value: "newer typing", baseline: "submitted" });
  editor.useLatestServer();
  assert.equal(storage.length, 0, "explicitly loading saved notes discards only this local session");
}

// Identity changes stop old queues from submitting under the next account.
{
  const storage = new MemoryStorage();
  let active = true;
  let calls = 0;
  const editor = createNotesAutosave("base", async () => { calls++; }, notesJournal(storage, { active: () => active }));
  editor.change("keep for original account");
  active = false;
  await assert.rejects(editor.flush(), /account or workspace changed/);
  assert.equal(calls, 0);
  assert.equal(recoveries(notesJournal(storage))[0].payload.value, "keep for original account");
}

// Motion IDs and the accepted baseline survive a reload after someone types
// while a new motion is being created and the next network request fails.
{
  type Motion = { motionId?: string; text: string; outcome?: string };
  type MotionDraft = AutosaveDraft<Motion[]>;
  const storage = new MemoryStorage();
  const makeJournal = () => createMeetingDraftJournal<MotionDraft>({ identity, editor: "motions", storage: () => storage, active: () => true, valid: (value): value is MotionDraft => {
    const row = value as MotionDraft | null; return !!row && Array.isArray(row.value) && Array.isArray(row.baseline);
  } });
  const accepted = deferred<Motion[]>();
  let calls = 0;
  const editor = createMotionAutosave<Motion>([], async () => { if (++calls === 1) return accepted.promise; throw new Error("Offline"); }, makeJournal());
  editor.change([{ text: "New motion" }]);
  const pending = editor.flush();
  await tick();
  editor.change([{ text: "New motion with more detail" }]);
  accepted.resolve([{ motionId: "synthetic-motion", text: "New motion", outcome: "Pending" }]);
  await assert.rejects(pending, /Offline/);
  const afterReload = makeJournal();
  afterReload.refresh();
  const [copy] = afterReload.getSnapshot().recoveries;
  assert.deepEqual(copy.payload.value, [{ motionId: "synthetic-motion", text: "New motion with more detail", outcome: "Pending" }]);
  assert.equal(copy.payload.baseline[0].text, "New motion");
  const resumed = createMotionAutosave(copy.payload.baseline, async (value, expected) => {
    assert.deepEqual(expected, copy.payload.baseline);
    return value;
  }, afterReload);
  resumed.restore(afterReload.recover(copy));
  await assert.rejects(resumed.flush(), /Review the recovered motions/);
  await resumed.saveRecovered();
  assert.equal(storage.length, 0);
  assert.equal(resumed.getSnapshot().value[0].motionId, "synthetic-motion");
}

// Explicit-save forms (sections, agenda, attendance and meeting details) share
// the same lifecycle. A successful earlier save cannot close over newer edits.
{
  type Value = { text: string };
  type Baseline = { expected: Record<string, unknown>; agenda: unknown };
  type Payload = MeetingFormPayload<Value, Baseline>;
  const storage = new MemoryStorage();
  const makeJournal = () => createMeetingDraftJournal<Payload>({ identity, editor: "section", storage: () => storage, active: () => true, valid: (value): value is Payload => {
    const row = value as Payload | null; return !!row && typeof row.value?.text === "string" && typeof row.initial?.text === "string" && !!row.baseline?.expected;
  } });
  const journal = makeJournal();
  const form = createMeetingFormDraft(journal);
  const baseline = { expected: meetingExpectedFields({ sections: [{ title: "Original" }] }, ["sections"]), agenda: { agenda: { title: "Original agenda" }, items: [] } };
  form.begin({ text: "Original" }, baseline);
  assert.equal(storage.length, 0, "opening an unchanged editor is not an unsaved draft");
  form.change({ text: "First edit" });
  const submitted = form.capture()!;
  form.change({ text: "Typed while saving" });
  const accepted = { ...baseline, expected: meetingExpectedFields({ sections: [{ title: "First edit" }] }, ["sections"]) };
  assert.equal(form.complete(submitted, accepted), false);
  assert.equal(form.getSnapshot()!.value.text, "Typed while saving");
  const nextSession = makeJournal(); nextSession.refresh();
  const [entry] = nextSession.getSnapshot().recoveries;
  assert.deepEqual(entry.payload.baseline, accepted);
  const restored = createMeetingFormDraft(nextSession);
  restored.restore(nextSession.recover(entry));
  assert.throws(() => assertMeetingFieldsUnchanged({ sections: [{ title: "Collaborator edit" }] }, restored.capture()!.payload.baseline.expected, "minutes"), /changed while you were editing/);
  assert.deepEqual(restored.getSnapshot()!.baseline.agenda, baseline.agenda, "agenda metadata baseline survives recovery unchanged");
  restored.discard();
  assert.equal(storage.length, 0);

  // Saving A cannot capture or complete against B after cancellation/reopen.
  form.begin({ text: "Section A" }, baseline);
  form.change({ text: "Edit A" });
  const fromA = form.capture()!;
  const nestedSave = deferred<void>();
  let writes = 0;
  const saveAfterNested = (async () => {
    await nestedSave.promise;
    if (!form.isCurrent(fromA)) return;
    writes++;
  })();
  form.discard();
  form.begin({ text: "Section B" }, baseline);
  form.change({ text: "Edit B" });
  nestedSave.resolve();
  await saveAfterNested;
  assert.equal(writes, 0, "a stale async continuation must abort before writing another section's draft");
  assert.equal(form.checkpoint(fromA, accepted), false);
  assert.equal(form.complete(fromA, accepted), false);
  assert.equal(form.getSnapshot()!.value.text, "Edit B");
  assert.deepEqual(form.getSnapshot()!.baseline, baseline);
  assert.equal(recoveries(notesJournal(storage)).length, 0, "other editor namespaces remain isolated");
  form.discard();

  // Reverting to the original text while B is saving is still a newer edit.
  form.begin({ text: "Original" }, baseline);
  form.change({ text: "First edit" });
  const savingB = form.capture()!;
  form.change({ text: "Original" });
  assert.equal(form.dirty(), true);
  const beforeCompletion = makeJournal(); beforeCompletion.refresh();
  assert.equal(beforeCompletion.getSnapshot().recoveries[0].payload.value.text, "Original");
  assert.equal(beforeCompletion.getSnapshot().recoveries[0].payload.requiresSave, true);
  assert.equal(form.complete(savingB, accepted), false);
  assert.equal(form.getSnapshot()!.value.text, "Original");
  assert.deepEqual(form.getSnapshot()!.baseline, accepted);
  form.discard();

  // A multi-step form checkpoints the actual first mutation, even if a later
  // conversion/action fails. Retrying uses that accepted baseline after reload.
  form.begin({ text: "Original" }, baseline);
  form.change({ text: "First edit" });
  const partial = form.capture()!;
  assert.equal(form.checkpoint(partial, accepted), true);
  const afterPartial = makeJournal(); afterPartial.refresh();
  assert.deepEqual(afterPartial.getSnapshot().recoveries[0].payload.baseline, accepted);
  assert.doesNotThrow(() => assertMeetingFieldsUnchanged({ sections: [{ title: "First edit" }] }, afterPartial.getSnapshot().recoveries[0].payload.baseline.expected, "minutes"));
}

// Every whole-list motion action (add, delete or outcome change) uses the
// snapshot the user reviewed, even when a confirmation waits for another edit.
{
  const original = [{ motionId: "one", text: "Original", outcome: "Pending" }];
  let writes = 0;
  const motions = createMotionAutosave(original, async (value) => { writes++; return value; });
  const captured = motions.getSnapshot().value;
  const current = [...original, { motionId: "two", text: "Added by another editor", outcome: "Pending" }];
  motions.receiveServer(current);
  for (const stale of [[], [{ ...captured[0], outcome: "Carried" }], [...captured, { motionId: "three", text: "New local motion", outcome: "Pending" }]]) {
    assert.equal(motions.change(stale, captured), false);
    assert.deepEqual(motions.getSnapshot().value, current);
  }
  await motions.flush();
  assert.equal(writes, 0, "confirming stale actions must never overwrite a newer motion list");
}

console.log("Meeting draft recovery: immediate persistence, identity isolation, explicit restore, original baselines, immutable multi-tab revisions, canonical motion IDs, newer edits and storage failures passed.");
