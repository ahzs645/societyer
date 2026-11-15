/**
 * Picks a UNSPSC commodity code, for the BC Bid filters or the award
 * analysis's commodity filter, from a dialog: search
 * by title words or code, or browse the hierarchy (segment → family → class
 * → commodity) with breadcrumbs, choosing any level. A segment, family or
 * class includes everything under it, as the filter matches by prefix.
 *
 * Each code shows how many notices fall under it (`counting`): for the BC
 * Bid filters, those in the loaded list that match the editor's other BC Bid
 * filters, of any status; for the analysis, the published awards, counted
 * where the analysis runs. Most of the ~90k codes have none, so by default
 * only codes with notices are listed.
 *
 * The full code list comes from the source (`loadTaxonomy`, the catalog
 * service). Where there is none (the demo, the older hosted reader, a
 * service not yet serving it), the picker lists the codes the loaded notices
 * (or the counted awards) carry, titled where the notices name them.
 *
 * It opens from inside the filter editor, which closes on an outside press
 * and applies on Enter; the dialog lives in a portal, so its presses and
 * keys are kept from reaching the editor (`guard`).
 */
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, ChevronRight, Search } from "lucide-react";
import { Modal } from "../../../../components/Modal";
import { Checkbox } from "../../../../components/Controls";
import type { BcBidSourceFilters } from "../../../../../shared/bcBidSourceFilters";
import { rememberCommodityTitles } from "../commodity/titles";
import { useReaderSource, type ListRow, type TaxonomyCodeList } from "../source";
import {
  LEVEL_NAMES,
  noticeCounts,
  searchTree,
  treeFromList,
  treeFromRows,
  unspscAncestors,
  unspscParent,
  type CommodityNode,
  type CommodityTree,
} from "./commodityTree";

const PLURALS = ["segments", "families", "classes", "commodities"];
/** Search results shown at once; a narrower search finds the rest. */
const RESULT_LIMIT = 150;

const trees = new WeakMap<TaxonomyCodeList, CommodityTree>();
function treeOf(list: TaxonomyCodeList) {
  let tree = trees.get(list);
  if (!tree) trees.set(list, (tree = treeFromList(list)));
  return tree;
}

type Loaded = { tree: CommodityTree | null; failed: boolean };

/**
 * What the counts beside each code are: the loaded notices that match the
 * BC Bid editor's other filters, or awards per code as the analysis counted
 * them (where it runs on the server, the awards themselves aren't loaded).
 */
export type CommodityCounting =
  | { of: "notices"; filters: BcBidSourceFilters }
  | { of: "awards"; codes: readonly (readonly [string, number])[] };

