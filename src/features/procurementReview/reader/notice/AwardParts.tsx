/**
 * An award notice leads with what was awarded: to whom (a link to the
 * supplier's page, marked "Us" when it is the workspace itself), for how
 * much, and when; then the opportunity it was awarded from, when that can be
 * told for certain. Further down, a few other awards to the same supplier and
 * from the same buyer, each opening its notice.
 *
 * The opportunity is matched by the source's own reference number (BC Bid
 * publishes an award with the opportunity's id) and the buyer, and only when
 * exactly one opportunity has both. It needs the whole opportunity list,
 * which the snapshot and service readers hold; the hosted reader pages its
 * list instead and shows no match rather than loading every opportunity.
 */
import { useMemo, type MouseEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "../../../../components/ui";
import { formatSourceDate, type NoticeModel } from "../../lib/notice";
import { organisationKey, useIsOurOrganisation } from "../../lib/ourOrganisation";
import { NOTICE_PARAM, useReaderNavigation, type PartyField } from "../routes";
import { plainClick } from "../ReaderHeader";
import { useReaderSource, type ListRow } from "../source";
import { PartyLink } from "./NoticeParts";

/** The facts the award card shows, which the rail then leaves out. */
export const AWARD_CARD_FACTS = ["Supplier", "Contract value", "Awarded"] as const;
const factOf = (model: NoticeModel, label: string) => model.facts.find((fact) => fact.label === label)?.value ?? "";
const referenceKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** How many of each list the page shows before "All …". */
const SHOWN = 4;

export function AwardCard({ model }: { model: NoticeModel }) {
  const supplier = factOf(model, "Supplier");
  const value = factOf(model, "Contract value");
  const awarded = factOf(model, "Awarded");
  const isOurs = useIsOurOrganisation();
  const source = useReaderSource();
  return (
    <section className="card procurement-award" aria-labelledby="procurement-award-title">
      <div className="card__body">
        <h2 className="sr-only" id="procurement-award-title">
          Award
        </h2>
        <dl className="procurement-award__facts">
          <div className="procurement-award__supplier">
            <dt>Awarded to</dt>
            <dd>
              {supplier ? (
                <>
                  <PartyLink party="supplier" name={supplier} />
                  {isOurs(supplier) && <Badge tone="success">Us</Badge>}
                </>
              ) : (
                <span className="muted">Not published</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Contract value</dt>
            <dd>{value || <span className="muted">Not published</span>}</dd>
          </div>
          <div>
            <dt>Awarded</dt>
            <dd>{awarded || <span className="muted">Not published</span>}</dd>
          </div>
        </dl>
        {!source.usePage && typeof source.useList === "function" && <AwardedFrom model={model} />}
      </div>
    </section>
  );
}

/** The one opportunity with this award's reference and buyer, or null. */
export function matchOpportunity(rows: readonly ListRow[] | undefined, reference: string, buyer: string): ListRow | null {
  const ref = referenceKey(reference);
  const buyerKey = organisationKey(buyer);
  if (!rows || !ref || !buyerKey) return null;
  const found = rows.filter((row) => referenceKey(row.reference) === ref && organisationKey(row.organization) === buyerKey);
  return found.length === 1 ? found[0] : null;
}

function AwardedFrom({ model }: { model: NoticeModel }) {
  const list = useReaderSource().useList("opportunity");
  const match = useMemo(() => matchOpportunity(list?.rows, model.reference, model.buyer), [list, model.reference, model.buyer]);
  if (!match) return null;
  return (
    <p className="procurement-award__origin">
      <span className="muted">Awarded from the opportunity</span> <NoticeLink row={match} />
    </p>
  );
}

/** A notice's title that opens it over this one (a new history entry, so Back returns here). */
function NoticeLink({ row }: { row: ListRow }) {
  const nav = useReaderNavigation();
  const href = useMemo(() => {
    const next = new URLSearchParams(nav.params);
    next.set(NOTICE_PARAM, row.recordKey);
    next.delete("tab");
    return `?${next.toString()}`;
  }, [nav.params, row.recordKey]);
  return (
    <a
      className="procurement-award__link"
      href={href}
      onClick={(event: MouseEvent) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.openNotice(row.recordKey);
      }}
    >
      {row.title}
    </a>
  );
}

const money = (value: number | null, currency: string) =>
  value === null || !Number.isFinite(value) ? "" : new Intl.NumberFormat("en-CA", { style: "currency", currency: currency || "CAD", maximumFractionDigits: 0 }).format(value);

/** Other awards to this award's supplier and from its buyer, newest first. */
export function RelatedAwards({ model, recordKey }: { model: NoticeModel; recordKey: string }) {
  const source = useReaderSource();
  if (typeof source.useList !== "function") return null;
  return <RelatedAwardLists supplier={factOf(model, "Supplier")} buyer={model.buyer} recordKey={recordKey} />;
}

function RelatedAwardLists({ supplier, buyer, recordKey }: { supplier: string; buyer: string; recordKey: string }) {
  const list = useReaderSource().useList("award");
  const related = useMemo(() => {
    const rows = (list?.rows ?? []).filter((row) => row.recordKey !== recordKey);
    const newest = (a: ListRow, b: ListRow) => b.date.localeCompare(a.date);
    const of = (name: string, pick: (row: ListRow) => string) => {
      const key = organisationKey(name);
      return key ? rows.filter((row) => organisationKey(pick(row)) === key).sort(newest) : [];
    };
    return { bySupplier: of(supplier, (row) => row.supplier), byBuyer: of(buyer, (row) => row.organization) };
  }, [list, supplier, buyer, recordKey]);
  if (!related.bySupplier.length && !related.byBuyer.length) return null;
  return (
    <div className="procurement-related">
      {related.bySupplier.length > 0 && (
        <RelatedList id="procurement-related-supplier" title="Other awards to this supplier" rows={related.bySupplier} party="supplier" name={supplier} other="buyer" />
      )}
      {related.byBuyer.length > 0 && (
        <RelatedList id="procurement-related-buyer" title="Other awards from this buyer" rows={related.byBuyer} party="organization" name={buyer} other="supplier" />
      )}
    </div>
  );
}

function RelatedList({
  id,
  title,
  rows,
  party,
  name,
  other,
}: {
  id: string;
  title: string;
  rows: ListRow[];
  party: PartyField;
  name: string;
  /** Which party each row names: the buyer under a supplier's awards, the supplier under a buyer's. */
  other: "buyer" | "supplier";
}) {
  const nav = useReaderNavigation();
  const isOurs = useIsOurOrganisation();
  return (
    <section className="card procurement-related__list" aria-labelledby={id}>
      <div className="card__head">
        <h2 className="card__title" id={id}>
          {title} <span className="procurement-notice__count">{rows.length}</span>
        </h2>
      </div>
      <ul className="card__body">
        {rows.slice(0, SHOWN).map((row) => {
          const party = other === "buyer" ? row.organization : row.supplier;
          return (
            <li key={row.recordKey}>
              <NoticeLink row={row} />
              <span className="procurement-related__meta">
                {party && <span>{party}</span>}
                {other === "supplier" && isOurs(row.supplier) && <Badge tone="success">Us</Badge>}
                {[money(row.value, row.currency), row.date ? formatSourceDate(row.date) : ""].filter(Boolean).map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > SHOWN && (
        <div className="card__footer procurement-related__foot">
          <a
            className="btn btn--ghost btn--sm"
            href={nav.partyHref(party, name)}
            onClick={(event) => {
              if (!plainClick(event)) return;
              event.preventDefault();
              nav.openParty(party, name);
            }}
          >
            All {rows.length + 1} awards {party === "supplier" ? "to" : "from"} {name} <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
      )}
    </section>
  );
}
