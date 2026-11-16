import assert from "node:assert/strict";
import { createNotesAutosave, keepBothNoteTexts, mergeNoteTexts } from "../src/features/meetings/lib/notesAutosave";

// Merging two people's edits to the same notes.
assert.equal(mergeNoteTexts("A\nB", "A\nB\nMine", "A\nB\nTheirs"), "A\nB\nTheirs\nMine", "both added at the end: theirs, then mine");
assert.equal(mergeNoteTexts("A\nB\nC", "A2\nB\nC", "A\nB\nC2"), "A2\nB\nC2", "edits to different lines combine");
assert.equal(mergeNoteTexts("A\nB\nC", "A\nB\nC", "A\nX\nC"), "A\nX\nC", "only they changed it");
assert.equal(mergeNoteTexts("A\nB", "A\nMine", "A\nTheirs"), null, "the same line changed both ways needs a person");
assert.equal(mergeNoteTexts("", "Mine", "Theirs"), "Theirs\nMine");
assert.equal(keepBothNoteTexts("A\nB", "A\nMine", "A\nTheirs"), "A\nTheirs\n\nMine", "keep both: theirs, then my changed lines");


function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// A blur followed immediately by conversion shares the same serialized drain.
// The newer keystrokes must survive both a stale subscription echo and the
// first save's completion; the second save must compare against that first save.
{
  const first = deferred();
  const calls: Array<[string, string | null]> = [];
  const controller = createNotesAutosave("Before", async (value, expected) => {
    calls.push([value, expected]);
    if (calls.length === 1) await first.promise;
  });
  controller.change("First edit");
  const a = controller.flush();
  const b = controller.flush();
  assert.equal(a, b, "multiple flushes share the in-flight drain");
  await Promise.resolve();
  controller.change("Newer typing");
  controller.receiveServer("First edit");
  assert.equal(controller.getSnapshot().value, "Newer typing");
  assert.equal(calls.length, 1, "no overlapping writes");
  first.resolve();
  await a;
  assert.deepEqual(calls, [["First edit", "Before"], ["Newer typing", "First edit"]]);
  assert.equal(controller.getSnapshot().value, "Newer typing");
  assert.equal(controller.getSnapshot().saveState, "saved");
}

// Save failures propagate to workflows and retain the user's draft and base.
{
  let attempts = 0;
  const expectedValues: Array<string | null> = [];
  const controller = createNotesAutosave(undefined, async (_value, expected) => {
    expectedValues.push(expected);
    if (++attempts === 1) throw new Error("Connection lost");
  });
  controller.change("Keep this draft");
  let converted = false;
  await assert.rejects(async () => { await controller.flush(); converted = true; }, /Connection lost/);
  assert.equal(converted, false, "a failed note save cannot start minutes conversion");
  assert.equal(controller.getSnapshot().saveState, "error");
  // Newer notes from someone else arrive: the draft goes on top of them, never over them.
  controller.receiveServer("Someone else's notes");
  await controller.flush();
  assert.equal(controller.getSnapshot().value, "Someone else's notes\nKeep this draft");
  assert.deepEqual(expectedValues, [null, "Someone else's notes"], "the retry is checked against their notes, keeping both");
  assert.equal(controller.getSnapshot().saveState, "saved");
}

// A second user's edit causes a conflict instead of replacing their text. The
// user can explicitly discard the retained draft and edit the current version.
{
  let server = "Original";
  const controller = createNotesAutosave(server, async (value, expected) => {
    if (server !== expected) throw new Error("Meeting changed while you were editing");
    server = value;
  });
  controller.change("My draft");
  server = "Collaborator's accepted edit";
  controller.receiveServer(server);
  await assert.rejects(controller.flush(), /changed while you were editing/);
  assert.equal(server, "Collaborator's accepted edit");
  assert.equal(controller.getSnapshot().value, "My draft");
  assert.equal(controller.getSnapshot().conflict, true, "overlapping edits are a conflict to resolve");
  controller.useLatestServer();
  assert.equal(controller.getSnapshot().value, server);
  controller.change("Reviewed combined notes");
  await controller.flush();
  assert.equal(server, "Reviewed combined notes");
}

// A save rejected because someone added notes meanwhile is combined and saved, no dead end.
{
  let server = "Agenda";
  const controller = createNotesAutosave(server, async (value, expected) => {
    if (server !== expected) throw new Error("Meeting changed while you were editing");
    server = value;
  });
  controller.change("Agenda\n- my point");
  server = "Agenda\n- their point";
  controller.receiveServer(server);
  await controller.flush();
  assert.equal(server, "Agenda\n- their point\n- my point");
  assert.equal(controller.getSnapshot().saveState, "saved");
}

// Overlapping edits: Keep both saves theirs with my changed lines under them.
{
  let server = "Budget: 10k";
  const controller = createNotesAutosave(server, async (value, expected) => {
    if (server !== expected) throw new Error("Meeting changed while you were editing");
    server = value;
  });
  controller.change("Budget: 12k");
  server = "Budget: 15k";
  controller.receiveServer(server);
  await assert.rejects(controller.flush(), /changed while you were editing/);
  await controller.keepBoth();
  assert.equal(server, "Budget: 15k\n\nBudget: 12k");
  assert.equal(controller.getSnapshot().conflict, false);
}

// When there is no local edit, collaborators' accepted changes are reactive.
{
  let calls = 0;
  const controller = createNotesAutosave("A", async () => { calls += 1; });
  controller.receiveServer("B");
  assert.equal(controller.getSnapshot().value, "B");
  controller.change("B");
  await controller.flush();
  assert.equal(calls, 0, "unchanged notes cause no write");
}

// A collaborator's later accepted edit can reach the subscription before our
// earlier mutation response. Once our local queue is empty, show that newer copy.
{
  const response = deferred();
  const controller = createNotesAutosave("Original", async () => { await response.promise; });
  controller.change("My accepted edit");
  const saved = controller.flush();
  await Promise.resolve();
  controller.receiveServer("My accepted edit");
  controller.receiveServer("Collaborator's later accepted edit");
  response.resolve();
  await saved;
  assert.equal(controller.getSnapshot().value, "Collaborator's later accepted edit");
  assert.equal(controller.getSnapshot().saveState, "saved");
}

// A successful mutation is also a known saved value, even when its reactive
// echo is delayed; recovery from the following failure must not load older text.
{
  let fail = false;
  const controller = createNotesAutosave("Original", async () => { if (fail) throw new Error("Offline"); });
  controller.change("Accepted");
  await controller.flush();
  fail = true;
  controller.change("Unsaved");
  await assert.rejects(controller.flush(), /Offline/);
  controller.useLatestServer();
  assert.equal(controller.getSnapshot().value, "Accepted");
}

console.log("Meeting notes autosave: serialized writes, preserved drafts, conflict checks, delayed echoes and conversion failure guards passed.");
