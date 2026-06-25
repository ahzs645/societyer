import assert from "node:assert/strict";

import {
  buildTimeline,
  changesBetween,
  fieldChanges,
  planRoleHolderRevision,
  registerAsOf,
  type LiveRoleHolder,
  type StoredRevision,
} from "../shared/roleHolderHistory";

// --- planRoleHolderRevision: closes the prior version, stamps the new one ---
{
  const existing = {
    _id: "rh1",
    createdAtISO: "2024-01-01T00:00:00",
    enteredAtISO: "2024-01-01T00:00:00",
    enteredByUserId: "alice",
    roleType: "director",
    status: "current",
    fullName: "Jane Doe",
    officerTitle: null,
  };
  const plan = planRoleHolderRevision(existing, "2024-06-01T00:00:00", "bob");
  assert.equal(plan.revision.roleHolderId, "rh1");
  assert.equal(plan.revision.enteredAtISO, "2024-01-01T00:00:00", "prior version entry preserved");
  assert.equal(plan.revision.supersededAtISO, "2024-06-01T00:00:00");
  assert.equal(plan.revision.supersededByUserId, "bob");
  assert.equal(plan.liveStamps.enteredAtISO, "2024-06-01T00:00:00");
  assert.equal(plan.liveStamps.enteredByUserId, "bob");
  // The snapshot captures the prior field values.
  const snap = JSON.parse(plan.revision.dataJson);
  assert.equal(snap.fullName, "Jane Doe");
  assert.equal(snap.roleType, "director");
}

// --- timeline: revisions + live row, oldest first ---
{
  const revisions: StoredRevision[] = [
    { roleHolderId: "rh1", dataJson: JSON.stringify({ fullName: "Jane Doe", officerTitle: null }), enteredAtISO: "2024-01-01T00:00:00", supersededAtISO: "2024-06-01T00:00:00", supersededByUserId: "bob" },
  ];
  const live: LiveRoleHolder = {
    _id: "rh1",
    enteredAtISO: "2024-06-01T00:00:00",
    fullName: "Jane Doe",
    officerTitle: "President",
  };
  const timeline = buildTimeline(revisions, live);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].enteredAtISO, "2024-01-01T00:00:00");
  assert.equal(timeline[1].enteredAtISO, "2024-06-01T00:00:00");
  assert.equal(timeline[1].supersededAtISO, null, "live version is open");

  const changes = fieldChanges(timeline[0], timeline[1]);
  assert.deepEqual(changes, [{ field: "officerTitle", from: null, to: "President" }]);
}

// --- registerAsOf + changesBetween: society-wide reconstruction & diff ---
{
  // rh1: director appointed 2024-01-01, title set to President on 2024-06-01.
  // rh2: officer appointed 2024-03-01, then deleted (final revision) on 2024-05-01.
  const revisions: StoredRevision[] = [
    { roleHolderId: "rh1", dataJson: JSON.stringify({ roleType: "director", fullName: "Jane Doe", officerTitle: null }), enteredAtISO: "2024-01-01T00:00:00", supersededAtISO: "2024-06-01T00:00:00" },
    { roleHolderId: "rh2", dataJson: JSON.stringify({ roleType: "officer", fullName: "Sam Lee" }), enteredAtISO: "2024-03-01T00:00:00", supersededAtISO: "2024-05-01T00:00:00" },
  ];
  const liveRows: LiveRoleHolder[] = [
    { _id: "rh1", enteredAtISO: "2024-06-01T00:00:00", roleType: "director", fullName: "Jane Doe", officerTitle: "President" },
    // rh2 has no live row (deleted).
  ];

  // As of Feb 2024: only rh1 (no title yet).
  const feb = registerAsOf(revisions, liveRows, "2024-02-01T00:00:00");
  assert.equal(feb.length, 1);
  assert.equal(feb[0].recordId, "rh1");
  assert.equal(feb[0].officerTitle, null);

  // As of April 2024: rh1 (no title) + rh2 (officer).
  const apr = registerAsOf(revisions, liveRows, "2024-04-01T00:00:00");
  assert.equal(apr.length, 2);

  // As of today: only rh1 (now President); rh2 deleted.
  const now = registerAsOf(revisions, liveRows, "2024-12-01T00:00:00");
  assert.equal(now.length, 1);
  assert.equal(now[0].officerTitle, "President");

  // Changes from April -> December: rh1 updated (title), rh2 deleted.
  const diff = changesBetween(revisions, liveRows, "2024-04-01T00:00:00", "2024-12-01T00:00:00");
  const byKey = new Map(diff.map((d) => [d.key, d.op]));
  assert.equal(byKey.get("rh1"), "update");
  assert.equal(byKey.get("rh2"), "delete");
}

console.log("OK role-holder-history");
