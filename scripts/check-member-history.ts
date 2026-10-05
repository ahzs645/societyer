import assert from "node:assert/strict";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities, definePortableQuery, definePortableMutation, type TransactionalDb } from "../shared/portable/index";
import * as history from "../shared/functions/memberHistory";
import { memberImport, memberMerge } from "../shared/functions/members";
import { portableTestPrincipal, portableTestSeed, PORTABLE_TEST_AUTH_SUBJECT } from "./portable-test-fixture";
const societyId = "soc_history";
const event = { effectiveDate: "2022-09", kind: "Role", title: "Board roster observation", reviewStatus: "Observed", sourceReference: "2022 workbook / Board sheet / row 17", sourceExternalId: "doc:row17" };
function seed() { return { ...portableTestSeed(societyId), members: [
  { _id: "member_a", societyId, firstName: "Alex", lastName: "Example", membershipClass: "Public", status: "Inactive", votingRights: false, joinedAt: "2022-09-20" },
  { _id: "member_b", societyId, firstName: "Second", lastName: "Example", membershipClass: "Public", status: "Active", votingRights: true, joinedAt: "2023-01-01" },
  { _id: "foreign_member", societyId: "foreign_soc", firstName: "Foreign", lastName: "Member" },
], meetingAttendanceRecords: [{ _id: "attend_b", societyId, memberId: "member_b", meetingDate: "2023-01-01" }] }; }
for (const engine of ["memory", "local"]) {
  const db: TransactionalDb = engine === "memory" ? new MemoryDb({ seed: seed() }) : new LocalStoreDb(new MemoryRowStore(seed()));
  const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll([
    definePortableQuery({ name: "memberHistory:list", applicationPolicy: true, handler: history.list }),
    definePortableMutation({ name: "memberHistory:add", applicationPolicy: true, handler: history.add }),
    definePortableMutation({ name: "members:importMember", applicationPolicy: true, handler: memberImport }),
    definePortableMutation({ name: "members:merge", applicationPolicy: true, handler: memberMerge }),
  ]);
  const args = { societyId, memberId: "member_a", event };
  const added: any = await runtime.runMutation("memberHistory:add", args);
  assert.equal(added.duplicate, false);
  assert.equal((await db.get("member_a", "members"))?.status, "Inactive", "Past roles must not activate membership");
  assert.equal((await runtime.runMutation("memberHistory:add", args) as any).duplicate, true);
  assert.equal((await runtime.runQuery("memberHistory:list", { societyId, memberId: "member_a" }) as any[]).length, 1);
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, event: { ...event, effectiveDate: "2023-02-29" } }), /date/);
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, event: { ...event, endDate: "2022-08" } }), /End date/);
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, event: { ...event, sourceUrl: "javascript:alert(1)" } }), /HTTP/);
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, event: { ...event, sourceReference: "", sourceExternalId: "" } }), /source/);
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, event: { ...event, title: "Different evidence" } }), /external event ID/);
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, memberId: "foreign_member" }), /not found/);
  await runtime.runMutation("memberHistory:add", { ...args, memberId: "member_b" });
  await runtime.runMutation("members:merge", { keepId: "member_a", dropIds: ["member_b"], patch: {} });
  assert.equal((await db.get("attend_b", "meetingAttendanceRecords"))?.memberId, "member_a");
  assert.equal((await runtime.runQuery("memberHistory:list", { societyId, memberId: "member_a" }) as any[]).length, 3, "Merge preserves history and includes linked attendance");
  const incoming = { societyId, firstName: "New", lastName: "Member", membershipClass: "Public", status: "Inactive", joinedAt: "2024-02-29", votingRights: false, leftAt: "2025-03-01", notes: "Source register" };
  assert.equal((await runtime.runMutation("members:importMember", incoming) as any).duplicate, false);
  assert.equal((await runtime.runMutation("members:importMember", incoming) as any).duplicate, true);
  await assert.rejects(runtime.runMutation("members:importMember", { ...incoming, votingRights: true }), /already exists/);
  await assert.rejects(runtime.runMutation("members:importMember", { ...incoming, firstName: "MissingDate", joinedAt: "" }), /unknown dates/);
  await db.transaction(async () => { await db.patch(`${societyId}_owner`, { role: "Member" }); });
  await assert.rejects(runtime.runMutation("memberHistory:add", { ...args, event: { ...event, sourceExternalId: "another" } }), /members:write/);
  assert.ok(await runtime.runQuery("memberHistory:list", { societyId, memberId: "member_a" }));
  console.log(`${engine}: effective-period history, provenance, duplicate/conflict protection, scope and role authorization, merge attendance/history preservation, safe member CSV passed`);
}
