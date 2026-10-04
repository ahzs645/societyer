import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { interfaceRouteReadPermission } from "../../shared/interfaceRouteAccess";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";

/** A denied role gets an explicit state before mounting data-dependent pages.
 * Server authorization remains the authority for every request. */
export function RouteAccessGate({ children }: { children: ReactNode }) {
  const society = useSociety();
  const { pathname } = useLocation();
  const { loaded, can } = usePermissions();
  const permission = interfaceRouteReadPermission(pathname);
  if (!permission || society === null) return <>{children}</>;
  if (society === undefined || !loaded) return <div className="page" role="status" aria-busy="true">Checking workspace access…</div>;
  if (!can(permission)) return <div className="page">
    <section className="card"><div className="card__body">
      <h1 style={{ marginTop: 0 }}>Access restricted</h1>
      <p>This page is unavailable for your current workspace role. Ask a workspace Owner if you need access.</p>
      <Link className="btn" to="/app">Back to dashboard</Link>
    </div></section>
  </div>;
  return <>{children}</>;
}
