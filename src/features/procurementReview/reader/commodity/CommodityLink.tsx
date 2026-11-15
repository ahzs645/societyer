/**
 * A UNSPSC code as a link to its commodity page: a plain click opens it in
 * the reader (from a notice it takes the notice's place, and Back names the
 * notice), a middle-click or a long-press in a new tab. Opened from that
 * commodity's own page (a notice over it), the link goes back there rather
 * than opening it again, as an organisation's link does.
 */
import type { ReactNode } from "react";
import { plainClick } from "../ReaderHeader";
import { COMMODITY_PARAM, useReaderNavigation } from "../routes";

export function CommodityLink({ code, className, title, ariaLabel, children }: {
  code: string;
  className?: string;
  /** The tooltip, such as the code and its full title where the link shows a short label. */
  title?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const { params, pushed, back, openCommodity, commodityHref } = useReaderNavigation();
  const fromHere = pushed && params.get(COMMODITY_PARAM) === code;
  return (
    <a
      className={className}
      href={commodityHref(code)}
      title={title}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        if (fromHere) back();
        else openCommodity(code);
      }}
    >
      {children}
    </a>
  );
}
