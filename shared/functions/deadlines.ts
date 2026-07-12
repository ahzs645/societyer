/**
 * PORTABLE FUNCTIONS: the deadlines domain
 * (list / create / setStatus / toggleDone / update / remove / backfillStatus).
 *
 * Reads/writes the `deadlines` table over `ctx.db`. Each handler runs unchanged
 * on hosted Convex, the local Dexie runtime, and the convex-test oracle. The
 * recurrence helpers (`deriveStatus` / `recurrenceMonths` / `advanceDueDate` /
 * `spawnNextOccurrence` / `applyStatusTransition`) are pure (`ctx.db`-only) and
 * shared by the mutations.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";

function deriveStatus(doc: any): "open" | "complete" | "closed" {
  if (doc?.status === "open" || doc?.status === "complete" || doc?.status === "closed") {
    return doc.status;
  }
  return doc?.done ? "complete" : "open";
}

/** Recurrence label → number of months to advance. Returns 0 for one-off /
 *  unknown values (None, "", Custom). Accepts the UI vocabulary plus the
 *  lowercase variants importers/paperless emit. */
function recurrenceMonths(recurrence?: string): number {
  switch (String(recurrence ?? "").trim().toLowerCase()) {
    case "monthly":
      return 1;
    case "quarterly":
      return 3;
    case "annual":
    case "annually":
    case "yearly":
      return 12;
    default:
      return 0;
  }
}

/** Advance a due date by N months, preserving the input's format
 *  (YYYY-MM-DD stays date-only; a full ISO string stays ISO) and clamping the
 *  day to the last valid day of the target month. Returns null if unparseable. */
function advanceDueDate(dueDate: string, months: number): string | null {
  const base = new Date(dueDate);
  if (Number.isNaN(base.getTime())) return null;
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const target = m + months;
  const newYear = y + Math.floor(target / 12);
  const newMonth = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(newYear, newMonth + 1, 0)).getUTCDate();
  const next = new Date(base);
  next.setUTCFullYear(newYear, newMonth, Math.min(d, lastDay));
  return /^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())
    ? next.toISOString().slice(0, 10)
    : next.toISOString();
}

/** True when the next occurrence would fall after the (inclusive) recurrence
 *  end bound, i.e. the series should stop. An absent/unparseable bound means no
 *  limit. Compared by UTC calendar day so a date-only bound isn't tripped by a
 *  time component on the due date. */
function isPastRecurrenceEnd(nextDue: string, endDate?: string): boolean {
  const bound = String(endDate ?? "").trim();
  if (!bound) return false;
  const next = new Date(nextDue);
  const end = new Date(bound);
  if (Number.isNaN(next.getTime()) || Number.isNaN(end.getTime())) return false;
  return next.toISOString().slice(0, 10) > end.toISOString().slice(0, 10);
}

/** When a recurring deadline is completed, create the next occurrence so the
 *  obligation keeps being tracked — unless an optional `recurrenceEndDate` bound
 *  says the series is over. Idempotent: skips if a matching future occurrence
 *  already exists, so completing twice never duplicates. Returns the new row's
 *  id and due date (so callers can surface/undo it), or null when nothing spawned. */
async function spawnNextOccurrence(
  ctx: any,
  doc: any,
): Promise<{ spawnedId: string; spawnedDue: string } | null> {
  const months = recurrenceMonths(doc?.recurrence);
  if (months === 0) return null;
  const nextDue = advanceDueDate(doc.dueDate, months);
  if (!nextDue) return null;
  if (isPastRecurrenceEnd(nextDue, doc?.recurrenceEndDate)) return null;

  const siblings = await ctx.db
    .query("deadlines")
    .withIndex("by_society_due", (q: any) =>
      q.eq("societyId", doc.societyId).eq("dueDate", nextDue),
    )
    .collect();
  const already = siblings.some(
    (r: any) =>
      r.title === doc.title &&
      r.category === doc.category &&
      String(r.recurrence ?? "") === String(doc.recurrence ?? ""),
  );
  if (already) return null;

  const spawnedId = await ctx.db.insert("deadlines", {
    societyId: doc.societyId,
    title: doc.title,
    description: doc.description,
    dueDate: nextDue,
    category: doc.category,
    status: "open",
    done: false,
    recurrence: doc.recurrence,
    recurrenceEndDate: doc.recurrenceEndDate,
    linkedFilingId: doc.linkedFilingId,
  });
  return { spawnedId: String(spawnedId), spawnedDue: nextDue };
}

