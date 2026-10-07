import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Flag } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { interfaceRouteReadPermission } from "../../../shared/interfaceRouteAccess";

type Check = { id: string; level: "ok" | "warn" | "err" | "info"; title: string; text: string; to: string; citation?: string };

/**
 * Dashboard card: record-continuity checks (AGM held this year, annual report
 * filed, minutes approved, director consent on file), computed from the same
 * expectations as the Coverage & gaps page.
 */
export function ContinuityChecksCard({ societyId }: { societyId: string }) {
  const { can } = usePermissions();
  const data = useQuery(api.continuity.dashboardChecks, can("deadlines:read") ? { societyId } : "skip") as { checks: Check[] } | undefined;
  if (!can("deadlines:read")) return null;
  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">Record continuity</h2>
        <Link to="/app/coverage" className="card__subtitle row" style={{ marginLeft: "auto" }}>
          Coverage &amp; gaps <ArrowRight size={12} />
        </Link>
      </div>
      <div className="card__body col" style={{ gap: 8 }}>
        {!data && <div className="muted">Checking records…</div>}
        {data?.checks.length === 0 && <div className="muted">No continuity checks apply to your role.</div>}
        {data?.checks.map((check) => {
          const permission = interfaceRouteReadPermission(check.to.split("?")[0]);
          const canOpen = !permission || can(permission);
          return (
            <div key={check.id} className="dashboard-remediation">
              <Flag level={check.level === "info" ? "ok" : check.level}>
                <strong>{check.title}.</strong> {check.text}
              </Flag>
              <div className="dashboard-remediation__meta">
                {check.citation && <span>{check.citation}</span>}
                {canOpen && <Link className="btn btn--sm" to={check.to}>Open</Link>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
