/**
 * Deterministic SYNTHETIC intake run at archive scale, for the compaction,
 * backup and performance gates. No real data: names, titles and text come
 * from a word list and a seeded PRNG.
 *
 * At scale 1 the shape matches a fully reviewed real archive (every class
 * bulk-accepted through the review screen, then "Promote all ready"):
 *
 *   10,196 intake files · 1,052 clusters · 2,262 stored extracts (~31 KB)
 *   2,033 extractions (~18 KB records) · 1,926 reviewed · 1,048 promoted
 *   ~89,000 field reviews · ~46,000 provenance rows · 12,041 log entries
 *   1,048 promotion import sessions with their staged records
 *
 * `layout: "legacy"` writes what builds before compaction wrote (one review
 * row per bulk-accepted field with value and locator copies, provenance rows
 * with value and quote copies, every extract kept, staged session records
 * kept). `layout: "compacted"` writes the same run as "Compact this intake
 * run" leaves it: one batch review row per document, provenance by reference,
 * extracts only for open reviews, sessions without applied staged copies.
 *
 * Returns `{ tables }` to merge into a `societyer.localWorkspaceSnapshot`.
 */

const WORDS = (
  "board motion minutes society member director treasurer report budget review policy annual general meeting " +
  "quorum resolution bylaw amendment committee finance grant insurance audit filing deadline registry notice agenda " +
  "item discussion vote approved carried tabled deferred secretary chair volunteer program community facility " +
  "maintenance contract renewal statement balance revenue expense reserve monitoring station airshed particulate"
).split(" ");
const CLASSES = ["meetingMinutes", "meetingMinutes", "meetingMinutes", "agenda", "agenda", "invoice", "correspondence", "grant", "policy", "agreement", "budget", "financialStatement", "meetingPackage", "insurance"];

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

