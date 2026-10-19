/**
 * Minutes and transcript privacy rules, shared by every read path.
 *
 * Who may see in-camera content: holders of `minutes:write` (Owner, Admin,
 * Director). They are the people who sit in an in-camera session or keep its
 * record. Members and Viewers (read-only observers such as an auditor) see a
 * placeholder instead, so they know something was withheld. No AI connector
 * scope grants it (decision A5); `minutes:in-camera` is reserved for that.
 *
 * Who may read a working transcript: the people who keep the minutes, i.e.
 * whose role holds `minutes:write` (decision A1). A transcript is unedited
 * evidence; Members and Viewers read the minutes instead. A scoped service
 * principal (an AI connector token) acting for such a person also needs the
 * `minutes:read` scope, and never gets in-camera access, so it reads the
 * transcript with in-camera segments cut out (decision A2) or not at all.
 *
 * Redaction happens when a record is read. Stored rows, approved snapshots and
 * adoption history are never changed. Everything here is pure.
 */
import { normalizeDocumentCategory } from "./documentCategories";
import type { Permission } from "./functions/permissions";
import { speakerResolver, type TranscriptSpeaker } from "./transcriptModel";

export const IN_CAMERA_ACCESS_PERMISSION: Permission = "minutes:write";
/** The role permission a working-transcript reader needs (decision A1). */
export const TRANSCRIPT_READ_PERMISSION: Permission = "minutes:write";
/** What a scoped service principal must also hold to read a transcript. Never grants in-camera access. */
export const TRANSCRIPT_READ_SCOPE: Permission = "minutes:read";
/**
 * Reserved, not implemented: a future connector scope for in-camera reads
 * (off by default, Owner-only, audited). No code accepts it today.
 */
export const RESERVED_IN_CAMERA_SCOPE = "minutes:in-camera";

/*
 * What readers without in-camera access see, one name per kind of thing:
 * the session itself (a time range in the meeting) is an "In-camera session";
 * an agenda item inside it, and its minutes section, are an "In-camera item";
 * a motion is an "In-camera motion".
 */
export const IN_CAMERA_PLACEHOLDER = "In-camera session — not shown";
export const IN_CAMERA_TITLE = "In-camera session";
export const IN_CAMERA_MOTION_TITLE = "In-camera motion";
export const IN_CAMERA_OUTCOME = "Not shown";
/** An agenda item inside an in-camera session, and its minutes section (decision A3). */
export const IN_CAMERA_ITEM_TITLE = "In-camera item";
/** The line that stands in for transcript segments recorded in camera (decision A2). */
export const IN_CAMERA_TRANSCRIPT_LINE = `[${IN_CAMERA_PLACEHOLDER}]`;
/** The discussion, when the minutes record an in-camera session that isn't its own section. */
export const IN_CAMERA_UNLOCATED_DISCUSSION =
  `${IN_CAMERA_PLACEHOLDER}. These minutes record an in-camera session that isn't in its own section, so the discussion is withheld.`;
export const IN_CAMERA_SOURCE_NOTE =
  "The imported source record includes an in-camera session, so it isn't shown.";

type Row = Record<string, unknown>;

export type InCameraFacts = {
  /** The minutes record an in-camera session segment or section. */
  hasInCamera: boolean;
  /** An in-camera session segment exists but no section holds it. */
  unlocated: boolean;
  /** Sections that are in camera, including depth-1 sub-items under an in-camera item. */
  sectionIndexes: number[];
  /** Motion ids carried by in-camera sections. */
  motionIds: string[];
};

export const NO_IN_CAMERA: InCameraFacts = { hasInCamera: false, unlocated: false, sectionIndexes: [], motionIds: [] };

const IN_CAMERA_TYPES = new Set(["in_camera", "executive_session", "closed", "closed_session"]);

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRow) : [];
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function pick(row: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const key of keys) if (row[key] !== undefined) out[key] = row[key];
  return out;
}

/** `in_camera`, `executive_session` or `closed` (any case, spaces or hyphens). */
export function isInCameraType(type: unknown): boolean {
  if (typeof type !== "string") return false;
  return IN_CAMERA_TYPES.has(type.trim().toLowerCase().replace(/[\s-]+/g, "_"));
}

/** The adopted snapshot of approved minutes, if they have one. */
function adoptedView(minutes: Row): Row | undefined {
  return minutes.approvedAt && isRow(minutes.adoptedSnapshot) ? minutes.adoptedSnapshot : undefined;
}

function ownFacts(minutes: Row): InCameraFacts {
  const segments = rows(minutes.sessionSegments).filter((segment) => isInCameraType(segment.type));
  const segmentTitles = new Set(segments.map((segment) => normalized(segment.title)).filter(Boolean));
  const sections = Array.isArray(minutes.sections) ? minutes.sections : [];
  const sectionIndexes: number[] = [];
  const motionIds: string[] = [];
  let parentInCamera = false;
  sections.forEach((section: unknown, index: number) => {
    if (!isRow(section)) return;
    const child = section.depth === 1;
    const own = isInCameraType(section.type) || segmentTitles.has(normalized(section.title));
    const inCamera = own || (child && parentInCamera);
    if (!child) parentInCamera = own;
    if (!inCamera) return;
    sectionIndexes.push(index);
    if (typeof section.motionId === "string") motionIds.push(section.motionId);
  });
  return {
    hasInCamera: segments.length > 0 || sectionIndexes.length > 0,
    unlocated: segments.length > 0 && sectionIndexes.length === 0,
    sectionIndexes,
    motionIds,
  };
}

