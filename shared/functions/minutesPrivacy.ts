/**
 * PORTABLE HELPERS: apply the in-camera and transcript rules
 * (`shared/minutesPrivacy.ts`) to the current reader. Every query that returns
 * minutes, motions, agenda items, a meeting's working notes or a working
 * transcript to a client runs its rows through these, on hosted Convex and the
 * local runtime alike. Stored rows are never changed.
 */
import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";
import {
  IN_CAMERA_ACCESS_PERMISSION,
  NO_IN_CAMERA_INDEX,
  TRANSCRIPT_READ_PERMISSION,
  TRANSCRIPT_READ_SCOPE,
  hasTranscriptCopy,
  inCameraAgendaItemIds,
  inCameraDocumentIdsOf,
  inCameraFacts,
  inCameraTaskIdsOf,
  isInCameraDocument,
  isInCameraMaterial,
  inCameraAgendaTitleKeys,
  isInCameraTask,
  isInCameraMotion,
  minutesSectionsOf,
  redactInCameraAgendaItems,
  redactInCameraMinutes,
  redactInCameraMotion,
  transcriptWithoutInCamera,
  withheldWorkingNotes,
  withheldInCameraTask,
  withoutTranscriptCopy,
  workingNotesAreInCamera,
  type InCameraIndex,
  type InCameraFacts,
} from "../minutesPrivacy";
import { isInternalDocumentRecord } from "../documentCategories";
import { requireSocietyMembership } from "./access";
import { hasPermission, requirePermissionPortable, type Permission } from "./permissions";
import { readableProjectionPermissions } from "./projectionPermissions";

/** Whether the current principal may read in-camera content in this workspace. */
export async function canReadInCameraPortable(ctx: PortableQueryCtx, societyId: string): Promise<boolean> {
  const readable = await readableProjectionPermissions(ctx, societyId, [IN_CAMERA_ACCESS_PERMISSION]);
  return readable.has(IN_CAMERA_ACCESS_PERMISSION);
}

/**
 * Whether the current principal may read working transcripts (decision A1):
 * the person's role holds `minutes:write`, and a scoped service principal also
 * holds `meetings:read` and `minutes:read`. Reading one still applies the
 * in-camera rule, which no connector scope satisfies.
 */
export async function canReadTranscriptPortable(ctx: PortableQueryCtx, societyId: string): Promise<boolean> {
  const scopes: Permission[] = ["meetings:read", TRANSCRIPT_READ_SCOPE];
  const readable = await readableProjectionPermissions(ctx, societyId, scopes);
  if (!scopes.every((permission) => readable.has(permission))) return false;
  const user = await requireSocietyMembership(ctx, societyId);
  return hasPermission(String(user.role), TRANSCRIPT_READ_PERMISSION);
}

/** Throws the usual "Permission … required." unless the current principal may read working transcripts. */
export async function requireTranscriptReaderPortable(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "meetings:read");
  const user = await requirePermissionPortable(ctx, societyId, TRANSCRIPT_READ_SCOPE);
  if (!hasPermission(String(user.role), TRANSCRIPT_READ_PERMISSION)) throw new Error(`Permission ${TRANSCRIPT_READ_PERMISSION} required.`);
  return user;
}

/** What the current reader may see in one workspace. */
export type ReaderAccess = { inCamera: boolean; transcript: boolean };

/** One permission lookup per workspace for the life of a query. */
export function readerAccessGate(ctx: PortableQueryCtx): (societyId: string) => Promise<ReaderAccess> {
  const decisions = new Map<string, Promise<ReaderAccess>>();
  return (societyId) => {
    let decision = decisions.get(societyId);
    if (!decision) {
      decision = Promise.all([canReadInCameraPortable(ctx, societyId), canReadTranscriptPortable(ctx, societyId)])
        .then(([inCamera, transcript]) => ({ inCamera, transcript }));
      decisions.set(societyId, decision);
    }
    return decision;
  };
}

type Gate = (societyId: string) => Promise<ReaderAccess>;

