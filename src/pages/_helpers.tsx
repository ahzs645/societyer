import { Sparkles } from "lucide-react";
import { ReactNode, useState, createElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { EmptyState, TintedIconTile } from "../components/ui";
import { useToast } from "../components/Toast";
import { setStoredSocietyId } from "../hooks/useSociety";
import { maintenanceErrorMessage, seedDemoSociety } from "../lib/maintenanceApi";
import { getRouteIdentity, resolveRouteIdentity, type IconTone } from "../lib/routeIdentity";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { getRuntimeMode } from "../lib/runtimeMode";

// The society-loading placeholder shown while `useSociety()` is undefined.
// Extracted so the ~86 page guards share one element instead of hand-rolling
// `<div className="page">Loading…</div>` (previously split between "…" and "...").
export function PageLoading() {
  return <div className="page">Loading…</div>;
}

export function SeedPrompt() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const showDemoSeed = isStaticDemoRuntime() || getRuntimeMode() === "local-indexeddb";
  return (
    <div className="page">
      <EmptyState
        icon={<Sparkles size={20} />}
        title="No society yet"
        action={
          showDemoSeed ? (
            <button
              className="btn btn--accent"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await seedDemoSociety();
                  setStoredSocietyId(result.societyId);
                  toast.success("Demo society seeded");
                } catch (error) {
                  toast.error(maintenanceErrorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Sparkles size={14} /> {busy ? "Seeding..." : "Seed demo society"}
            </button>
          ) : (
            <Link className="btn btn--accent" to="/app/society/new">
              Create society
            </Link>
          )
        }
      >
        {showDemoSeed ? (
          <>
            Click below to load <strong>Riverside Community Society</strong>, a fictional BC
            non-profit used to showcase the app. You can wipe it any time.
          </>
        ) : (
          <>Create a local society workspace to start storing records and documents.</>
        )}
      </EmptyState>
    </div>
  );
}

/**
 * The five document/record surfaces are scattered across three different
 * sidebar groups (Work, Governance records, Compliance) because each has a
 * legitimate reason to sit next to its neighbours there. That makes it easy
 * to land on one and not realize the other four exist. Rather than restructure
 * nav, each of those five pages renders this single unobtrusive link row
 * (right under its PageHeader) so a user can jump straight across.
 */
const RELATED_DOCUMENT_VIEWS = [
  { to: "/app/documents", label: "Documents" },
  { to: "/app/document-catalog", label: "Document catalog" },
  { to: "/app/library", label: "Library" },
  { to: "/app/minute-book", label: "Minute book" },
  { to: "/app/records-archive", label: "Records archive" },
] as const;

export function RelatedDocumentViews({ current }: { current: (typeof RELATED_DOCUMENT_VIEWS)[number]["to"] }) {
  const links = RELATED_DOCUMENT_VIEWS.filter((view) => view.to !== current);
  return (
    <div className="row muted" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 16, fontSize: "var(--fs-sm)" }}>
      <span>Related:</span>
      {links.map((view) => (
        <Link key={view.to} to={view.to} className="chip chip--sm">
          {view.label}
        </Link>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  iconColor,
  routeKey,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Fallback icon when the registry has no entry for this route. */
  icon?: ReactNode;
  /** Fallback color when the registry has no entry for this route. */
  iconColor?: IconTone;
  /** Override the auto-detected route. Usually omit — the current pathname is used. */
  routeKey?: string;
  actions?: ReactNode;
}) {
  // Auto-resolve from the current location so every page reads its identity
  // from the registry, even ones that haven't been migrated. Registry wins
  // over manual `icon`/`iconColor` whenever the route is registered — so the
  // sidebar and the page header can never disagree.
  const location = useLocation();
  const identity = routeKey
    ? getRouteIdentity(routeKey)
    : resolveRouteIdentity(location.pathname);

  const resolvedIcon = identity
    ? createElement(identity.icon, { size: 16 })
    : icon;
  const resolvedTone: IconTone = identity?.color ?? iconColor ?? "blue";

  return (
    <div className="page__header">
      <div className="page__header-main">
        <div className="page__intro">
          <h1 className="page__title">
            {resolvedIcon && (
              <TintedIconTile tone={resolvedTone} size="md" className="page__icon">
                {resolvedIcon}
              </TintedIconTile>
            )}
            <span className="page__title-text">{title}</span>
          </h1>
          {subtitle && <p className="page__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </div>
  );
}