/**
 * Where a minutes record's in-camera content is. A section is in camera when
 * its type says so, or its title matches an in-camera session segment's title
 * (imported minutes record the session that way). Sub-items (depth 1) follow
 * their in-camera parent item. Approved minutes also count their adopted
 * snapshot, so a row and its snapshot can never disagree in the reader's favour.
 */
export function inCameraFacts(minutes: unknown): InCameraFacts {
  if (!isRow(minutes)) return NO_IN_CAMERA;
  const live = ownFacts(minutes);
  const snapshot = adoptedView(minutes);
  if (!snapshot) return live;
  const adopted = ownFacts(snapshot);
  return {
    hasInCamera: live.hasInCamera || adopted.hasInCamera,
    unlocated: live.unlocated || adopted.unlocated,
    sectionIndexes: [...new Set([...live.sectionIndexes, ...adopted.sectionIndexes])],
    motionIds: [...new Set([...live.motionIds, ...adopted.motionIds])],
  };
}

/** A motion (minutes-embedded shape or `motions` row) recorded in an in-camera section. */
export function isInCameraMotion(motion: unknown, facts: InCameraFacts): boolean {
  if (!isRow(motion) || !facts.sectionIndexes.length) return false;
  if (typeof motion.sectionIndex === "number" && facts.sectionIndexes.includes(motion.sectionIndex)) return true;
  const id = motion.motionId ?? motion._id;
  return typeof id === "string" && facts.motionIds.includes(id);
}

const MOTION_KEPT_FIELDS = [
  "_id", "_creationTime", "societyId", "minutesId", "primaryMeetingId", "meetingId",
  "motionId", "sectionIndex", "status", "createdAtISO", "updatedAtISO",
] as const;

/** Ids and position stay so lists and numbering hold; wording, people and votes go. */
export function redactInCameraMotion<T>(motion: T): T {
  if (!isRow(motion)) return motion;
  const redacted: Row = {
    ...pick(motion, MOTION_KEPT_FIELDS),
    name: IN_CAMERA_MOTION_TITLE,
    title: IN_CAMERA_MOTION_TITLE,
    text: IN_CAMERA_PLACEHOLDER,
    outcome: IN_CAMERA_OUTCOME,
    sectionTitle: IN_CAMERA_ITEM_TITLE,
    inCameraRedacted: true,
  };
  return redacted as T;
}

function redactSection(section: Row): Row {
  return {
    ...pick(section, ["agendaItemId", "depth", "motionId"]),
    title: IN_CAMERA_ITEM_TITLE,
    type: isInCameraType(section.type) ? section.type : "executive_session",
    discussion: IN_CAMERA_PLACEHOLDER,
    decisions: [],
    actionItems: [],
    publicVisible: false,
    inCameraRedacted: true,
  };
}

function redactActionItem(item: Row): Row {
  return { ...pick(item, ["done", "status", "dueDate"]), text: IN_CAMERA_PLACEHOLDER, inCameraRedacted: true };
}

function redactSessionSegment(segment: Row): Row {
  if (!isInCameraType(segment.type)) return segment;
  return {
    ...pick(segment, ["type", "startedAt", "endedAt", "recordingStartSec", "recordingEndSec"]),
    title: IN_CAMERA_TITLE,
    ...(segment.notes ? { notes: IN_CAMERA_PLACEHOLDER } : {}),
  };
}

const MOTION_LIST_FIELDS = ["displayMotions", "motionSnapshots", "motions"] as const;

/**
 * The minutes as someone without in-camera access may read them. In-camera
 * sections, their motions, decisions and action items become placeholders.
 * The imported source record and the working transcript copy are withheld,
 * because neither can be split at the session boundary. Adopted snapshots and
 * adoption history are redacted the same way. Returns the input unchanged
 * when nothing is in camera. Never mutates the input.
 */