/**
 * A minutes read view for the current reader: in-camera content redacted
 * without in-camera access, and the transcript copy (`draftTranscript`)
 * removed for anyone who may not read working transcripts.
 */
export async function minutesForReader<T>(ctx: PortableQueryCtx, minutes: T, gate: Gate = readerAccessGate(ctx)): Promise<T> {
  if (!minutes || typeof minutes !== "object") return minutes;
  const societyId = (minutes as { societyId?: unknown }).societyId;
  if (typeof societyId !== "string") return minutes;
  const inCamera = inCameraFacts(minutes).hasInCamera;
  const transcriptCopy = hasTranscriptCopy(minutes);
  if (!inCamera && !transcriptCopy) return minutes;
  const access = await gate(societyId);
  let view = minutes;
  if (transcriptCopy && !access.transcript) view = withoutTranscriptCopy(view);
  if (inCamera && !access.inCamera) view = redactInCameraMinutes(view);
  return view;
}

/** Heavy fields the in-camera facts never need. */
const FACTS_OMITTED_FIELDS = ["sourceMeetingRecord", "sourceTransposition", "draftTranscript", "importedSourceVersions"] as const;

async function minutesForMeeting(ctx: PortableQueryCtx, meetingId: unknown, societyId: unknown): Promise<PortableDoc | null> {
  if (typeof meetingId !== "string") return null;
  const minutes = await ctx.db
    .query("minutes")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .omitFields(...FACTS_OMITTED_FIELDS)
    .first();
  return minutes && minutes.societyId === societyId ? minutes : null;
}

/** In-camera facts for the minutes these motions belong to, keyed by minutes id. */
async function referencedFacts(ctx: PortableQueryCtx, societyId: string, motions: readonly PortableDoc[]): Promise<Map<string, InCameraFacts>> {
  const ids = [...new Set(motions.map((motion) => motion.minutesId).filter((id): id is string => typeof id === "string"))];
  const facts = new Map<string, InCameraFacts>();
  await Promise.all(ids.map(async (id) => {
    const minutes = await ctx.db.get(id, "minutes", { omitFields: FACTS_OMITTED_FIELDS });
    if (!minutes || minutes.societyId !== societyId) return;
    const minutesFacts = inCameraFacts(minutes);
    if (minutesFacts.hasInCamera) facts.set(id, minutesFacts);
  }));
  return facts;
}

/**
 * `motions` rows for the current reader: a motion recorded in an in-camera
 * section keeps its id, minutes and position but loses its wording, movers
 * and votes. Facts are only loaded for readers without in-camera access.
 */
export async function motionRowsForReader<T extends PortableDoc>(
  ctx: PortableQueryCtx,
  societyId: string,
  motions: T[],
  facts?: Map<string, InCameraFacts>,
): Promise<T[]> {
  if (!motions.some((motion) => motion.minutesId)) return motions;
  if (await canReadInCameraPortable(ctx, societyId)) return motions;
  const byMinutes = facts ?? (await referencedFacts(ctx, societyId, motions));
  if (!byMinutes.size) return motions;
  return motions.map((motion) => {
    const minutesFacts = motion.minutesId ? byMinutes.get(String(motion.minutesId)) : undefined;
    return minutesFacts && isInCameraMotion(motion, minutesFacts) ? redactInCameraMotion(motion) : motion;
  });
}

/** In-camera facts for one minutes row, as a single-entry map for `motionRowsForReader`. */
export function factsForMinutes(minutes: PortableDoc | null | undefined): Map<string, InCameraFacts> {
  if (!minutes) return new Map();
  const facts = inCameraFacts(minutes);
  return facts.hasInCamera ? new Map([[String(minutes._id), facts]]) : new Map();
}

/**
 * A working transcript for a reader who may read transcripts. Without
 * in-camera access (a connector), the segments recorded in camera are cut out
 * when the minutes mark every session's recording offsets, and the transcript
 * is withheld whole otherwise (`transcriptWithoutInCamera`).
 */
