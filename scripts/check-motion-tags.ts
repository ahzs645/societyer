// Meeting-motion tags: now that a meeting's motions are first-class rows, the
// resolved display motions carry the row's `tags` (so the MotionEditor can show +
// edit them), and saving preserves user tags — the reconcile merges procedural
// tags in but never drops the user's. Runs on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { syncMotionsForMinutes, resolveMinutesMotions } from "../shared/functions/minutes";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

const setup: any = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Tag Co" });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "Board Q1", status: "Complete" });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, status: "Draft" });
  // An editor save carrying a user label on the motion (non-procedural text, so
  // no procedural tag is auto-added and the assertion stays exact).
  await syncMotionsForMinutes(ctx, {
    societyId, minutesId, meetingId,
    motions: [{ name: "Arts grant", text: "Fund the new community arts program.", outcome: "Carried", tags: ["finance"] }],
  });
  return { societyId, meetingId, minutesId };
});

// The resolver surfaces the tag (via motionRowToEmbedded) so the editor shows it.
const resolved1: any[] = await query("r1", (ctx: any) => ctx.db.get(setup.minutesId).then((m: any) => resolveMinutesMotions(ctx, m)));
assert.equal(resolved1.length, 1, "one resolved motion");
assert.ok(resolved1[0].tags?.includes("finance"), "resolved motion carries the user tag for the editor to display");
assert.ok(resolved1[0].motionId, "resolved motion carries its motionId (needed to persist tag edits)");

// Editing: add a second label (as the editor submits the resolved motion + a new
// tag). The reconcile updates the row in place and keeps both labels.
await mutate("edit", (ctx: any) =>
  syncMotionsForMinutes(ctx, {
    societyId: setup.societyId, minutesId: setup.minutesId, meetingId: setup.meetingId,
    motions: [{ ...resolved1[0], tags: [...(resolved1[0].tags ?? []), "reviewed"] }],
  }));
const resolved2: any[] = await query("r2", (ctx: any) => ctx.db.get(setup.minutesId).then((m: any) => resolveMinutesMotions(ctx, m)));
assert.ok(
  resolved2[0].tags?.includes("finance") && resolved2[0].tags?.includes("reviewed"),
  "editing preserves the existing tag and adds the new one",
);
assert.equal(String(resolved2[0].motionId), String(resolved1[0].motionId), "same motion row — the tag edit is in place, not a churn");

console.log("✓ meeting-motion tags: resolved motions carry tags; edits preserve them via the reconcile");
console.log("\nmotion tags checks passed.");
