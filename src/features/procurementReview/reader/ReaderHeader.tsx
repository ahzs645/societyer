/**
 * The head of a buyer or supplier page: Back, then the title. Back names the
 * place it returns to, which is the one the page was opened from (routes.ts
 * keeps it with the history entry), and steps back to it, so that place comes
 * back at the same rows (a notice comes back in its panel). From a pasted
 * link it goes to the parent place.
 *
 * Back says where it leads in words ("← Opportunities", "← District of
 * Saanich") on a row of its own above the title. On phones it is an arrow on
 * the title's row, so the header stays short; where it leads is the arrow's
 * tooltip and accessible label. (A notice has no page header: it opens in
 * the side panel, which brings its own.)
 */
import type { MouseEvent, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "../../../pages/_helpers";
import { mobileCardMediaQuery } from "../../../lib/breakpoints";
import { useMediaQuery } from "../../../lib/useSheetDrag";
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
  back = "auto",
}: {
  title: ReactNode;
  /** Not a registered route, so the header shows no icon tile beside a long title. */
  routeKey: string;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** How Back shows: "words" on its own row, "icon" as an arrow beside the title; "auto" (the default) is words, or the arrow on phones. */
  back?: "auto" | "words" | "icon";
}) {
  const phone = useMediaQuery(mobileCardMediaQuery);
  const style = back === "auto" ? (phone ? "icon" : "words") : back;
  return (
    <>
      {style === "words" && (
        <div className="procurement-back-row">
          <ReaderBackLink words />
        </div>
      )}
      <PageHeader
        title={title}
        routeKey={routeKey}
        breadcrumbs={false}
        eyebrow={eyebrow}
        subtitle={subtitle}
        actions={actions}
        leading={style === "icon" ? <ReaderBackLink /> : undefined}
      />
    </>
  );
}

/**
 * Back to the place this page was opened from: an arrow, or with `words` the
 * arrow and the place's name. Its href is that place, for a middle-click or a
 * long-press.
 */
export function ReaderBackLink({ words = false }: { words?: boolean }) {
  const nav = useReaderNavigation();
  return (
    <a
      className={words ? "btn btn--ghost btn--sm procurement-back procurement-back--words" : "btn btn--ghost btn--icon procurement-back"}
      href={nav.backHref}
      aria-label={`Back to ${nav.backLabel}`}
      title={words ? undefined : `Back to ${nav.backLabel}`}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        nav.back();
      }}
    >
      <ArrowLeft size={words ? 14 : 18} aria-hidden="true" />
      {words && <span className="procurement-back__label">{nav.backLabel}</span>}
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