export function redactInCameraMinutes<T>(minutes: T): T {
  if (!isRow(minutes)) return minutes;
  if (!inCameraFacts(minutes).hasInCamera) return minutes;
  // Top-level fields follow this record's own sections; the snapshot and
  // history entries below are redacted against their own sections.
  const facts = ownFacts(minutes);
  const sections = Array.isArray(minutes.sections) ? minutes.sections : undefined;
  const hidden = new Set(facts.sectionIndexes);
  const hiddenSections = facts.sectionIndexes.map((index) => sections?.[index]).filter(isRow);
  const hiddenDecisions = new Set(hiddenSections.flatMap((section) => Array.isArray(section.decisions) ? section.decisions.map(normalized) : []).filter(Boolean));
  const hiddenActions = new Set(hiddenSections.flatMap((section) => rows(section.actionItems).map((item) => normalized(item.text))).filter(Boolean));
  const hiddenMotionLabels = new Set(
    MOTION_LIST_FIELDS.flatMap((field) => rows(minutes[field]))
      .filter((motion) => isInCameraMotion(motion, facts))
      .flatMap((motion) => [normalized(motion.name), normalized(motion.title), normalized(motion.text)])
      .filter(Boolean),
  );

  const out: Row = { ...minutes };
  if (sections) out.sections = sections.map((section: unknown, index: number) => (isRow(section) && hidden.has(index) ? redactSection(section) : section));
  for (const field of MOTION_LIST_FIELDS) {
    const list = minutes[field];
    if (Array.isArray(list)) out[field] = list.map((motion: unknown) => (isInCameraMotion(motion, facts) ? redactInCameraMotion(motion) : motion));
  }
  if (Array.isArray(minutes.decisions)) {
    out.decisions = minutes.decisions.map((decision: unknown) => (hiddenDecisions.has(normalized(decision)) ? IN_CAMERA_PLACEHOLDER : decision));
  }
  if (Array.isArray(minutes.actionItems)) {
    out.actionItems = minutes.actionItems.map((item: unknown) => (isRow(item) && hiddenActions.has(normalized(item.text)) ? redactActionItem(item) : item));
  }
  if (Array.isArray(minutes.actionObservations)) {
    out.actionObservations = minutes.actionObservations.filter((item: unknown) => !(isRow(item) && hiddenActions.has(normalized(item.text))));
  }
  if (Array.isArray(minutes.sessionSegments)) {
    out.sessionSegments = minutes.sessionSegments.map((segment: unknown) => (isRow(segment) ? redactSessionSegment(segment) : segment));
  }
  if (inCameraFacts(minutes).unlocated && typeof minutes.discussion === "string" && minutes.discussion.trim()) out.discussion = IN_CAMERA_UNLOCATED_DISCUSSION;
  delete out.draftTranscript;
  if (minutes.sourceMeetingRecord !== undefined) delete out.sourceMeetingRecord;
  if (minutes.sourceTransposition !== undefined) out.sourceTransposition = { version: 1, reviewStatus: "restricted", note: IN_CAMERA_SOURCE_NOTE };
  if (Array.isArray(minutes.importedSourceVersions)) out.importedSourceVersions = [];
  if (isRow(minutes.adoptedSnapshot)) out.adoptedSnapshot = redactInCameraMinutes(minutes.adoptedSnapshot);
  if (Array.isArray(minutes.adoptionHistory)) {
    out.adoptionHistory = minutes.adoptionHistory.map((entry: unknown) =>
      isRow(entry) && isRow(entry.snapshot) ? { ...entry, snapshot: redactInCameraMinutes(entry.snapshot) } : entry);
  }
  if (isRow(minutes.adoptedExportEvidence) && Array.isArray(minutes.adoptedExportEvidence.conflicts)) {
    out.adoptedExportEvidence = {
      ...minutes.adoptedExportEvidence,
      conflicts: minutes.adoptedExportEvidence.conflicts.map((conflict: unknown) =>
        isRow(conflict) && hiddenMotionLabels.has(normalized(conflict.motionLabel)) ? { ...conflict, motionLabel: IN_CAMERA_MOTION_TITLE } : conflict),
    };
  }
  out.inCameraRedacted = true;
  return out as T;
}

export const TRANSCRIPT_WITHHELD_IN_CAMERA = "in_camera" as const;

/**
 * A transcript of a meeting with an in-camera session, for someone without
 * in-camera access. Session times in minutes are clock times with no anchor in
 * the recording, so the in-camera part can't be cut out: the whole working
 * transcript is withheld, and `withheld` says why.
 */
export function withheldTranscript<T>(row: T): T {
  if (!isRow(row)) return row;
  const withheld: Row = {
    ...pick(row, ["_id", "_creationTime", "societyId", "meetingId", "provider", "createdAtISO", "demo", "durationSeconds", "language"]),
    text: "",
    segments: [],
    speakers: [],
    withheld: TRANSCRIPT_WITHHELD_IN_CAMERA,
  };
  return withheld as T;
}

// --- Recording offsets: cutting in-camera parts out of a transcript (A2) -----

/** Where an in-camera session sits in the recording, in seconds. */
export type InCameraRecordingRange = { title: string; startSec: number; endSec: number };

function recordingRange(segment: Row): { startSec: number; endSec: number } | null {
  const startSec = segment.recordingStartSec;
  const endSec = segment.recordingEndSec;
  if (typeof startSec !== "number" || typeof endSec !== "number") return null;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) return null;
  return { startSec, endSec };
}

/** One minutes view's ranges, or null when any in-camera session can't be placed in the recording. */
function ownRecordingRanges(minutes: Row): InCameraRecordingRange[] | null {
  const segments = rows(minutes.sessionSegments).filter((segment) => isInCameraType(segment.type));
  const ranges: InCameraRecordingRange[] = [];
  const marked = new Set<string>();
  for (const segment of segments) {
    const range = recordingRange(segment);
    if (!range) return null;
    const title = typeof segment.title === "string" && segment.title.trim() ? segment.title.trim() : IN_CAMERA_TITLE;
    ranges.push({ title, ...range });
    marked.add(normalized(title));
  }
  // An in-camera section that no marked session names is somewhere in the
  // recording we can't point to, so nothing can be cut out safely.
  const sections = rows(minutes.sections);
  const unmarkedSection = sections.some((section) => section.depth !== 1 && isInCameraType(section.type) && !marked.has(normalized(section.title)));
  return unmarkedSection ? null : ranges;
}

/**
 * The recording ranges of a meeting's in-camera sessions, when every one of
 * them has offsets (`recordingStartSec`/`recordingEndSec` on its session
 * segment) and every in-camera section is named by a marked session. Null
 * means the in-camera part can't be located, so the transcript stays withheld
 * whole. An empty list means nothing is in camera. Approved minutes must
 * satisfy this in their adopted snapshot too; the ranges are the union.
 */
