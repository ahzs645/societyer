import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { Drawer, EmptyState } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { formatDate } from "../../../lib/format";

export type DrilldownItem = {
  id: string;
  date: string;
  primary: ReactNode;
  secondary?: ReactNode;
  /** Small chips (fund, program, counterparty). */
  tags?: string[];
  debitCents?: number;
  creditCents?: number;
  /** Signed amount for single-column sources (bank transactions). */
  amountCents?: number;
  ledgerHref?: string;
  transactionHref?: string;
};

/**
 * Drawer behind a report amount: the journal lines or bank transactions that
 * make up the figure, each with a link back to its source. When the source
 * rows aren't available, pass `composition` to explain how the figure is built
 * instead of inventing entries.
 */
export function FinanceDrilldownDrawer({
  open,
  onClose,
  title,
  subtitle,
  totalCents,
  totalLabel = "Total",
  currency,
  items,
  composition,
  emptyText = "No posted entries make up this amount.",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  totalCents?: number | null;
  totalLabel?: string;
  currency?: string;
  items: DrilldownItem[];
  composition?: ReactNode;
  emptyText?: string;
}) {
  const hasSides = items.some((item) => item.debitCents != null || item.creditCents != null);
  const debitTotal = items.reduce((sum, item) => sum + (item.debitCents ?? 0), 0);
  const creditTotal = items.reduce((sum, item) => sum + (item.creditCents ?? 0), 0);
  return (
    <Drawer open={open} onClose={onClose} title={title} size="wide">
      <div className="finance-drilldown">
        <div className="finance-drilldown__summary">
          {subtitle && <div className="finance-drilldown__subtitle muted">{subtitle}</div>}
          {totalCents != null && (
            <div className="finance-drilldown__total">
              <span className="muted">{totalLabel}</span>
              <Money cents={totalCents} currency={currency} negativeStyle="parentheses" variant="hero" />
            </div>
          )}
        </div>
        {composition && <div className="finance-drilldown__composition">{composition}</div>}
        {items.length > 0 ? (
          <>
            <ul className="finance-drilldown__list" aria-label={`${items.length} ${items.length === 1 ? "entry" : "entries"}`}>
              {items.map((item) => (
                <li key={item.id} className="finance-drilldown__item">
                  <div className="finance-drilldown__item-main">
                    <div className="finance-drilldown__item-title">{item.primary}</div>
                    <div className="finance-drilldown__item-meta muted">
                      <span>{formatDate(item.date)}</span>
                      {item.secondary && <span>· {item.secondary}</span>}
                    </div>
                    {item.tags && item.tags.length > 0 && (
                      <div className="finance-drilldown__tags">
                        {item.tags.map((tag) => <span key={tag} className="cell-tag">{tag}</span>)}
                      </div>
                    )}
                    {(item.ledgerHref || item.transactionHref) && (
                      <div className="finance-drilldown__links">
                        {item.ledgerHref && (
                          <Link to={item.ledgerHref} className="btn btn--ghost btn--sm" onClick={onClose}>
                            <BookOpen size={12} aria-hidden="true" /> Open in ledger
                          </Link>
                        )}
                        {item.transactionHref && (
                          <Link to={item.transactionHref} className="btn btn--ghost btn--sm" onClick={onClose}>
                            <ArrowUpRight size={12} aria-hidden="true" /> Open transaction
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="finance-drilldown__amounts">
                    {hasSides ? (
                      <>
                        {item.debitCents ? <span><span className="finance-drilldown__side">Dr</span> <Money cents={item.debitCents} currency={currency} /></span> : null}
                        {item.creditCents ? <span><span className="finance-drilldown__side">Cr</span> <Money cents={item.creditCents} currency={currency} /></span> : null}
                      </>
                    ) : (
                      <Money cents={item.amountCents ?? 0} currency={currency} tone={(item.amountCents ?? 0) > 0 ? "in" : "auto"} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hasSides && (
              <div className="finance-drilldown__footer">
                <span className="muted">{items.length} line{items.length === 1 ? "" : "s"}</span>
                <span>Dr <Money cents={debitTotal} currency={currency} /></span>
                <span>Cr <Money cents={creditTotal} currency={currency} /></span>
              </div>
            )}
          </>
        ) : (
          !composition && <EmptyState size="sm" title="Nothing to show" description={emptyText} />
        )}
      </div>
    </Drawer>
  );
}
