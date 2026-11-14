/**
 * "Our work": the kinds of work this organisation bids on, as a few keywords
 * (and optionally place names), so the award analysis can show the part of
 * the market that matters to it rather than every award in the province.
 *
 * Kept in this browser, per workspace and person, because nothing on the
 * server stores it yet: it never reaches other people or devices, and the
 * editor says so. Matching is plain and explainable: an award is ours when
 * its title or procurement type mentions a keyword (and, with places set, its
 * title or source region names one). It runs where the analysis runs in the
 * browser; the hosted server analysis can't filter by keywords, so the toggle
 * isn't offered there.
 */
import { useCallback, useSyncExternalStore } from "react";
import { useSociety } from "../../../../hooks/useSociety";
import { useCurrentUserId } from "../../../../hooks/useCurrentUser";
import { analyticalFields } from "../../lib/market";
import type { ListRow } from "../source";

export type OurWork = { keywords: string[]; regions: string[] };

const KEY = (societyId: string, userId: string) => `societyer.procurementOurWork.${societyId}.${userId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; work: OurWork | null }>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function read(key: string): OurWork | null {
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.work;
  let work: OurWork | null = null;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const { keywords, regions } = parsed as Record<string, unknown>;
      const next = { keywords: strings(keywords), regions: strings(regions) };
      work = next.keywords.length || next.regions.length ? next : null;
    }
  } catch {
    /* A damaged entry reads as none set. */
  }
  cache.set(key, { raw, work });
  return work;
}

/** The saved set for this workspace and person, and a way to change or clear it. */
export function useOurWork(): { work: OurWork | null; save: (next: OurWork | null) => void } {
  const society = useSociety();
  const userId = useCurrentUserId();
  const key = KEY(society?._id ?? "none", userId ?? "anonymous");
  const work = useSyncExternalStore(subscribe, () => read(key));
  const save = useCallback(
    (next: OurWork | null) => {
      try {
        if (next && (next.keywords.length || next.regions.length)) window.localStorage.setItem(key, JSON.stringify(next));
        else window.localStorage.removeItem(key);
      } catch {
        /* A private window: the change lasts until the page reloads. */
        cache.set(key, { raw: readRaw(key), work: next });
      }
      for (const listener of listeners) listener();
    },
    [key],
  );
  return { work, save };
}

/** "facilitation, engagement\nsurvey" → ["facilitation", "engagement", "survey"], each once. */
export function parseTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const term = part.replace(/\s+/g, " ").trim();
    if (term && !seen.has(term.toLowerCase())) {
      seen.add(term.toLowerCase());
      terms.push(term);
    }
  }
  return terms.slice(0, 40);
}

const folded = (value: string) => value.toLowerCase().replace(/\s+/g, " ");
const mentions = (text: string, terms: string[]) => terms.some((term) => text.includes(folded(term)));

/** A predicate for the award rows that are "our work". */
export function ourWorkMatcher(work: OurWork): (row: ListRow) => boolean {
  return (row) => {
    const text = folded(`${row.title} ${row.procurementType}`);
    if (work.keywords.length && !mentions(text, work.keywords)) return false;
    if (!work.regions.length) return true;
    let region: unknown[] = [];
    try {
      const extra = analyticalFields(row);
      region = [extra.sourceRegionPath, extra.sourceRegionCodes].flat();
    } catch {
      /* Unreadable analytical fields: the title alone decides. */
    }
    return mentions(folded(`${row.title} ${region.filter((item) => typeof item === "string").join(" ")}`), work.regions);
  };
}

/** "facilitation, engagement and 3 more": the set in a few words. */
export function describeOurWork(work: OurWork): string {
  const terms = [...work.keywords, ...work.regions];
  return terms.length > 3 ? `${terms.slice(0, 3).join(", ")} and ${terms.length - 3} more` : terms.join(", ");
}