export function inCameraRecordingRanges(minutes: unknown): InCameraRecordingRange[] | null {
  if (!isRow(minutes) || !inCameraFacts(minutes).hasInCamera) return [];
  const live = ownRecordingRanges(minutes);
  const snapshot = adoptedView(minutes);
  const adopted = snapshot ? ownRecordingRanges(snapshot) : [];
  if (!live || !adopted) return null;
  const all = [...live, ...adopted];
  return all.length ? all : null;
}

/** One minutes view's marked ranges, and the in-camera sessions or sections no marked range covers. */
function ownMarkedRanges(minutes: Row) {
  const ranges: InCameraRecordingRange[] = [];
  const unmarked = new Map<string, string>();
  const marked = new Set<string>();
  for (const segment of rows(minutes.sessionSegments).filter((row) => isInCameraType(row.type))) {
    const title = typeof segment.title === "string" && segment.title.trim() ? segment.title.trim() : IN_CAMERA_TITLE;
    const range = recordingRange(segment);
    if (range) {
      ranges.push({ title, ...range });
      marked.add(normalized(title));
    } else unmarked.set(normalized(title), title);
  }
  for (const section of rows(minutes.sections)) {
    if (section.depth === 1 || !isInCameraType(section.type)) continue;
    const title = typeof section.title === "string" && section.title.trim() ? section.title.trim() : IN_CAMERA_TITLE;
    // Matched on the raw title, as `ownRecordingRanges` does.
    if (!marked.has(normalized(section.title))) unmarked.set(normalized(title), title);
  }
  return { ranges, unmarked };
}

/**
 * For someone with in-camera access exporting a transcript without its
 * in-camera parts: every marked range (live and adopted), and the titles of
 * in-camera sessions the export can't cut because nothing places them in the
 * recording. `unmarked` is empty exactly when `inCameraRecordingRanges` is not
 * null. Unlike that rule, marked ranges are still returned when some session
 * isn't marked, so the person can choose to export with a warning.
 */
export function inCameraExportRanges(minutes: unknown): { ranges: InCameraRecordingRange[]; unmarked: string[] } {
  if (!isRow(minutes) || !inCameraFacts(minutes).hasInCamera) return { ranges: [], unmarked: [] };
  const snapshot = adoptedView(minutes);
  const views = [ownMarkedRanges(minutes), ...(snapshot ? [ownMarkedRanges(snapshot)] : [])];
  const ranges = views.flatMap((view) => view.ranges);
  const unmarked = new Map(views.flatMap((view) => [...view.unmarked]));
  // In camera, yet no session or section to name: nothing can be placed.
  if (!ranges.length && !unmarked.size) unmarked.set(normalized(IN_CAMERA_TITLE), IN_CAMERA_TITLE);
  return { ranges: ranges.sort((a, b) => a.startSec - b.startSec), unmarked: [...unmarked.values()] };
}

/** Every in-camera session of the minutes (marked or not), for the Transcript tab's "Mark as in camera" choices. */
export function inCameraSessionChoices(minutes: unknown): Array<{ title: string; startSec?: number; endSec?: number }> {
  if (!isRow(minutes)) return [];
  const choices = new Map<string, { title: string; startSec?: number; endSec?: number }>();
  for (const segment of rows(minutes.sessionSegments).filter((row) => isInCameraType(row.type))) {
    const title = typeof segment.title === "string" && segment.title.trim() ? segment.title.trim() : IN_CAMERA_TITLE;
    const range = recordingRange(segment);
    choices.set(normalized(title), { title, ...(range ?? {}) });
  }
  for (const section of rows(minutes.sections)) {
    if (section.depth === 1 || !isInCameraType(section.type) || typeof section.title !== "string" || !section.title.trim()) continue;
    if (!choices.has(normalized(section.title))) choices.set(normalized(section.title), { title: section.title.trim() });
  }
  return [...choices.values()];
}

/** Display names for raw speaker labels, following combined speakers. */
function speakerNames(speakers: readonly Row[]): (label: string) => string {
  const map: TranscriptSpeaker[] = speakers
    .filter((speaker) => typeof speaker.label === "string")
    .map((speaker) => ({
      label: String(speaker.label),
      ...(typeof speaker.name === "string" ? { name: speaker.name } : {}),
      ...(typeof speaker.mergedInto === "string" ? { mergedInto: speaker.mergedInto } : {}),
    }));
  const resolver = speakerResolver(map);
  return (label) => resolver.name(label);
}

type TimedSegment = { speaker?: unknown; text?: unknown; startSec?: unknown; endSec?: unknown };

/** Segments that start before a range ends and end after it starts are in camera. */
function overlapsAny(segment: TimedSegment, ranges: readonly InCameraRecordingRange[]): boolean {
  const start = typeof segment.startSec === "number" ? segment.startSec : 0;
  const end = typeof segment.endSec === "number" ? Math.max(start, segment.endSec) : start;
  return ranges.some((range) => (end > start ? end > range.startSec && start < range.endSec : start >= range.startSec && start < range.endSec));
}

/**
 * A transcript row with the segments recorded in camera replaced by one
 * placeholder line per run ("[In-camera session — not shown]"). Speakers who
 * only spoke in camera drop out of the speaker map. The `text` copy is rebuilt
 * from what is left. Never mutates the input.
 */
