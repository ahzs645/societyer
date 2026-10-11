/**
 * Seeded record-table views must only name fields their object defines (a
 * filter on a missing field is silently dropped, leaving an unfiltered copy
 * of "All"), and a reseed must retire the meeting review queues that were
 * once copied onto other objects without touching views people made.
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { RECORD_TABLE_OBJECTS } from "../convex/recordTableMetadataDefinitions";
import { RETIRED_SEEDED_VIEW_NAMES, seedSocietyPortable } from "../shared/functions/seedRecordTableMetadata";
import { toPortableMutationCtx } from "../convex/lib/portable";

/* ---------------------------------------------------------------- definitions */

const problems: string[] = [];
for (const object of RECORD_TABLE_OBJECTS) {
  const fields = new Set(object.fields.map((field) => field.name));
  const views = [{ ...object.defaultView, name: `${object.defaultView.name} (default)` }, ...(object.extraViews ?? [])];
  for (const view of views) {
    const where = `${object.nameSingular} › ${view.name}`;
    for (const filter of view.filters ?? []) {
      if (!fields.has(filter.fieldName)) problems.push(`${where}: filter on unknown field "${filter.fieldName}"`);
    }
    if (view.kanbanFieldName && !fields.has(view.kanbanFieldName)) problems.push(`${where}: kanban field "${view.kanbanFieldName}" is not defined`);
    for (const column of view.columns ?? []) {
      if (!fields.has(column.fieldName)) problems.push(`${where}: column "${column.fieldName}" is not defined`);
    }
  }
  if (object.nameSingular !== "meeting") {
    for (const view of object.extraViews ?? []) {
      assert.ok(!(RETIRED_SEEDED_VIEW_NAMES as readonly string[]).includes(view.name), `${object.nameSingular} still seeds the meeting-only view "${view.name}"`);
    }
  }
}
assert.deepEqual(problems, [], `Seeded views reference fields their object does not define:\n${problems.join("\n")}`);

/* ---------------------------------------------------------------- reseed cleanup */

const t = convexTest(schema, {
  "./_generated/api.js": () => import("../convex/_generated/api.js"),
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
});
const at = new Date().toISOString();
const seed = (societyId: string) => t.run(async (ctx) => seedSocietyPortable(await toPortableMutationCtx(ctx), societyId, RECORD_TABLE_OBJECTS));

const societyId = await t.run((ctx) => ctx.db.insert("societies", { name: "Seeded views", isCharity: false, isMemberFunded: false, updatedAt: 0 }));
await seed(societyId);

// Recreate what the old seeder left on objects that never had these fields:
// unfiltered shared copies with the default view's columns. Add a same-name
// view a person made, and one the seeder made that someone later filtered.
const fixture = await t.run(async (ctx) => {
  const objectId = async (nameSingular: string) =>
    (await ctx.db.query("objectMetadata").withIndex("by_society_name", (q) => q.eq("societyId", societyId).eq("nameSingular", nameSingular)).unique())!._id;
  const copyDefaultColumns = async (nameSingular: string, objectMetadataId: any, viewId: any) => {
    const definition = RECORD_TABLE_OBJECTS.find((object) => object.nameSingular === nameSingular)!;
    const fields = await ctx.db.query("fieldMetadata").withIndex("by_object", (q) => q.eq("objectMetadataId", objectMetadataId)).collect();
    for (const [index, column] of definition.defaultView.columns.entries()) {
      const field = fields.find((entry) => entry.name === column.fieldName);
      if (field) await ctx.db.insert("viewFields", { societyId, viewId, fieldMetadataId: field._id, isVisible: true, position: index, size: 160, createdAtISO: at, updatedAtISO: at });
    }
  };
  const seededCopy = async (nameSingular: string, name: string, extra: Record<string, unknown> = {}) => {
    const objectMetadataId = await objectId(nameSingular);
    const viewId = await ctx.db.insert("views", { societyId, objectMetadataId, name, type: "table", density: "compact", isShared: true, isSystem: false, position: 10, createdAtISO: at, updatedAtISO: at, ...extra });
    await copyDefaultColumns(nameSingular, objectMetadataId, viewId);
    return viewId;
  };
  const stale: any[] = [];
  for (const nameSingular of ["member", "filing", "committee", "asset", "motion", "task"]) {
    for (const name of RETIRED_SEEDED_VIEW_NAMES) stale.push(await seededCopy(nameSingular, name));
  }
  const memberObject = await objectId("member");
  const fieldId = (await ctx.db.query("fieldMetadata").withIndex("by_object", (q) => q.eq("objectMetadataId", memberObject)).collect())[0]._id;
  const personal = await seededCopy("member", "Needs source review", { createdByUserId: undefined, visibility: "personal", isShared: false });
  const filtered = await seededCopy("filing", "Held, no minutes", { filtersJson: JSON.stringify([{ fieldMetadataId: String(fieldId), operator: "eq", value: "x" }]) });
  const meetingObject = await objectId("meeting");
  const meetingViews = (await ctx.db.query("views").withIndex("by_object", (q) => q.eq("objectMetadataId", meetingObject)).collect())
    .filter((view) => (RETIRED_SEEDED_VIEW_NAMES as readonly string[]).includes(view.name))
    .map((view) => view._id);
  return { stale, personal, filtered, meetingViews };
});
assert.equal(fixture.meetingViews.length, RETIRED_SEEDED_VIEW_NAMES.length, "meetings keep their review queues");

await seed(societyId);

await t.run(async (ctx) => {
  for (const viewId of fixture.stale) {
    assert.equal(await ctx.db.get(viewId), null, "untouched seeded copies are removed");
    assert.equal((await ctx.db.query("viewFields").withIndex("by_view", (q) => q.eq("viewId", viewId)).collect()).length, 0, "their columns go with them");
  }
  assert.ok(await ctx.db.get(fixture.personal), "a person's view with the same name stays");
  assert.ok(await ctx.db.get(fixture.filtered), "a copy someone gave a filter stays");
  for (const viewId of fixture.meetingViews) assert.ok(await ctx.db.get(viewId), "meeting review queues stay");
});

// Idempotent: a further reseed changes nothing.
await seed(societyId);
console.log(`Seeded record views ok: ${RECORD_TABLE_OBJECTS.length} objects reference only defined fields; ${fixture.stale.length} stale meeting-review copies retired, personal, filtered and meeting views kept.`);