export async function transcriptForReader<T extends PortableDoc>(ctx: PortableQueryCtx, transcript: T | null): Promise<T | null> {
  if (!transcript) return transcript;
  const minutes = await minutesForMeeting(ctx, transcript.meetingId, transcript.societyId);
  if (!minutes || !inCameraFacts(minutes).hasInCamera) return transcript;
  return (await canReadInCameraPortable(ctx, String(transcript.societyId))) ? transcript : transcriptWithoutInCamera(transcript, minutes);
}

/**
 * A meeting's agenda items for the current reader: items inside an in-camera
 * session read "In-camera item" for readers without in-camera access
 * (decision A3). `items` must be in agenda order.
 */
export async function agendaItemsForReader<T extends PortableDoc>(ctx: PortableQueryCtx, meeting: PortableDoc, items: T[], gate: Gate = readerAccessGate(ctx)): Promise<T[]> {
  if (!items.length) return items;
  const minutes = await minutesForMeeting(ctx, meeting._id, meeting.societyId);
  if (!minutes || !inCameraFacts(minutes).hasInCamera) return items;
  if ((await gate(String(meeting.societyId))).inCamera) return items;
  return redactInCameraAgendaItems(items, minutes);
}

/**
 * A meeting row for the current reader: a formal-minutes meeting's working
 * notes are withheld from readers without in-camera access when its minutes
 * record an in-camera session (decision A3).
 */
export async function meetingForReader<T extends PortableDoc>(ctx: PortableQueryCtx, meeting: T, gate: Gate = readerAccessGate(ctx)): Promise<T> {
  if (typeof meeting.workingNotes !== "string" || !meeting.workingNotes.trim()) return meeting;
  const minutes = await minutesForMeeting(ctx, meeting._id, meeting.societyId);
  if (!workingNotesAreInCamera(meeting, minutes)) return meeting;
  return (await gate(String(meeting.societyId))).inCamera ? meeting : withheldWorkingNotes(meeting);
}

/**
 * Raw table export rows for the current reader. Every role that may download
 * exports also holds in-camera and transcript access, so this only narrows
 * scoped service principals. A redacted export is not a full backup.
 */
export async function exportRowsForReader<T extends PortableDoc>(ctx: PortableQueryCtx, societyId: string, table: string, rows: T[]): Promise<T[]> {
  if (!["minutes", "motions", "transcripts", "meetings", "agendaItems", "tasks", "documents", "meetingMaterials"].includes(table) || !rows.length) return rows;
  const access = await readerAccessGate(ctx)(societyId);
  if (table === "transcripts" && !access.transcript) return [];
  if (table === "minutes" && !access.transcript) rows = rows.map((row) => withoutTranscriptCopy(row));
  if (access.inCamera) return rows;
  if (table === "minutes") return rows.map((row) => redactInCameraMinutes(row));
  if (table === "tasks") return tasksForReader(ctx, societyId, rows);
  if (table === "meetingMaterials") return materialsForReader(ctx, societyId, rows);
  // In-camera documents never pass the export's document check; import bookkeeping (raw imported text) stays out too.
  if (table === "documents") return rows.filter((row) => !isInternalDocumentRecord(row));
  if (table === "motions") return motionRowsForReader(ctx, societyId, rows);
  if (table === "meetings") return Promise.all(rows.map((row) => meetingForReader(ctx, row, async () => access)));
  if (table === "agendaItems") return agendaExportRows(ctx, rows);
  const transcripts: T[] = [];
  for (const row of rows) {
    const visible = await transcriptForReader(ctx, row);
    if (visible) transcripts.push(visible);
  }
  return transcripts;
}

/** Exported agenda items grouped by agenda, so each meeting's in-camera items are found in order. */
async function agendaExportRows<T extends PortableDoc>(ctx: PortableQueryCtx, rows: T[]): Promise<T[]> {
  const byAgenda = new Map<string, T[]>();
  for (const row of rows) byAgenda.set(String(row.agendaId), [...(byAgenda.get(String(row.agendaId)) ?? []), row]);
  const redacted = new Map<string, T>();
  for (const [agendaId, items] of byAgenda) {
    const agenda = await ctx.db.get(agendaId, "agendas");
    const meeting = agenda && typeof agenda.meetingId === "string" ? await ctx.db.get(agenda.meetingId, "meetings") : null;
    if (!meeting) continue;
    const ordered = [...items].sort((a, b) => Number(a.order) - Number(b.order));
    const visible = await agendaItemsForReader(ctx, meeting, ordered, async () => ({ inCamera: false, transcript: false }));
    for (const item of visible) redacted.set(String(item._id), item);
  }
  return rows.map((row) => redacted.get(String(row._id)) ?? row);
}

