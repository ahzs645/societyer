import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { DashboardModuleId } from "./dashboardLayout";

/** Shown on phones as the one "Needs attention" list instead of three cards. */
export const ATTENTION_MODULES: ReadonlySet<DashboardModuleId> = new Set(["compliance", "continuity", "filings"]);
const LEAD_MODULES: DashboardModuleId[] = ["setup", "stats"];

export type DashboardDisclosure = {
  title: string;
  /** One line under the title, led by the module's count ("3 upcoming"). */
  summary?: string;
};

/**
 * The phone presentation of the visible dashboard modules (Customize still
 * decides which modules show and in what order): the setup card and key
 * numbers, one "Needs attention" list standing in for the compliance,
 * continuity and filings modules, then every other module collapsed under a
 * disclosure with its count. Nothing here changes the saved layout.
 *
 * The disclosures use the app's phone fold styling (`.mobile-fold`, see
 * MobileFold) but keep their body mounted, as the dashboard always has, so a
 * module that renders nothing for this workspace (no expiring agreements, no
 * bank data) drops its disclosure instead of opening onto an empty box.
 */
export function DashboardPhoneLayout({
  modules,
  content,
  attention,
  disclosures,
}: {
  modules: DashboardModuleId[];
  content: Partial<Record<DashboardModuleId, ReactNode>>;
  /** The merged list; rendered when any of its modules is visible. */
  attention: ReactNode;
  disclosures: Partial<Record<DashboardModuleId, DashboardDisclosure>>;
}) {
  const lead = LEAD_MODULES.filter((id) => modules.includes(id));
  const showAttention = modules.some((id) => ATTENTION_MODULES.has(id));
  const rest = modules.filter((id) => !LEAD_MODULES.includes(id) && !ATTENTION_MODULES.has(id));
  return (
    <div className="dashboard-grid dashboard-grid--phone">
      {lead.map((id) => (
        <div key={id} className="dashboard-module" data-dashboard-module={id}>
          {content[id]}
        </div>
      ))}
      {showAttention && (
        <div className="dashboard-module" data-dashboard-module="attention">
          {attention}
        </div>
      )}
      {rest.length > 0 && (
        <div className="dashboard-disclosures">
          {rest.map((id) => {
            const disclosure = disclosures[id];
            return (
              <details key={id} className="card mobile-fold dashboard-disclosure" data-dashboard-module={id}>
                <summary className="mobile-fold__summary">
                  <span className="mobile-fold__titles">
                    <h2 className="mobile-fold__title">{disclosure?.title ?? id}</h2>
                    {disclosure?.summary && <span className="mobile-fold__meta">{disclosure.summary}</span>}
                  </span>
                  <ChevronDown size={16} className="mobile-fold__chevron" aria-hidden="true" />
                </summary>
                <div className="mobile-fold__body">{content[id]}</div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
