/**
 * WP-H gate: people identity maintenance, directory scoping, organization
 * members and representatives, historical source actions and roster
 * promotion. Synthetic data only. Runs on the in-memory and local-store
 * engines through the real portable registry.
 */
import assert from "node:assert/strict";
import { MemoryDb, LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities } from "../shared/portable/index";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { portableTestPrincipal, portableTestSeed } from "./portable-test-fixture";
import { candidatePeopleForName, peopleNamedInFragment, personMatchesSearch, stripRoleAffixes, suggestDuplicatePeople } from "../shared/personMatching";
import { matchByPrefix } from "../shared/peopleDirectory";
import { actionTitleKey, isOpenOperationalTask, sourceAssigneeFromTitle } from "../shared/taskStatus";
import { personReferencePaths, repointPaths } from "../shared/functions/personMerge";

/* ----------------------------- pure matching ----------------------------- */
{
  const people = [
    { id: "a", fullName: "Jordan Sample", occurrenceCount: 40, meetingIds: ["m1", "m2"], firstObserved: "2015", lastObserved: "2019" },
    { id: "b", fullName: "Jordon Sample", occurrenceCount: 2, meetingIds: ["m3"], firstObserved: "2016", lastObserved: "2016" },
    { id: "c", fullName: "Robert Fixture", occurrenceCount: 9 },
    { id: "d", fullName: "Bob Fixture", occurrenceCount: 3 },
    { id: "e", fullName: "Casey Testerman", occurrenceCount: 3 },
    { id: "f", fullName: "Casey Testerman Long", occurrenceCount: 5 },
    { id: "g", fullName: "Avery Placeholder", occurrenceCount: 4, meetingIds: ["m9", "m8", "m7"] },
    { id: "h", fullName: "Avery Placeholdr", occurrenceCount: 4, meetingIds: ["m9", "m8", "m7"] },
    { id: "i", fullName: "Morgan Dummy", occurrenceCount: 4, distinctFromIds: ["j"] },
    { id: "j", fullName: "Morgen Dummy", occurrenceCount: 1 },
    { id: "k", fullName: "Quinn Unrelated" },
    { id: "l", fullName: "DR. Renée Exemple" },
    { id: "m", fullName: "renee exemple" },
  ];
  const suggestions = suggestDuplicatePeople(people);
  const pair = (x: string, y: string) => suggestions.find((s) => s.ids.includes(x) && s.ids.includes(y));
  assert.ok(pair("a", "b"), "spelling variant of a given name is suggested");
  assert.deepEqual(pair("a", "b")!.ids, ["a", "b"], "the profile with more observations is the suggested survivor");
  assert.ok(pair("c", "d"), "nicknames (Bob/Robert) are suggested");
  assert.ok(pair("e", "f"), "a name contained in another is suggested");
  assert.ok(pair("l", "m"), "case, diacritics and honorifics are ignored");
  const together = pair("g", "h");
  assert.ok(!together || together.reasons.some((r) => /same meeting/.test(r)), "co-attendance is reported as a reason against");
  assert.ok(!pair("i", "j"), "a dismissed pair is not suggested again");
  assert.ok(!suggestions.some((s) => s.ids.includes("k")), "unrelated names are not suggested");
  const directory = [{ _id: "1", fullName: "Taylor Example" }, { _id: "2", fullName: "Taylor Sampleton" }, { _id: "3", fullName: "Riley Other", aliases: ["Taylor R."] }];
  assert.equal(candidatePeopleForName(directory, "Taylor").length, 3, "a first name alone lists every person with that given name (aliases included)");
  assert.equal(candidatePeopleForName(directory, "Example, Taylor")[0].reason, "exact");
  assert.ok(personMatchesSearch({ fullName: "Taylor Sampleton" }, "Sampl"), "surname prefix search");
  assert.ok(!personMatchesSearch({ fullName: "Taylor Sampleton" }, "ampl"), "search is word-prefix, not arbitrary substring");
  assert.deepEqual(matchByPrefix([{ id: "x", fullName: "Taylor Sampleton" }, { id: "y", fullName: "Other Person" }], "Sampleton").map((p) => p.id), ["x"]);
  assert.deepEqual(peopleNamedInFragment([{ _id: "1", fullName: "Taylor Example" }, { _id: "2", fullName: "Riley Other" }], "Taylor Example Fictional Health Riley Other").map((p) => p._id), ["1", "2"]);
  assert.equal(stripRoleAffixes("Vice President Taylor Example"), "Taylor Example");
  assert.equal(sourceAssigneeFromTitle("Review historical action: Taylor and Riley to draft the plan"), "Taylor and Riley");
  assert.equal(sourceAssigneeFromTitle("Discuss the budget"), undefined);
  assert.equal(actionTitleKey("Review historical action: Secretariat to begin work."), actionTitleKey("Secretariat to begin work"));
  assert.equal(isOpenOperationalTask({ status: "Todo", tags: ["historical-source-action"] }), false);
  assert.equal(isOpenOperationalTask({ status: "Unknown", tags: [] }), false);
  assert.equal(isOpenOperationalTask({ status: "Blocked", tags: [] }), true);
  const doc = { _id: "x", personId: "p1", sections: [{ actionItems: [{ assigneePersonId: "p1" }, { assigneePersonId: "p2" }] }], reviewHistory: [{ personId: "p1" }] };
  const paths = personReferencePaths(doc, "p1");
  assert.deepEqual(paths, [["personId"], ["sections", 0, "actionItems", 0, "assigneePersonId"]], "nested references are found; review trails are not rewritten");
  const { patch, changed } = repointPaths(doc, paths, "p1", "p9");
  assert.equal(changed, 2);
  assert.equal(patch.sections[0].actionItems[1].assigneePersonId, "p2");
  assert.equal(doc.sections[0].actionItems[0].assigneePersonId, "p1", "repointing never mutates the source document");
}