export function redactInCameraTranscript<T>(row: T, ranges: readonly InCameraRecordingRange[]): T {
  if (!isRow(row) || !ranges.length) return row;
  const segments = rows(row.segments);
  const kept: Row[] = [];
  let redacted = 0;
  for (const segment of segments) {
    if (!overlapsAny(segment, ranges)) {
      kept.push(segment);
      continue;
    }
    redacted += 1;
    const previous = kept.at(-1);
    if (previous?.inCameraRedacted === true) {
      previous.endSec = Math.max(Number(previous.endSec), Number(segment.endSec ?? segment.startSec ?? 0));
      continue;
    }
    kept.push({
      speaker: IN_CAMERA_TITLE,
      text: IN_CAMERA_TRANSCRIPT_LINE,
      startSec: Number(segment.startSec ?? 0),
      endSec: Number(segment.endSec ?? segment.startSec ?? 0),
      inCameraRedacted: true,
    });
  }
  if (!redacted) return row;
  const speakers = rows(row.speakers);
  const used = new Set(kept.filter((segment) => segment.inCameraRedacted !== true).map((segment) => String(segment.speaker)));
  // Keep the targets of kept labels too, so combined speakers still resolve.
  let grew = true;
  while (grew) {
    grew = false;
    for (const speaker of speakers) {
      const target = typeof speaker.mergedInto === "string" ? speaker.mergedInto : undefined;
      if (target && used.has(String(speaker.label)) && !used.has(target)) {
        used.add(target);
        grew = true;
      }
    }
  }
  const keptSpeakers = speakers.filter((speaker) => used.has(String(speaker.label)));
  const names = speakerNames(keptSpeakers);
  const text = kept
    .map((segment) => (segment.inCameraRedacted === true ? IN_CAMERA_TRANSCRIPT_LINE : `${names(String(segment.speaker))}: ${String(segment.text ?? "")}`))
    .join("\n");
  return { ...row, segments: kept, speakers: keptSpeakers, text, inCameraRedacted: true } as T;
}

/** Imports with synthetic five-second segments (pasted text) have no recording times to cut at. */
export function isTimedTranscript(row: unknown): boolean {
  if (!isRow(row)) return false;
  const provider = typeof row.provider === "string" ? row.provider : "manual";
  return !["manual", "text", "txt"].includes(provider) && rows(row.segments).some((segment) => typeof segment.endSec === "number" && segment.endSec > 0);
}

/**
 * A working transcript for someone without in-camera access: unchanged when
 * the minutes record no in-camera session, cut at the marked offsets when
 * every session is marked (and the transcript is timed), withheld whole
 * otherwise.
 */
export function transcriptWithoutInCamera<T>(transcript: T, minutes: unknown): T {
  if (!isRow(minutes) || !inCameraFacts(minutes).hasInCamera) return transcript;
  const ranges = inCameraRecordingRanges(minutes);
  return ranges && ranges.length && isTimedTranscript(transcript) ? redactInCameraTranscript(transcript, ranges) : withheldTranscript(transcript);
}

/** The export appendix text (`Name: text` lines) for an audience without in-camera access, or null when withheld. */
export function transcriptTextWithoutInCamera(transcript: unknown, minutes: unknown): string | null {
  if (!isRow(transcript)) return null;
  const visible = transcriptWithoutInCamera(transcript, minutes);
  if (!isRow(visible) || visible.withheld) return null;
  if (visible.inCameraRedacted === true) return typeof visible.text === "string" ? visible.text : null;
  const segments = rows(visible.segments);
  if (!segments.length) return typeof visible.text === "string" && visible.text.trim() ? visible.text : null;
  const resolve = speakerNames(rows(visible.speakers));
  return segments.map((segment) => `${resolve(String(segment.speaker))}: ${String(segment.text ?? "")}`).join("\n");
}

// --- Agenda items and working notes (A3) ------------------------------------

/**
 * Agenda items inside an in-camera session: their type says so, a minutes
 * section in camera links to them (`agendaItemId`) or has their title, or an
 * in-camera session segment has their title. Sub-items (depth 1) follow their
 * parent. `items` must be in agenda order.
 */
export function inCameraAgendaItemIds(items: readonly unknown[], minutes: unknown): Set<string> {
  const facts = inCameraFacts(minutes);
  const sections = isRow(minutes) ? rows(minutes.sections) : [];
  const snapshot = isRow(minutes) ? adoptedView(minutes) : undefined;
  const allSections = [...sections, ...(snapshot ? rows(snapshot.sections) : [])];
  const hiddenSections = facts.sectionIndexes.map((index) => sections[index]).filter(isRow);
  const linkedIds = new Set(hiddenSections.map((section) => section.agendaItemId).filter((id): id is string => typeof id === "string"));
  const titles = new Set([
    ...hiddenSections.map((section) => normalized(section.title)),
    ...allSections.filter((section) => isInCameraType(section.type)).map((section) => normalized(section.title)),
    ...(isRow(minutes) ? rows(minutes.sessionSegments) : []).filter((segment) => isInCameraType(segment.type)).map((segment) => normalized(segment.title)),
  ].filter(Boolean));
  const ids = new Set<string>();
  let parentInCamera = false;
  for (const item of items) {
    if (!isRow(item)) continue;
    const child = item.depth === 1;
    const own = isInCameraType(item.type) || linkedIds.has(String(item._id)) || titles.has(normalized(item.title));
    const inCamera = own || (child && parentInCamera);
    if (!child) parentInCamera = own;
    if (inCamera && typeof item._id === "string") ids.add(item._id);
  }
  return ids;
}

/** The titles of the agenda items inside an in-camera session, as editors see them (the material drawer's topics). */
export function inCameraAgendaTopics(items: readonly unknown[], minutes: unknown): Set<string> {
  const ids = inCameraAgendaItemIds(items, minutes);
  return new Set(rows(items).filter((item) => ids.has(String(item._id)) && typeof item.title === "string").map((item) => String(item.title)));
}

