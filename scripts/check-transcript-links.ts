/**
 * Transcript ↔ minutes links: `transcripts:linkMinutesItem` on both portable
 * adapters — registry, permissions, ownership, bounds, approved-minutes
 * immutability, and that a later minutes save keeps a motion's link.
 */
import assert from "node:assert/strict";
import {
  MemoryDb,
  LocalStoreDb,
  MemoryRowStore,
  PortableRuntime,
  makeCapabilities,
  type PortablePrincipal,
} from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { actionPermission } from "../shared/functions/actionPolicy";
import { motionRowToEmbedded } from "../shared/minutesMotions";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import {
  citationsBySegment,
  linkTargetMenuLabel,
  minutesActionItems,
  minutesLinkTargets,
  transcriptMarkers,
} from "../src/features/meetings/transcript/transcriptLinks";
import { motionDisplayName, motionNumbers, motionShortTitle, motionTallySummary } from "../src/lib/motionDisplay";

type Ref = { startSec: number; endSec: number };
type ActionRow = { text: string; done: boolean; transcriptRef?: Ref };
type MinutesRow = {
  _id: string;
  actionItems: ActionRow[];
  sections?: { title: string; actionItems?: ActionRow[] }[];
  motionIds?: string[];
};
type MotionRow = { _id: string; text: string; transcriptRef?: Ref };

assert.ok(
  PORTABLE_FUNCTIONS.some((fn) => fn.name === "transcripts:linkMinutesItem"),
  "linkMinutesItem is registered for the local runtimes",
);
assert.equal(actionPermission("transcripts:linkMinutesItem", "mutation"), "meetings:write");

