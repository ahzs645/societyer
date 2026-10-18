import { Sparkles } from "lucide-react";
import { InfoPopover } from "../components/InfoPopover";
import { ReactNode, useState, createElement, useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { EmptyState, TintedIconTile } from "../components/ui";
import { useToast } from "../components/Toast";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { maintenanceErrorMessage, seedDemoSociety } from "../lib/maintenanceApi";
import { getRouteIdentity, resolveRouteIdentity, type IconTone } from "../lib/routeIdentity";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { getRuntimeMode } from "../lib/runtimeMode";
import { useTranslation } from "react-i18next";
import { useScrollOverflow } from "../hooks/useScrollOverflow";
import { translateNavLabel } from "../i18n/navLabels";
import { useDocumentTitle } from "../lib/documentTitle";
import { mobileCardMediaQuery } from "../lib/breakpoints";
import { PageSkeleton, type PageSkeletonVariant } from "../components/PageSkeleton";
import { Breadcrumbs, useRouteBreadcrumbs, type Crumb } from "../components/Breadcrumbs";

// The society-loading placeholder shown while `useSociety()` is undefined.
// Extracted so the ~86 page guards share one element instead of hand-rolling
// `<div className="page">Loading…</div>` (previously split between "…" and "...").
// It draws the page's outline (header, stats, rows) rather than bare text and
// announces "Loading <page>…" once to assistive tech.
export function PageLoading({ variant = "table", label }: { variant?: PageSkeletonVariant; label?: string } = {}) {
  const location = useLocation();
  const { t } = useTranslation();
  const identity = resolveRouteIdentity(location.pathname);
  const pageName = label ?? (identity ? translateNavLabel(t, identity.label) : null);
  return (
    <div className="page">
      <PageSkeleton variant={variant} label={pageName ? `Loading ${pageName}…` : "Loading…"} />
    </div>
  );
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
  // Phones scroll the row sideways; data-overflow fades whichever edge is cut.
  const rowRef = useRef<HTMLDivElement>(null);
  const overflow = useScrollOverflow(rowRef, [links.length]);
  return (
    <div ref={rowRef} data-overflow={overflow} className="row muted related-views" style={{ gap: 6, alignItems: "center", marginBottom: 16, fontSize: "var(--fs-sm)" }}>
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
  info,
  breadcrumbs,
}: {
  /**
   * Breadcrumb trail. Omit to derive it from the route (detail pages get
   * "Section › List › Record"); pass `false` to suppress it, or an explicit
   * list to override.
   */
  breadcrumbs?: Crumb[] | false;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Background that would otherwise be a paragraph under the header; shown from an ⓘ beside the title. */
  info?: ReactNode;
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

  const { t } = useTranslation();
  // A page titled with its sidebar label shows the same translated words as
  // the sidebar; record names and other free text are left as written.
  const displayTitle = typeof title === "string" ? translateNavLabel(t, title) : title;
  useDocumentTitle(
    typeof displayTitle === "string"
      ? displayTitle
      : identity
        ? translateNavLabel(t, identity.label)
        : null,
  );

  const resolvedIcon = identity
    ? createElement(identity.icon, { size: 16 })
    : icon;
  const headerRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  usePhoneHeaderActionsFit(headerRef, actionsRef, Boolean(actions));
  const resolvedTone: IconTone = identity?.color ?? iconColor ?? "blue";
  const organization = useSociety();
  // Detail pages (a path below a registered list route) get a derived trail;
  // an explicit routeKey marks a page as its own destination.
  const derivedCrumbs = useRouteBreadcrumbs(location.pathname, displayTitle, organization);
  const crumbs = breadcrumbs === false ? null : breadcrumbs ?? (routeKey ? null : derivedCrumbs);

  return (
    <div className={`page__header${crumbs ? " page__header--with-crumbs" : ""}`} ref={headerRef}>
      <div className="page__header-main">
        <div className="page__intro">
          {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
          {info ? (
            // The ⓘ sits beside the heading, not inside it, so the heading's
            // accessible name stays the page title.
            <div className="page__title-row">
              <h1 className="page__title">
              {resolvedIcon && (
                <TintedIconTile tone={resolvedTone} size="md" className="page__icon">
                  {resolvedIcon}
                </TintedIconTile>
              )}
              <span className="page__title-text">{displayTitle}</span>
            </h1>
              <InfoPopover label={`About ${typeof displayTitle === "string" ? displayTitle : "this page"}`}>{info}</InfoPopover>
            </div>
          ) : (
            <h1 className="page__title">
            {resolvedIcon && (
              <TintedIconTile tone={resolvedTone} size="md" className="page__icon">
                {resolvedIcon}
              </TintedIconTile>
            )}
            <span className="page__title-text">{displayTitle}</span>
          </h1>
          )}
          {subtitle && <p className="page__subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page__actions" ref={actionsRef}>{actions}</div>}
    </div>
  );
}

/** Room the title keeps beside inline actions (icon tile + a short name). */
const PHONE_HEADER_MIN_TITLE = 140;
/**
 * Width the title row needs so its longest word never breaks mid-word
 * ("Communica-tions"): icon tile + gap + longest word (+ the ⓘ beside it).
 */
function titleWordRoom(header: HTMLElement): number {
  const text = header.querySelector<HTMLElement>(".page__title-text");
  if (!text) return 0;
  const words = (text.textContent ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const canvas = (titleWordRoom as { canvas?: HTMLCanvasElement }).canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return 0;
  const style = getComputedStyle(text);
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const longest = Math.max(...words.map((word) => context.measureText(word).width));
  const title = header.querySelector<HTMLElement>(".page__title");
  const icon = header.querySelector<HTMLElement>(".page__icon");
  const gap = title ? parseFloat(getComputedStyle(title).columnGap) || 0 : 0;
  const info = header.querySelector<HTMLElement>(".page__title-row > .info-popover__trigger, .page__title-row > * > .info-popover__trigger");
  return Math.ceil(longest + (icon ? icon.offsetWidth + gap : 0) + (info ? info.offsetWidth + 6 : 0)) + 2;
}

/** Past this many, bare icons stop being recognisable — keep labels and wrap. */
const PHONE_HEADER_MAX_ICON_ACTIONS = 3;

/**
 * Phones: put the page actions on the title's row, right-aligned. If they
 * don't fit at full size, icon buttons drop their text ("+ New member" →
 * "+", label kept for assistive tech) — at most three of them, since a
 * longer row of bare icons stops being readable; otherwise, or if even that
 * doesn't fit, they wrap under the title as before. Sets `data-actions-fit` on the
 * header ("inline" | "compact" | "wrap") before paint, and re-measures when
 * the header is resized or the actions change.
 */
function usePhoneHeaderActionsFit(
  headerRef: React.RefObject<HTMLDivElement | null>,
  actionsRef: React.RefObject<HTMLDivElement | null>,
  hasActions: boolean,
) {
  useLayoutEffect(() => {
    const header = headerRef.current;
    const actions = actionsRef.current;
    if (!header || !actions || !hasActions) return;
    const media = window.matchMedia(mobileCardMediaQuery);
    let lastWidth = -1;
    const measure = (force = false) => {
      if (!media.matches) {
        delete header.dataset.actionsFit;
        lastWidth = -1;
        return;
      }
      const style = getComputedStyle(header);
      const width = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (!force && width === lastWidth) return;
      lastWidth = width;
      // Reserve room for the title: at least its longest word (so it never
      // breaks mid-word) and, for long titles, about two lines beside the
      // actions. Otherwise the actions compact or wrap under the title.
      const titleText = header.querySelector<HTMLElement>(".page__title-text");
      let titleRoom = Math.max(PHONE_HEADER_MIN_TITLE, titleWordRoom(header));
      if (titleText) {
        const previous = titleText.style.whiteSpace;
        titleText.style.whiteSpace = "nowrap";
        const natural = titleText.getBoundingClientRect().width;
        titleText.style.whiteSpace = previous;
        const icon = header.querySelector<HTMLElement>(".page__icon")?.getBoundingClientRect().width ?? 0;
        titleRoom = Math.max(titleRoom, Math.min(natural, natural / 2 + 24) + icon + 8);
      }
      const fits = () => actions.scrollWidth + 8 + titleRoom <= width;
      header.dataset.actionsFit = "inline";
      if (fits()) return;
      const iconActions = actions.querySelectorAll(":is(.btn, .btn-action):has(> svg)").length;
      if (iconActions <= PHONE_HEADER_MAX_ICON_ACTIONS) {
        header.dataset.actionsFit = "compact";
        if (fits()) return;
      }
      header.dataset.actionsFit = "wrap";
    };
    measure(true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    resize?.observe(header);
    // Buttons appear/disappear or relabel, and record titles arrive, as data loads.
    const mutations = new MutationObserver(() => measure(true));
    mutations.observe(header, { childList: true, subtree: true, characterData: true });
    const onMedia = () => measure(true);
    media.addEventListener("change", onMedia);
    return () => {
      resize?.disconnect();
      mutations.disconnect();
      media.removeEventListener("change", onMedia);
      delete header.dataset.actionsFit;
    };
  }, [headerRef, actionsRef, hasActions]);
}
