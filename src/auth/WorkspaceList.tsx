import type { LockedWorkspace, PrincipalMembership, WorkspaceLockReason } from "./AuthProvider";
import { useOpenWorkspace } from "./useOpenWorkspace";
import { WorkspaceLogo } from "../components/WorkspaceLogo";
import { originHost } from "../lib/workspaceDomain";

export const LOCK_REASON_LABEL: Record<WorkspaceLockReason, string> = {
  mfa: "Needs two-factor authentication",
  microsoft: "Needs Microsoft sign-in",
  "email-domain": "Needs a different email address",
};

/**
 * The person's workspaces with an Open button each: memberships first, then
 * locked ones with the missing step. `detailed` adds role, domain and the
 * linked-account hint (My workspaces).
 */
export function WorkspaceList({ memberships, locked, exclude, detailed = false, label, showLabel = false }: {
  memberships: readonly PrincipalMembership[];
  locked: readonly LockedWorkspace[];
  exclude?: string;
  detailed?: boolean;
  label: string;
  /** Show `label` as a small heading (lock screens); otherwise it only names the list. */
  showLabel?: boolean;
}) {
  const { open, opening, error } = useOpenWorkspace();
  const rows = [
    ...memberships.filter((membership) => membership.society._id !== exclude).map((membership) => ({
      id: membership.society._id,
      name: membership.society.name,
      logo: membership.society,
      canonicalOrigin: membership.canonicalOrigin,
      meta: detailed
        ? [membership.role, originHost(membership.canonicalOrigin), membership.viaLinkedIdentity ? "via linked account" : null]
        : [membership.role],
    })),
    ...locked.filter((workspace) => workspace.id !== exclude).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      logo: { name: workspace.name, logoUrl: workspace.logoUrl },
      canonicalOrigin: workspace.canonicalOrigin,
      meta: [LOCK_REASON_LABEL[workspace.reason ?? "mfa"], detailed ? originHost(workspace.canonicalOrigin) : null],
    })),
  ];
  if (!rows.length) return null;
  return (
    <section className="account-section" aria-label={label}>
      {showLabel && <h2 className="account-section__title">{label}</h2>}
      <ul className="account-workspaces">
        {rows.map((row) => (
          <li key={row.id} className="account-workspace">
            <WorkspaceLogo organization={row.logo} />
            <span className="account-workspace__text">
              <strong className="account-workspace__name">{row.name}</strong>
              <span className="account-workspace__meta">{row.meta.filter(Boolean).join(" · ")}</span>
            </span>
            <button
              type="button"
              className="btn btn--sm"
              disabled={opening !== null}
              aria-label={`Open ${row.name}`}
              onClick={() => void open({ societyId: row.id, canonicalOrigin: row.canonicalOrigin })}
            >
              {opening === row.id ? "Opening…" : "Open"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="notice notice--danger auth__notice">{error}</p>}
    </section>
  );
}