for (const local of [false, true]) {
  const societyId = "links-test";
  const seed = {
    ...portableTestSeed(societyId),
    meetings: [
      { _id: "meeting", societyId },
      { _id: "approved-meeting", societyId },
      { _id: "foreign-meeting", societyId: "foreign" },
    ],
    minutes: [
      {
        _id: "minutes",
        societyId,
        meetingId: "meeting",
        heldAt: "2026-05-01",
        attendees: [],
        absent: [],
        quorumMet: true,
        discussion: "",
        decisions: [],
        actionItems: [{ text: "Send the budget to members", done: false }],
        sections: [{ title: "Budget", actionItems: [{ text: "Book the hall", done: false }] }],
        motionIds: ["motion"],
      },
      {
        _id: "approved-minutes",
        societyId,
        meetingId: "approved-meeting",
        heldAt: "2026-04-01",
        attendees: [],
        absent: [],
        quorumMet: true,
        discussion: "",
        decisions: [],
        actionItems: [{ text: "Frozen action", done: false }],
        approvedAt: "2026-05-01",
        motionSnapshots: [],
        motionIds: ["approved-motion"],
      },
    ],
    motions: [
      {
        _id: "motion",
        societyId,
        minutesId: "minutes",
        primaryMeetingId: "meeting",
        text: "Approve the 2027 budget",
        status: "Voted",
        outcome: "Carried",
      },
      { _id: "approved-motion", societyId, minutesId: "approved-minutes", text: "Old", status: "Voted" },
      { _id: "other-motion", societyId, minutesId: "approved-minutes", text: "Elsewhere", status: "Draft" },
    ],
    users: [
      ...portableTestSeed(societyId).users,
      { _id: "viewer", societyId, role: "Viewer", status: "Active", authSubject: "viewer" },
    ],
  };
  const db = local ? new LocalStoreDb(new MemoryRowStore(seed)) : new MemoryDb({ seed });
  let principal: PortablePrincipal = portableTestPrincipal();
  const runtime = new PortableRuntime({
    db,
    capabilities: makeCapabilities({}),
    principalProvider: () => principal,
  }).registerAll(PORTABLE_FUNCTIONS);
  const base = { societyId, meetingId: "meeting" };
  const link = (args: Record<string, unknown>) =>
    runtime.runMutation("transcripts:linkMinutesItem", { ...base, ...args });
  const minutes = async () => runtime.runQuery<MinutesRow>("minutes:getByMeeting", { meetingId: "meeting" });
  const motion = async () =>
    (await runtime.runQuery<MotionRow[]>("motions:listForMinutes", { minutesId: "minutes" }))[0];

  // Motions: set, then a minutes save that round-trips the display shape keeps it.
  assert.deepEqual(await link({ kind: "motion", motionId: "motion", startSec: 862, endSec: 871.5 }), {
    kind: "motion",
    transcriptRef: { startSec: 862, endSec: 871.5 },
  });
  assert.deepEqual((await motion()).transcriptRef, { startSec: 862, endSec: 871.5 });
  const embedded = motionRowToEmbedded(await motion());
  assert.deepEqual(
    embedded.transcriptRef,
    { startSec: 862, endSec: 871.5 },
    "display motions carry the link",
  );
  const { transcriptRef: _dropped, ...withoutRef } = embedded;
  const amended = { ...withoutRef, text: "Approve the amended 2027 budget" };
  await runtime.runMutation("minutes:update", { id: "minutes", patch: { motions: [amended] } });
  assert.equal((await motion()).text, amended.text, "the minutes save reached the motion row");
  assert.deepEqual(
    (await motion()).transcriptRef,
    { startSec: 862, endSec: 871.5 },
    "a minutes save that omits the link keeps it",
  );

  // Action items: top-level and per section, guarded by wording.
  await link({ kind: "actionItem", actionIndex: 0, startSec: 900, endSec: 905 });
  await link({
    kind: "actionItem",
    sectionIndex: 0,
    actionIndex: 0,
    expectedText: "Book the hall",
    startSec: 910,
    endSec: 910,
  });
  let row = await minutes();
  assert.deepEqual(row.actionItems[0].transcriptRef, { startSec: 900, endSec: 905 });
  assert.deepEqual(row.sections?.[0].actionItems?.[0].transcriptRef, { startSec: 910, endSec: 910 });
  await assert.rejects(
    () =>
      link({
        kind: "actionItem",
        sectionIndex: 0,
        actionIndex: 0,
        expectedText: "Stale",
        startSec: 1,
        endSec: 2,
      }),
    /changed since/,
  );

  // Clearing removes the field.
  await link({ kind: "actionItem", actionIndex: 0 });
  row = await minutes();
  assert.equal("transcriptRef" in row.actionItems[0], false, "clearing removes the action's link");
  await link({ kind: "motion", motionId: "motion" });
  assert.equal((await motion()).transcriptRef, undefined, "clearing removes the motion's link");

  // Bounds.
  for (const [startSec, endSec] of [
    [-1, 2],
    [5, 4],
    [Number.NaN, 4],
    [0, Number.POSITIVE_INFINITY],
    [0, 90_000],
  ]) {
    await assert.rejects(
      () => link({ kind: "motion", motionId: "motion", startSec, endSec }),
      /Transcript times/,
    );
  }
  await assert.rejects(
    () => link({ kind: "actionItem", actionIndex: 5, startSec: 1, endSec: 2 }),
    /out of bounds/,
  );
  await assert.rejects(
    () => link({ kind: "actionItem", sectionIndex: 3, actionIndex: 0, startSec: 1, endSec: 2 }),
    /out of bounds/,
  );

  // Ownership: the motion must belong to this meeting's minutes and workspace.
  await assert.rejects(
    () => link({ kind: "motion", motionId: "other-motion", startSec: 1, endSec: 2 }),
    /not in this meeting/,
  );
  await assert.rejects(
    () => link({ meetingId: "foreign-meeting", kind: "actionItem", actionIndex: 0, startSec: 1, endSec: 2 }),
    /not found/i,
  );

  // Approved minutes are frozen for both kinds.
  for (const args of [
    { kind: "motion", motionId: "approved-motion" },
    { kind: "actionItem", actionIndex: 0 },
  ]) {
    await assert.rejects(
      () => link({ meetingId: "approved-meeting", ...args, startSec: 1, endSec: 2 }),
      /Adopted minutes are frozen/,
    );
  }
  const approved = await runtime.runQuery<MinutesRow>("minutes:getByMeeting", {
    meetingId: "approved-meeting",
  });
  assert.equal(approved.actionItems[0].transcriptRef, undefined);

  // Permissions: viewers are refused by the action policy; a service principal
  // with meetings:write but not minutes:write is refused by the handler.
  principal = { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: "viewer" };
  await assert.rejects(
    () => link({ kind: "actionItem", actionIndex: 0, startSec: 1, endSec: 2 }),
    /meetings:write/,
  );
  principal = {
    kind: "service",
    runtime: "test",
    assurance: "trusted-internal",
    subject: "links-service",
    societyId,
    actorUserId: `${societyId}_owner`,
    scopes: ["meetings:read", "meetings:write", "minutes:read"],
  };
  await assert.rejects(
    () => link({ kind: "actionItem", actionIndex: 0, startSec: 1, endSec: 2 }),
    /minutes:write/,
  );
}

