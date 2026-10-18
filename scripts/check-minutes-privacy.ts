/**
 * In-camera minutes and working-transcript privacy, on both portable adapters
 * (the in-memory oracle and the local row-store engine), for every role.
 *
 *   - minutes get/list/listLight/listSummaries, motions lists, the meeting
 *     package and table exports redact in-camera content for readers without
 *     minutes:write, with a visible placeholder, and leave it for those with it;
 *   - approved snapshots and adoption history are redacted on read, never stored;
 *   - transcripts:* reads need a role holding minutes:write (A1), plus the
 *     meetings:read and minutes:read scopes for a service principal; the
 *     minutes' transcript copy is withheld from everyone else;
 *   - a reader without in-camera access (a connector) gets a transcript with
 *     only the segments inside marked in-camera ranges replaced (A2), or none
 *     when any session is unmarked; marking needs minutes:write and never
 *     touches approved minutes;
 *   - in-camera agenda titles read "In-camera item" and a minutes meeting's
 *     working notes are withheld (A3); notes meetings keep their notes;
 *   - no connector scope reads in-camera content, even for the Owner (A5);
 *   - documents holding in-camera content (a meeting's minutes scan, materials
 *     of in-camera agenda items, sources in-camera minutes cite) are a
 *     placeholder in documents:list/listSummaries/get/getMany/browse/
 *     reviewQueues and the meeting package, and can't be opened, downloaded
 *     or commented on, for readers without minutes:write and every connector
 *     scope; editors read them as usual (security review H1);
 *   - the public copy renderer drops in-camera content for everyone;
 *   - the hosted AI agent's find_minutes tool is limited to roles that hold
 *     in-camera access (tasks:write); its redaction guards scoped tokens;
 *   - stored rows are unchanged after every read.
 *
 * Run: node --import tsx scripts/check-minutes-privacy.ts
 */
import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { betterAuthIssuer } from "../convex/lib/authIdentity";
import { actionPermission } from "../shared/functions/actionPolicy";
import { hasPermission } from "../shared/functions/permissions";
import {
  IN_CAMERA_ACCESS_PERMISSION,
  IN_CAMERA_DOCUMENT_TITLE,
  IN_CAMERA_ITEM_TITLE,
  IN_CAMERA_TASK_TITLE,
  IN_CAMERA_PLACEHOLDER,
  IN_CAMERA_TRANSCRIPT_LINE,
  IN_CAMERA_UNLOCATED_DISCUSSION,
  RESERVED_IN_CAMERA_SCOPE,
  TRANSCRIPT_READ_PERMISSION,
  TRANSCRIPT_READ_SCOPE,
  inCameraDocumentIdsOf,
  inCameraFacts,
  inCameraTaskIdsOf,
  isInCameraTask,
  minutesSectionsOf,
  inCameraRecordingRanges,
  isInCameraDocument,
  redactInCameraAgendaTitles,
  redactInCameraMinutes,
  redactInCameraTranscript,
  transcriptTextWithoutInCamera,
  withoutTranscriptCopy,
} from "../shared/minutesPrivacy";
import { CONNECTOR_SCOPES, validateGrantRequest } from "../shared/mcp/connectorPolicy";
import { listPermissionsForRole } from "../shared/functions/permissions";
import { renderMinutesHtml } from "../src/features/meetings/lib/minutesRenderer";
import {
  IN_CAMERA_ROLES,
  ROLES,
  SECRET,
  privacyRuntime,
  privacySeed,
  rolePrincipal,
  servicePrincipal,
} from "./minutes-privacy-fixture";

type Row = Record<string, unknown>;
const json = (value: unknown) => JSON.stringify(value);