const AGENDA_ITEM_KEPT_FIELDS = ["_id", "_creationTime", "societyId", "agendaId", "order", "type", "depth", "timeAllottedMinutes", "createdAtISO"] as const;

/** An in-camera agenda item for a reader without access: position and type stay, wording goes. */
export function redactInCameraAgendaItem<T>(item: T): T {
  if (!isRow(item)) return item;
  return { ...pick(item, AGENDA_ITEM_KEPT_FIELDS), title: IN_CAMERA_ITEM_TITLE, inCameraRedacted: true } as T;
}

/** Agenda items for a reader without in-camera access. Returns the input when nothing is in camera. */
export function redactInCameraAgendaItems<T>(items: readonly T[], minutes: unknown): T[] {
  const hidden = inCameraAgendaItemIds(items, minutes);
  if (!hidden.size) return [...items];
  return items.map((item) => (isRow(item) && hidden.has(String(item._id)) ? redactInCameraAgendaItem(item) : item));
}

/**
 * Agenda titles (as an export or package lists them) for a reader without
 * in-camera access: titles of in-camera items become "In-camera item".
 */
export function redactInCameraAgendaTitles<T extends { title: string; depth?: number }>(entries: readonly T[], minutes: unknown): T[] {
  const withIds = entries.map((entry, index) => ({ ...entry, _id: `entry_${index}`, type: (entry as { type?: unknown }).type }));
  const hidden = inCameraAgendaItemIds(withIds, minutes);
  return entries.map((entry, index) => (hidden.has(`entry_${index}`) ? { ...entry, title: IN_CAMERA_ITEM_TITLE } : entry));
}

export const WORKING_NOTES_WITHHELD_IN_CAMERA = "in_camera" as const;

/**
 * Whether a meeting's working notes are hidden from readers without in-camera
 * access: a formal-minutes meeting (a missing `recordKind` counts) whose
 * minutes record an in-camera session. Notes-only meetings have no session
 * segments, so their notes stay with the meeting.
 */
export function workingNotesAreInCamera(meeting: unknown, minutes: unknown): boolean {
  if (!isRow(meeting) || typeof meeting.workingNotes !== "string" || !meeting.workingNotes.trim()) return false;
  const kind = meeting.recordKind ?? "minutes";
  return kind === "minutes" && inCameraFacts(minutes).hasInCamera;
}

/** The meeting row without its working notes, saying why. */
export function withheldWorkingNotes<T>(meeting: T): T {
  if (!isRow(meeting)) return meeting;
  const { workingNotes: _notes, ...rest } = meeting;
  return { ...rest, workingNotesWithheld: WORKING_NOTES_WITHHELD_IN_CAMERA } as T;
}

/**
 * The minutes' copy of the working transcript (`draftTranscript`). Imports
 * reuse the field for a JSON metadata object (attendance evidence, source
 * ids); that isn't a transcript and stays.
 */
function isTranscriptCopy(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  if (!value.trimStart().startsWith("{")) return true;
  try {
    return !isRow(JSON.parse(value));
  } catch {
    return true;
  }
}

/** Minutes without the copy of the working transcript they carry (for readers who may not read transcripts). */
export function withoutTranscriptCopy<T>(minutes: T): T {
  if (!isRow(minutes)) return minutes;
  const strip = (view: Row): Row => {
    if (!isTranscriptCopy(view.draftTranscript)) return view;
    const { draftTranscript: _copy, ...rest } = view;
    return rest;
  };
  const out = strip(minutes);
  if (isRow(minutes.adoptedSnapshot)) out.adoptedSnapshot = strip(minutes.adoptedSnapshot);
  if (Array.isArray(minutes.adoptionHistory)) {
    out.adoptionHistory = minutes.adoptionHistory.map((entry: unknown) =>
      isRow(entry) && isRow(entry.snapshot) ? { ...entry, snapshot: strip(entry.snapshot) } : entry);
  }
  return out as T;
}

/** Whether these minutes carry a transcript copy anywhere a reader could see it. */
export function hasTranscriptCopy(minutes: unknown): boolean {
  if (!isRow(minutes)) return false;
  const has = (view: unknown) => isRow(view) && isTranscriptCopy(view.draftTranscript);
  return has(minutes) || has(minutes.adoptedSnapshot) || (Array.isArray(minutes.adoptionHistory) && minutes.adoptionHistory.some((entry: unknown) => isRow(entry) && has(entry.snapshot)));
}

// --- Documents and tasks that hold in-camera content (security review H1) ---

/** What a withheld document is called in lists and on its page. */
export const IN_CAMERA_DOCUMENT_TITLE = "In-camera material";
/** What a withheld task is called. */
export const IN_CAMERA_TASK_TITLE = "In-camera action";
export const DOCUMENT_WITHHELD_IN_CAMERA = "in_camera" as const;

/**
 * Where a workspace's in-camera material is, from its minutes that record an
 * in-camera session: their meetings, the agenda items inside the session, the
 * documents that belong to those meetings or that the minutes cite (and,
 * through duplicate and version links, copies of them), and the tasks made
 * from in-camera action items.
 */
