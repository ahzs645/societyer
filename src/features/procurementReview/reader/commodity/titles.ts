/**
 * What a UNSPSC code is called, wherever the reader names one: a commodity
 * page and its breadcrumb, the analytics' commodity chip, the list's
 * commodity filter. The full code list is licensed and comes only from a
 * source that serves it (`loadTaxonomy`, the catalog service); elsewhere the
 * notices themselves name the codes they carry and those codes' ancestors
 * (a notice's `commodityClassifications`, which the demo and Convex keep in
 * each list row and every notice keeps in its body).
 *
 * Titles seen once (on a notice, in the picker, in the loaded rows) are kept
 * for the page's life, so a code stays titled on the next page that names it.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { isUnspscCode } from "../../../../../shared/unspsc";
import { useReaderSource, type ListRow, type ReaderSource } from "../source";

const known = new Map<string, string>();
/** The source's full code list, once a page has needed a title the notices don't give. */
let full: Map<string, string> | null = null;
const asked = new WeakSet<ReaderSource>();
let version = 0;
const listeners = new Set<() => void>();
const changed = () => {
  version += 1;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const current = () => version;

/** Keeps titles for later pages: from a notice's classifications, the picker, the loaded rows. */
export function rememberCommodityTitles(entries: Iterable<readonly [string, string]>) {
  let added = false;
  for (const [code, title] of entries) {
    if (!isUnspscCode(code) || !title || known.get(code) === title) continue;
    known.set(code, title);
    added = true;
  }
  if (added) changed();
}

const lookup = (code: string) => known.get(code) || full?.get(code) || "";

/** A known title, without subscribing (for an event handler or a one-off read). */
export const knownCommodityTitle = lookup;

/**
 * Titles for codes, as a lookup that follows what arrives. When any of
 * `needed` has no title yet and the source serves the full code list, the
 * list is read once (the picker shares it), then every code is titled.
 */
export function useCommodityTitles(needed: readonly string[]): (code: string) => string {
  const source = useReaderSource();
  const at = useSyncExternalStore(subscribe, current);
  const missing = needed.some((code) => isUnspscCode(code) && !lookup(code));
  useEffect(() => {
    if (!missing || full || !source.loadTaxonomy || asked.has(source)) return;
    asked.add(source);
    source.loadTaxonomy("UNSPSC").then(
      (list) => {
        if (!list?.terms.length) return;
        full = new Map(list.terms);
        changed();
      },
      // A passing failure can be retried by the next page that needs a title.
      () => asked.delete(source),
    );
  }, [missing, source]);
  // A new lookup whenever titles arrive, so memoised readers of it recompute.
  return useCallback((code: string) => lookup(code), [at]); // eslint-disable-line react-hooks/exhaustive-deps -- `at` changes as titles arrive
}

/**
 * The title the loaded rows give a code: `"code":"72000000","title":"…"` as
 * stored in a row's `commodityClassifications`, either a classification or
 * one of its ancestors. Cheaper than reading every row's facts for one code.
 */
export function titleInRows(rows: readonly ListRow[], code: string): string {
  if (!isUnspscCode(code)) return "";
  for (const row of rows) {
    const json = row.analyticsJson;
    if (!json?.includes(`"${code}"`) || !json.includes("commodityClassifications")) continue;
    const match = new RegExp(`"code":"${code}","title":"((?:[^"\\\\]|\\\\.)*)"`).exec(json);
    if (!match) continue;
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return "";
    }
  }
  return "";
}

/** One code's title: known, from `rows` where given, or the source's full list. "" when none of them names it. */
export function useCommodityTitle(code: string, rows?: readonly ListRow[]): string {
  const fromRows = useMemo(() => (rows && code ? titleInRows(rows, code) : ""), [rows, code]);
  const titles = useCommodityTitles(code && !fromRows ? [code] : []);
  return (code && titles(code)) || fromRows;
}
