/**
 * Deterministic SYNTHETIC large workspace for performance gates. No real data:
 * every name, title and paragraph is generated from a fixed word list and a
 * seeded PRNG. The shape mirrors what makes real transposed workspaces heavy:
 *
 *   - ~11k documents per unit of scale, most of them import candidates whose
 *     JSON `content` carries extracted text (tens of KB each), plus text-heavy
 *     library documents;
 *   - minutes whose `sourceMeetingRecord` / `sourceTransposition` keep large
 *     verbatim source copies;
 *   - thousands of person occurrences, source evidence rows and tasks.
 *
 * Output is a `societyer.localWorkspaceSnapshot`, the format Settings → Restore
 * accepts as a .json backup.
 *
 * CLI: node scripts/perf/synthetic-workspace.mjs [--scale 1] --out file.json
 */
import { writeFileSync } from "node:fs";

const WORDS = (
  "board motion minutes society member director treasurer report budget review " +
  "policy annual general meeting quorum resolution bylaw amendment committee finance " +
  "grant insurance audit filing deadline registry notice agenda item discussion vote " +
  "approved carried tabled deferred secretary chair volunteer program community " +
  "facility maintenance contract renewal statement balance revenue expense reserve"
).split(" ");

function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSyntheticWorkspace({ scale = 1, seed = 20261007 } = {}) {
  const random = prng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const words = (count) => {
    const out = new Array(count);
    for (let index = 0; index < count; index++) out[index] = pick(WORDS);
    return out.join(" ");
  };
  /** Paragraphs of roughly `chars` characters. */
  const text = (chars) => {
    const parts = [];
    let length = 0;
    while (length < chars) {
      const sentence = `${words(8 + Math.floor(random() * 14))}.`;
      parts.push(sentence[0].toUpperCase() + sentence.slice(1));
      length += sentence.length + 1;
      if (random() < 0.12) parts.push("\n\n");
    }
    return parts.join(" ");
  };
  const hex = (length) => Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");
  const n = (value) => Math.max(1, Math.round(value * scale));
  const iso = (dayOffset) => new Date(Date.UTC(2008, 0, 1) + dayOffset * 86_400_000).toISOString();
  let clock = Date.UTC(2026, 0, 1);
  const created = () => (clock += 997);

  const societyId = "societies_synthetic_scale";
  const tables = {
    societies: [{
      _id: societyId,
      _creationTime: created(),
      name: "Synthetic Scale Society",
      jurisdictionCode: "CA-BC",
      entityType: "society",
      status: "active",
      incorporationNumber: "S0000000",
      createdAtISO: iso(0),
      updatedAtISO: iso(0),
    }],
    users: [{
      _id: "users_synthetic_owner",
      _creationTime: created(),
      societyId,
      email: "owner@example.test",
      displayName: "Synthetic Owner",
      role: "Owner",
      status: "Active",
      createdAtISO: iso(0),
    }],
    meetings: [],
    minutes: [],
    documents: [],
    tasks: [],
    peopleDirectory: [],
    personOccurrences: [],
    sourceEvidence: [],
    members: [],
  };

  // People.
  for (let index = 0; index < n(160); index++) {
    const fullName = `Person ${String(index + 1).padStart(4, "0")} ${pick(["Example", "Sample", "Synthetic", "Placeholder"])}`;
    tables.peopleDirectory.push({
      _id: `peopleDirectory_syn_${index}`,
      _creationTime: created(),
      societyId,
      fullName,
      searchName: fullName.toLowerCase(),
      aliases: [],
      isIndividual: true,
      identityReviewStatus: "pending",
      createdAtISO: iso(index),
      updatedAtISO: iso(index),
    });
  }
  for (let index = 0; index < n(40); index++) {
    tables.members.push({
      _id: `members_syn_${index}`,
      _creationTime: created(),
      societyId,
      firstName: `Member${index + 1}`,
      lastName: "Synthetic",
      status: "Active",
      membershipClass: "Regular",
      votingRights: true,
      joinedAt: iso(index * 30).slice(0, 10),
      createdAtISO: iso(index * 30),
    });
  }

  // Import sessions and their candidates (JSON content with extracted text).
  const sessions = [];
  for (let index = 0; index < n(40); index++) {
    const _id = `documents_syn_session_${index}`;
    sessions.push(_id);
    tables.documents.push({
      _id,
      _creationTime: created(),
      societyId,
      title: `Synthetic import session ${index + 1}`,
      category: "Import Session",
      tags: ["import-session"],
      retentionYears: 10,
      createdAtISO: iso(4000 + index),
      content: JSON.stringify({ name: `Synthetic import session ${index + 1}`, createdAtISO: iso(4000 + index), sourceSystem: "local" }),
    });
  }
  for (let index = 0; index < n(6500); index++) {
    const sessionId = sessions[index % sessions.length];
    const title = `Candidate ${index + 1}: ${words(5)}`;
    tables.documents.push({
      _id: `documents_syn_candidate_${index}`,
      _creationTime: created(),
      societyId,
      title,
      category: "Import Candidate",
      tags: ["import-session", "import-session-record"],
      importSessionId: sessionId,
      retentionYears: 10,
      createdAtISO: iso(4000 + (index % 400)),
      content: JSON.stringify({
        sessionId,
        recordKind: pick(["documentCandidate", "meetingMinutes", "motion", "filing"]),
        status: pick(["Pending", "Pending", "Pending", "Approved", "Rejected"]),
        targetModule: pick(["documents", "meetings", "motions", "filings"]),
        title,
        confidence: pick(["High", "Medium", "Review"]),
        sourceExternalIds: [`local:synthetic/${index}`],
        payload: {
          fileName: `synthetic-${index}.pdf`,
          sha256: hex(64),
          sourceDate: iso(index % 5000).slice(0, 10),
          extractedText: text(4000 + Math.floor(random() * 22000)),
          notes: `Original folder path: Synthetic/${pick(WORDS)}/${pick(WORDS)}`,
        },
      }),
    });
  }

  // Library documents with long extracted text.
  for (let index = 0; index < n(3400); index++) {
    const category = pick(["Other", "Other", "Other", "Minutes", "Policy", "Insurance", "Bylaws", "FinancialStatement", "Recovered source review"]);
    tables.documents.push({
      _id: `documents_syn_library_${index}`,
      _creationTime: created(),
      societyId,
      title: `${category} ${index + 1}: ${words(4)}`,
      category,
      tags: [pick(["governance", "finance", "records", "history"])],
      fileName: `library-${index}.txt`,
      retentionYears: 10,
      createdAtISO: iso(index % 6000),
      content: random() < 0.3
        ? JSON.stringify({ externalId: `local:library/${index}`, sha256: hex(64), sourceDate: iso(index % 6000).slice(0, 10), extractedText: text(3000 + Math.floor(random() * 30000)) })
        : text(2000 + Math.floor(random() * 30000)),
    });
  }

  // Meetings with transposed minutes that keep large source copies.
  for (let index = 0; index < n(150); index++) {
    const meetingId = `meetings_syn_${index}`;
    const minutesId = `minutes_syn_${index}`;
    const sourceDocumentId = `documents_syn_library_${index % n(3400)}`;
    const heldAt = iso(index * 30 + 12);
    tables.meetings.push({
      _id: meetingId,
      _creationTime: created(),
      societyId,
      title: `${pick(["Board", "Committee", "Executive"])} meeting ${index + 1}`,
      type: pick(["Board", "Board", "Committee", "AGM"]),
      scheduledAt: heldAt,
      status: "Held",
      location: "Synthetic hall",
      attendeeIds: [],
      createdAtISO: heldAt,
    });
    const sections = Array.from({ length: 8 }, (_, section) => ({
      title: `Item ${section + 1}: ${words(3)}`,
      discussion: text(600),
      decisions: [],
      actionItems: [],
    }));
    tables.minutes.push({
      _id: minutesId,
      _creationTime: created(),
      societyId,
      meetingId,
      heldAt,
      attendees: [`Person 0001 Example`, `Person 0002 Sample`],
      absent: [],
      quorumMet: true,
      quorumStatus: "met",
      discussion: text(1500),
      decisions: [],
      actionItems: [],
      sections,
      sourceDocumentIds: [sourceDocumentId],
      sourceReviewStatus: "needs_review",
      sourceTransposition: {
        version: 1,
        reviewStatus: "draft",
        originalSources: [{ documentId: sourceDocumentId, label: "Source minutes" }],
        trace: Array.from({ length: 30 }, () => ({ excerpt: text(800) })),
      },
      sourceMeetingRecord: {
        documents: [{ documentId: sourceDocumentId, text: text(120_000 + Math.floor(random() * 160_000)) }],
      },
    });
  }

  // Occurrences, evidence and tasks.
  for (let index = 0; index < n(2600); index++) {
    const person = tables.peopleDirectory[index % tables.peopleDirectory.length];
    const meeting = tables.meetings[index % tables.meetings.length];
    tables.personOccurrences.push({
      _id: `personOccurrences_syn_${index}`,
      _creationTime: created(),
      societyId,
      personId: person._id,
      personName: person.fullName,
      recordTable: "meetings",
      recordId: meeting._id,
      roleTitle: pick(["Director", "Chair", "Secretary", "Guest"]),
      matchStatus: pick(["suggested", "verified", "assumed"]),
      sourceReference: `Synthetic minutes ${index % 150}`,
      observedDate: meeting.scheduledAt.slice(0, 10),
      occurrenceKey: `syn:${index}`,
      reviewHistory: [{ at: meeting.scheduledAt, note: words(20) }],
      notes: text(200),
    });
  }
  for (let index = 0; index < n(3600); index++) {
    tables.sourceEvidence.push({
      _id: `sourceEvidence_syn_${index}`,
      _creationTime: created(),
      societyId,
      sourceDocumentId: `documents_syn_library_${index % n(3400)}`,
      sourceTitle: `Library ${index % n(3400)}`,
      excerpt: text(900),
      summary: text(250),
      notes: text(300),
      externalId: `local:evidence/${index}`,
      ...(random() < 0.4 ? { targetTable: "meetings", targetId: `meetings_syn_${index % n(150)}` } : {}),
      createdAtISO: iso(index % 6000),
    });
  }
  for (let index = 0; index < n(360); index++) {
    tables.tasks.push({
      _id: `tasks_syn_${index}`,
      _creationTime: created(),
      societyId,
      title: `Task ${index + 1}: ${words(5)}`,
      description: text(250),
      status: pick(["Todo", "InProgress", "Done"]),
      priority: pick(["Low", "Medium", "High"]),
      tags: [pick(["governance", "finance"])],
      createdAtISO: iso(index * 3),
    });
  }

  return {
    kind: "societyer.localWorkspaceSnapshot",
    exportedAtISO: "2026-10-07T00:00:00.000Z",
    workspace: {
      id: "synthetic-scale-workspace",
      name: "Synthetic scale workspace",
      schemaVersion: 3,
      createdAtISO: "2026-10-07T00:00:00.000Z",
      updatedAtISO: "2026-10-07T00:00:00.000Z",
    },
    tables,
    attachments: [],
    changes: [],
  };
}

export function summarizeWorkspace(snapshot) {
  const tables = Object.entries(snapshot.tables).map(([name, rows]) => ({ name, rows: rows.length, bytes: JSON.stringify(rows).length }));
  return {
    rows: tables.reduce((sum, table) => sum + table.rows, 0),
    megabytes: Math.round(tables.reduce((sum, table) => sum + table.bytes, 0) / 1e6),
    tables: tables.sort((a, b) => b.bytes - a.bytes).slice(0, 6),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const scale = Number(args[args.indexOf("--scale") + 1] ?? 1) || 1;
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
  const snapshot = buildSyntheticWorkspace({ scale });
  console.log(JSON.stringify(summarizeWorkspace(snapshot)));
  if (out) writeFileSync(out, JSON.stringify(snapshot));
}
