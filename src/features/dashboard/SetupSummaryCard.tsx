import { Link } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { SetupRing } from "../../components/SetupPill";
import { Tooltip } from "../../components/Tooltip";
import { ORGANIZATION_SETUP_PATH, type OrganizationSetupProgress } from "../../../shared/organizationSetup/types";
import { setupPercent, setupSummaryTitle, setupViewStepLink } from "../../lib/organizationSetupLinks";

/**
 * Dashboard "setup" module: one compact row with the progress ring, how much
 * is done, the next step and a way into the setup view. The checklist itself
 * lives on `/app/organization-setup`; this only points there.
 */
export function SetupSummaryCard({
  progress,
  organizationName,
  onHide,
}: {
  progress: OrganizationSetupProgress;
  organizationName?: string;
  onHide: () => void;
}) {
  const { done, total } = progress.counts;
  const percent = setupPercent(progress);
  const phase = progress.phases.find((candidate) => candidate.key === progress.currentPhase);
  const next = progress.next;
  const title = setupSummaryTitle(progress, organizationName);
  return (
    <section className="setup-summary" aria-labelledby="setup-summary-title" data-setup-summary="">
      <div className="setup-summary__ring" role="img" aria-label={`${done} of ${total} setup steps done`}>
        <SetupRing percent={percent} size={44} />
        <span className="setup-summary__ring-count" aria-hidden="true">{done}</span>
      </div>
      <div className="setup-summary__main">
        <h2 id="setup-summary-title" className="setup-summary__title">{title}</h2>
        <p className="setup-summary__meta">
          <span className="setup-summary__count">{done} of {total} done</span>
          {phase?.statusNote && <span className="setup-summary__status">{phase.statusNote}</span>}
        </p>
        {next && (
          <p className="setup-summary__next">
            <span className="setup-summary__next-label">Next:</span>{" "}
            <Link to={setupViewStepLink(next.key)} className="setup-summary__next-link">{next.title}</Link>
          </p>
        )}
      </div>
      <div className="setup-summary__actions">
        <Link to={ORGANIZATION_SETUP_PATH} className="btn btn--accent btn--sm setup-summary__continue">
          Continue setup <ArrowRight size={12} aria-hidden="true" />
        </Link>
        <Tooltip content="Hide setup guide">
          <button type="button" className="setup-summary__hide" onClick={onHide} aria-label="Hide setup guide">
            <X size={14} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </section>
  );
}
