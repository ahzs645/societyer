/**
 * The notice on a phone (the page's narrow layout) keeps its way out and its
 * two main actions in reach while it scrolls:
 *
 * - an app bar that sticks to the top of the page: Back (with the place's
 *   name until the title scrolls away, then the notice's title on one line,
 *   so it is always clear which notice this is), previous and next, and the
 *   buyer's site;
 * - a bar fixed to the bottom of the screen, just above the app's bottom
 *   navigation and clear of the home indicator: Classify (the classification
 *   choice, a bottom sheet) and Open on the buyer's site.
 *
 * The bottom bar is portalled to the body: a page container that is a CSS
 * container (the list's split pane) would otherwise hold a fixed bar inside
 * it rather than at the screen's edge.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { ReaderBackLink } from "../ReaderHeader";
import { ClassifyButton, type NoticeTriageControl } from "../NoticeTriageBar";
import { NoticePager, type NoticeNeighbours } from "./NoticePager";

/** "the buyer's site", "BC Bid": where the notice was published. */
export const siteName = (source: string) => (source === "Buyer's website" ? "the buyer's site" : source);
/** The same for a button: "buyer's site". */
export const shortSiteName = (source: string) => (source === "Buyer's website" ? "buyer's site" : source);

/** Whether the page's title (`.page__title` under `root`) has scrolled out from under the app bar. */
function useTitleScrolledAway(root: HTMLElement | null): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const title = root?.querySelector(".page__title");
    if (!title || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setAway(!entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0)), {
      root: root?.closest(".page") ?? null,
      // The app bar covers the top of the page.
      rootMargin: "-52px 0px 0px 0px",
    });
    observer.observe(title);
    return () => observer.disconnect();
  }, [root]);
  return away;
}

export function NoticeAppBar({
  root,
  title,
  sourceUrl,
  source,
  neighbours,
}: {
  root: HTMLElement | null;
  title: string;
  sourceUrl?: string;
  source: string;
  neighbours: NoticeNeighbours | null;
}) {
  const away = useTitleScrolledAway(root);
  const bar = useRef<HTMLDivElement>(null);
  // A sticky bar stops at the scroller's padding; the bar reaches past it to the scroller's top edge.
  useLayoutEffect(() => {
    const node = bar.current;
    const page = node?.closest(".page");
    if (!node || !page) return;
    const inset = () => node.style.setProperty("--appbar-inset", getComputedStyle(page).paddingTop);
    inset();
    window.addEventListener("resize", inset);
    return () => window.removeEventListener("resize", inset);
  }, []);
  return (
    <div ref={bar} className="procurement-appbar" data-titled={away || undefined}>
      <ReaderBackLink words={!away} />
      {/* The h1 below is the heading; this repeats it for the eye only. */}
      {away && (
        <span className="procurement-appbar__title" aria-hidden="true">
          {title}
        </span>
      )}
      <span className="procurement-appbar__end">
        {neighbours && <NoticePager neighbours={neighbours} compact />}
        {sourceUrl && (
          <a
            className="btn btn--ghost btn--icon"
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open on ${siteName(source)} (opens in a new tab)`}
            title={`Open on ${siteName(source)}`}
          >
            <ExternalLink size={18} aria-hidden="true" />
          </a>
        )}
      </span>
    </div>
  );
}

export function NoticeActionBar({ control, sourceUrl, source }: { control: NoticeTriageControl | null; sourceUrl?: string; source: string }) {
  if (!control && !sourceUrl) return null;
  return createPortal(
    <div className="procurement-actionbar" role="region" aria-label="Notice actions" data-count={control && sourceUrl ? 2 : 1}>
      {control && <ClassifyButton control={control} />}
      {sourceUrl && (
        <a className="btn btn--accent procurement-actionbar__open" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          <span className="procurement-actionbar__label">Open on {shortSiteName(source)}</span>
          <ExternalLink size={16} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </div>,
    document.body,
  );
}