export default function CommodityPicker({
  value,
  rows,
  counting,
  onClose,
  onChoose,
}: {
  value: string;
  /** The loaded notices: counted for the BC Bid filters, and where there's no full code list, the titles. */
  rows: readonly ListRow[];
  counting: CommodityCounting;
  onClose: () => void;
  /** `code` is "" to clear the filter. */
  onChoose: (code: string, title: string) => void;
}) {
  const source = useReaderSource();
  const [loaded, setLoaded] = useState<Loaded | null>(source.loadTaxonomy ? null : { tree: null, failed: false });
  useEffect(() => {
    if (!source.loadTaxonomy) return;
    let live = true;
    source.loadTaxonomy("UNSPSC").then(
      (list) => live && setLoaded({ tree: list && list.terms.length ? treeOf(list) : null, failed: false }),
      () => live && setLoaded({ tree: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [source]);
  const counts = useMemo(
    () => (counting.of === "notices" ? noticeCounts(rows, counting.filters) : new Map(counting.codes)),
    [rows, counting],
  );
  const fallback = useMemo(() => treeFromRows(rows, counting.of === "awards" ? counts.keys() : []), [rows, counting.of, counts]);
  const tree = loaded?.tree ?? fallback;
  const noun = counting.of === "awards" ? "award" : "notice";

  // A chosen code without notices (from a link, or picked with the toggle off) stays in sight.
  const [only, setOnly] = useState(() => !value || (counts.get(value) ?? 0) > 0);
  const keep = (code: string) => !only || (counts.get(code) ?? 0) > 0;
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  // Clearing the search (or leaving it for the hierarchy) shows the hierarchy at once.
  const deferredQuery = query.trim() ? deferred : "";
  const searching = deferredQuery.length >= 2 || /\d/.test(deferredQuery);
  const [at, setAt] = useState<string | null>(() => (/^\d{8}$/.test(value) ? unspscParent(value) : null));
  const here = at && tree.nodes.has(at) ? tree.nodes.get(at)! : null;

  // The chosen code's title, kept for the field (and anything else naming it) once the picker closes.
  const valueTitle = tree.nodes.get(value)?.title;
  useEffect(() => {
    if (valueTitle) rememberCommodityTitles([[value, valueTitle]]);
  }, [value, valueTitle]);

  const listed: CommodityNode[] = useMemo(() => {
    if (searching) return searchTree(tree, deferredQuery, (code) => !only || (counts.get(code) ?? 0) > 0);
    const codes = here ? here.children : tree.roots;
    return codes.filter((code) => !only || (counts.get(code) ?? 0) > 0).map((code) => tree.nodes.get(code)!);
  }, [searching, tree, deferredQuery, only, counts, here]);

  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Where focus goes after moving through the hierarchy: the first row, or the row of the level just left. */
  const focusNext = useRef<string | null>(null);
  const go = (code: string | null, focus: string = "first") => {
    focusNext.current = focus;
    setQuery("");
    setAt(code);
  };
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target || !listRef.current) return;
    focusNext.current = null;
    const row = target === "first"
      ? listRef.current.querySelector<HTMLElement>("[data-row-main]")
      : listRef.current.querySelector<HTMLElement>(`[data-row-main="${target}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [at]);
  // Opened on a chosen code: show it among its siblings.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || loaded === null || !value) return;
    scrolled.current = true;
    listRef.current?.querySelector(`[data-row-main="${value}"]`)?.scrollIntoView({ block: "center" });
  }, [loaded, value]);

  const choose = (node: CommodityNode) => {
    if (node.title) rememberCommodityTitles([[node.code, node.title]]);
    onChoose(node.code, node.title);
  };

  /** Arrow keys move between rows; right opens a level, left goes back up. */
  const onListKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const mains = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-row-main]") ?? []);
    const row = target?.closest<HTMLElement>("[data-row]");
    const index = row ? mains.findIndex((main) => row.contains(main)) : -1;
    const move = (next: number) => {
      event.preventDefault();
      mains[Math.max(0, Math.min(mains.length - 1, next))]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp" && index > 0) move(index - 1);
    else if (event.key === "ArrowUp") {
      event.preventDefault();
      searchRef.current?.focus();
    }
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(mains.length - 1);
    else if (event.key === "ArrowRight" && row?.dataset.row && row.dataset.branch !== undefined) {
      event.preventDefault();
      go(row.dataset.row);
    } else if (event.key === "ArrowLeft" && here && !searching) {
      event.preventDefault();
      go(unspscParent(here.code), here.code);
    }
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      listRef.current?.querySelector<HTMLElement>("[data-row-main]")?.focus();
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    }
  };

  /**
   * The dialog is portalled out of the filter editor but still inside it for
   * React: a press in it would read as outside the editor (closing it), and
   * Enter in a field would apply the editor. Escape closes only this dialog.
   */
  const guard = (event: ReactKeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
    }
  };

  const count = (code: string) => counts.get(code) ?? 0;
  const fullList = loaded?.tree != null;

  const note = loaded === null
    ? "Loading the UNSPSC code list…"
    : !fullList
      ? `${loaded.failed ? "The full UNSPSC list couldn't be loaded" : "The full UNSPSC list isn't available here"}, so this lists the codes the ${noun === "award" ? "published awards" : "loaded notices"} carry.`
      : searching
        ? `${listed.length.toLocaleString()} ${listed.length === 1 ? "code matches" : "codes match"}${listed.length > RESULT_LIMIT ? `; the first ${RESULT_LIMIT} are shown. Add words to narrow it.` : "."}`
        : listed.length
          ? `${listed.length.toLocaleString()} ${listed.length === 1 ? LEVEL_NAMES[here ? here.level + 1 : 0].toLowerCase() : PLURALS[here ? here.level + 1 : 0]}${only ? ` with ${noun}s` : ""}`
          : "";

  return (
    <span hidden onKeyDown={guard} onPointerDown={(event) => event.stopPropagation()}>
      <Modal
        open
        onClose={onClose}
        title="Commodity code (UNSPSC)"
        size="lg"
        resizable={false}
        className="procurement-commodity-picker"
        footer={
          <>
            {value && (
              <button type="button" className="btn procurement-commodity-picker__clear" onClick={() => onChoose("", "")}>
                Clear code
              </button>
            )}
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          </>
        }
      >
        <div className="procurement-commodity-picker__tools">
          <label className="procurement-commodity-picker__search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              className="input"
              type="search"
              data-autofocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Search by title or code"
              aria-label="Search commodity codes by title or code"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKey}
            />
          </label>
          <Checkbox checked={only} onChange={setOnly} label={`Only codes that have ${noun}s`} />
        </div>
        <p className="procurement-commodity-picker__note">
          {counting.of === "awards"
            ? "Counts are published awards classified under each code, before the analysis's other filters."
            : "Counts are notices in this list that match your other BC Bid filters, of any status."}
        </p>
        {!searching && <Crumbs tree={tree} here={here} go={go} />}
        {!searching && here && (
          <div className="procurement-commodity-picker__here">
            <div>
              <span className="procurement-commodity-picker__level">{LEVEL_NAMES[here.level]}</span>
              <strong>
                <span className="procurement-commodity-picker__code">{here.code}</span> {titleOf(here)}
              </strong>
              <span className="procurement-commodity-picker__here-count">
                {count(here.code).toLocaleString()} {count(here.code) === 1 ? noun : `${noun}s`}, everything under it included
              </span>
            </div>
            <button type="button" className="btn btn--primary btn--sm" onClick={() => choose(here)}>
              Choose this {LEVEL_NAMES[here.level].toLowerCase()}
            </button>
          </div>
        )}
        <p className="procurement-commodity-picker__status" role="status">{note}</p>
        {loaded !== null && (
          <div className="procurement-commodity-picker__scroll">
            {listed.length > 0 ? (
              <ul ref={listRef} className="procurement-commodity-picker__list" aria-label="Commodity codes" onKeyDown={onListKey}>
                {listed.slice(0, RESULT_LIMIT).map((node) => (
                  <CodeRow
                    key={node.code}
                    node={node}
                    count={count(node.code)}
                    noun={noun}
                    current={node.code === value}
                    // A level with codes under it opens (from a search too, leaving the search); its Choose picks it.
                    opens={node.children.some(keep)}
                    path={searching ? unspscAncestors(node.code).map((code) => tree.nodes.get(code)?.title || code) : null}
                    onOpen={() => go(node.code)}
                    onChoose={() => choose(node)}
                  />
                ))}
              </ul>
            ) : (
              <div className="procurement-commodity-picker__empty">
                <p>
                  {searching
                    ? `No ${only ? `codes with ${noun}s` : "codes"} match “${deferredQuery}”.`
                    : only
                      ? here
                        ? `No ${noun}s ${noun === "award" ? "published" : "in this list"} fall under this code.`
                        : noun === "award"
                          ? "No published awards carry a commodity code."
                          : "No notices in this list carry a commodity code that matches your other BC Bid filters."
                      : "No codes here."}
                </p>
                {only && fullList && (
                  <button type="button" className="btn btn--sm" onClick={() => setOnly(false)}>
                    Show all codes
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </span>
  );
}

const titleOf = (node: CommodityNode) => node.title || `Untitled ${LEVEL_NAMES[node.level].toLowerCase()}`;

/** "All segments › 72000000 Building … › 72100000 …"; each earlier level is a step back up. */
function Crumbs({ tree, here, go }: { tree: CommodityTree; here: CommodityNode | null; go: (code: string | null, focus?: string) => void }) {
  const crumbs = here ? [...unspscAncestors(here.code), here.code] : [];
  return (
    <nav className="procurement-commodity-picker__crumbs" aria-label="Where you are in the code list">
      <ol>
        <li>
          {here ? (
            <button type="button" onClick={() => go(null, crumbs[0])}>All segments</button>
          ) : (
            <span aria-current="location">All segments</span>
          )}
        </li>
        {crumbs.map((code, index) => {
          const label = `${code} ${tree.nodes.get(code)?.title ?? ""}`.trim();
          return (
            <li key={code}>
              <ChevronRight size={12} aria-hidden="true" />
              {index === crumbs.length - 1 ? (
                <span aria-current="location" title={label}>{label}</span>
              ) : (
                <button type="button" title={label} onClick={() => go(code, crumbs[index + 1])}>{label}</button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * One code: the row opens the level below (or, at the bottom, chooses the
 * code); "Choose" picks a level with everything under it. Search results
 * also say where the code sits.
 */
function CodeRow({
  node,
  count,
  noun,
  current,
  opens,
  path,
  onOpen,
  onChoose,
}: {
  node: CommodityNode;
  count: number;
  noun: string;
  current: boolean;
  opens: boolean;
  path: string[] | null;
  onOpen: () => void;
  onChoose: () => void;
}) {
  const notices = `${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`;
  return (
    <li data-row={node.code} data-branch={opens ? "" : undefined} className="procurement-commodity-picker__row">
      <button
        type="button"
        data-row-main={node.code}
        className="procurement-commodity-picker__main"
        aria-current={current ? "true" : undefined}
        aria-label={`${node.code} ${titleOf(node)}, ${notices}${opens ? `, open its ${PLURALS[node.level + 1]}` : ", choose"}`}
        onClick={opens ? onOpen : onChoose}
      >
        <span className="procurement-commodity-picker__code">{node.code}</span>
        <span className="procurement-commodity-picker__label">
          <span className={node.title ? undefined : "procurement-commodity-picker__untitled"}>{titleOf(node)}</span>
          {path && (
            <small>
              {LEVEL_NAMES[node.level]}
              {path.length ? ` in ${path.join(" › ")}` : ""}
            </small>
          )}
        </span>
        <span className="procurement-commodity-picker__count" title={notices} aria-hidden="true">
          {count ? count.toLocaleString() : "–"}
        </span>
        {current && <Check size={14} className="procurement-commodity-picker__current" aria-hidden="true" />}
        <span className="procurement-commodity-picker__chev" aria-hidden="true">{opens && <ChevronRight size={14} />}</span>
      </button>
      {/* A commodity (or a level with nothing listed under it) is chosen by its row; the slot keeps the counts in line. */}
      {opens ? (
        <button type="button" className="btn btn--sm procurement-commodity-picker__choose" aria-label={`Choose ${node.code} ${titleOf(node)}`} onClick={onChoose}>
          Choose
        </button>
      ) : (
        <span className="procurement-commodity-picker__choose" aria-hidden="true" />
      )}
    </li>
  );
}
