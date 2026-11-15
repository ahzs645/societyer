/**
 * The notice's commodities, under its facts: the main one first and marked,
 * each classified one a link to its commodity page (the notices, buyers and
 * suppliers in it), a label the notice gives no code shown as plain text.
 * A long list shows its first few with "Show all", rather than hiding the
 * rest behind "and 11 more".
 *
 * The titles the notice gives its codes and their ancestors are kept for the
 * visit (commodity/titles.ts), so the page a link opens is titled at once.
 */
import { useEffect, useId, useState } from "react";
import { Pill } from "../../../../components/ui";
import type { NoticeCommodity } from "../../lib/notice";
import { CommodityLink } from "../commodity/CommodityLink";
import { rememberCommodityTitles } from "../commodity/titles";

/** How many show before "Show all". */
const SHOWN = 6;

export function NoticeCommodities({ commodities }: { commodities: NoticeCommodity[] }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  useEffect(() => {
    rememberCommodityTitles(
      commodities.flatMap((item) => [
        [item.code, item.title] as const,
        ...item.ancestors.map((ancestor) => [ancestor.code, ancestor.title] as const),
      ]),
    );
  }, [commodities]);
  const shown = all ? commodities : commodities.slice(0, SHOWN);
  return (
    // Its own section of the card, so the rule above it runs edge to edge.
    <div className="card__body procurement-notice__commodities">
      <span className="procurement-notice__kv-label">{commodities.length === 1 ? "Commodity" : "Commodities"}</span>
      <ul id={listId}>
        {shown.map((item) => (
          <li key={`${item.label}|${item.code}`}>
            {item.code ? (
              <CommodityLink
                code={item.code}
                className="procurement-notice__commodity"
                title={[...item.ancestors.map((ancestor) => ancestor.title), item.title || item.label].filter(Boolean).join(" › ")}
              >
                <span className="procurement-notice__commodity-name">{item.label}</span>{" "}
                <small className="procurement-notice__commodity-code">{item.code}</small>
              </CommodityLink>
            ) : (
              item.label
            )}
            {item.main && (
              <>
                {" "}
                <Pill size="sm" className="procurement-notice__commodity-main">Main</Pill>
              </>
            )}
          </li>
        ))}
      </ul>
      {commodities.length > SHOWN && (
        <button
          type="button"
          className="btn btn--ghost btn--sm procurement-notice__commodities-toggle"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${commodities.length}`}
        </button>
      )}
    </div>
  );
}
