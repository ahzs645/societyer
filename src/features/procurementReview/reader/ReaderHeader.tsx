/**
 * The head of a notice or buyer page: Back, then the title. Back names the
 * place it returns to, which is the one the page was opened from (routes.ts
 * keeps it with the history entry), and steps back to it, so that place comes
 * back at the same rows. From a pasted link it goes to the parent place.
 *
 * Back is an arrow on the title's row, to the left of the title and its
 * eyebrow ("Buyer"), so the header stays short. Where it leads is its tooltip
 * and its accessible label.
 */
import type { MouseEvent, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "../../../pages/_helpers";
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

/** Back to the place this page was opened from. Its href is that place, for a middle-click or a long-press. */
function ReaderBackLink() {
  const nav = useReaderNavigation();
  return (
    <a
      className="btn btn--ghost btn--icon procurement-back"
      href={nav.backHref}
      aria-label={`Back to ${nav.backLabel}`}
      title={`Back to ${nav.backLabel}`}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.back();
      }}
    >
      <ArrowLeft size={18} aria-hidden="true" />
    </a>
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
