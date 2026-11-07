import { Link } from "react-router-dom";
import { useSociety } from "../hooks/useSociety";
import { normalizeOrganizationIdentity, LEGAL_FORM_LABELS } from "../../shared/organization/normalize";
import { ROUTE_IDENTITY, routeAllowedForOrganization } from "../lib/routeIdentity";

/**
 * Where a corporation keeps the records a society-only page would hold. Only
 * routes the app already has; no page is invented for the other entity kind.
 */
const ALTERNATIVES: Record<string, { to: string; label: string }> = {
  "/app/members": { to: "/app/role-holders", label: "Open role holders" },
  "/app/membership": { to: "/app/rights-ledger", label: "Open share register" },
  "/app/receipts": { to: "/app/financials", label: "Open financials" },
};

const KIND_PLURAL: Record<string, string> = {
  society: "societies",
  corporation: "corporations",
};

/**
 * Direct-URL guard for routes that apply to one entity kind only. The sidebar
 * and command palette already hide these (ROUTE_IDENTITY.entityKinds); this
 * keeps a bookmarked or typed URL from opening, for example, the Societies Act
 * member register in a business-company workspace. Loading and unresolved
 * identities do not grant access to a form-specific route.
 */
export function EntityKindGate({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  const society = useSociety();
  const identity = ROUTE_IDENTITY[routeKey];
  if (!identity || (!identity.entityKinds?.length && !identity.legalForms?.length)) return <>{children}</>;
  if (society === undefined) return <div className="page" role="status">Loading organization…</div>;
  if (routeAllowedForOrganization(identity, society)) return <>{children}</>;
  const normalized = normalizeOrganizationIdentity(society);
  const kind = normalized.legalForm === "business_corporation" ? "corporation" : normalized.legalForm;
  const applicableTo = identity.legalForms?.map(form => LEGAL_FORM_LABELS[form]).join(", ")
    ?? (identity.entityKinds ?? []).map(value => KIND_PLURAL[value] ?? value).join(" and ");

  const alternative = ALTERNATIVES[routeKey];
  return (
    <div className="page" data-testid="entity-kind-unavailable">
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card__head">
          <h2 className="card__title">{identity.label} is not used for this kind of organization</h2>
          <span className="card__subtitle">
            {society?.name ?? "This workspace"}: {normalized.legalFormLabel}. This page applies to {applicableTo}.
          </span>
        </div>
        <div className="card__body col">
          <div className="muted">
            Existing records are preserved. If the entity type is wrong, correct it on the organization profile.
            {normalized.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {alternative && kind === "corporation" && (
              <Link to={alternative.to} className="btn btn--accent">{alternative.label}</Link>
            )}
            <Link to="/app" className="btn">Back to dashboard</Link>
            <Link to="/app/society" className="btn">Organization profile</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
