// Phase 4A conformance (docs/motions-migration-finish-scope.md): the master
// motions list (motions.listPortable) is the first-class `motions` table ONLY —
// no synthetic `from-minutes:<minutesId>:<index>` entries, and no double-count.
// Before 4A, a mirrored minutes motion appeared twice: once as its real mirror
// row and again as a synthetic entry (mirror rows carry `minutesId` but not
// `sourceMinutesId`, so they missed the dedupe set). Runs on a MemoryDb.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { syncMotionsForMinutes } from "../shared/functions/minutes";
import { listPortable as listMotionsPortable } from "../shared/functions/motions";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps, principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }) });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

const setup: any = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Master List Co" });
  const meetingId = await ctx.db.insert("meetings", { societyId, title: "AGM", status: "Complete" });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, status: "Draft", motions: [] });
  // Dual-write two minutes motions into the table (mirror rows + motionIds + back-links).
  await syncMotionsForMinutes(ctx, {
    societyId, minutesId, meetingId,
    motions: [
      { name: "M1", text: "First minutes motion", outcome: "Carried" },
      { name: "M2", text: "Second minutes motion", outcome: "Deferred" },
    ],
  });
  // Plus a genuine first-class backlog row (not minutes-sourced).
  await ctx.db.insert("motions", {
    societyId, title: "Backlog motion", text: "A parked motion", status: "Backlog",
    source: "manual", createdAtISO: "2026-01-01T00:00:00.000Z", updatedAtISO: "2026-01-01T00:00:00.000Z",
  });
  return { societyId, minutesId };
});

const list: any[] = await query("list", (ctx: any) => listMotionsPortable(ctx, { societyId: setup.societyId }));

// No synthetic "from-minutes:" entries survive.
const synthetic = list.filter((m) => String(m._id).startsWith("from-minutes:"));
assert.equal(synthetic.length, 0, "master list has no synthetic from-minutes: entries");

// Exactly the real rows — 2 mirror + 1 backlog — one per motion, no double-count.
assert.equal(list.length, 3, "master list = real table rows only (2 mirror + 1 backlog), no double-count");

// Each minutes motion appears exactly once, as its real mirror row (minutesId set).
const mirror = list.filter((m) => String(m.minutesId ?? "") === String(setup.minutesId));
assert.equal(mirror.length, 2, "each minutes motion appears exactly once as its mirror row");
assert.ok(mirror.every((m) => !String(m._id).startsWith("from-minutes:")), "mirror rows are real table rows");

console.log("✓ master motions list = table rows only (no from-minutes: synthetics, no double-count)");
console.log("\nmotions master-list checks passed.");
