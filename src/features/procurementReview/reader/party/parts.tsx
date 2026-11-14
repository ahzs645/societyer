/**
 * Pieces the organisation pages share: the buyer and issued-for pages
 * (BuyerPage.tsx) and the supplier page (SupplierPage.tsx). The tab row and
 * its URL state, the short lists of notices on an overview, and the link to
 * another organisation's page, marked "Us" when it is the workspace's own.
 */
import type { ReactNode } from "react";
import { Tabs } from "../../../../components/primitives";
import { Pill } from "../../../../components/ui";
import { useIsOurOrganisation } from "../../lib/ourOrganisation";
import { procurementPartyKey } from "../../../../../shared/procurementAnalytics";
import type { NoticeRow } from "../../../../../shared/procurementNoticeRow";
import { plainClick } from "../ReaderHeader";
import { PARTY_TAB_PARAM, useReaderNavigation, type PartyField } from "../routes";
import type { RecordList } from "../source";

/** Not a registered route: the header shows no icon tile beside a long organisation name. */
export const PARTY_ROUTE_KEY = "procurement-review/party";
/** The notice page's rule for "the same organisation" (lib/notice.ts `partyCount`): case, spacing and punctuation don't matter. */
export const partyKey = procurementPartyKey;
export const titleOf = (name: string) => name || "Unnamed organisation";
/** How many notices the overview's short lists show before "All …". */
export const PREVIEW = 5;

export type PartyTab = "overview" | "opportunities" | "awards";
export type NoticeTab = Exclude<PartyTab, "overview">;
const isPartyTab = (value: string | null): value is PartyTab =>
  value === "overview" || value === "opportunities" || value === "awards";

/** The tab showing, from the URL; changing it replaces the history entry rather than adding one. */
export function usePartyTab(fallback: PartyTab = "overview") {
  const nav = useReaderNavigation();
  const requested = nav.params.get(PARTY_TAB_PARAM);
  const tab: PartyTab = isPartyTab(requested) ? requested : fallback;
  const setTab = (next: PartyTab) =>
    nav.update({ [PARTY_TAB_PARAM]: next === fallback ? null : next });
  return [tab, setTab] as const;
}

/** The tab row and the panel it controls. */
export function PartyTabs<T extends PartyTab>({
  tab,
  onChange,
  items,
  trailing,
  children,
}: {
  tab: T;
  onChange: (tab: T) => void;
  items: { id: T; label: string; count?: number | null }[];
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Tabs
        value={tab}
        onChange={onChange}
        items={items}
        trailing={trailing}
        tabRoles
        ariaLabel="Organisation sections"
      />
      <div
        role="tabpanel"
        aria-label={items.find((item) => item.id === tab)?.label}
        className="procurement-party__panel"
      >
        {children}
      </div>
    </>
  );
}

export const progressOf = (list: RecordList) => ({
  loaded: list.rows.length,
  total: list.total,
  done: list.done,
});

/** "Us": the workspace's own organisation, wherever it is named. */
export function UsBadge() {
  return (
    <Pill size="sm" tone="accent" className="procurement-party__us" title="Your organisation">
      Us
    </Pill>
  );
}

/**
 * Another organisation's name as a link to its page: a plain click opens it
 * in the reader (Back returns here), a middle-click in a new tab. The
 * workspace's own organisation carries "Us".
 */
export function PartyLink({ field, name }: { field: PartyField; name: string }) {
  const nav = useReaderNavigation();
  const ours = useIsOurOrganisation();
  return (
    <>
      <a
        className="procurement-party__link"
        href={nav.partyHref(field, name)}
        onClick={(event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          nav.openParty(field, name);
        }}
      >
        {name}
      </a>
      {ours(name) && <> <UsBadge /></>}
    </>
  );
}

/**
 * A short list of notices, each opening its page: the title, a line under it,
 * and a figure at the right. The whole row opens the notice; a link in the
 * line under the title (a supplier, a buyer) opens that organisation instead.
 */
export function NoticeLinks({
  rows,
  onOpen,
  meta,
  aside,
}: {
  rows: NoticeRow[];
  onOpen: (recordKey: string) => void;
  meta: (row: NoticeRow) => ReactNode;
  aside: (row: NoticeRow) => ReactNode;
}) {
  return (
    <ul className="procurement-party__notices">
      {rows.map((row) => (
        <li key={row._id} className="procurement-party__notice">
          <button
            type="button"
            className="procurement-party__notice-open"
            onClick={() => onOpen(row._id)}
          >
            {row.title}
          </button>
          <span className="procurement-party__notice-aside">{aside(row)}</span>
          <span className="procurement-party__notice-meta muted">{meta(row)}</span>
        </li>
      ))}
    </ul>
  );
}