// --- The rule itself ---------------------------------------------------------
assert.equal(IN_CAMERA_ACCESS_PERMISSION, "minutes:write");
// A1: working transcripts are for the people who keep the minutes.
assert.equal(TRANSCRIPT_READ_PERMISSION, "minutes:write");
assert.equal(TRANSCRIPT_READ_SCOPE, "minutes:read");
for (const role of ROLES) {
  assert.equal(hasPermission(role, IN_CAMERA_ACCESS_PERMISSION), IN_CAMERA_ROLES.includes(role), `${role} in-camera access`);
  assert.equal(hasPermission(role, TRANSCRIPT_READ_PERMISSION), IN_CAMERA_ROLES.includes(role), `${role} transcript access`);
}
for (const name of ["transcripts:getByMeeting", "transcripts:jobForMeeting"]) {
  // The policy gate is the scope a service principal needs; the handler checks the role.
  assert.equal(actionPermission(name, "query"), TRANSCRIPT_READ_SCOPE, `${name}: scope gate`);
}
// A5: no connector scope grants in-camera reads; the reserved scope isn't accepted.
assert.ok(!CONNECTOR_SCOPES.some((scope) => scope.permission === IN_CAMERA_ACCESS_PERMISSION || scope.permission === RESERVED_IN_CAMERA_SCOPE), "no in-camera connector scope");
assert.throws(() => validateGrantRequest({ name: "x", scopes: [RESERVED_IN_CAMERA_SCOPE], expiresInDays: 30 }, [...listPermissionsForRole("Owner"), RESERVED_IN_CAMERA_SCOPE]), /can't use minutes:in-camera/, "minutes:in-camera is reserved, not implemented");
assert.equal(actionPermission("transcripts:markInCameraRange", "mutation"), "meetings:write", "marking also needs minutes:write in its handler");
for (const name of ["transcripts:importTimed", "transcripts:updateSegment", "transcripts:assignSpeaker", "transcripts:saveText"]) {
  assert.equal(actionPermission(name, "mutation"), "meetings:write", `${name} keeps meetings:write`);
}

// --- Pure redaction ------------------------------------------------------------
const seed = privacySeed();
const boardRow = seed.minutes.find((row) => row._id === "minutes_board")!;
const boardFacts = inCameraFacts(boardRow);
assert.deepEqual(boardFacts.sectionIndexes, [1, 2], "the in-camera item and its depth-1 sub-item");
assert.deepEqual(boardFacts.motionIds, ["motion_secret"]);
assert.equal(boardFacts.unlocated, false);
const before = json(boardRow);
const redactedBoard = redactInCameraMinutes(boardRow) as Row;
assert.equal(json(boardRow), before, "redaction never mutates its input");
assert.ok(!json(redactedBoard).includes(SECRET), "no in-camera wording survives");
assert.ok(json(redactedBoard).includes(IN_CAMERA_PLACEHOLDER), "readers see that something was withheld");
assert.equal((redactedBoard.sections as Row[]).length, 4, "sections keep their positions");
assert.equal((redactedBoard.decisions as string[]).length, 2);
assert.equal((redactedBoard.decisions as string[])[0], "Approve the budget");
assert.equal((redactedBoard.sections as Row[])[0].discussion, "Budget reviewed.", "public sections are untouched");
assert.equal(redactedBoard.draftTranscript, undefined, "the working transcript copy is withheld");
assert.equal(redactedBoard.inCameraRedacted, true);
const unlocated = redactInCameraMinutes(seed.minutes.find((row) => row._id === "minutes_unlocated")!) as Row;
assert.equal(unlocated.discussion, IN_CAMERA_UNLOCATED_DISCUSSION, "an unseparated in-camera session withholds the discussion");
assert.ok(!json(unlocated).includes(SECRET));
const publicRow = seed.minutes.find((row) => row._id === "minutes_public")!;
assert.equal(redactInCameraMinutes(publicRow), publicRow, "minutes with nothing in camera pass through");
assert.equal(inCameraFacts({ sections: [{ title: "In camera", type: "In-Camera" }] }).sectionIndexes[0], 0, "type spelling is normalized");

// A2: recording offsets. Only overlapping segments go, as one placeholder line per run.
const markedRow = seed.minutes.find((row) => row._id === "minutes_marked")!;
assert.deepEqual(inCameraRecordingRanges(markedRow), [{ title: "In camera — legal advice", startSec: 10, endSec: 20 }]);
assert.equal(inCameraRecordingRanges(boardRow), null, "an unmarked session can't be cut out");
assert.equal(inCameraRecordingRanges(publicRow)?.length, 0, "nothing in camera");
assert.equal(inCameraRecordingRanges({ ...markedRow, sections: [...(markedRow.sections as Row[]), { title: "Second closed item", type: "closed" }] }), null, "every in-camera section must be named by a marked session");
assert.equal(inCameraRecordingRanges({ ...markedRow, sessionSegments: [{ type: "in_camera", title: "In camera — legal advice", recordingStartSec: 20, recordingEndSec: 10 }] }), null, "reversed offsets don't count");
const markedTranscript = seed.transcripts.find((row) => row._id === "transcript_marked")!;
const cut = redactInCameraTranscript(markedTranscript, inCameraRecordingRanges(markedRow)!) as Row;
assert.deepEqual((cut.segments as Row[]).map((segment) => segment.text), ["Reports were received.", IN_CAMERA_TRANSCRIPT_LINE, "We are back in open session."], "only overlapping segments are replaced, one line per run");
assert.deepEqual([(cut.segments as Row[])[1].startSec, (cut.segments as Row[])[1].endSec], [10, 19.5]);
assert.equal(cut.text, `Mina Patel: Reports were received.\n${IN_CAMERA_TRANSCRIPT_LINE}\nMina Patel: We are back in open session.`);
assert.ok(!json(cut).includes(SECRET), "speakers heard only in camera drop out too");
assert.equal(json(markedTranscript).includes(SECRET), true, "the input is untouched");
assert.equal(transcriptTextWithoutInCamera(markedTranscript, markedRow), cut.text, "export appendix text");
assert.equal(transcriptTextWithoutInCamera(seed.transcripts.find((row) => row._id === "transcript_board"), boardRow), null, "unmarked: no appendix");
assert.equal(IN_CAMERA_TRANSCRIPT_LINE, "[In-camera session — not shown]");
// A1: the minutes' transcript copy goes; import metadata that reuses the field stays.
assert.equal((withoutTranscriptCopy({ draftTranscript: "Mina: hello" }) as Row).draftTranscript, undefined);
const metadata = JSON.stringify({ importSessionId: "s1", nonPersonAttendance: [] });
assert.equal((withoutTranscriptCopy({ draftTranscript: metadata }) as Row).draftTranscript, metadata, "import metadata isn't a transcript");

// A3: agenda titles as exports list them.
const agendaTitles = redactInCameraAgendaTitles([{ title: "Budget" }, { title: "In camera — executive director review" }, { title: "SECRET sub-item", depth: 1 }, { title: "Adjournment" }], boardRow);
assert.deepEqual(agendaTitles.map((entry) => entry.title), ["Budget", IN_CAMERA_ITEM_TITLE, IN_CAMERA_ITEM_TITLE, "Adjournment"]);

// The public copy drops in-camera content even for an editor's export.
const rendered = renderMinutesHtml({
  society: { name: "Privacy fixture society" },
  meeting: { title: "September board meeting", scheduledAt: "2026-09-01T19:00:00.000Z", location: "Hall", type: "Board" },
  minutes: {
    ...(boardRow as Row),
    motions: [
      { text: "Approve the 2027 budget", outcome: "Carried", sectionIndex: 0 },
      { text: "SECRET approve a 5% salary adjustment", outcome: "Carried", sectionIndex: 1 },
    ],
  },
  options: { publicOnly: true },
} as unknown as Parameters<typeof renderMinutesHtml>[0]);
assert.ok(!rendered.includes(SECRET), "public copy carries no in-camera wording");
assert.ok(rendered.includes("In-camera session"), "public copy marks the withheld session");

// --- In-camera documents: the pure rule (H1) ------------------------------------
assert.deepEqual(inCameraDocumentIdsOf(seed.minutes.find((row) => row._id === "minutes_unlocated")!), ["doc_source_pack"], "sources cited by in-camera minutes");
assert.deepEqual(inCameraDocumentIdsOf({ ...publicRow, sourceDocumentIds: ["doc_x"] }), [], "minutes with nothing in camera mark nothing");
assert.deepEqual(inCameraDocumentIdsOf(boardRow, [{ _id: "motion_secret", minutesId: "minutes_board", sectionIndex: 1, dissentDocumentId: "doc_dissent" }, { _id: "motion_budget", sectionIndex: 0, dissentDocumentId: "doc_open_dissent" }]), ["doc_dissent"], "dissent reports of in-camera motions only");
const index = {
  documentIds: new Set(["doc_cited"]), meetingIds: new Set(["meeting_board"]), agendaItemIds: new Set(["item_review"]), taskIds: new Set(["task_linked"]),
  minutesSections: new Map([["meeting_board", minutesSectionsOf(boardRow)], ["meeting_public", minutesSectionsOf(publicRow)]]),
};
assert.ok(isInCameraDocument({ _id: "doc_cited" }, [], index));
assert.ok(isInCameraDocument({ _id: "doc_scan", category: "meeting minutes", meetingId: "meeting_board" }, [], index), "a minutes document of the meeting (category aliases too)");
assert.ok(isInCameraDocument({ _id: "doc_agenda", category: "Correspondence", meetingId: "meeting_board" }, [], index), "any category filed under the meeting (round 2)");
assert.ok(!isInCameraDocument({ _id: "doc_other", category: "Minutes", meetingId: "meeting_public" }, [], index));
assert.ok(isInCameraDocument({ _id: "doc_copy", duplicateOfDocumentId: "doc_cited" }, [], index) && isInCameraDocument({ _id: "doc_v2", supersedesDocumentId: "doc_cited" }, [], index), "copies and versions of in-camera documents");
assert.ok(isInCameraDocument({ _id: "doc_material" }, [{ documentId: "doc_material", meetingId: "meeting_board" }], index), "any material of the meeting");
assert.deepEqual(inCameraTaskIdsOf(boardRow), ["task_ic_linked"], "tasks linked from in-camera action items");
assert.ok(isInCameraTask({ _id: "task_linked" }, index) && isInCameraTask({ _id: "t", inCamera: true }, index), "linked tasks; the hint holds for a task with no minutes");
// Round 3: decided at read time against the current minutes.
const action = (extra: Record<string, unknown>) => ({ _id: "t", meetingId: "meeting_board", tags: ["minutes-action"], ...extra });
assert.ok(isInCameraTask(action({}), index), "a minutes action task with no section reference, under an in-camera meeting");
assert.ok(isInCameraTask(action({ inCamera: false }), index), "a stored false doesn't exempt it");
assert.ok(isInCameraTask(action({ minutesSectionIndex: 1, minutesSectionTitle: "In camera — executive director review" }), index), "its section is in camera now");
assert.ok(!isInCameraTask(action({ minutesSectionIndex: 0, minutesSectionTitle: "Budget" }), index), "its section is open now");
assert.ok(!isInCameraTask(action({ minutesSectionIndex: 0, minutesSectionTitle: "Budget", inCamera: true }), index), "the current minutes overrule a stale hint (unmarking)");
assert.ok(!isInCameraTask(action({ minutesSectionIndex: 5, minutesSectionTitle: "Budget" }), index), "found by title when sections moved");
assert.ok(isInCameraTask(action({ minutesSectionIndex: 0, minutesSectionTitle: "Renamed section" }), index), "a section that can't be found counts as in camera");
assert.ok(!isInCameraTask({ _id: "t", meetingId: "meeting_public", tags: ["minutes-action"] }, index), "nothing is in camera at that meeting");
assert.ok(!isInCameraTask({ _id: "t", meetingId: "meeting_board", tags: [] }, index), "an ordinary task about the meeting");
assert.ok(isInCameraDocument({ _id: "doc_pack" }, [{ documentId: "doc_pack", agendaItemId: "item_review" }], index), "a material of an in-camera agenda item");
assert.ok(isInCameraDocument({ _id: "doc_attached", agendaItemId: "item_review" }, [], index));
assert.ok(!isInCameraDocument({ _id: "doc_pack" }, [{ documentId: "doc_pack", agendaItemId: "item_budget" }], index));

// --- Both portable adapters, every role ---------------------------------------
for (const local of [false, true]) {
  const adapter = local ? "local row store" : "memory oracle";
  const { db, runtime, as } = privacyRuntime(local);
  const stored = async () => json(await Promise.all(
    ["minutes_board", "minutes_adopted", "minutes_unlocated", "motion_secret", "transcript_board"].map((id) => db.get(id)),
  ));
  const storedBefore = await stored();

  for (const role of ROLES) {
    as(rolePrincipal(role));
    const sees = IN_CAMERA_ROLES.includes(role);
    const label = `${adapter} / ${role}`;
    const check = (value: unknown, what: string) => {
      const text = json(value);
      if (sees) assert.ok(text.includes(SECRET), `${label}: ${what} keeps in-camera content`);
      else {
        assert.ok(!text.includes(SECRET), `${label}: ${what} leaks in-camera content`);
        assert.ok(text.includes(IN_CAMERA_PLACEHOLDER) || text.includes("In-camera"), `${label}: ${what} shows the placeholder`);
      }
    };

    const board = await runtime.runQuery<Row>("minutes:getByMeeting", { meetingId: "meeting_board" });
    check(board, "minutes:getByMeeting");
    assert.equal((board.displayMotions as Row[]).length, 2, `${label}: motions keep their count`);
    const adopted = await runtime.runQuery<Row>("minutes:getByMeeting", { meetingId: "meeting_adopted" });
    check(adopted, "approved minutes (snapshot and history)");
    check(await runtime.runQuery("minutes:getByMeeting", { meetingId: "meeting_unlocated" }), "unseparated in-camera minutes");
    const plain = await runtime.runQuery<Row>("minutes:getByMeeting", { meetingId: "meeting_public" });
    assert.equal(plain.inCameraRedacted, undefined, `${label}: nothing to redact`);

    check(await runtime.runQuery("minutes:list", { societyId: "privacy-society" }), "minutes:list");
    check(await runtime.runQuery("minutes:listLight", { societyId: "privacy-society" }), "minutes:listLight");
    const summaries = await runtime.runQuery<Row[]>("minutes:listSummaries", { societyId: "privacy-society" });
    const boardSummary = summaries.find((row) => row._id === "minutes_board")!;
    assert.equal(boardSummary.hasInCamera, true);
    assert.equal(Boolean(boardSummary.actionObservations), sees, `${label}: in-camera action observations`);

    check(await runtime.runQuery("motions:list", { societyId: "privacy-society" }), "motions:list");
    check(await runtime.runQuery("motions:listForMinutes", { minutesId: "minutes_board" }), "motions:listForMinutes");
    check(await runtime.runQuery("motions:listForMeeting", { meetingId: "meeting_board" }), "motions:listForMeeting");
    const motions = await runtime.runQuery<Row[]>("motions:listForMinutes", { minutesId: "minutes_board" });
    assert.equal(motions.find((row) => row._id === "motion_budget")!.text, "Approve the 2027 budget", `${label}: public motions untouched`);

    const pack = await runtime.runQuery<Row>("meetingMaterials:packageForMeeting", { meetingId: "meeting_board" });
    check(pack.minutes, "meeting package");

    if (hasPermission(role, "exports:download")) {
      check(await runtime.runQuery("exports:exportTable", { societyId: "privacy-society", table: "minutes" }), "minutes export");
    }

    // A1: transcripts are for the people who keep the minutes, and so is the minutes' copy.
    if (sees) {
      const transcript = await runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_board" });
      assert.equal((transcript.segments as Row[]).length, 1, `${label}: full transcript`);
      const publicTranscript = await runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_public" });
      assert.equal((publicTranscript.segments as Row[]).length, 120, `${label}: transcript with nothing in camera`);
      assert.equal(publicTranscript.withheld, undefined);
      const marked = await runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_marked" });
      assert.ok(json(marked).includes(SECRET), `${label}: editors read the in-camera part`);
      await runtime.runQuery("transcripts:jobForMeeting", { meetingId: "meeting_public" });
    } else {
      for (const meetingId of ["meeting_board", "meeting_public", "meeting_marked"]) {
        await assert.rejects(() => runtime.runQuery("transcripts:getByMeeting", { meetingId }), /minutes:write/, `${label}: ${meetingId} transcript refused`);
      }
      await assert.rejects(() => runtime.runQuery("transcripts:jobForMeeting", { meetingId: "meeting_public" }), /minutes:write/, `${label}: transcription job refused`);
    }
    assert.equal(json(plain).includes("TRANSCRIPT-COPY"), sees, `${label}: the minutes' transcript copy follows the transcript rule`);
    assert.equal(json(await runtime.runQuery("minutes:list", { societyId: "privacy-society" })).includes("TRANSCRIPT-COPY"), sees, `${label}: minutes:list transcript copy`);

    // A3: in-camera agenda titles and a minutes meeting's working notes.
    const agenda = await runtime.runQuery<{ items: Row[] }>("agendas:getForMeeting", { meetingId: "meeting_board" });
    const titles = agenda.items.map((item) => item.title);
    if (sees) assert.deepEqual(titles, ["Budget", "In camera — executive director review", "SECRET follow-up item", "Adjournment"], `${label}: editors see agenda titles`);
    else {
      assert.deepEqual(titles, ["Budget", IN_CAMERA_ITEM_TITLE, IN_CAMERA_ITEM_TITLE, "Adjournment"], `${label}: in-camera agenda items`);
      assert.ok(!json(agenda).includes(SECRET), `${label}: agenda details and presenter go too`);
      assert.equal(agenda.items[1].order, 1, `${label}: position kept`);
    }
    const viaAgendaId = await runtime.runQuery<{ items: Row[] }>("agendas:get", { agendaId: "agenda_board" });
    assert.equal(json(viaAgendaId).includes(SECRET), sees, `${label}: agendas:get`);
    const boardMeeting = await runtime.runQuery<Row>("meetings:get", { id: "meeting_board" });
    if (sees) assert.ok(String(boardMeeting.workingNotes).includes(SECRET), `${label}: editors read working notes`);
    else {
      assert.equal(boardMeeting.workingNotes, undefined, `${label}: working notes withheld`);
      assert.equal(boardMeeting.workingNotesWithheld, "in_camera");
    }
    const notesMeeting = await runtime.runQuery<Row>("meetings:get", { id: "meeting_notes" });
    assert.equal(notesMeeting.workingNotes, "Picked a date for the picnic.", `${label}: notes meetings keep their notes`);
    assert.equal(json(pack.agenda).includes(SECRET), sees, `${label}: package agenda`);
    assert.equal(json(pack.meeting).includes(SECRET), sees, `${label}: package meeting notes`);

    // H1: documents that hold in-camera content.
    const inCameraDocs = ["doc_board_scan", "doc_review_pack", "doc_source_pack"];
    const withheldDoc = (value: unknown, what: string) => {
      assert.equal(json(value).includes(SECRET), sees, `${label}: ${what}`);
      if (!sees) assert.ok(json(value).includes(IN_CAMERA_DOCUMENT_TITLE), `${label}: ${what} shows "${IN_CAMERA_DOCUMENT_TITLE}"`);
    };
    for (const id of inCameraDocs) {
      const document = await runtime.runQuery<Row>("documents:get", { id });
      withheldDoc(document, `documents:get ${id}`);
      if (!sees) {
        assert.deepEqual([document.title, document.inCameraWithheld, document.content, document.url, document.fileName], [IN_CAMERA_DOCUMENT_TITLE, "in_camera", undefined, undefined, undefined], `${label}: ${id} placeholder`);
        await assert.rejects(() => runtime.runQuery("documentVersions:listForDocument", { documentId: id }), /not found/, `${label}: ${id} versions and downloads refused`);
        await assert.rejects(() => runtime.runQuery("documentComments:listForDocument", { documentId: id }), /not found/, `${label}: ${id} comments refused`);
      }
    }
    for (const name of ["documents:list", "documents:listSummaries", "documents:browse", "documents:reviewQueues"]) {
      const listing = await runtime.runQuery(name, { societyId: "privacy-society" });
      withheldDoc(listing, name);
    }
    withheldDoc(await runtime.runQuery("documents:getMany", { ids: inCameraDocs }), "documents:getMany");
    const listed = await runtime.runQuery<Row[]>("documents:listSummaries", { societyId: "privacy-society" });
    assert.ok(inCameraDocs.every((id) => listed.some((row) => row._id === id)), `${label}: in-camera material stays listed, so readers know it exists`);
    // Round 2: any category under the meeting, copies of in-camera documents, import bookkeeping.
    for (const id of ["doc_board_pack", "doc_source_copy"]) withheldDoc(await runtime.runQuery("documents:get", { id }), `documents:get ${id}`);
    assert.equal(await runtime.runQuery("documents:get", { id: "doc_import_session" }), null, `${label}: import bookkeeping isn't a document to open`);
    assert.deepEqual(await runtime.runQuery("documents:getMany", { ids: ["doc_import_session"] }), [], `${label}: not through getMany either`);
    // Round 2: tasks made from in-camera action items.
    const taskRows = await runtime.runQuery<Row[]>("tasks:list", { societyId: "privacy-society" });
    const inCameraTasks = ["task_ic_linked", "task_ic_flagged", "task_ic_legacy"];
    assert.equal(json(taskRows).includes(SECRET), sees, `${label}: tasks:list`);
    if (!sees) {
      for (const id of inCameraTasks) {
        const row = taskRows.find((task) => task._id === id);
        assert.deepEqual([row?.title, row?.inCameraWithheld, row?.status], [IN_CAMERA_TASK_TITLE, "in_camera", "Todo"], `${label}: ${id} keeps its place, not its wording`);
      }
    }
    assert.equal(taskRows.find((task) => task._id === "task_open_action")?.title, "Circulate the budget", `${label}: an action from an open section is untouched`);
    assert.equal(json(await runtime.runQuery("tasks:byMeeting", { meetingId: "meeting_board" })).includes(SECRET), sees, `${label}: tasks:byMeeting`);
    assert.equal(json(await runtime.runQuery("dashboard:summary", { societyId: "privacy-society" })).includes(SECRET), sees, `${label}: dashboard task preview`);
    const committeeMinutes = await runtime.runQuery<Row>("documents:get", { id: "doc_committee_minutes" });
    assert.equal(committeeMinutes.content, "Updates were shared.", `${label}: minutes of a meeting with nothing in camera read as usual`);
    const packMaterials = pack.materials as Row[];
    withheldDoc(packMaterials, "meeting package materials (label, notes, document)");
    assert.equal(json(pack.tasks).includes(SECRET), sees, `${label}: meeting package tasks`);
    if (!sees) assert.equal(packMaterials.find((row) => row.documentId === "doc_review_pack")?.label, IN_CAMERA_DOCUMENT_TITLE);
    withheldDoc(await runtime.runQuery("meetingMaterials:listForMeeting", { meetingId: "meeting_board" }), "meetingMaterials:listForMeeting");
  }

  // A2: marking a range needs minutes:write and refuses approved minutes.
  as(rolePrincipal("Member"));
  await assert.rejects(() => runtime.runMutation("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_board", sessionTitle: "In camera — executive director review", startSec: 0, endSec: 4 }), /meetings:write|minutes:write/);
  as(rolePrincipal("Director"));
  await assert.rejects(() => runtime.runMutation("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_adopted", sessionTitle: "In camera — executive director review", startSec: 0, endSec: 4 }), /Approved minutes/, "approved minutes are never touched");
  await assert.rejects(() => runtime.runMutation("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_board", sessionTitle: "Not a session", startSec: 0, endSec: 4 }), /isn't in these minutes/);
  await assert.rejects(() => runtime.runMutation("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_board", startSec: 4, endSec: 4 }), /at least a moment/);

  // Scoped service principals (AI connectors): transcripts need the role and both scopes; in camera never.
  const connector = ["meetings:read", TRANSCRIPT_READ_SCOPE];
  as(servicePrincipal(connector));
  const withheldBoard = await runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_board" });
  assert.deepEqual([withheldBoard.withheld, withheldBoard.segments, withheldBoard.text], ["in_camera", [], ""], `${adapter}: unmarked in-camera session withholds the whole transcript`);
  const cutMarked = await runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_marked" });
  assert.ok(!json(cutMarked).includes(SECRET), `${adapter}: marked in-camera segments are cut out`);
  assert.deepEqual((cutMarked.segments as Row[]).map((segment) => segment.text), ["Reports were received.", IN_CAMERA_TRANSCRIPT_LINE, "We are back in open session."]);
  assert.equal(cutMarked.inCameraRedacted, true);
  assert.equal(((await runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_public" })).segments as Row[]).length, 120, `${adapter}: nothing in camera, nothing cut`);
  as(servicePrincipal(connector, "Member"));
  await assert.rejects(() => runtime.runQuery("transcripts:getByMeeting", { meetingId: "meeting_public" }), /minutes:write/, `${adapter}: a Member's token never reads transcripts`);
  // A5: every connector scope together, for the Owner, still reads no in-camera content.
  as(servicePrincipal(CONNECTOR_SCOPES.map((scope) => scope.permission)));
  for (const [name, args] of [
    ["minutes:getByMeeting", { meetingId: "meeting_board" }], ["minutes:getByMeeting", { meetingId: "meeting_marked" }], ["meetingMaterials:packageForMeeting", { meetingId: "meeting_board" }],
    ["meetings:get", { id: "meeting_board" }], ["transcripts:getByMeeting", { meetingId: "meeting_marked" }],
    // H1: in-camera material by document, for the Owner's connector.
    ["documents:get", { id: "doc_board_scan" }], ["documents:get", { id: "doc_review_pack" }], ["documents:get", { id: "doc_source_pack" }],
    ["documents:listSummaries", { societyId: "privacy-society" }], ["documents:list", { societyId: "privacy-society" }], ["documents:getMany", { ids: ["doc_board_scan", "doc_source_pack"] }],
    ["documents:get", { id: "doc_board_pack" }], ["documents:get", { id: "doc_source_copy" }], ["documents:get", { id: "doc_import_session" }],
    ["tasks:list", { societyId: "privacy-society" }], ["tasks:byMeeting", { meetingId: "meeting_board" }],
  ] as const) {
    assert.ok(!json(await runtime.runQuery(name, args)).includes(SECRET), `${adapter}: ${name} with every connector scope`);
  }

  // A Director marks a range on the unmarked board minutes (a fresh copy of
  // the fixture); a connector then gets a cut transcript instead of none.
  {
    const marking = privacyRuntime(local);
    marking.as(rolePrincipal("Director"));
    const marked = await marking.runtime.runMutation<Row>("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_board", sessionTitle: "In camera — executive director review", startSec: 0, endSec: 4 });
    assert.deepEqual(marked, { title: "In camera — executive director review", recordingStartSec: 0, recordingEndSec: 4 });
    marking.as(servicePrincipal(connector));
    const nowCut = await marking.runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_board" });
    assert.equal(nowCut.withheld, undefined, `${adapter}: marked, so no longer withheld whole`);
    assert.deepEqual((nowCut.segments as Row[]).map((segment) => segment.text), [IN_CAMERA_TRANSCRIPT_LINE]);
    marking.as(rolePrincipal("Director"));
    const added = await marking.runtime.runMutation<Row>("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_public", startSec: 2, endSec: 6 });
    assert.equal(added.title, "In-camera session", `${adapter}: a new session is titled "In-camera session"`);
    await marking.runtime.runMutation("transcripts:markInCameraRange", { societyId: "privacy-society", meetingId: "meeting_board", sessionTitle: "In camera — executive director review" });
    marking.as(servicePrincipal(connector));
    assert.equal((await marking.runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_board" })).withheld, "in_camera", `${adapter}: clearing the offsets withholds it again`);
    const publicCut = await marking.runtime.runQuery<Row>("transcripts:getByMeeting", { meetingId: "meeting_public" });
    assert.equal((publicCut.segments as Row[]).filter((segment) => segment.text === IN_CAMERA_TRANSCRIPT_LINE).length, 1, `${adapter}: the new session cuts its range`);
    assert.equal((publicCut.segments as Row[]).length, 120 - 2 + 1, `${adapter}: the two overlapping segments become one line`);
  }

  // Scoped service principals: scopes narrow the role's permissions.
  as(servicePrincipal(["meetings:read"]));
  await assert.rejects(() => runtime.runQuery("transcripts:getByMeeting", { meetingId: "meeting_public" }), /minutes:read/, `${adapter}: transcript needs minutes:read`);
  as(servicePrincipal(["minutes:read"]));
  await assert.rejects(() => runtime.runQuery("transcripts:getByMeeting", { meetingId: "meeting_public" }), /meetings:read/, `${adapter}: transcript needs meetings:read`);
  as(servicePrincipal(["meetings:read", "minutes:read"]));
  assert.ok(!json(await runtime.runQuery("minutes:getByMeeting", { meetingId: "meeting_board" })).includes(SECRET), `${adapter}: read scopes don't grant in-camera access`);
  as(servicePrincipal(["exports:*"]));
  for (const table of ["minutes", "motions", "transcripts", "meetings", "agendaItems", "tasks", "documents"]) {
    const rows = await runtime.runQuery("exports:exportTable", { societyId: "privacy-society", table });
    assert.ok(!json(rows).includes(SECRET), `${adapter}: ${table} export for a scoped token`);
  }
  assert.deepEqual(await runtime.runQuery("exports:exportTable", { societyId: "privacy-society", table: "transcripts" }), [], `${adapter}: no transcript access, no transcript rows`);
  as(servicePrincipal(["exports:*", "minutes:write"]));
  assert.ok(json(await runtime.runQuery("exports:exportTable", { societyId: "privacy-society", table: "minutes" })).includes(SECRET), `${adapter}: a minutes:write scope keeps the full export`);

  // Rounds 2 and 3: "Create task from action" records where the action came from; reads decide against the current minutes.
  {
    const creating = privacyRuntime(local);
    creating.as(rolePrincipal("Admin"));
    const fromAction = (label: string, extra: Record<string, unknown>) => creating.runtime.runMutation<string>("tasks:create", {
      societyId: "privacy-society", title: `SECRET action ${label}`, status: "Todo", priority: "Medium", meetingId: "meeting_board", tags: ["minutes-action"], ...extra,
    });
    const inCameraTask = await fromAction("in camera", { minutesSectionIndex: 1, inCamera: false, minutesSectionTitle: "Budget" });
    const openTask = await fromAction("open", { minutesSectionIndex: 0 });
    const noIndexTask = await fromAction("no index", {});
    const laterTask = await fromAction("later marked", { minutesSectionIndex: 3 });
    const stored = await creating.db.get(inCameraTask);
    assert.deepEqual([stored?.minutesSectionIndex, stored?.minutesSectionTitle, stored?.inCamera], [1, "In camera — executive director review", true], `${adapter}: the section reference and hint come from the minutes, not the caller`);
    assert.deepEqual([(await creating.db.get(openTask))?.minutesSectionTitle, (await creating.db.get(openTask))?.inCamera], ["Budget", undefined], `${adapter}: an open section's task records no hint`);
    const memberView = async () => {
      creating.as(rolePrincipal("Member"));
      const rows = await creating.runtime.runQuery<Row[]>("tasks:list", { societyId: "privacy-society" });
      creating.as(rolePrincipal("Admin"));
      return (id: string) => rows.find((row) => row._id === id)?.title;
    };
    let title = await memberView();
    assert.equal(title(inCameraTask), IN_CAMERA_TASK_TITLE, `${adapter}: a Member sees the in-camera action as a placeholder`);
    assert.equal(title(openTask), "SECRET action open", `${adapter}: an open section's action reads as written`);
    assert.equal(title(noIndexTask), IN_CAMERA_TASK_TITLE, `${adapter}: a minutes action sent without its section counts as in camera (round 3)`);
    assert.equal(title(laterTask), "SECRET action later marked", `${adapter}: open until its section is marked`);
    const board = (await creating.db.get("minutes_board"))!;
    const patchBoard = (fields: Row) => creating.db.transaction(() => creating.db.patch("minutes_board", fields));
    const sections = (board.sections as Row[]).map((section, index) => (index === 3 ? { ...section, type: "in_camera" } : section));
    await patchBoard({ sections });
    title = await memberView();
    assert.equal(title(laterTask), IN_CAMERA_TASK_TITLE, `${adapter}: marking its section in camera later hides the task (round 3)`);
    await patchBoard({ sections: (board.sections as Row[]).map((section) => ({ ...section, type: "discussion" })), sessionSegments: [] });
    title = await memberView();
    assert.equal(title(inCameraTask), "SECRET action in camera", `${adapter}: unmarking the section shows the task again, despite its hint (round 3)`);
    assert.equal(title(laterTask), "SECRET action later marked", `${adapter}: and the later-marked one`);
    creating.as(servicePrincipal(CONNECTOR_SCOPES.map((scope) => scope.permission)));
    await patchBoard({ sections: board.sections, sessionSegments: board.sessionSegments });
    assert.ok(!json(await creating.runtime.runQuery("tasks:list", { societyId: "privacy-society" })).includes("SECRET action in camera"), `${adapter}: re-marked, every connector scope sees the placeholder again`);
  }

  // Edits still need meetings:write.
  as(rolePrincipal("Member"));
  await assert.rejects(
    () => runtime.runMutation("transcripts:assignSpeaker", { societyId: "privacy-society", meetingId: "meeting_public", label: "SPEAKER_00", name: "X" }),
    /meetings:write/,
  );

  assert.equal(await stored(), storedBefore, `${adapter}: stored rows are unchanged by every read`);
}

// --- Hosted AI agent minutes tool (find_minutes), on convex-test ---------------
{
  const issuer = betterAuthIssuer();
  const test = convexTest(schema, {
    "./_generated/api.js": () => import("../convex/_generated/api.js"),
    "./_generated/server.js": () => import("../convex/_generated/server.js"),
    "./authorization.js": () => import("../convex/authorization"),
    "./aiAgents.js": () => import("../convex/aiAgents"),
  });
  const societyId = await test.run(async (ctx) => {
    const societyId = await ctx.db.insert("societies", { name: "AI privacy", isCharity: false, isMemberFunded: false, updatedAt: Date.now() });
    for (const role of ["Owner", "Member"]) {
      await ctx.db.insert("users", { societyId, role, status: "Active", email: `${role}@example.test`, displayName: role, authSubject: role, authIssuer: issuer, authProvider: "better-auth", createdAtISO: new Date().toISOString() });
    }
    const meetingId = await ctx.db.insert("meetings", { societyId, title: "Board", type: "Board", scheduledAt: "2026-09-01T19:00:00Z", electronic: false, status: "Held", attendeeIds: [] });
    await ctx.db.insert("minutes", {
      societyId, meetingId, heldAt: "2026-09-01", attendees: [], absent: [], quorumMet: true, discussion: "Opened.",
      sections: [{ title: "Budget", discussion: "Reviewed." }, { title: "In camera", type: "executive_session", discussion: "SECRET personnel matter", decisions: ["SECRET raise"] }],
      decisions: ["SECRET raise"], actionItems: [],
    });
    return societyId;
  });
  const run = (role: string) => test.withIdentity({ subject: role, issuer }).mutation(api.aiAgents.executeTool, { societyId, toolName: "find_minutes", arguments: {} });
  assert.ok(json(await run("Owner")).includes("SECRET raise"), "an editor's agent reads in-camera minutes");
  // Agent tools are a tasks:write action, so Members and Viewers can't reach
  // this path; the redaction there guards scoped service principals.
  await assert.rejects(() => run("Member"), /tasks:write/);
}

console.log("Minutes privacy checks passed: in-camera redaction across minutes, motions, package, exports and public copy; hosted AI minutes tool access; transcripts for minute-takers only (A1); in-camera segments cut at marked offsets or the transcript withheld, and marking rules (A2); in-camera agenda titles and working notes (A3); no connector scope reads in camera (A5); in-camera documents are placeholders that can't be opened (H1); both portable adapters, every role; stored rows untouched.");
