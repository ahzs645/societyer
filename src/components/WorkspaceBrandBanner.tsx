import { Link } from "react-router-dom";
import { WorkspaceLogo } from "./WorkspaceLogo";
import type { WorkspaceBrandSource } from "../../shared/workspaceBranding";

export function WorkspaceBrandBanner({ organization, canEdit = false }: { organization: WorkspaceBrandSource; canEdit?: boolean }) {
  if (!organization.workspaceBrand && !organization.logoUrl) return null;
  return <section className="workspace-brand-banner" aria-label="Current workspace">
    <WorkspaceLogo organization={organization} presentation="full" />
    <div className="workspace-brand-banner__identity"><span className="muted">Current workspace</span><strong>{organization.name}</strong></div>
    {canEdit && <Link className="btn btn--ghost btn--sm" to="/app/settings#workspace-brandkit">Brand settings</Link>}
  </section>;
}
