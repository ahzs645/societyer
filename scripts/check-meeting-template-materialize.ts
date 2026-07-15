// Conformance for Phase 4C/4D: meeting-from-template scaffolding materializes its
// motions into the motions TABLE (motionIds + rows) rather than only storing them
// on the embedded minutes.motions[]. Post-4C the embedded array isn't read for
// materialized minutes, and (post-4A) the master motions list is table-rows-only —
// so template motions must become real rows to show up before a first edit.
// Exercises applyTemplatePortable on a MemoryDb; no live backend.

import assert from "node:assert/strict";
import {
  MemoryDb,
  PortableRuntime,
  definePortableQuery,
  definePortableMutation,
  makeCapabilities,
} from "../shared/portable/index";
import { applyTemplatePortable } from "../shared/functions/meetings";
import { resolveMinutesMotions } from "../shared/functions/minutes";

const db = new MemoryDb({ seed: {} });
const caps = makeCapabilities({});
const rt = () => new PortableRuntime({ db, capabilities: caps, principalProvider: () => ({ kind: "anonymous", runtime: "test", assurance: "none" }) });
const query = (name: string, handler: any) => rt().register(definePortableQuery({ name, handler })).runQuery(name, {});
const mutate = (name: string, handler: any) => rt().register(definePortableMutation({ name, handler })).runMutation(name, {});

const setup: any = await mutate("setup", async (ctx: any) => {
  const societyId = await ctx.db.insert("societies", { name: "Template Co" });
  const meetingId = await ctx.db.insert("meetings", {
    societyId, type: "Board", title: "Board Q1", scheduledAt: "2026-05-01T18:00:00.000Z", status: "Scheduled",
  });
  const minutesId = await ctx.db.insert("minutes", { societyId, meetingId, status: "Draft", attendees: [], sections: [] });
  await ctx.db.patch(meetingId, { minutesId });
  const templateId = await ctx.db.insert("meetingTemplates", {
    societyId,
    name: "Board template",
    items: [
      { title: "Call to order", sectionType: "discussion", depth: 0 },
      { title: "Approve budget", sectionType: "motion", depth: 0, motionText: "BE IT RESOLVED THAT the annual budget be approved." },
      { title: "Adjournment", sectionType: "motion", depth: 0, motionText: "BE IT RESOLVED THAT the meeting be adjourned." },
    ],
  });
  return { societyId, meetingId, minutesId, templateId };
});

await mutate("apply", (ctx: any) =>
  applyTemplatePortable(ctx, { meetingId: setup.meetingId, meetingTemplateId: setup.templateId, replace: true }));

const after: any = await query("after", async (ctx: any) => {
  const m: any = await ctx.db.get(setup.minutesId);
  const resolved = await resolveMinutesMotions(ctx, m);
  const rows = await ctx.db.query("motions").withIndex("by_minutes", (q: any) => q.eq("minutesId", setup.minutesId)).collect();
  return {
    motionIds: (m.motionIds ?? []).map(String),
    rawMotions: m.motions ?? null,
    resolvedTexts: resolved.map((x: any) => x.text),
    rowCount: rows.length,
  };
});

assert.equal(after.motionIds.length, 2, "both template motions materialized into minutes.motionIds");
assert.equal(after.rowCount, 2, "one motions-table row per materialized template motion");
assert.ok(after.resolvedTexts.some((t: string) => t.includes("budget")), "the template motion resolves from the table");
assert.equal(after.rawMotions, null, "minutes.motions[] is not stored (Phase 4C)");
console.log(`✓ applyTemplate materializes template motions into the table (${after.motionIds.length} motions), no embedded write`);
console.log("\nmeeting template materialization checks passed.");