// --- Documents and tasks that hold in-camera content (security review H1) ---

/** Minutes fields the index never needs (it keeps the source record and transposition: they cite documents). */
const INDEX_OMITTED_FIELDS = ["draftTranscript", "importedSourceVersions"] as const;
/** Duplicate and version links are followed this many steps, and at most this many documents are visited. */
const LINK_DEPTH = 4;
const LINK_VISIT_LIMIT = 500;

/**
 * Copies of in-camera documents: duplicates and versions linked to one, in
 * either direction, a bounded number of steps out. Index reads only.
 */
async function withLinkedCopies(ctx: PortableQueryCtx, societyId: string, seed: Set<string>): Promise<Set<string>> {
  const found = new Set(seed);
  let frontier = [...seed];
  for (let depth = 0; depth < LINK_DEPTH && frontier.length && found.size < LINK_VISIT_LIMIT; depth += 1) {
    const next: string[] = [];
    const add = (id: unknown) => {
      if (typeof id === "string" && !found.has(id) && found.size < LINK_VISIT_LIMIT) {
        found.add(id);
        next.push(id);
      }
    };
    await Promise.all(frontier.map(async (id) => {
      const [document, duplicates, versions] = await Promise.all([
        ctx.db.get(id, "documents", { omitFields: ["content"] }),
        ctx.db.query("documents").withIndex("by_duplicate_of", (q) => q.eq("duplicateOfDocumentId", id)).omitFields("content").collect(),
        ctx.db.query("documents").withIndex("by_supersedes", (q) => q.eq("supersedesDocumentId", id)).omitFields("content").collect(),
      ]);
      if (document && document.societyId === societyId) {
        add(document.duplicateOfDocumentId);
        add(document.supersedesDocumentId);
      }
      for (const row of [...duplicates, ...versions]) if (row.societyId === societyId) add(row._id);
    }));
    frontier = next;
  }
  return found;
}

/**
 * Where one workspace's in-camera material is. Index reads only: the
 * workspace's minutes, and for the few that record an in-camera session,
 * their motions, agendas and agenda items, the meeting's documents and
 * materials, and copies linked to those documents.
 */
export async function inCameraIndex(ctx: PortableQueryCtx, societyId: string): Promise<InCameraIndex> {
  const minutesRows = await ctx.db
    .query("minutes")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .omitFields(...INDEX_OMITTED_FIELDS)
    .collect();
  // Every meeting's sections, so tasks are judged against the current minutes (marking and unmarking apply).
  const minutesSections = new Map(minutesRows.map((minutes) => [String(minutes.meetingId), minutesSectionsOf(minutes)]));
  const inCamera = minutesRows.filter((minutes) => inCameraFacts(minutes).hasInCamera);
  if (!inCamera.length) return { ...NO_IN_CAMERA_INDEX, minutesSections };
  const documentIds = new Set<string>();
  const meetingIds = new Set<string>();
  const agendaItemIds = new Set<string>();
  const inCameraAgendaTitles = new Map<string, Set<string>>();
  const taskIds = new Set<string>();
  await Promise.all(inCamera.map(async (minutes) => {
    const meetingId = String(minutes.meetingId);
    meetingIds.add(meetingId);
    // Documents filed under the meeting belong to it; library documents only
    // attached as its materials don't (their in-camera links are withheld instead).
    const [motions, agendas, meetingDocuments] = await Promise.all([
      ctx.db.query("motions").withIndex("by_minutes", (q) => q.eq("minutesId", minutes._id)).collect(),
      ctx.db.query("agendas").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect(),
      ctx.db.query("documents").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).omitFields("content").collect(),
    ]);
    for (const id of inCameraDocumentIdsOf(minutes, motions)) documentIds.add(id);
    for (const row of meetingDocuments) if (row.societyId === societyId) documentIds.add(String(row._id));
    for (const id of inCameraTaskIdsOf(minutes)) taskIds.add(id);
    const titles = new Set<string>();
    for (const agenda of agendas) {
      const items = await ctx.db.query("agendaItems").withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id)).collect();
      items.sort((a, b) => Number(a.order) - Number(b.order));
      const ids = inCameraAgendaItemIds(items, minutes);
      for (const id of ids) agendaItemIds.add(id);
      for (const title of inCameraAgendaTitleKeys(items, ids)) titles.add(title);
    }
    inCameraAgendaTitles.set(meetingId, titles);
  }));
  return { documentIds: await withLinkedCopies(ctx, societyId, documentIds), meetingIds, agendaItemIds, inCameraAgendaTitles, taskIds, minutesSections };
}

