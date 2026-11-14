/**
 * A buyer's (or issued-for organisation's) overview, under BuyerPage's
 * Overview tab: open and closing soon, how much it has awarded and to whom,
 * and when it last did; the few opportunities closing soonest and the latest
 * awards, each a way into its notice; and for an issued-for organisation the
 * buyers who issue for it (for a buyer, the organisations it issues for, when
 * there are any). The tiles for the two lists open their tabs.
 *
 * It fits what the organisation has published. A small one (a municipality
 * with one open call) gets one plain sentence instead of tiles of zeros; a
 * tile with nothing to say isn't shown; a single related organisation is a
 * line, not a ranked list of one; and a lone card takes the full width.
 */
import { useMemo } from "react";
import { ChartCard } from "../../../../components/charts";
import { StatTile } from "../../../../components/StatTile";
import { count, counted, money, normalizeAwards, rank } from "../../lib/market";
import { opportunityInsights, type OpportunityInsights } from "../../lib/insights";
import { shortSourceDate } from "../../lib/notice";
import { useIsOurOrganisation } from "../../lib/ourOrganisation";
import { useProcurementClock } from "../../lib/clock";
import { toNoticeRow, type NoticeRow } from "../../../../../shared/procurementNoticeRow";
import { useReaderNavigation, type PartyField } from "../routes";
import type { ListRow } from "../source";
import { Amount, RankedCard, RankedList, foldRanked } from "../analytics/parts";
import { NoticeLinks, PREVIEW, PartyLink, UsBadge, partyKey, type PartyTab } from "./parts";

export type BuyerField = Exclude<PartyField, "supplier">;
/** "from" a buyer, "issued for" an organisation. */
export const relation = (field: BuyerField) => (field === "organization" ? "from" : "issued for");
/** At most this many notices in all, the overview leads with a sentence instead of tiles. */
const SMALL = 3;

/** What it awarded, in one currency (CAD unless it awards in another only; currencies are never added together). */
function useAwarded(awards: ListRow[]) {
  return useMemo(() => {
    const normalized = normalizeAwards(awards);
    const currency = normalized.some((award) => award.currencyCode === "CAD") ? "CAD" : (normalized[0]?.currencyCode ?? "CAD");
    const inCurrency = normalized.filter((award) => award.currencyCode === currency);
    const positive = (rows: typeof inCurrency) => rows.reduce((n, award) => n + Math.max(0, award.value ?? 0), 0);
    // Shares are of everything awarded, so they add up against the Total awarded tile;
    // what went to unknown or migrated supplier names is said, not ranked.
    const all = positive(inCurrency);
    const unnamed = positive(inCurrency.filter((award) => award.placeholder));
    const suppliers = rank(inCurrency.filter((award) => !award.placeholder), "supplier")
      .map((row) => ({ ...row, share: all > 0 ? row.positiveValue / all : 0 }));
    const latest = normalized.reduce<string | null>((last, award) => (award.date && (!last || award.date > last) ? award.date : last), null);
    return {
      currency,
      value: inCurrency.reduce((n, award) => n + (award.value ?? 0), 0),
      valued: inCurrency.filter((award) => award.value !== null).length,
      other: normalized.length - inCurrency.length,
      all,
      unnamed,
      suppliers,
      latest,
    };
  }, [awards]);
}
type Awarded = ReturnType<typeof useAwarded>;

