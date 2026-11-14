/**
 * The opportunity list's views. Where the workspace has a bid triage, the list
 * is a review queue in four states, each with its count:
 *
 *   To review    open, and nobody has marked it reviewed
 *   Shortlist    open, and classified Doable, Possible or Needs a partner
 *   In progress  on an action item (a task holding the opportunity)
 *   Archived     reviewed and not doable (shared/procurementTriage.ts)
 *
 * "Open" is the derived status with a closing date today or later, the same
 * rule as the old "Open, closing soonest" view. The catalog's plain views (all
 * open including unverified dates, all, Closed, Awarded, Cancelled, With
 * documents) stay under "More views". Without a triage (a catalog read without
 * one) the plain views lead instead, opening on the open notices.
 *
 * A list held in memory picks each view's rows before the table, so the
 * states don't show as filter chips and the person's own filters, search and
 * sort apply on top. A list paged by the server has no triage and expresses
 * its views as table filters (NoticeTable.tsx `presetView`).
 *
 * Each view id is the list's `status` URL value; ids from before the queue
 * ("upcoming", "triage") still open what they did.
 */
import type { NoticeRow } from "../../../../shared/procurementNoticeRow";
import type { ActionItem } from "./triage";

export type NoticeViewId =
  | "review"
  | "shortlist"
  | "progress"
  | "archived"
  | "upcoming"
  | "triage"
  | "Open"
  | "all"
  | "Closed"
  | "Awarded"
  | "Cancelled"
  | "documents";

export type NoticeView = {
  _id: NoticeViewId;
  /** The name in menus and the toolbar. */
  name: string;
  /** A shorter name for the segmented row, where the full one is long. */
  short?: string;
  /** Only where the workspace has a triage. */
  triage?: true;
  /** Only where action items can be read (In progress). */
  actionItems?: true;
  /** Kept for old links; offered nowhere. */
  legacy?: true;
};

export const NOTICE_VIEWS: NoticeView[] = [
  { _id: "review", name: "To review", triage: true },
  { _id: "shortlist", name: "Shortlist", triage: true },
  { _id: "progress", name: "In progress", triage: true, actionItems: true },
  { _id: "archived", name: "Archived", triage: true },
  { _id: "upcoming", name: "Open, closing soonest", short: "Open" },
  { _id: "Open", name: "All open, including unverified closing dates" },
  { _id: "all", name: "All, latest closing first", short: "All" },
  { _id: "Closed", name: "Closed" },
  { _id: "Awarded", name: "Awarded" },
  { _id: "Cancelled", name: "Cancelled" },
  { _id: "documents", name: "With documents" },
  { _id: "triage", name: "Open, best classification first", triage: true, legacy: true },
];

export const isNoticeView = (value: string | null): value is NoticeViewId =>
  NOTICE_VIEWS.some((view) => view._id === value);

export const noticeViewName = (id: NoticeViewId) => NOTICE_VIEWS.find((view) => view._id === id)?.name ?? "";
export const noticeViewShortName = (id: NoticeViewId) => {
  const view = NOTICE_VIEWS.find((entry) => entry._id === id);
  return view?.short ?? view?.name ?? "";
};

/** The states shown as a segmented row (phones: a row of pills); the rest go under "More views". */
export function primaryViews(triaged: boolean, actionItems: boolean): NoticeViewId[] {
  if (!triaged) return ["upcoming", "Closed", "Awarded", "all"];
  return actionItems ? ["review", "shortlist", "progress", "archived"] : ["review", "shortlist", "archived"];
}

/** The views under "More views", in menu order. */
export function moreViews(triaged: boolean, actionItems: boolean): NoticeViewId[] {
  const primary = new Set(primaryViews(triaged, actionItems));
  return NOTICE_VIEWS.filter((view) => !view.legacy && !primary.has(view._id) && (triaged || !view.triage) && (actionItems || !view.actionItems))
    .map((view) => view._id);
}

/** Where a list with no view in its address opens. */
export const defaultNoticeView = (triaged: boolean): NoticeViewId => (triaged ? "review" : "upcoming");

/** A view this list can show: a triage view without a triage falls back to the default. */
export function availableView(id: NoticeViewId, triaged: boolean): NoticeViewId {
  const view = NOTICE_VIEWS.find((entry) => entry._id === id);
  return view?.triage && !triaged ? defaultNoticeView(false) : id;
}

/** Views whose rows are all open: the Status column says nothing there. */
export const OPEN_VIEWS: ReadonlySet<NoticeViewId> = new Set(["review", "shortlist", "upcoming", "triage"]);

/** A row with the workspace's triage joined (triageList.tsx), or a plain row without one. */
type QueueRow = NoticeRow & { reviewed?: boolean; classification?: string; archived?: boolean };

/** Open, closing today or later; "No closing date" rows aren't. */
export const isOpenNotice = (row: NoticeRow, today: string) =>
  row.status === "Open" && row.when !== "" && row.when.slice(0, 10) >= today;

const SHORTLISTED = new Set(["doable", "possible", "needs_partner"]);

/**
 * Whether a view shows the row, for lists held in memory. Archived rows show
 * only in Archived (and nowhere at all while the triage can't be read).
 */
export function inNoticeView(
  id: NoticeViewId,
  row: QueueRow,
  today: string,
  actionItems?: ReadonlyMap<string, readonly ActionItem[]>,
): boolean {
  if (id === "archived") return row.archived === true;
  if (row.archived) return false;
  switch (id) {
    case "review": return isOpenNotice(row, today) && !row.reviewed;
    case "shortlist": return isOpenNotice(row, today) && SHORTLISTED.has(row.classification ?? "");
    case "progress": return Boolean(actionItems?.get(row._id)?.length);
    case "upcoming":
    case "triage": return isOpenNotice(row, today);
    case "Open": return row.status === "Open";
    case "all": return true;
    case "documents": return row.documents > 0;
    case "Closed":
    case "Awarded":
    case "Cancelled": return row.status === id;
  }
}

/** How many rows each view shows, and how many To review rows are new since the last visit. */
export function countNoticeViews(
  views: readonly NoticeViewId[],
  rows: readonly QueueRow[],
  today: string,
  actionItems: ReadonlyMap<string, readonly ActionItem[]> | undefined,
  fresh: ReadonlySet<string>,
): { counts: Partial<Record<NoticeViewId, number>>; newToReview: number } {
  const counts: Partial<Record<NoticeViewId, number>> = {};
  for (const view of views) counts[view] = 0;
  let newToReview = 0;
  for (const row of rows) {
    for (const view of views) {
      if (inNoticeView(view, row, today, actionItems)) {
        counts[view] = (counts[view] ?? 0) + 1;
        if (view === "review" && fresh.has(row._id)) newToReview++;
      }
    }
  }
  return { counts, newToReview };
}

const VIEW_MEMORY_PREFIX = "societyer:procurement-view";

/**
 * The view a person was last on in a list (per workspace, person and browser),
 * which the list opens on when its address names none. A view in the address
 * always wins.
 */
export function readRememberedView(societyId: string, userId: string, tableId: string): NoticeViewId | null {
  try {
    const value = window.localStorage.getItem(`${VIEW_MEMORY_PREFIX}:${societyId}:${userId}:${tableId}`);
    return isNoticeView(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberView(societyId: string, userId: string, tableId: string, view: NoticeViewId) {
  try {
    window.localStorage.setItem(`${VIEW_MEMORY_PREFIX}:${societyId}:${userId}:${tableId}`, view);
  } catch {
    // Blocked storage: the list opens on its default next time.
  }
}