/** Patch a deadline's status and, when it transitions into "complete", roll a
 *  recurring deadline forward. Shared by setStatus/toggleDone/update. */
async function applyStatusTransition(
  ctx: any,
  id: any,
  nextStatus: "open" | "complete" | "closed",
  extraPatch: Record<string, unknown> = {},
) {
  const before = await ctx.db.get(id);
  await ctx.db.patch(id, { status: nextStatus, done: nextStatus === "complete", ...extraPatch });
  const wasComplete = before ? deriveStatus(before) === "complete" : false;
  if (before && nextStatus === "complete" && !wasComplete) {
    const spawned = await spawnNextOccurrence(ctx, { ...before, ...extraPatch });
    return { spawnedDue: spawned?.spawnedDue ?? null, spawnedId: spawned?.spawnedId ?? null };
  }
  return { spawnedDue: null, spawnedId: null };
}

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const rows = await ctx.db
    .query("deadlines")
    .withIndex("by_society_due", (q) => q.eq("societyId", societyId))
    .order("asc")
    .collect();
  return rows.map((r: any) => {
    const status = deriveStatus(r);
    return { ...r, status, done: status === "complete" };
  });
}

export async function createPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    title: string;
    description?: string;
    dueDate: string;
    category: string;
    status?: "open" | "complete" | "closed";
    recurrence?: string;
    recurrenceEndDate?: string;
    linkedFilingId?: string;
  },
) {
  const { status, ...rest } = args;
  const initial = status ?? "open";
  return ctx.db.insert("deadlines", {
    ...rest,
    status: initial,
    done: initial === "complete",
  });
}

export async function setStatusPortable(
  ctx: PortableMutationCtx,
  { id, status }: { id: string; status: "open" | "complete" | "closed" },
) {
  return applyStatusTransition(ctx, id, status);
}

export async function toggleDonePortable(
  ctx: PortableMutationCtx,
  { id, done }: { id: string; done: boolean },
) {
  return applyStatusTransition(ctx, id, done ? "complete" : "open");
}

export async function updatePortable(
  ctx: PortableMutationCtx,
  {
    id,
    patch,
  }: {
    id: string;
    patch: {
      title?: string;
      description?: string;
      dueDate?: string;
      category?: string;
      status?: "open" | "complete" | "closed";
      done?: boolean;
      recurrence?: string;
      recurrenceEndDate?: string;
      linkedFilingId?: string;
    };
  },
) {
  const before = await ctx.db.get(id);
  const next: Record<string, unknown> = { ...patch };
  if (patch.status !== undefined) {
    next.done = patch.status === "complete";
  } else if (patch.done !== undefined) {
    next.status = patch.done ? "complete" : "open";
  }
  await ctx.db.patch(id, next);
  // Roll a recurring deadline forward when this edit completes it.
  const wasComplete = before ? deriveStatus(before) === "complete" : false;
  const nowComplete = next.status === "complete";
  if (before && nowComplete && !wasComplete) {
    const spawned = await spawnNextOccurrence(ctx, { ...before, ...next });
    return { spawnedDue: spawned?.spawnedDue ?? null, spawnedId: spawned?.spawnedId ?? null };
  }
  return { spawnedDue: null, spawnedId: null };
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

export async function backfillStatusPortable(
  ctx: PortableMutationCtx,
  { societyId }: { societyId: string },
) {
  const rows = await ctx.db
    .query("deadlines")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  let updated = 0;
  for (const row of rows) {
    if (row.status === "open" || row.status === "complete" || row.status === "closed") continue;
    const status = row.done ? "complete" : "open";
    await ctx.db.patch(row._id, { status, done: status === "complete" });
    updated += 1;
  }
  return { updated, total: rows.length };
}