export type InCameraIndex = {
  documentIds: ReadonlySet<string>;
  meetingIds: ReadonlySet<string>;
  agendaItemIds: ReadonlySet<string>;
  /** Per in-camera meeting: the titles of its in-camera agenda items (normalized), for materials filed by topic. */
  inCameraAgendaTitles: ReadonlyMap<string, ReadonlySet<string>>;
  taskIds: ReadonlySet<string>;
  /**
   * Every meeting with minutes: its sections' titles (normalized) and which
   * sections are in camera now. A task made from an action item is judged
   * against these when it is read, so marking or unmarking a section later
   * applies to it.
   */
  minutesSections: ReadonlyMap<string, MinutesSections>;
};

/** `unlocated`: an in-camera session no section holds, so any action may have come from it. */
export type MinutesSections = { titles: readonly string[]; inCamera: ReadonlySet<number>; unlocated: boolean };

export const NO_IN_CAMERA_INDEX: InCameraIndex = { documentIds: new Set(), meetingIds: new Set(), agendaItemIds: new Set(), inCameraAgendaTitles: new Map(), taskIds: new Set(), minutesSections: new Map() };

/** A minutes record's sections for task checks: titles and the in-camera ones. */
export function minutesSectionsOf(minutes: unknown): MinutesSections {
  if (!isRow(minutes)) return { titles: [], inCamera: new Set(), unlocated: false };
  const facts = inCameraFacts(minutes);
  const sections = Array.isArray(minutes.sections) ? minutes.sections : [];
  return { titles: sections.map((section: unknown) => (isRow(section) ? normalized(section.title) : "")), inCamera: new Set(facts.sectionIndexes), unlocated: facts.unlocated };
}

/** The title a task records for the section its action item came from (`tasks.minutesSectionTitle`). */
export function sectionTitleAt(minutes: unknown, sectionIndex: number): string | undefined {
  if (!isRow(minutes) || !Array.isArray(minutes.sections)) return undefined;
  const section = minutes.sections[sectionIndex];
  return isRow(section) && typeof section.title === "string" && section.title.trim() ? section.title.trim() : undefined;
}

function documentIdsIn(value: unknown): string[] {
  return rows(value).map((entry) => entry.documentId).filter((id): id is string => typeof id === "string");
}

/** The source documents a minutes view cites: linked sources, transposition originals and source-record documents. */
function citedSourceIds(view: Row): string[] {
  const linked = Array.isArray(view.sourceDocumentIds) ? view.sourceDocumentIds.filter((id): id is string => typeof id === "string") : [];
  const transposition = isRow(view.sourceTransposition) ? documentIdsIn(view.sourceTransposition.originalSources) : [];
  const record = isRow(view.sourceMeetingRecord) ? documentIdsIn(view.sourceMeetingRecord.documents) : [];
  return [...linked, ...transposition, ...record];
}

/**
 * Documents that in-camera minutes cite. Imported sources (scans, originals,
 * the source record's documents) can't be split at the session boundary, so
 * they are in-camera material whole, like the source record itself
 * (`redactInCameraMinutes`). Dissent reports belong to in-camera motions.
 * `motions` are the minutes' `motions` rows. Empty when nothing is in camera.
 */
export function inCameraDocumentIdsOf(minutes: unknown, motions: readonly unknown[] = []): string[] {
  if (!isRow(minutes)) return [];
  const facts = inCameraFacts(minutes);
  if (!facts.hasInCamera) return [];
  const snapshot = adoptedView(minutes);
  const sources = [...citedSourceIds(minutes), ...(snapshot ? citedSourceIds(snapshot) : [])];
  const embedded = [...rows(minutes.motionSnapshots), ...(snapshot ? rows(snapshot.motionSnapshots) : [])];
  const dissent = [...embedded, ...motions.filter(isRow)]
    .filter((motion) => isInCameraMotion(motion, facts))
    .map((motion) => motion.dissentDocumentId)
    .filter((id): id is string => typeof id === "string");
  return [...new Set([...sources, ...dissent])];
}

/** Tasks made from (or linked to) an in-camera section's action items: `actionItems[].taskId` and `linkedTaskIds`. */
export function inCameraTaskIdsOf(minutes: unknown): string[] {
  if (!isRow(minutes)) return [];
  const ids = new Set<string>();
  const collect = (view: Row) => {
    const facts = ownFacts(view);
    const sections = Array.isArray(view.sections) ? view.sections : [];
    for (const index of facts.sectionIndexes) {
      const section = sections[index];
      if (!isRow(section)) continue;
      for (const item of rows(section.actionItems)) if (typeof item.taskId === "string") ids.add(item.taskId);
      for (const id of Array.isArray(section.linkedTaskIds) ? section.linkedTaskIds : []) if (typeof id === "string") ids.add(id);
    }
  };
  collect(minutes);
  const snapshot = adoptedView(minutes);
  if (snapshot) collect(snapshot);
  return [...ids];
}

/** The section an action item sits in is in camera (recorded on a task made from it, `tasks.inCamera`). */
export function isInCameraSection(minutes: unknown, sectionIndex: number): boolean {
  return isRow(minutes) && inCameraFacts(minutes).sectionIndexes.includes(sectionIndex);
}

/**
 * Whether a document is in-camera material: it belongs to an in-camera
 * meeting. That is: cited by in-camera minutes, filed under an in-camera
 * meeting (`meetingId`, whatever its category: a board pack or letter filed
 * there may hold the session's content) or agenda item (`agendaItemId`), or a
 * duplicate or version of such a document. Being attached as a meeting
 * material doesn't make a library document the meeting's: attaching records
 * the link in `meetingMaterials` only, and an in-camera item's material link
 * is withheld instead (`isInCameraMaterial`).
 */
