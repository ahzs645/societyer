/**
 * The head of a buyer or supplier page: Back, then the title. Back returns to
 * the place the page was opened from (routes.ts keeps it with the history
 * entry) by stepping back to it, so that place comes back as it was: the
 * same analytics section and rows, a notice in its panel. From a pasted link
 * it goes to the parent place.
 *
 * Back is an arrow on the title's row at every width, so the header keeps to
 * the title's height; where it leads ("Back to Analytics") shows in its
 * tooltip on hover or focus and is its accessible name. (A notice has no page
 * header: it opens in the side panel, which brings its own.)
 */
import type { MouseEvent, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "../../../pages/_helpers";
import { Tooltip } from "../../../components/Tooltip";
import { useReaderNavigation } from "./routes";

/** A click the page handles itself; with a modifier or another button the browser opens the link's href (a new tab or window). */
export const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function ReaderHeader({
  title,
  routeKey,
  eyebrow,
  subtitle,
  actions,
}: {
  title: ReactNode;
  /** Not a registered route, so the header shows no icon tile beside a long title. */
  routeKey: string;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      routeKey={routeKey}
      breadcrumbs={false}
      eyebrow={eyebrow}
      subtitle={subtitle}
      actions={actions}
      leading={<ReaderBackLink />}
    />
  );
}

/**
 * Back to the place this page was opened from, as an arrow whose tooltip
 * names it. Its href is that place, for a middle-click or a long-press.
 */
export function ReaderBackLink() {
  const nav = useReaderNavigation();
  const label = `Back to ${nav.backLabel}`;
  return (
    <Tooltip content={label} placement="bottom">
      <a
        className="btn btn--ghost btn--icon procurement-back"
        href={nav.backHref}
        aria-label={label}
        onClick={(event) => {
          if (!plainClick(event)) return;
          event.preventDefault();
          nav.back();
        }}
      >
        <ArrowLeft size={18} aria-hidden="true" />
      </a>
    </Tooltip>
  );
}

/** The same Back as a button with words, for an empty or missing page's call to action. */
export function ReaderBackButton() {
  const nav = useReaderNavigation();
  return (
    <button type="button" className="btn btn--accent" onClick={nav.back}>
      Back to {nav.backLabel}
    </button>
  );
}