/** The other organisations named on these notices: the ones a buyer issues for, or the buyers issuing for this one. */
function useCounterparts(field: BuyerField, opportunities: ListRow[], awards: ListRow[]) {
  return useMemo(() => {
    const names = new Map<string, number>();
    for (const row of [...opportunities, ...awards]) {
      const other = (field === "issuedFor" ? row.organization : row.issuedFor).trim();
      if (other && partyKey(other) !== partyKey(field === "issuedFor" ? row.issuedFor : row.organization))
        names.set(other, (names.get(other) ?? 0) + 1);
    }
    return [...names]
      .map(([label, n]) => ({ key: label, label, value: n }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  }, [opportunities, awards, field]);
}

/** "1 open opportunity, closing tomorrow · no published awards": a small organisation in a sentence. */
function leadSentence({ open, closing, opportunities, awards, awarded, now }: {
  open: OpportunityInsights; closing: NoticeRow[]; opportunities: number; awards: number; awarded: Awarded; now: number;
}): string {
  const next = closing[0]?.relative ? `closing ${closing[0].relative}` : "";
  const opportunityPart = open.open > 0
    ? [counted(open.open, "open opportunity", "open opportunities"), next].filter(Boolean).join(open.open === 1 ? ", " : ", the first ")
    : opportunities ? `${counted(opportunities, "opportunity", "opportunities")}, none open` : "no published opportunities";
  const awardPart = awards
    ? [counted(awards, "award"), awarded.valued ? money(awarded.value, awarded.currency, true) : "", awarded.latest ? `${awards === 1 ? "on" : "latest"} ${shortSourceDate(awarded.latest, now)}` : ""]
        .filter(Boolean)
        .join(", ")
    : "no published awards";
  const text = `${opportunityPart} · ${awardPart}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The figures, without the ones that have nothing to say (no opportunities, nothing closing, no awards, no values). */
function BuyerTiles({ open, opportunities, awards, awarded, partial, onShow }: {
  open: OpportunityInsights; opportunities: number; awards: number; awarded: Awarded; partial: boolean; onShow: (tab: PartyTab) => void;
}) {
  const now = useProcurementClock();
  const soon = open.windows.today + open.windows.week;
  const so = (text?: string) => (partial ? [text, "so far"].filter(Boolean).join(" · ") : text);
  const tiles = [
    opportunities > 0 && (
      <StatTile
        key="open"
        label="Open opportunities"
        value={count(open.open)}
        sub={so(
          [
            open.open === opportunities ? "All of them open" : `${count(opportunities)} published`,
            // The list's "Open, closing soonest" leaves these out; say so, or the counts disagree.
            open.windows.undated ? `${count(open.windows.undated)} with no closing date` : "",
          ].filter(Boolean).join(" · "),
        )}
        onClick={() => onShow("opportunities")}
        actionLabel="Show the opportunities"
      />
    ),
    (soon > 0 || open.windows.twoWeeks > 0) && (
      <StatTile
        key="soon"
        label="Closing within 7 days"
        value={count(soon)}
        tone={soon ? "warn" : "neutral"}
        sub={so(open.windows.twoWeeks ? `${count(open.windows.twoWeeks)} more in the week after` : undefined)}
      />
    ),
    awards > 0 && (
      <StatTile
        key="awards"
        label="Awards"
        value={count(awards)}
        sub={so(awarded.latest ? `Latest ${shortSourceDate(awarded.latest, now)}` : "No readable award dates")}
        onClick={() => onShow("awards")}
        actionLabel="Show the awards"
      />
    ),
    awarded.valued > 0 && (
      <StatTile
        key="value"
        label="Total awarded"
        value={<Amount value={awarded.value} currency={awarded.currency} />}
        sub={so([`${count(awarded.valued)} with values`, awarded.other ? `${count(awarded.other)} in other currencies` : ""].filter(Boolean).join(" · "))}
      />
    ),
  ].filter(Boolean);
  return <div className="stat-grid procurement-analytics__stats" data-count={tiles.length}>{tiles}</div>;
}

/** Whom it awarded to, by value, each opening the supplier's page; the smallest fold into "+N more", which opens the table. */
function TopSuppliers({ field, awarded, partial }: { field: BuyerField; awarded: Awarded; partial: boolean }) {
  const nav = useReaderNavigation();
  const ours = useIsOurOrganisation();
  const compactOf = (value: number) => money(value, awarded.currency, true);
  const exactOf = (value: number) => money(value, awarded.currency);
  const suppliers = foldRanked(
    awarded.suppliers.map((row) => ({
      key: row.name,
      label: row.name,
      value: Math.max(0, row.value),
      share: row.share,
      detail: counted(row.count, "award"),
      href: nav.partyHref("supplier", row.name),
      badge: ours(row.name) ? <UsBadge /> : undefined,
    })),
    PREVIEW,
  );
  return (
    <RankedCard
      title="Top suppliers"
      subtitle={[
        `Who ${field === "organization" ? "this buyer" : "these notices"} awarded to, by recorded value in ${awarded.currency}${partial ? ", so far" : ""}. Shares are of all ${compactOf(awarded.all)} awarded.`,
        awarded.unnamed > 0 ? `${compactOf(awarded.unnamed)} went to unnamed or migrated suppliers, not ranked here.` : "",
      ].filter(Boolean).join(" ")}
      headingLevel={3}
      table={{
        caption: "Suppliers by recorded award value",
        columns: [
          { key: "name", label: "Supplier" },
          { key: "count", label: "Awards", numeric: true },
          { key: "value", label: "Award value", numeric: true },
          { key: "share", label: "Share", numeric: true },
        ],
        rows: awarded.suppliers.map((row) => ({ name: row.name, count: count(row.count), value: exactOf(row.value), share: `${Math.round(row.share * 1000) / 10}%` })),
      }}
    >
      {(showTable) => (
        <RankedList
          rows={suppliers.rows}
          rest={suppliers.rest}
          onMore={showTable}
          ariaLabel="Top suppliers by award value"
          formatValue={compactOf}
          exactValue={exactOf}
          onSelect={(row) => nav.openParty("supplier", row.key)}
          selectLabel={(row) => `Open supplier ${row.label}`}
        />
      )}
    </RankedCard>
  );
}

export function BuyerSummary({ field, opportunities, awards, partial, onShow }: {
  field: BuyerField;
  opportunities: ListRow[];
  awards: ListRow[];
  partial: boolean;
  onShow: (tab: PartyTab) => void;
}) {
  const nav = useReaderNavigation();
  const now = useProcurementClock();
  const open = useMemo(() => opportunityInsights(opportunities, now), [opportunities, now]);
  // Open ones by closing date, undated last; the latest awards first.
  const closing = useMemo(
    () => opportunities
      .filter((row) => open.openKeys.has(row.recordKey))
      .map((row) => toNoticeRow(row, now))
      .sort((a, b) => Number(!a.when) - Number(!b.when) || a.when.localeCompare(b.when)),
    [opportunities, open, now],
  );
  const latest = useMemo(
    () => awards.map((row) => toNoticeRow(row, now)).sort((a, b) => b.when.localeCompare(a.when)).slice(0, PREVIEW),
    [awards, now],
  );
  const awarded = useAwarded(awards);
  const counterparts = useCounterparts(field, opportunities, awards);
  const counterField: PartyField = field === "issuedFor" ? "organization" : "issuedFor";
  const small = opportunities.length + awards.length <= SMALL;

  return (
    <>
      {small ? (
        <p className="procurement-party__lead">
          {leadSentence({ open, closing, opportunities: opportunities.length, awards: awards.length, awarded, now })}
          {partial ? " · so far." : "."}
        </p>
      ) : (
        <BuyerTiles open={open} opportunities={opportunities.length} awards={awards.length} awarded={awarded} partial={partial} onShow={onShow} />
      )}
      {counterparts.length === 1 && (
        <p className="procurement-party__note">
          {field === "issuedFor" ? "Notices issued by " : "Also issues notices for "}
          <PartyLink field={counterField} name={counterparts[0].label} /> ({counted(counterparts[0].value, "notice")}).
        </p>
      )}
      <div className="procurement-analytics__columns procurement-party__overview">
        {closing.length > 0 && (
          <ChartCard
            title="Closing soonest"
            subtitle={`Open opportunities ${relation(field)} this organisation${partial ? ", so far" : ""}.`}
            headingLevel={3}
            footer={closing.length > PREVIEW && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onShow("opportunities")}>
                All {count(closing.length)} open opportunities
              </button>
            )}
          >
            <NoticeLinks
              rows={closing.slice(0, PREVIEW)}
              onOpen={nav.openNotice}
              meta={(row) => (
                <span className="procurement-reader__when" data-state={row.state}>
                  {row.when ? `Closes ${row.whenText}` : row.whenText}
                  {row.relative && <small> · {row.relative}</small>}
                </span>
              )}
              aside={(row) => (row.documents ? counted(row.documents, "document") : null)}
            />
          </ChartCard>
        )}
        {latest.length > 0 && (
          <ChartCard
            title="Latest awards"
            subtitle={`Who won the most recent contracts${partial ? ", so far" : ""}.`}
            headingLevel={3}
            footer={awards.length > PREVIEW && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onShow("awards")}>
                All {count(awards.length)} awards
              </button>
            )}
          >
            <NoticeLinks
              rows={latest}
              onOpen={nav.openNotice}
              meta={(row) => (
                <>
                  {row.supplier ? <PartyLink field="supplier" name={row.supplier} /> : "Supplier not named"}
                  {row.whenText && ` · ${row.whenText}`}
                </>
              )}
              aside={(row) => (row.value === null ? null : <Amount value={row.value} currency={row.currency} />)}
            />
          </ChartCard>
        )}
        {awarded.suppliers.length > 0 && <TopSuppliers field={field} awarded={awarded} partial={partial} />}
        {counterparts.length > 1 && (
          <ChartCard
            title={field === "issuedFor" ? "Buyers who issue for them" : "Issues notices for"}
            subtitle={`${field === "issuedFor" ? "The buyers named on these notices." : "Organisations this buyer issued notices for."} Open one for its own page.`}
            headingLevel={3}
          >
            <RankedList
              rows={counterparts.slice(0, 8).map((row) => ({ ...row, href: nav.partyHref(counterField, row.key) }))}
              ariaLabel={field === "issuedFor" ? "Buyers by notices" : "Organisations by notices"}
              formatValue={(value) => counted(value, "notice")}
              onSelect={(row) => nav.openParty(counterField, row.key)}
              selectLabel={(row) => `Open ${row.label}`}
            />
          </ChartCard>
        )}
      </div>
    </>
  );
}