export function isInCameraDocument(document: unknown, index: InCameraIndex): boolean {
  if (!isRow(document)) return false;
  const linkedTo = (value: unknown, set: ReadonlySet<string>) => typeof value === "string" && set.has(value);
  if (index.documentIds.has(String(document._id))) return true;
  if (linkedTo(document.meetingId, index.meetingIds) || linkedTo(document.agendaItemId, index.agendaItemIds)) return true;
  return linkedTo(document.duplicateOfDocumentId, index.documentIds) || linkedTo(document.supersedesDocumentId, index.documentIds);
}

/**
 * Whether a meeting material is filed under an in-camera agenda item, by its
 * `agendaItemId` or its agenda topic (`agendaLabel`, the item's title). Readers
 * without in-camera access don't see the link, its label or its notes; the
 * document itself follows `isInCameraDocument`.
 */
export function isInCameraMaterial(material: unknown, index: InCameraIndex): boolean {
  if (!isRow(material)) return false;
  if (typeof material.agendaItemId === "string" && index.agendaItemIds.has(material.agendaItemId)) return true;
  const titles = index.inCameraAgendaTitles.get(String(material.meetingId));
  return !!titles && titles.has(normalized(material.agendaLabel));
}

/** Normalized titles of the agenda items inside an in-camera session, keyed for `InCameraIndex.inCameraAgendaTitles`. */
export function inCameraAgendaTitleKeys(items: readonly unknown[], inCameraIds: ReadonlySet<string>): Set<string> {
  return new Set(rows(items).filter((item) => inCameraIds.has(String(item._id))).map((item) => normalized(item.title)).filter(Boolean));
}

/** A task made from an imported or minutes action item, before tasks recorded where they came from. */
function isMinutesActionTask(task: Row): boolean {
  const tags = Array.isArray(task.tags) ? task.tags : [];
  return tags.includes("minutes-action") || typeof task.externalActionId === "string" || typeof task.actionRegisterKey === "string" || Array.isArray(task.sourceObservations);
}

/**
 * The section of the current minutes a task's action item came from: by the
 * title it recorded (sections can move), else by its index when the title
 * still matches or none was recorded. Null when it can't be found.
 */
function sourceSectionIndex(task: Row, sections: MinutesSections): number | null {
  const title = typeof task.minutesSectionTitle === "string" ? normalized(task.minutesSectionTitle) : "";
  const index = typeof task.minutesSectionIndex === "number" ? task.minutesSectionIndex : null;
  if (title) {
    if (index !== null && sections.titles[index] === title) return index;
    const byTitle = sections.titles.indexOf(title);
    return byTitle >= 0 ? byTitle : null;
  }
  return index !== null && index < sections.titles.length ? index : null;
}

/**
 * Whether a task holds in-camera content, judged when it is read against the
 * current minutes: linked from an in-camera section, under an in-camera
 * agenda item, or made from a minutes action item whose section is in camera
 * now. A minutes action task whose section can't be found (none recorded,
 * renamed, removed) under a meeting with an in-camera session counts as in
 * camera. `inCamera: true`, set when the task was made, is only a hint: it
 * holds when the meeting's minutes are gone, and the current minutes decide
 * otherwise, so a section later marked in camera hides its tasks and one
 * unmarked shows them again.
 */
export function isInCameraTask(task: unknown, index: InCameraIndex): boolean {
  if (!isRow(task)) return false;
  if (index.taskIds.has(String(task._id))) return true;
  if (typeof task.agendaItemId === "string" && index.agendaItemIds.has(task.agendaItemId)) return true;
  const fromMinutes = isMinutesActionTask(task) || typeof task.minutesSectionIndex === "number" || typeof task.minutesSectionTitle === "string";
  if (!fromMinutes || typeof task.meetingId !== "string") return task.inCamera === true;
  const sections = index.minutesSections.get(task.meetingId);
  if (!sections) return task.inCamera === true;
  if (!index.meetingIds.has(task.meetingId)) return false;
  if (sections.unlocated) return true;
  const source = sourceSectionIndex(task, sections);
  return source === null || sections.inCamera.has(source);
}

const DOCUMENT_KEPT_FIELDS = [
  "_id", "_creationTime", "societyId", "category", "committeeId", "meetingId", "agendaItemId",
  "createdAtISO", "librarySection", "flaggedForDeletion", "archivedAtISO", "retentionYears",
] as const;

/**
 * An in-camera document for a reader without in-camera access: it stays in
 * lists (so they know something is there) with its category, dates and
 * links, but its title, file, extracted text, tags and download go.
 */
export function withheldInCameraDocument<T>(document: T): T {
  if (!isRow(document)) return document;
  return { ...pick(document, DOCUMENT_KEPT_FIELDS), title: IN_CAMERA_DOCUMENT_TITLE, tags: [], inCameraWithheld: DOCUMENT_WITHHELD_IN_CAMERA } as T;
}

const TASK_KEPT_FIELDS = [
  "_id", "_creationTime", "societyId", "status", "priority", "dueDate", "committeeId", "meetingId", "agendaItemId",
  "createdAtISO", "completedAt", "inCamera", "minutesSectionIndex",
] as const;

/** An in-camera task for a reader without in-camera access: status and dates stay, wording, people and notes go. */
export function withheldInCameraTask<T>(task: T): T {
  if (!isRow(task)) return task;
  return { ...pick(task, TASK_KEPT_FIELDS), title: IN_CAMERA_TASK_TITLE, tags: [], inCameraWithheld: DOCUMENT_WITHHELD_IN_CAMERA } as T;
}