// Marker layout: rows stack when pills would overlap, then everything becomes dots.
const targets = minutesLinkTargets(
  [
    { motionId: "a", text: "First", transcriptRef: { startSec: 10, endSec: 12 } },
    { motionId: "b", text: "Second", transcriptRef: { startSec: 11, endSec: 13 } },
    { motionId: "c", text: "Unlinked" },
  ],
  [{ text: "Do it", sectionIndex: null, actionIndex: 0, transcriptRef: { startSec: 80, endSec: 81 } }],
);
const layout = transcriptMarkers({ targets, duration: 100, width: 600 });
assert.equal(layout.dots, false);
assert.deepEqual(
  layout.markers.map((marker) => [marker.label, marker.row]),
  [
    ["Motion 1", 0],
    ["Motion 2", 1],
    ["Action", 0],
  ],
);
assert.equal(transcriptMarkers({ targets, duration: 100, width: 600, maxRows: 1 }).dots, true);
assert.equal(transcriptMarkers({ targets, duration: 100, width: 380 }).dots, true, "narrow bars use dots");
assert.equal(
  transcriptMarkers({ targets: targets.slice(2, 3), duration: 100, width: 600 }).markers.length,
  0,
);
const cited = citationsBySegment(
  [
    { startSec: 0, endSec: 12 },
    { startSec: 12, endSec: 13 },
    { startSec: 13, endSec: 90 },
  ],
  targets,
);
assert.deepEqual(
  [...cited].map(([index, rows]) => [index, rows.map((row) => row.label)]),
  [
    [0, ["Motion 1"]],
    [1, ["Motion 2"]],
    [2, ["Action"]],
  ],
);
// Labels match the Motions tab: business motions numbered without the
// adjournment, short titles without boilerplate, names preferred.
const boardTargets = minutesLinkTargets(
  [
    { motionId: "agenda", text: "BE IT RESOLVED THAT the agenda for this meeting be adopted as presented." },
    { motionId: "adjourn", text: "BE IT RESOLVED THAT the meeting be adjourned." },
    { motionId: "budget", name: "Approve the 2027 operating budget", text: "That the board approve the draft budget." },
    { motionId: "hall", text: "MOTION: THAT the hall be repainted." },
  ],
  [],
);
assert.deepEqual(
  boardTargets.map((target) => linkTargetMenuLabel(target)),
  [
    "Motion 1 — The agenda for this meeting be adopted as prese…",
    "Motion 2 — Approve the 2027 operating budget",
    "Motion 3 — The hall be repainted",
    "Adjournment — The meeting be adjourned",
  ],
  "the Motions tab's numbers and order: business motions, then the adjournment",
);
assert.deepEqual(motionNumbers([{ text: "Adjourn the meeting" }, { text: "Approve" }]), [null, 1]);
assert.equal(motionShortTitle({ text: "be it resolved that" }), "be it resolved that", "all-boilerplate wording is kept");
assert.equal(motionShortTitle({ text: "That's settled." }), "That's settled", "only a whole leading THAT is removed");
assert.equal(motionDisplayName(2, { text: "Resolved: hire a bookkeeper" }), "Motion 2 · Hire a bookkeeper");
assert.equal(
  motionTallySummary([
    { text: "Approve the budget", outcome: "Carried" },
    { text: "Paint the hall", outcome: "pending" },
    { text: "Buy chairs", outcome: "Tabled" },
    { text: "Adjourn the meeting", outcome: "Pending" },
  ]),
  "3 motions · 1 carried · 1 tabled or deferred · 1 pending · plus adjournment",
  "the tally counts what the Motions tab lists",
);
assert.equal(motionTallySummary([{ text: "Adjourn the meeting" }]), "No business motions · plus adjournment");

assert.deepEqual(
  minutesActionItems({
    actionItems: [{ text: "Top" }, { text: " " }],
    sections: [{ actionItems: [{ text: "In section", transcriptRef: { startSec: 1, endSec: 2 } }] }],
  }).map((item) => [item.text, item.sectionIndex, item.actionIndex]),
  [
    ["Top", null, 0],
    ["In section", 0, 0],
  ],
);

console.log(
  "Transcript link checks passed: registry, both portable adapters, motion + action links, round-trip, bounds, ownership, approved immutability, permissions, marker layout.",
);