/* ------------------------------- runtime -------------------------------- */
const A = "people_identity_a", B = "people_identity_b";
const source = { sourceUrl: "https://example.invalid/people-identity", sourceReference: "Fictional regression fixture", reviewStatus: "verified" };
const now = "2026-01-01T00:00:00.000Z";
for (const engine of ["memory", "local-store"] as const) {
  const seed: any = {
    societies: [...portableTestSeed(A).societies, ...portableTestSeed(B).societies],
    users: [...portableTestSeed(A).users, ...portableTestSeed(B).users],
    peopleDirectory: [
      { _id: "pa1", societyId: A, fullName: "Jordan Sample", searchName: "jordan sample", createdAtISO: now, updatedAtISO: now },
      { _id: "pa2", societyId: A, fullName: "Jordon Sample", searchName: "jordon sample", createdAtISO: now, updatedAtISO: now },
      { _id: "pb1", societyId: B, fullName: "Foreign Private Person", searchName: "foreign private person", createdAtISO: now, updatedAtISO: now },
      { _id: "pu1", fullName: "Reusable Legacy Contact", searchName: "reusable legacy contact", createdAtISO: now, updatedAtISO: now },
    ],
    meetings: [
      { _id: "m1", societyId: A, title: "Fictional finance meeting", type: "Committee", committeeId: "c1", scheduledAt: "2019-03-01T12:00:00.000Z", status: "Held", attendeeIds: [] },
      { _id: "m2", societyId: A, title: "Fictional board meeting", type: "Board", scheduledAt: "2019-04-01T12:00:00.000Z", status: "Held", attendeeIds: [] },
    ],
    committees: [{ _id: "c1", societyId: A, name: "Finance Committee", cadence: "Monthly", color: "#000", status: "Active", createdAtISO: now }],
    agendas: [{ _id: "ag2", societyId: A, meetingId: "m2", title: "Board agenda", createdAtISO: now }],
    agendaItems: [{ _id: "ai2", societyId: A, agendaId: "ag2", order: 1, type: "discussion", title: "Item" }],
    minutes: [{ _id: "min1", societyId: A, meetingId: "m1", heldAt: "2019-03-01", attendees: ["Jordon Sample"], absent: [], quorumMet: true, discussion: "", decisions: [], actionItems: [{ text: "Draft plan", done: false, assigneePersonId: "pa2" }], detailedAttendance: [{ name: "Jordon Sample", status: "present", personId: "pa2" }] }],
    personOccurrences: [
      { _id: "o1", societyId: A, occurrenceKey: "k1", recordTable: "minutes", recordId: "min1", personName: "Jordon Sample", context: "Attendance (Present)", observedDate: "2019-03-01", meetingId: "m1", sourceUrl: source.sourceUrl, sourceReference: "p. 1", personId: "pa2", matchStatus: "suggested", reviewHistory: [], createdAtISO: now },
      { _id: "o2", societyId: A, occurrenceKey: "k2", recordTable: "minutes", recordId: "min1", personName: "Jordan Sample", context: "Attendance (Present)", observedDate: "2019-03-01", meetingId: "m1", sourceUrl: source.sourceUrl, sourceReference: "p. 1", personId: "pa1", matchStatus: "verified", reviewHistory: [{ previous: { personId: "pa2", status: "suggested" }, status: "verified" }], createdAtISO: now },
    ],
    personHistoryEvents: [
      { _id: "e1", societyId: A, personId: "pa2", eventKey: "ev1", kind: "observation", title: "Attended", scope: "Meeting", effectiveDate: "2019-03-01", transition: "observed", reviewStatus: "pending", sourceOccurrenceId: "o1", sourceUrl: source.sourceUrl, sourceReference: "p. 1", createdAtISO: now, createdByUserId: "u" },
      // Left behind by an earlier re-link (o2 now belongs to pa1).
      { _id: "e2", societyId: A, personId: "pa2", eventKey: "ev2", kind: "note", title: "Lost note", scope: "Meeting", effectiveDate: "2019-03-01", transition: "observed", reviewStatus: "pending", sourceOccurrenceId: "o2", sourceUrl: source.sourceUrl, sourceReference: "p. 1", createdAtISO: now, createdByUserId: "u" },
    ],
    personContactPoints: [{ _id: "cp1", societyId: A, personId: "pa2", pointKey: "cp1", kind: "email", value: "jordon@example.invalid", observedDate: "2019", reviewStatus: "pending", sourceOccurrenceId: "o1", sourceUrl: source.sourceUrl, sourceReference: "p. 1", createdAtISO: now }],
    meetingAttendanceRecords: [{ _id: "ar1", societyId: A, minutesId: "min1", meetingId: "m1", meetingTitle: "Fictional finance meeting", meetingDate: "2019-03-01", personName: "Jordon Sample", attendanceStatus: "Present", confidence: "Review", directoryPersonId: "pa2", createdAtISO: now }],
    motions: [{ _id: "mo1", societyId: A, meetingId: "m1", text: "Approve the plan", movedByPersonId: "pa2", outcome: "Carried", createdAtISO: now }],
    committeeMembers: [{ _id: "cm1", societyId: A, committeeId: "c1", name: "Jordon Sample", role: "Member", personId: "pa2", joinedAt: "2019" }],
    tasks: [
      { _id: "t1", societyId: A, title: "Review historical action: Taylor to draft the plan", status: "Todo", priority: "Medium", tags: ["historical-source-action"], meetingId: "m1", actionRegisterKey: "Register", externalActionId: "x1", sourceObservations: [{ id: "x1", observedDate: "2019-03-01" }], responsibleUserIds: [`${A}_owner`], createdAtISO: now },
      { _id: "t2", societyId: A, title: "Review historical action: Taylor to draft the plan.", status: "Todo", priority: "Medium", tags: ["historical-source-action"], meetingId: "m2", actionRegisterKey: "Register", externalActionId: "x2", sourceObservations: [{ id: "x2", observedDate: "2019-04-01" }], createdAtISO: now },
      { _id: "t3", societyId: A, title: "Review historical action: Riley to book the hall", status: "Todo", priority: "Medium", tags: ["historical-source-action"], meetingId: "m1", actionRegisterKey: "Register", externalActionId: "x3", sourceObservations: [{ id: "x3", observedDate: "2019-03-01" }], createdAtISO: now },
      { _id: "t4", societyId: A, title: "File the annual report", status: "Todo", priority: "High", tags: [], assigneePersonId: "pa2", createdAtISO: now },
    ],
    organizationSeats: [
      { _id: "s1", societyId: A, seatKey: "Fictional Health Org / Finance Committee", organizationName: "Fictional Health Org", observations: [{ id: "so1", kind: "contact", personName: "Jordan Sample", roleTitle: "Member", observedDate: "2022", reviewStatus: "pending", sourceUrl: source.sourceUrl, sourceReference: "Roster!A2" }, { id: "so1b", kind: "contact", personName: "Jordan Sample", roleTitle: "Member", observedDate: "2025-03", reviewStatus: "pending", sourceUrl: source.sourceUrl, sourceReference: "Roster!A9" }], createdAtISO: now },
      { _id: "s2", societyId: A, seatKey: "Fictional Health Org / Board", organizationName: "Fictional Health Org", observations: [{ id: "so2", kind: "contact", personName: "Riley Boardmember", roleTitle: "Director", observedDate: "2025-03", reviewStatus: "pending", sourceUrl: source.sourceUrl, sourceReference: "Board!A2" }], createdAtISO: now },
    ],
  };
  const db = engine === "memory" ? new MemoryDb({ seed }) : new LocalStoreDb(new MemoryRowStore(seed));
  const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll(PORTABLE_FUNCTIONS);
  const mutate = (n: string, args: any) => runtime.runMutation(n, args);
  const query = (n: string, args: any) => runtime.runQuery(n, args);
  const row = async (table: string, id: string) => (await db.query(table).collect()).find((r: any) => r._id === id) as any;

  // P12: directory scoping in the trusted local runtime.
  const list = await query("peopleDirectory:list", { societyId: A }) as any[];
  assert.ok(list.some((p) => p._id === "pu1"), `${engine}: unowned legacy contacts stay reusable locally`);
  assert.ok(!list.some((p) => p._id === "pb1"), `${engine}: another workspace's person never appears`);
  assert.ok(!JSON.stringify(await query("peopleDirectory:searchByPrefix", { societyId: A, prefix: "Foreign" })).includes("pb1"));
  assert.equal((await query("peopleDirectory:searchByPrefix", { societyId: A, prefix: "Sample" }) as any[]).length, 2, `${engine}: surname search`);
  const foreignProfile: any = await query("personHistory:profile", { societyId: A, personId: "pb1" }).catch((e: Error) => ({ notFound: /not found/i.test(e.message) }));
  assert.equal(foreignProfile.notFound, true, `${engine}: a foreign profile is not found`);
  assert.ok(!JSON.stringify(await query("personHistory:duplicateSuggestions", { societyId: A })).includes("pb1"));
  await assert.rejects(() => mutate("personHistory:mergePeople", { societyId: A, survivorId: "pa1", mergedIds: ["pb1"], rationale: "x" }));

  // P8: repair history left behind by an earlier re-link.
  const dry: any = await mutate("personHistory:repairOrphanedEvents", { societyId: A, dryRun: true });
  assert.equal(dry.count, 1);
  assert.equal((await row("personHistoryEvents", "e2")).personId, "pa2", `${engine}: dry run changes nothing`);
  await mutate("personHistory:repairOrphanedEvents", { societyId: A });
  assert.equal((await row("personHistoryEvents", "e2")).personId, "pa1", `${engine}: the lost event follows its occurrence`);
  assert.equal(((await mutate("personHistory:repairOrphanedEvents", { societyId: A, dryRun: true })) as any).count, 0, "repair is idempotent");

  // P7: duplicate suggestion, merge and undo.
  const suggestions = await query("personHistory:duplicateSuggestions", { societyId: A }) as any[];
  assert.ok(suggestions.some((s) => s.ids.includes("pa1") && s.ids.includes("pa2")), `${engine}: the spelling variant is suggested`);
  const merged: any = await mutate("personHistory:mergePeople", { societyId: A, survivorId: "pa1", mergedIds: ["pa2"], rationale: "Same person, spelling variant" });
  assert.ok(merged.merges[0].moved >= 9, `${engine}: every reference moved (${merged.merges[0].moved})`);
  assert.equal((await row("personOccurrences", "o1")).personId, "pa1");
  assert.equal((await row("personHistoryEvents", "e1")).personId, "pa1");
  assert.equal((await row("personContactPoints", "cp1")).personId, "pa1");
  assert.equal((await row("meetingAttendanceRecords", "ar1")).directoryPersonId, "pa1");
  assert.equal((await row("motions", "mo1")).movedByPersonId, "pa1");
  assert.equal((await row("tasks", "t4")).assigneePersonId, "pa1");
  assert.equal((await row("committeeMembers", "cm1")).personId, "pa1");
  assert.equal((await row("minutes", "min1")).detailedAttendance[0].personId, "pa1");
  assert.equal((await row("minutes", "min1")).actionItems[0].assigneePersonId, "pa1");
  assert.equal((await row("peopleDirectory", "pa2")).mergedIntoId, "pa1", "the duplicate stays as a tombstone");
  assert.ok((await row("peopleDirectory", "pa1")).aliases.includes("Jordon Sample"), "the merged name becomes an alias");
  assert.ok(!(await query("peopleDirectory:list", { societyId: A }) as any[]).some((p) => p._id === "pa2"), "merged profiles leave the directory");
  assert.equal(((await query("personHistory:profile", { societyId: A, personId: "pa2" })) as any).mergedInto._id, "pa1");
  await assert.rejects(() => mutate("personHistory:reviewMatch", { societyId: A, occurrenceId: "o1", personId: "pa2", status: "verified", rationale: "x", source }), /merged/);
  const history = await query("personHistory:mergeHistory", { societyId: A }) as any[];
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "applied");
  const undo: any = await mutate("personHistory:unmergePeople", { societyId: A, mergeId: history[0]._id });
  assert.equal(undo.skipped, 0);
  assert.equal((await row("motions", "mo1")).movedByPersonId, "pa2", `${engine}: undo restores every moved reference`);
  assert.equal((await row("minutes", "min1")).detailedAttendance[0].personId, "pa2");
  assert.equal((await row("peopleDirectory", "pa2")).mergedIntoId, undefined);
  assert.ok(!(await row("peopleDirectory", "pa1")).aliases.includes("Jordon Sample"), "undo removes the alias it added");
  await assert.rejects(() => mutate("personHistory:unmergePeople", { societyId: A, mergeId: history[0]._id }), /already undone/);

  // P8: re-linking an occurrence moves its history and contact details.
  await mutate("personHistory:reviewMatch", { societyId: A, occurrenceId: "o1", personId: "pa1", status: "verified", rationale: "Same person per source", source });
  assert.equal((await row("personHistoryEvents", "e1")).personId, "pa1", `${engine}: re-link moves the event`);
  assert.equal((await row("personContactPoints", "cp1")).personId, "pa1", `${engine}: re-link moves the contact point`);
  const profile: any = await query("personHistory:profile", { societyId: A, personId: "pa1" });
  assert.ok(profile.events.some((e: any) => e._id === "e1"), "the moved event is visible on the new profile");

  // P10: split a fragment.
  const ids = await mutate("personHistory:splitOccurrence", { societyId: A, occurrenceId: "o2", rationale: "Two names run together", parts: [{ personName: "Jordan Sample", personId: "pa1" }, { personName: "New Fictional Person" }] }) as string[];
  assert.equal(ids.length, 2);
  assert.equal((await row("personOccurrences", "o2")).matchStatus, "not_person");
  await mutate("personHistory:createPersonFromOccurrence", { societyId: A, occurrenceId: ids[1], fullName: "New Fictional Person", rationale: "Named in the source" });
  assert.ok((await query("peopleDirectory:list", { societyId: A }) as any[]).some((p) => p.fullName === "New Fictional Person"));

  // A2/B1/B2: organization member, representative change, correction.
  const memberId = await mutate("memberGovernance:saveOrganizationMember", { societyId: A, organizationName: "Fictional Health Org", membershipClass: "Organization", status: "Active", joinedAt: "2015", votingRights: true, linkSeatIds: ["s1"] });
  await assert.rejects(() => mutate("memberGovernance:saveOrganizationMember", { societyId: A, organizationName: "fictional health org", membershipClass: "Organization", status: "Active", joinedAt: "2015", votingRights: true }), /already/);
  await assert.rejects(() => mutate("memberGovernance:saveOrganizationMember", { societyId: A, organizationName: " ? ", membershipClass: "Organization", status: "Active", joinedAt: "2015", votingRights: true }), /placeholder/, "a roster placeholder is not an organization name");
  const orgs: any = await query("memberGovernance:organizationMembers", { societyId: A });
  const org = orgs.organizations.find((g: any) => g.member?._id === memberId);
  assert.equal(org.seats.length, 2, "unlinked seats with the same organization name group under the member");
  assert.deepEqual(org.seats.find((s: any) => s._id === "s1").current.map((c: any) => c.id), ["so1b"], "only the latest roster observation is current");
  await mutate("memberGovernance:recordRepresentative", { seatId: "s1", personId: "pa2", termStart: "2021-09", endPreviousObservationId: "so1b", source });
  const seat: any = await query("memberGovernance:seatDetail", { seatId: "s1" });
  assert.equal(seat.observations.find((o: any) => o.id === "so1b").supersededById !== undefined, true, "the previous term is superseded, not rewritten");
  assert.ok(seat.observations.some((o: any) => o.supersedes === "so1b" && o.termEnd === "2021-09"), "the earlier representative's term ends");
  assert.deepEqual(seat.current.map((c: any) => c.personId), ["pa2"]);
  await assert.rejects(() => mutate("memberGovernance:recordRepresentative", { seatId: "s1", personId: "pb1", source }), /not found/i);
  await assert.rejects(() => mutate("memberGovernance:recordRepresentative", { seatId: "s1", personName: "X", termStart: "2022", termEnd: "2021", source }), /ends before/);
  const repId = seat.current[0].id;
  await mutate("memberGovernance:supersedeSeatObservation", { seatId: "s1", observationId: repId, changes: { roleTitle: "Alternate" }, rationale: "Source says alternate" });
  await assert.rejects(() => mutate("memberGovernance:supersedeSeatObservation", { seatId: "s1", observationId: repId, changes: { roleTitle: "X" }, rationale: "again" }), /already corrected/);
  assert.equal(((await query("memberGovernance:seatDetail", { seatId: "s1" })) as any).current[0].roleTitle, "Alternate");

  // P2–P5: historical source actions.
  const counts0: any = await query("dashboard:navCounts", { societyId: A });
  assert.equal(counts0.openTasks, 1, `${engine}: historical actions are not open tasks`);
  const preview: any = await mutate("tasks:consolidateHistoricalActions", { societyId: A, dryRun: true });
  assert.equal(preview.folded, 1);
  assert.equal((await db.query("tasks").collect()).length, 4, "dry run changes nothing");
  await mutate("tasks:consolidateHistoricalActions", { societyId: A, dryRun: false });
  const tasks = await db.query("tasks").collect() as any[];
  assert.equal(tasks.length, 3, "the carried-forward duplicate is folded");
  const kept = tasks.find((t) => t._id === "t1");
  assert.deepEqual(kept.sourceObservations.map((o: any) => o.id), ["x1", "x2"], "observations from both copies are kept");
  assert.deepEqual(kept.mergedExternalActionIds, ["x2"]);
  assert.equal(kept.status, "Unknown");
  assert.deepEqual(kept.responsibleUserIds, []);
  assert.equal(kept.sourceAssignee, "Taylor");
  assert.equal(kept.committeeId, "c1", "the source meeting's committee is linked");
  await mutate("tasks:observeAction", { societyId: A, registerKey: "Register", externalActionId: "x2", title: "Taylor to draft the plan", observation: { id: "x2b", observedDate: "2019-05-01", reviewStatus: "pending", sourceUrl: source.sourceUrl, sourceReference: "p. 2" } });
  assert.equal((await db.query("tasks").collect()).length, 3, "a folded external id still resolves to the kept task");
  await mutate("tasks:promoteHistoricalAction", { id: "t3", title: "Riley to book the hall" });
  const promoted = await row("tasks", "t3");
  assert.equal(promoted.status, "Todo");
  assert.ok(!promoted.tags.includes("historical-source-action") && promoted.tags.includes("promoted-from-source-action"));
  assert.equal(((await query("dashboard:navCounts", { societyId: A })) as any).openTasks, 2);
  await assert.rejects(() => mutate("tasks:create", { societyId: A, title: "Bad", status: "Open", priority: "Low", tags: [] }), /Unknown task status/);
  await assert.rejects(() => mutate("tasks:create", { societyId: A, title: "Wrong agenda", status: "Todo", priority: "Low", tags: [], meetingId: "m1", agendaItemId: "ai2" }), /different meeting/);
  assert.ok(await mutate("tasks:create", { societyId: A, title: "Follow-up", status: "Todo", priority: "Low", tags: [], meetingId: "m2", agendaItemId: "ai2" }));

  // P15/P16/B10/P14: rosters, directors, committee members, add to society.
  const rosterPreview: any = await mutate("committees:buildRostersFromSeats", { societyId: A, dryRun: true });
  assert.equal(rosterPreview.committees.find((c: any) => c.committeeId === "c1")?.newMembers, 1, "one roster row per person, not per observation");
  await mutate("committees:buildRostersFromSeats", { societyId: A, dryRun: false });
  const roster = (await db.query("committeeMembers").collect() as any[]).filter((m) => m.committeeId === "c1");
  assert.ok(roster.some((m) => m.reviewStatus === "pending" && m.sourceSeatId === "s1"), `${engine}: roster member is pending with its source`);
  assert.equal(((await mutate("committees:buildRostersFromSeats", { societyId: A, dryRun: true })) as any).newMembers, 0, "roster build is idempotent");
  const pending = roster.find((m) => m.reviewStatus === "pending");
  await mutate("committees:updateMember", { id: pending._id, patch: { personId: "pa1", leftAt: "2025-12", reviewStatus: "verified" } });
  await assert.rejects(() => mutate("committees:updateMember", { id: pending._id, patch: { leftAt: "1999" } }), /leave before joining/);
  await assert.rejects(() => mutate("committees:updateMember", { id: pending._id, patch: { personId: "pb1" } }), /not found/i);
  const suggestionsBoard = await query("directors:rosterSuggestions", { societyId: A }) as any[];
  assert.deepEqual(suggestionsBoard.map((r) => r.personName), ["Riley Boardmember"]);
  await mutate("directors:promoteRosterObservation", { seatId: "s2", observationId: "so2" });
  const director = (await db.query("directors").collect() as any[]).find((d) => d.lastName === "Boardmember");
  assert.equal(director.status, "NeedsReview", "a roster observation never becomes an active director by itself");
  await assert.rejects(() => mutate("directors:promoteRosterObservation", { seatId: "s2", observationId: "so2" }), /already/);
  await mutate("peopleDirectory:addToSociety", { societyId: A, directoryPersonId: "pa1", roleType: "director", startDate: "2024-06-01", sourceReference: "AGM 2024 minutes", nowISO: now });
  assert.ok((await db.query("directors").collect() as any[]).some((d) => d.directoryPersonId === "pa1" && d.status === "Active" && d.termStart === "2024-06-01"), "add as director enters the director register");
  await assert.rejects(() => mutate("peopleDirectory:addToSociety", { societyId: A, directoryPersonId: "pa1", roleType: "director", startDate: "2024-06-01", nowISO: now }), /already a current director/);
  await assert.rejects(() => mutate("peopleDirectory:addToSociety", { societyId: A, directoryPersonId: "pa2", roleType: "director", nowISO: now }), /term start/);
}
console.log("OK people identity: fuzzy duplicates, merge/undo, re-link and lost-history repair, directory scoping, fragment split, organization members and representative terms, historical source actions, rosters and director promotion");
