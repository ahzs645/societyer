/**
 * The reader's Analytics tab: Zoer's Market analysis over the published
 * awards, and its notice and decision insights, computed here from the same
 * catalog so both interfaces show the same figures. Desktop lists the views
 * in a rail beside the content, as Zoer does; phones pick a view from a menu.
 * The view (`analysis=`) and its filters live in the URL.
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { Select } from "../../../../components/Select";
import { useReaderNavigation } from "../routes";
import { useReaderSource } from "../source";
import { AwardAnalysis, type AwardView } from "./AwardAnalysis";
import { DecisionAnalysis, OpportunityAnalysis } from "./NoticeInsights";

type View = AwardView | "opportunities" | "decisions";
const VIEWS: { id: View; label: string; group: "Awards" | "Notices" }[] = [
  { id: "overview", label: "Overview", group: "Awards" },
  { id: "trends", label: "Trends", group: "Awards" },
  { id: "buyers", label: "Buyers", group: "Awards" },
  { id: "suppliers", label: "Suppliers", group: "Awards" },
  { id: "sizes", label: "Award sizes", group: "Awards" },
  { id: "mix", label: "Procurement mix", group: "Awards" },
  { id: "quality", label: "Data quality", group: "Awards" },
  { id: "opportunities", label: "Opportunities", group: "Notices" },
  { id: "decisions", label: "Decision insights", group: "Notices" },
];
export const ANALYSIS_PARAM = "analysis";
/** Parameters that belong to one view; switching views drops them. */
const VIEW_STATE = ["metric", "year", "scope", "inspect"];

export function ProcurementAnalytics() {
  const source = useReaderSource();
  const [enabled, setEnabled] = useState(false);
  if (source.usePage && !enabled)
    return (
      <div className="card">
        <div className="card__body">
          <h2>Detailed catalog analytics</h2>
          <p>
            This analysis loads compact metadata for the selected dataset.
            Ordinary browsing only loads the requested page. Documents stay in
            SharePoint.
          </p>
          <button className="btn btn--primary" onClick={() => setEnabled(true)}>
            Load detailed analytics
          </button>
        </div>
      </div>
    );
  return <LoadedProcurementAnalytics />;
}
function LoadedProcurementAnalytics() {
  const source = useReaderSource();
  const nav = useReaderNavigation();
  const hasAwards = (source.catalog.counts.award ?? 0) > 0;
  const views = VIEWS.filter((view) => hasAwards || view.group !== "Awards");
  const requested = nav.params.get(ANALYSIS_PARAM);
  const view = views.find((item) => item.id === requested) ?? views[0];
  const choose = (next: View) =>
    nav.update({
      [ANALYSIS_PARAM]: next === views[0].id ? null : next,
      ...Object.fromEntries(VIEW_STATE.map((key) => [key, null])),
    });
  // Every view starts at the top, where its header and filters are.
  const top = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const page = top.current?.closest(".page");
    if (page && top.current && top.current.getBoundingClientRect().top < 0)
      page.scrollTo({
        top: page.scrollTop + top.current.getBoundingClientRect().top - 72,
      });
  }, [view.id]);

  return (
    <div ref={top} className="procurement-analytics">
      <aside className="procurement-analytics__nav">
        <nav aria-label="Analytics views">
          {views.map((item, index) => (
            <Fragment key={item.id}>
              {(index === 0 || views[index - 1].group !== item.group) && (
                <span className="procurement-analytics__nav-group">
                  {item.group}
                </span>
              )}
              <button
                type="button"
                className="procurement-analytics__nav-item"
                aria-current={item.id === view.id ? "page" : undefined}
                onClick={() => choose(item.id)}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </nav>
      </aside>
      <div className="procurement-analytics__main">
        <div className="procurement-analytics__picker">
          <Select<View>
            aria-label="Analytics view"
            sheetTitle="Analytics view"
            value={view.id}
            onChange={choose}
            options={views.map((item) => ({
              value: item.id,
              label: item.label,
              hint: item.group,
            }))}
          />
        </div>
        {view.group === "Awards" ? (
          <AwardAnalysis
            key={view.id}
            view={view.id as AwardView}
            title={view.label}
          />
        ) : view.id === "opportunities" ? (
          <OpportunityAnalysis title={view.label} />
        ) : (
          <DecisionAnalysis title={view.label} />
        )}
      </div>
    </div>
  );
}