export function buildSyntheticIntakeTables({ scale = 1, seed = 4242, societyId = "societies_synthetic_scale", userId = "users_synthetic_owner", layout = "legacy" } = {}) {
  const random = prng(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const words = (count) => Array.from({ length: count }, () => pick(WORDS)).join(" ");
  const sentence = () => { const s = words(8 + Math.floor(random() * 10)); return `${s[0].toUpperCase()}${s.slice(1)}.`; };
  const hex = (length) => Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");
  const n = (value) => Math.max(1, Math.round(value * scale));
  const compacted = layout === "compacted";
  let clock = Date.UTC(2026, 5, 1);
  const created = () => (clock += 37);
  const at = (offset) => new Date(Date.UTC(2026, 5, 1) + offset * 1000).toISOString();
  const runId = "intakeRuns_syn_archive";
  const tables = { intakeRuns: [], intakeFiles: [], intakeClusters: [], intakeExtracts: [], intakeExtractions: [], intakeFieldReviews: [], fieldProvenance: [], intakeProcessingLog: [], documents: [], meetings: [] };

  // Files: every disposition, ~10k entries.
  const fileCount = n(10196);
  const extractCount = n(2262);
  const extractionCount = n(2033);
  for (let index = 0; index < fileCount; index++) {
    const docClass = index < extractionCount ? CLASSES[index % CLASSES.length] : pick(["image", "report", "unclassified", "presentation", "plan"]);
    const disposition = index < extractCount ? "extract" : pick(["catalogue", "junk", "duplicate", "catalogue", "junk"]);
    const name = `${docClass}-${String(index).padStart(5, "0")} ${words(3)}.${pick(["pdf", "docx", "xlsx", "doc"])}`;
    tables.intakeFiles.push({
      _id: `intakeFiles_syn_${index}`, _creationTime: created(), societyId, runId,
      fileKey: `google-drive:syn${hex(28)}${index}`, name, path: `Archive/${pick(WORDS)}/${pick(WORDS)}/${name}`,
      driveId: `syn${hex(30)}`, md5: hex(32), sha256: hex(64), mimeType: "application/pdf", sizeBytes: 20_000 + Math.floor(random() * 900_000),
      modifiedTime: at(index), url: `https://example.test/file/${index}`, acquisitionStatus: "downloaded", disposition,
      dispositionReason: disposition === "extract" ? undefined : `${words(6)} (catalogued)`, docClass,
      classification: { docClass, confidence: 0.8 + random() * 0.2, signals: [words(3), words(4)], bodyLabel: pick(["Board", "Operations Committee", "Executive"]), date: { iso: at(index).slice(0, 10), precision: "day" }, recordStatus: pick(["approved", "draft"]) },
      sensitivity: "standard", clusterKey: `cluster:${index % n(1052)}`, createdAtISO: at(0), updatedAtISO: at(0),
    });
  }
  for (let index = 0; index < n(1052); index++) {
    const members = [index, index + n(1052)].filter((member) => member < fileCount).map((member, position) => ({ fileKey: tables.intakeFiles[member].fileKey, fileId: tables.intakeFiles[member]._id, relation: position ? "format-copy" : "canonical", score: 0.97, reason: words(6) }));
    tables.intakeClusters.push({ _id: `intakeClusters_syn_${index}`, _creationTime: created(), societyId, runId, clusterKey: `cluster:${index}`, canonicalFileKey: members[0].fileKey, canonicalFileId: members[0].fileId, members, method: "content+name", createdAtISO: at(0) });
  }

  // Extractions with FieldValue records; quotes come from the extract text.
  const fieldValue = (value, quote, blockIndex) => { const long = `${quote} ${words(10)}`.slice(0, 160); return { value, status: "stated", confidence: 0.85 + random() * 0.14, locators: [{ kind: "block", fileId: undefined, blockIndex, page: 1 + Math.floor(blockIndex / 25), charStart: blockIndex * 120, charEnd: blockIndex * 120 + long.length, quote: long }] }; };
  const extractions = [];
  for (let index = 0; index < extractionCount; index++) {
    const file = tables.intakeFiles[index];
    const docClass = file.docClass;
    const date = at(index * 3600).slice(0, 10);
    const record = { date: fieldValue({ iso: date, precision: "day" }, `Date: ${date}`, 0), body: fieldValue("board", "Board of Directors", 1), bodyLabel: fieldValue("Board", "Board of Directors", 1), title: fieldValue(words(5), words(5), 2), location: fieldValue(words(3), words(3), 3) };
    const attendance = Array.from({ length: 8 + Math.floor(random() * 10) }, (_, item) => { const name = `Person ${String(1 + Math.floor(random() * 400)).padStart(4, "0")} Example`; return { nameAsWritten: fieldValue(name, name, 4 + item), category: fieldValue("present", `${name} present`, 4 + item) }; });
    const motions = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, item) => { const text = sentence(); return { text: fieldValue(text, text, 30 + item), movedBy: fieldValue({ nameAsWritten: "Person 0001 Example" }, "Moved by Person 0001 Example", 30 + item), secondedBy: fieldValue({ nameAsWritten: "Person 0002 Example" }, "Seconded Person 0002 Example", 30 + item), outcome: fieldValue("carried", "Carried", 30 + item) }; });
    const actionItems = Array.from({ length: 2 + Math.floor(random() * 8) }, (_, item) => { const text = sentence(); return { text: fieldValue(text, text, 40 + item), assignee: fieldValue({ nameAsWritten: "Person 0003 Example" }, "Person 0003 Example", 40 + item) }; });
    const sections = Array.from({ length: 4 + Math.floor(random() * 8) }, (_, item) => { const title = `${item + 1}. ${words(4)}`; return { title: fieldValue(title, title, 60 + item) }; });
    Object.assign(record, { attendance, motions, actionItems, sections });
    const reviewed = index < n(1926);
    const promoted = index < n(1048);
    const row = {
      _id: `intakeExtractions_syn_${index}`, _creationTime: created(), societyId, runId, fileId: file._id, fileKey: file.fileKey, docClass, schemaVersion: `${docClass}@1`, engine: "deterministic",
      record, unsupported: random() < 0.3 ? [{ description: words(10), locators: [], suggestedTarget: "meetings.goal", category: "no_field", infoType: "meeting.goal" }] : [], references: [], warnings: [],
      verification: { fields: 60, locators: 60, quoted: 60, verified: 60, fuzzy: 0, mismatched: 0, invalid: 0, mismatches: [] },
      status: promoted ? "promoted" : reviewed ? "in_review" : "pending_review", createdAtISO: at(0), updatedAtISO: at(index),
    };
    if (promoted) row.promotion = { sessionId: `documents_syn_promo_session_${index}`, targets: [{ table: "meetings", id: `meetings_syn_promo_${index}`, label: "Board meeting" }], atISO: at(index + 9000) };
    tables.intakeExtractions.push(row);
    extractions.push({ row, reviewed, promoted });
  }

  // Extracts: blocks plus text for the review viewer (~31 KB each).
  const extractText = new Map();
  for (let index = 0; index < extractCount; index++) {
    const file = tables.intakeFiles[index];
    const blocks = Array.from({ length: 70 }, (_, block) => ({ index: block, kind: block % 9 === 0 ? "heading" : "paragraph", text: Array.from({ length: 2 }, sentence).join(" "), charStart: block * 120, charEnd: block * 120 + 119, page: 1 + Math.floor(block / 25) }));
    const text = blocks.map((block) => block.text).join("\n");
    extractText.set(file._id, text);
    const open = index >= n(1048);
    if (compacted && !open) continue;
    tables.intakeExtracts.push({ _id: `intakeExtracts_syn_${index}`, _creationTime: created(), societyId, runId, fileId: file._id, method: "pdfjs-text", methodVersion: "pdfjs@4", blocks, text, textLength: text.length, pageCount: 3, warnings: [], createdAtISO: at(0) });
  }

  // Reviews and provenance.
  const note = "Bulk accepted (stated, span-verified, at or above the threshold).";
  const encode = (paths) => {
    const plain = [], groups = new Map();
    for (const path of paths) {
      const match = /^([^[\]]*)\[(\d+)\](.*)$/.exec(path);
      if (!match) { plain.push(path); continue; }
      const key = `${match[1]}\u0000${match[3]}`;
      const group = groups.get(key) ?? { prefix: match[1], suffix: match[3], indices: [] };
      group.indices.push(Number(match[2]));
      groups.set(key, group);
    }
    for (const { prefix, suffix, indices } of groups.values()) {
      indices.sort((a, b) => a - b);
      const parts = [];
      for (let start = 0; start < indices.length;) { let end = start; while (end + 1 < indices.length && indices[end + 1] === indices[end] + 1) end++; parts.push(end > start ? `${indices[start]}-${indices[end]}` : String(indices[start])); start = end + 1; }
      plain.push(`${prefix}[${parts.join(",")}]${suffix}`);
    }
    return plain;
  };
  let reviewIndex = 0, provenanceIndex = 0;
  for (const { row, reviewed, promoted } of extractions) {
    if (!reviewed) continue;
    const fields = [];
    const visit = (node, path) => {
      if (Array.isArray(node)) return node.forEach((item, index) => visit(item, `${path}[${index}]`));
      if (!node || typeof node !== "object") return;
      if ("status" in node && Array.isArray(node.locators)) { fields.push({ path, field: node }); return; }
      for (const [key, child] of Object.entries(node)) visit(child, path ? `${path}.${key}` : key);
    };
    visit(row.record, "");
    const accepted = fields.slice(0, Math.max(2, Math.round(fields.length * 0.82)));
    const reviewedAtISO = at(50_000 + reviewIndex);
    if (compacted) {
      tables.intakeFieldReviews.push({ _id: `intakeFieldReviews_syn_${reviewIndex++}`, _creationTime: created(), societyId, runId, extractionId: row._id, fieldPath: "@batch", fieldPaths: encode(accepted.map((item) => item.path)), decision: "accept", note, reviewerUserId: userId, reviewedAtISO });
    } else {
      for (const { path, field } of accepted) {
        tables.intakeFieldReviews.push({ _id: `intakeFieldReviews_syn_${reviewIndex++}`, _creationTime: created(), societyId, runId, extractionId: row._id, fieldPath: path, decision: "accept", originalValue: field.value, locators: field.locators.map(({ fileId, ...locator }) => ({ fileId: row.fileKey, ...locator })), note, reviewerUserId: userId, reviewedAtISO });
      }
    }
    if (!promoted) continue;
    for (const { path, field } of accepted) {
      const locator = field.locators[0];
      const base = { _id: `fieldProvenance_syn_${provenanceIndex++}`, _creationTime: created(), societyId, targetTable: path.startsWith("motions") ? "motions" : path.startsWith("date") || path.startsWith("location") ? "meetings" : "minutes", targetId: `minutes_syn_promo_${row._id}`, fieldPath: path.replace("attendance", "detailedAttendance"), sourceFieldPath: path, runId, extractionId: row._id, fileKey: row.fileKey, decision: "accept", createdAtISO: at(90_000) };
      tables.fieldProvenance.push(compacted
        ? { ...base, locator: { kind: locator.kind } }
        : { ...base, locator: { fileId: row.fileKey, kind: locator.kind, blockIndex: locator.blockIndex, page: locator.page, charStart: locator.charStart, charEnd: locator.charEnd, quote: locator.quote }, value: field.value });
    }
    // The promotion's import session (an audit trail), its staged records, and the source document created.
    const sessionId = row.promotion.sessionId;
    const documentId = `documents_syn_promo_source_${row._id}`;
    const text = (extractText.get(row.fileId) ?? "").slice(0, 20_000);
    const compactedRecords = compacted ? { atISO: at(99_000), removed: 2, summary: { total: 2, byKind: { documentCandidate: 1, meetingMinutes: 1 }, byStatus: { Approved: 2 }, byTarget: { documents: 1, meetings: 1 }, riskCount: 0, orgHistoryApplied: 0, meetingsApplied: 1, documentsApplied: 1, sectionsApplied: 0 }, targets: [{ recordKind: "documentCandidate", importedTargets: { documents: documentId } }, { recordKind: "meetingMinutes", importedTargets: { meetings: { meetingId: `meetings_syn_promo_${row._id}` } } }] } : undefined;
    tables.documents.push({ _id: sessionId, _creationTime: created(), societyId, title: `Intake: ${row.fileKey}`, category: "Import Session", content: JSON.stringify({ kind: "importSession", name: `Intake: ${row.fileKey}`, sourceSystem: "google-drive", bundleMetadata: { name: "Intake promotion" }, createdAtISO: at(90_000), updatedAtISO: at(90_000), status: "Reviewing", summary: { total: 2, byKind: { documentCandidate: 1, meetingMinutes: 1 }, byStatus: { Approved: 2 }, byTarget: {}, riskCount: 0, orgHistoryApplied: 0, meetingsApplied: 1, documentsApplied: 1, sectionsApplied: 0, approvedUnapplied: 0 }, ...(compactedRecords ? { compactedRecords } : {}) }), createdAtISO: at(90_000), flaggedForDeletion: false, tags: ["import-session", "google-drive"] });
    if (!compacted) {
      tables.documents.push({ _id: `documents_syn_promo_record_doc_${row._id}`, _creationTime: created(), societyId, title: row.fileKey, category: "Import Candidate", importSessionId: sessionId, importRecordKind: "documentCandidate", content: JSON.stringify({ recordKind: "documentCandidate", targetModule: "documents", title: row.fileKey, sessionId, kind: "importRecord", status: "Approved", reviewNotes: "", importedTargets: { documents: documentId }, sourceExternalIds: [row.fileKey], payload: { externalId: row.fileKey, title: row.fileKey, extractedText: text, sha256: hex(64) }, createdAtISO: at(90_000), updatedAtISO: at(90_000) }), createdAtISO: at(90_000), flaggedForDeletion: false, tags: ["import-session", "import-session-record", "documentcandidate"] });
      tables.documents.push({ _id: `documents_syn_promo_record_min_${row._id}`, _creationTime: created(), societyId, title: "Board meeting", category: "Import Candidate", importSessionId: sessionId, importRecordKind: "meetingMinutes", content: JSON.stringify({ recordKind: "meetingMinutes", targetModule: "meetings", title: "Board meeting", sessionId, kind: "importRecord", status: "Approved", reviewNotes: "", importedTargets: { meetings: { meetingId: `meetings_syn_promo_${row._id}` } }, sourceExternalIds: [row.fileKey], payload: { meetingTitle: "Board meeting", meetingDate: row.record.date.value.iso, attendees: row.record.attendance.map((entry) => entry.nameAsWritten.value), discussion: Array.from({ length: 12 }, sentence).join(" "), sourceExternalIds: [row.fileKey] }, createdAtISO: at(90_000), updatedAtISO: at(90_000) }), createdAtISO: at(90_000), flaggedForDeletion: false, tags: ["import-session", "import-session-record", "meetingminutes"] });
    }
    tables.documents.push({ _id: documentId, _creationTime: created(), societyId, title: row.fileKey, category: "Minutes", content: JSON.stringify({ importedFrom: "Google Drive import session", importSessionId: sessionId, externalId: row.fileKey, sourceExternalIds: [row.fileKey], extractedText: text }), createdAtISO: at(90_000), reviewStatus: "transposed", flaggedForDeletion: false, tags: ["google-drive-import", "import-candidate", row.fileKey] });
  }
  for (let index = 0; index < n(12041); index++) {
    const file = tables.intakeFiles[index % fileCount];
    tables.intakeProcessingLog.push({ _id: `intakeProcessingLog_syn_${index}`, _creationTime: created(), societyId, runId, atISO: at(index), fileKey: file.fileKey, stage: pick(["extract", "classify", "fields", "verify", "junk"]), sentToProvider: false, inputChars: Math.floor(random() * 90_000), note: `${words(12)} ${file.name}` });
  }
  tables.intakeRuns.push({
    _id: runId, _creationTime: created(), societyId, name: "Synthetic archive run", sourceKind: "drive_inventory", sourceRoot: "Synthetic archive", status: "reviewing",
    engine: { minutes: "deterministic" }, stats: { files: fileCount, extractions: extractionCount, clusters: n(1052) },
    coverage: { headline: { files: fileCount, extracted: extractionCount, transposed: n(1609), nativeFacts: n(114602), gapFacts: n(1385), unresolvedFacts: n(5124), coverage: 0.946 } },
    recordGaps: Array.from({ length: n(260) }, (_, index) => ({ kind: "meeting_without_minutes", date: at(index * 3600).slice(0, 10), detail: words(16) })),
    reconciliation: { meetings: Array.from({ length: n(294) }, (_, index) => ({ meetingKey: `m${index}`, date: at(index * 3600).slice(0, 10), body: "board", canonicalFileId: tables.intakeFiles[index].fileKey, files: [{ fileId: tables.intakeFiles[index].fileKey, recordStatus: "approved" }] })), links: [], actionChains: [] },
    createdByUserId: userId, createdAtISO: at(0), updatedAtISO: at(0),
    ...(compacted ? { compaction: { atISO: at(99_000), reviewRowsFolded: 0, reviewBatchRows: 0, provenanceSlimmed: 0, sessionRecordsRemoved: 0, extractsRemoved: 0, bytesFreed: 0 } } : {}),
  });
  if (!tables.meetings.length) delete tables.meetings;
  return { tables };
}

/** Rows and serialized bytes per table, largest first. */
export function measureTables(tables) {
  const rows = Object.entries(tables).map(([name, list]) => ({ name, rows: list.length, bytes: list.reduce((sum, row) => sum + JSON.stringify(row).length, 0) }));
  return { rows: rows.reduce((sum, table) => sum + table.rows, 0), bytes: rows.reduce((sum, table) => sum + table.bytes, 0), tables: rows.sort((a, b) => b.bytes - a.bytes) };
}
