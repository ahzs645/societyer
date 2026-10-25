import assert from "node:assert/strict";
import { createMotionAutosave } from "../src/features/meetings/lib/motionAutosave";

type Motion = { motionId?: string; text: string; outcome?: string; votesFor?: number; movedBy?: string };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Slow creation followed by typing must carry the assigned ID into the next
// update, retain the new text, and use the canonical first save as its baseline.
{
  const first = deferred();
  const calls: Array<{ value: Motion[]; expected: Motion[] }> = [];
  const editor = createMotionAutosave<Motion>([], async (value, expected) => {
    calls.push({ value, expected });
    if (calls.length === 1) await first.promise;
    return value.map((row) => ({ ...row, motionId: row.motionId ?? "new_motion", outcome: row.outcome ?? "Pending" }));
  });
  editor.change([{ text: "Approve draft" }]);
  const saved = editor.flush();
  await Promise.resolve();
  editor.change([{ text: "Approve edited draft", votesFor: 3 }]);
  editor.receiveServer([{ motionId: "new_motion", text: "Approve draft", outcome: "Pending" }]);
  assert.equal(editor.getSnapshot().value[0].text, "Approve edited draft");
  assert.equal(editor.flush(), saved);
  assert.equal(calls.length, 1, "no overlapping saves");
  first.resolve();
  await saved;
  assert.deepEqual(calls[1], {
    value: [{ motionId: "new_motion", text: "Approve edited draft", outcome: "Pending", votesFor: 3 }],
    expected: [{ motionId: "new_motion", text: "Approve draft", outcome: "Pending" }],
  });
  assert.equal(editor.getSnapshot().saveState, "saved");
  assert.equal(editor.getSnapshot().value[0].motionId, "new_motion");
}

// Deleting a row and adding a new row during a slow save must not transfer
// the deleted row's assigned ID to the new motion.
{
  const first = deferred();
  const calls: Motion[][] = [];
  const a = { text: "A" };
  const b = { text: "B" };
  const editor = createMotionAutosave<Motion>([], async (value) => {
    calls.push(value);
    if (calls.length === 1) await first.promise;
    return value.map((row) => ({ ...row, motionId: row.motionId ?? `id_${row.text}` }));
  });
  editor.change([a, b]);
  const saved = editor.flush();
  await Promise.resolve();
  editor.change([b]);
  editor.change([{ ...b, text: "B edited" }]);
  editor.change([...editor.getSnapshot().value, { text: "C" }]);
  first.resolve();
  await saved;
  assert.deepEqual(calls[1], [{ text: "B edited", motionId: "id_B" }, { text: "C" }]);
  assert.equal(editor.getSnapshot().value[1].motionId, "id_C");
}

// A failed write keeps the draft and original baseline even after a new server
// subscription value arrives. There is no timed fallback that hides the edit.
{
  let server: Motion[] = [{ motionId: "m1", text: "Original" }];
  const editor = createMotionAutosave<Motion>(server, async (value, expected) => {
    if (JSON.stringify(expected) !== JSON.stringify(server)) throw new Error("changed while you were editing");
    server = value;
    return server;
  });
  editor.change([{ motionId: "m1", text: "My edit" }]);
  server = [{ motionId: "m1", text: "Collaborator edit" }];
  editor.receiveServer(server);
  await assert.rejects(editor.flush(), /changed while you were editing/);
  assert.equal(editor.getSnapshot().value[0].text, "My edit");
  assert.equal(editor.getSnapshot().saveState, "error");
  await assert.rejects(editor.flush(), /changed while you were editing/, "retry cannot silently rebase over the collaborator");
  assert.equal(server[0].text, "Collaborator edit");
  editor.useLatestServer();
  editor.change([{ ...server[0], text: "Reviewed edit" }]);
  await editor.flush();
  assert.equal(server[0].text, "Reviewed edit");
}

{
  const response = deferred();
  const editor = createMotionAutosave<Motion>([{ motionId: "m1", text: "Original" }], async (value) => {
    await response.promise;
    return value;
  });
  editor.change([{ motionId: "m1", text: "My accepted edit" }]);
  const saved = editor.flush();
  await Promise.resolve();
  editor.receiveServer([{ motionId: "m1", text: "My accepted edit" }]);
  editor.receiveServer([{ motionId: "m1", text: "Collaborator's later accepted edit" }]);
  response.resolve();
  await saved;
  assert.equal(editor.getSnapshot().value[0].text, "Collaborator's later accepted edit");
}

{
  let fail = false;
  const editor = createMotionAutosave<Motion>([], async (value) => {
    if (fail) throw new Error("Offline");
    return value.map((row) => ({ ...row, motionId: "m1" }));
  });
  editor.change([{ text: "Accepted" }]);
  await editor.flush();
  fail = true;
  editor.change([{ motionId: "m1", text: "Unsaved" }]);
  await assert.rejects(editor.flush(), /Offline/);
  editor.useLatestServer();
  assert.deepEqual(editor.getSnapshot().value, [{ motionId: "m1", text: "Accepted" }]);
}

console.log("Motion autosave: serialized saves, canonical IDs, pending edit rebasing, deletions, delayed echoes and conflict retention passed.");