/** One index per workspace for the life of a query or mutation (a ctx is never reused across calls). */
const readerIndexes = new WeakMap<PortableQueryCtx, Map<string, Promise<InCameraIndex | null>>>();

/**
 * For the current reader: the in-camera material to withhold, or null for
 * readers with in-camera access (Owner, Admin, Director in the app), who
 * withhold nothing. Everyone else, including every AI connector (decision
 * A5), withholds what the index lists. Memoized per ctx, so a query that
 * opens many records builds the index once.
 */
export function readerInCameraIndex(ctx: PortableQueryCtx, societyId: string): Promise<InCameraIndex | null> {
  let indexes = readerIndexes.get(ctx);
  if (!indexes) readerIndexes.set(ctx, (indexes = new Map()));
  let index = indexes.get(societyId);
  if (!index) {
    index = canReadInCameraPortable(ctx, societyId).then((allowed) => (allowed ? null : inCameraIndex(ctx, societyId)));
    indexes.set(societyId, index);
  }
  return index;
}

/** Is this document in-camera material (does it belong to an in-camera meeting)? */
export type InCameraDocumentTest = (document: unknown) => boolean;

const NEVER_IN_CAMERA: InCameraDocumentTest = () => false;

function documentTestFor(index: InCameraIndex | null): InCameraDocumentTest {
  return !index || !index.meetingIds.size ? NEVER_IN_CAMERA : (document) => isInCameraDocument(document, index);
}

/** Which documents the current reader sees only as an in-camera placeholder. */
export async function inCameraDocumentTest(ctx: PortableQueryCtx, societyId: string): Promise<InCameraDocumentTest> {
  return documentTestFor(await readerInCameraIndex(ctx, societyId));
}

/**
 * Meeting materials the current reader may see listed: a material filed under
 * an in-camera agenda item is left out for readers without in-camera access
 * (its link, label and notes), whatever its document.
 */
export async function materialsForReader<T extends PortableDoc>(ctx: PortableQueryCtx, societyId: string, materials: T[]): Promise<T[]> {
  if (!materials.length) return materials;
  const index = await readerInCameraIndex(ctx, societyId);
  return index ? materials.filter((material) => !isInCameraMaterial(material, index)) : materials;
}

/** The same rule for an anonymous public viewer, who never has in-camera access. */
export async function publicInCameraDocumentTest(ctx: PortableQueryCtx, societyId: string): Promise<InCameraDocumentTest> {
  return documentTestFor(await inCameraIndex(ctx, societyId));
}

/**
 * Task rows for the current reader: tasks made from in-camera action items
 * keep their place (status, due date, links) but lose their wording, people
 * and notes (`withheldInCameraTask`).
 */
export async function tasksForReader<T extends PortableDoc>(ctx: PortableQueryCtx, societyId: string, tasks: T[]): Promise<T[]> {
  if (!tasks.length) return tasks;
  const index = await readerInCameraIndex(ctx, societyId);
  if (!index) return tasks;
  return tasks.map((task) => (isInCameraTask(task, index) ? withheldInCameraTask(task) : task));
}
