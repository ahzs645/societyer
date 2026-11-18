import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Flag } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { interfaceRouteReadPermission } from "../../../shared/interfaceRouteAccess";
import { InfoPopover } from "../../components/InfoPopover";
import { pluralizeCounts } from "../../lib/pluralizeCounts";

/** `actionLabel` says what the button does ("Add directors"); older servers may omit it. */
export type ContinuityCheck = { id: string; level: "ok" | "warn" | "err" | "info"; title: string; text: string; to: string; actionLabel?: string; citation?: string };
type Check = ContinuityCheck;

/**
 * Dashboard card: record-continuity checks (AGM held this year, annual report
 * filed, minutes approved, director consent on file), computed from the same
 * expectations as the Coverage & gaps page. Before incorporation there is no
 * entity to check yet, so the card says so in one line.
 */
export function ContinuityChecksCard({ societyId, hideCheckIds }: { societyId: string; hideCheckIds?: string[] }) {
  const { can } = usePermissions();
  const data = useQuery(api.continuity.dashboardChecks, can("deadlines:read") ? { societyId } : "skip") as { checks: Check[]; preIncorporation?: boolean } | undefined;
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
        {data?.preIncorporation && <div className="muted">Record checks start at incorporation.</div>}
        {data && !data.preIncorporation && data.checks.length === 0 && <div className="muted">No continuity checks apply to your role.</div>}
        {data?.checks.filter((check) => !hideCheckIds?.includes(check.id)).map((check) => {
          const permission = interfaceRouteReadPermission(check.to.split("?")[0]);
          const canOpen = !permission || can(permission);
          return (
            <Flag
              key={check.id}
              level={check.level}
              actions={canOpen || check.citation ? (
                <>
                  {canOpen && <Link className="btn btn--sm" to={check.to}>{check.actionLabel ?? "Open"}</Link>}
                  {check.citation && (
                    <InfoPopover label={`Legal source for ${check.title}`}>
                      <p>{check.citation}</p>
                    </InfoPopover>
                  )}
                </>
              ) : null}
            >
              <strong>{check.title}.</strong> {pluralizeCounts(check.text)}
            </Flag>
          );
        })}
      </div>
    </div>
  );
}
