import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateNavLabel } from "../i18n/navLabels";
import { breadcrumbTrailForPath } from "../lib/navTree";
import { isModuleEnabled } from "../lib/modules";
import { ROUTE_IDENTITY, routeAllowedForEntityKind, routeLabelForOrganization } from "../lib/routeIdentity";
import { organizationKind } from "../../shared/organizationDomain";

export type Crumb = {
  label: ReactNode;
  to?: string;
};

/**
 * Breadcrumb trail for a detail page. Desktop shows the whole path
 * ("Meetings › Meetings › Board meeting"); phones show just "← Parent".
 * The last crumb is the current page (not a link).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  // Phones collapse the trail to its nearest ancestor: "← Meetings".
  const back = items.slice(0, -1).reverse().find((item) => item.to);
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol className="breadcrumbs__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={index}>
              <li className={`breadcrumbs__item${isLast ? " is-current" : ""}`}>
                {item.to && !isLast ? (
                  <Link to={item.to} className="breadcrumbs__link">{item.label}</Link>
                ) : (
                  <span className="breadcrumbs__text" aria-current={isLast ? "page" : undefined}>{item.label}</span>
                )}
              </li>
              {!isLast && (
                <li className="breadcrumbs__sep" aria-hidden="true">
                  <ChevronRight size={12} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
      {back?.to && (
        <Link to={back.to} className="breadcrumbs__back">
          <ArrowLeft size={14} aria-hidden="true" />
          <span>{back.label}</span>
        </Link>
      )}
    </nav>
  );
}

/**
 * Derive a page's breadcrumbs from route identity: L1 nav parent → list page
 * → (registered intermediate pages) → current title. Null on pages that are
 * themselves sidebar destinations.
 */
export function useRouteBreadcrumbs(
  pathname: string,
  currentTitle: ReactNode,
  organization: any,
): Crumb[] | null {
  const { t } = useTranslation();
  const trail = breadcrumbTrailForPath(pathname);
  if (!trail) return null;
  const kind = organization ? organizationKind(organization) : null;
  const crumbs: Crumb[] = trail.map((entry) => {
    if (entry.parent) {
      // Link the section to its first page this organization can open.
      const first = entry.parent.children.find((child) => {
        const identity = ROUTE_IDENTITY[child.to];
        return (
          identity &&
          routeAllowedForEntityKind(identity, kind) &&
          (!identity.module || isModuleEnabled(organization, identity.module))
        );
      });
      return {
        label: entry.parent.i18nKey ? t(entry.parent.i18nKey, entry.parent.label) : entry.parent.label,
        to: first?.to,
      };
    }
    const identity = entry.routeKey ? ROUTE_IDENTITY[entry.routeKey] : undefined;
    const label = identity ? routeLabelForOrganization(identity, organization) : entry.label;
    return { label: translateNavLabel(t, label), to: entry.to };
  });
  // "Meetings › Meetings › …" reads as a stutter: when a section and its list
  // page share a name, keep only the list page.
  const deduped = crumbs.filter((crumb, index) => {
    const next = crumbs[index + 1];
    return !(
      next &&
      typeof crumb.label === "string" &&
      typeof next.label === "string" &&
      crumb.label.toLowerCase() === next.label.toLowerCase()
    );
  });
  if (currentTitle != null && currentTitle !== false && currentTitle !== "") {
    deduped.push({ label: currentTitle });
  }
  return deduped;
}
