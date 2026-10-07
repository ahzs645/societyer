/** Site-only upgrade for an existing browser test; never replace its edits. */
const revision = "agenda-person-test-v2";
const marker = "pgair-preview-upgrade:" + revision;
const allowedPatchFields: Record<string, string[]> = {
  meetings: ["status", "scheduledAt", "title", "type", "committeeId", "sourceReviewNotes"],
  minutes: ["heldAt", "sourceReviewNotes"],
  motions: ["sectionIndex", "sectionTitle", "status", "notes", "history"],
  personOccurrences: ["observedDate", "notes"],
  personHistoryEvents: ["effectiveDate", "details"],
  meetingAttendanceRecords: ["meetingDate", "notes"],
};
function same(a: any, b: any): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (typeof a === "object" || typeof b === "object") return typeof a === "object" && typeof b === "object" && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => same(a[k], b[k]));
  return a === b;
}
const recordedSection = (section: any) => section.discussion?.trim() || section.motionText?.trim() || section.motionId || section.decisions?.length || section.actionItems?.length || section.linkedTaskIds?.length || section.reportSubmitted;

export async function upgradeTestWorkspace(client: any, updateStatus: (s: string) => void) {
  if (localStorage.getItem(marker) === "complete") return;
  updateStatus("Adding source notes under agenda items and connecting test person links…");
  const response = await fetch("/test-data/upgrade-v2.json", { cache: "no-store" });
  if (!response.ok) throw new Error("The test workspace update could not be loaded. Please try again.");
  const upgrade = await response.json();
  if (upgrade.kind !== "pgair-interface-upgrade" || upgrade.revision !== revision || upgrade.testOnly !== true) throw new Error("The test update is not recognized.");
  const societyId = upgrade.societyId;
  const snapshot = await client.exportLocalWorkspaceSnapshot();
  const tables = snapshot.tables as Record<string, any[]>;
  const byTable = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, new Map(rows.map(row => [row._id, row]))]));
  const protectedMinutes = new Set<string>();
  for (const [id, baseline] of Object.entries(upgrade.minutesBaselines) as Array<[string, any]>) {
    const row = byTable.minutes?.get(id);
    if (!row || row.societyId !== societyId || row.approvedAt || row.adoptedSnapshot || Array.isArray(row.motionSnapshots) ||
        row.sections?.some(recordedSection) || !same(row.discussion, baseline.discussion) || !same(row.sourceReviewStatus, baseline.sourceReviewStatus)) protectedMinutes.add(id);
  }
  const protectedMeetings = new Set([...protectedMinutes].map(id => byTable.minutes?.get(id)?.meetingId).filter(Boolean));
  let corrections = 0;
  // These bounded, baseline-checked fixture corrections run before transposition.
  // The normal backup validator preserves every other record and local edit.
  for (const correction of upgrade.recordPatches) {
    const allowed = allowedPatchFields[correction.table];
    if (!allowed || Object.keys(correction.patch).some(key => !allowed.includes(key))) throw new Error("An unsupported test correction was requested.");
    const row = byTable[correction.table]?.get(correction.id);
    if (!row || row.societyId !== societyId || protectedMinutes.has(row._id) || protectedMeetings.has(row._id) || protectedMeetings.has(row.meetingId) || protectedMinutes.has(row.minutesId)) continue;
    if (!Object.entries(correction.baseline).every(([key, value]) => same(row[key], value))) continue;
    Object.assign(row, correction.patch); corrections++;
  }
  if (corrections) await client.replaceLocalWorkspaceRecords(snapshot);
  const entries = upgrade.minutesEntries.filter((entry: any) => !protectedMinutes.has(entry.id));
  for (let index = 0; index < entries.length; index += 15) {
    updateStatus(`Organizing meeting source notes (${Math.min(index + 15, entries.length)} of ${entries.length})…`);
    await client.mutation("minutes:transposeSources", { societyId, entries: entries.slice(index, index + 15) });
  }
  const current = await client.query("personHistory:overview", { societyId });
  const people = current.people as any[];
  const personIds = new Map<string, string>();
  for (const contact of upgrade.contacts) {
    const existing = people.find(person => person.sourceKey === contact.sourceKey);
    const id = existing?._id ?? await client.mutation("personHistory:createContact", { societyId, fullName: contact.fullName, sourceKey: contact.sourceKey, notes: contact.rationale });
    personIds.set(contact.key, id);
  }
  const resolvePerson = (id: string | undefined) => id ? personIds.get(id) ?? id : undefined;
  const assignments = upgrade.assignments.map((assignment: any) => ({ ...assignment, ...(assignment.personId ? { personId: resolvePerson(assignment.personId) } : {}) }));
  for (let index = 0; index < assignments.length; index += 150) {
    updateStatus(`Connecting test person links (${Math.min(index + 150, assignments.length)} of ${assignments.length})…`);
    await client.mutation("personHistory:applyTestAssumptions", { societyId, testOnly: true, assignments: assignments.slice(index, index + 150) });
  }
  const mentions = upgrade.mentions.map((mention: any) => ({ ...mention, personId: resolvePerson(mention.personId) }));
  for (let index = 0; index < mentions.length; index += 150) {
    updateStatus(`Linking contextual meeting notes (${Math.min(index + 150, mentions.length)} of ${mentions.length})…`);
    await client.mutation("personHistory:stageTestMentions", { societyId, testOnly: true, mentions: mentions.slice(index, index + 150) });
  }
  localStorage.setItem(marker, "complete");
}
