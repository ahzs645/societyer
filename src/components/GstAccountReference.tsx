import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { organizationGstAccountReference, type GstAccountIdentifier } from "../../shared/gstAccountReference";
import { calendarDateKey } from "../lib/calendarDates";
import { TooltipCopyable } from "./TooltipCopyable";

/** Reuses the organization's identifier records. It does not create another
 * editable GST field on each invoice or filing. */
export function GstAccountReference({ identifiers, canRead = true, asOfDate, actions, filing = false }: {
  identifiers?: GstAccountIdentifier[];
  canRead?: boolean;
  asOfDate?: string;
  actions?: ReactNode;
  filing?: boolean;
}) {
  const headingId = useId();
  const reference = identifiers ? organizationGstAccountReference(identifiers, asOfDate ?? calendarDateKey(new Date())) : undefined;
  return <section className="card" aria-labelledby={headingId} data-testid="gst-account-reference" style={{ marginBottom: 16 }}>
    <div className="card__head" style={{ flexWrap: "wrap", gap: 8 }}>
      <h2 className="card__title" id={headingId}>Organization GST/HST account</h2>
      {actions}
    </div>
    <div className="card__body">
      {!canRead ? <p className="muted" style={{ margin: 0 }}>Organization read access is required to view the saved GST/HST account.</p>
        : !reference ? <p className="muted" style={{ margin: 0 }} role="status">Loading the organization GST/HST account…</p>
        : <>
          {reference.number && <div style={{ marginBottom: 8 }}><TooltipCopyable value={reference.number} label="organization GST/HST account" /></div>}
          <p className="muted" style={{ margin: 0 }} role={reference.status === "ready" ? undefined : "status"}>{reference.status === "ready" && !filing
            ? "Saved for this organization. Active registrations are available when you prepare invoices and GST/HST filings."
            : reference.message}</p>
          {filing && <p className="muted" style={{ marginBottom: 0 }}>
            This shows the current organization record. It does not change or verify a submitted return. <Link to="/app/society#tax-identifiers">Manage organization tax identifiers</Link>
          </p>}
        </>}
    </div>
  </section>;
}
