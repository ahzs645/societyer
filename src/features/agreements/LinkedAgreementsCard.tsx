import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { FileSignature, Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { useSociety } from "../../hooks/useSociety";
import { isModuleEnabled } from "../../lib/modules";
import { formatDate, money } from "../../lib/format";
import { AGREEMENT_STATUS_LABELS, type AgreementStatus } from "../../../shared/agreements";

/**
 * Agreements linked to a grant, service provider, committee, meeting, motion
 * or document (grant ↔ funding agreement, provider ↔ service contract …).
 *
 *   <LinkedAgreementsCard table="grants" recordId={grant._id} />
 */
export function LinkedAgreementsCard({ table, recordId, title = "Agreements" }: { table: string; recordId: string | undefined; title?: string }) {
  const society = useSociety();
  const { can } = usePermissions();
  const enabled = Boolean(society && recordId && can("agreements:read") && isModuleEnabled(society as any, "agreements"));
  const rows = useQuery(api.agreements.forRecord, enabled ? { societyId: society!._id, table, recordId: String(recordId) } : "skip") as any[] | undefined;
  if (!enabled) return null;
  return (
    <section className="card" style={{ marginTop: 16 }} data-testid="linked-agreements">
      <div className="card__head">
        <h2 className="card__title"><FileSignature size={14} aria-hidden="true" /> {title}</h2>
        {can("agreements:write") && <Link className="card__subtitle row" style={{ marginLeft: "auto" }} to="/app/agreements?intent=add"><Plus size={12} /> New agreement</Link>}
      </div>
      <div className="card__body col" style={{ gap: 8 }}>
        {!rows && <div className="muted">Loading…</div>}
        {rows && !rows.length && <div className="muted">No agreement is linked yet. Link one from the agreement's edit form.</div>}
        {(rows ?? []).map((row) => (
          <div key={row._id} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link to={`/app/agreements/${row._id}`}><strong>{row.title}</strong></Link>
            <Badge tone={row.effectiveStatus === "active" ? "success" : row.effectiveStatus === "expired" ? "warn" : "neutral"}>{AGREEMENT_STATUS_LABELS[row.effectiveStatus as AgreementStatus] ?? row.effectiveStatus}</Badge>
            <span className="muted">{[row.counterparties?.join("; "), row.endDate ? `ends ${formatDate(row.endDate)}` : "", row.valueCents !== undefined ? money(row.valueCents) : ""].filter(Boolean).join(" · ")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
