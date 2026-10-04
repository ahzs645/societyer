import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { Badge } from "./ui";
import { Select } from "./Select";
import { ACCESS_ACTIONS, getModuleAccess } from "../lib/moduleAccess";
import type { normalizeModuleSettings } from "../lib/modules";

type AccessUser = {
  _id: string;
  displayName: string;
  email: string;
  role: string;
  status?: string;
};

export function WorkspaceAccessViewer({
  users,
  selectedUserId,
  onSelectUser,
  moduleSource,
}: {
  users: readonly AccessUser[];
  selectedUserId: string;
  onSelectUser: (userId: string) => void;
  moduleSource: Parameters<typeof normalizeModuleSettings>[0];
}) {
  const user = users.find((entry) => entry._id === selectedUserId) ?? users[0];
  if (!user) return null;
  const rows = getModuleAccess(user.role, moduleSource, user.status);
  const actionLabels = { view: "View", write: "Edit", approve: "Approve", submit: "Submit", manage: "Manage" };
  const inactive = user.status !== undefined && user.status !== "Active";

  return (
    <section className="card" aria-labelledby="workspace-access-title" style={{ marginTop: 16 }}>
      <div className="card__head" style={{ flexWrap: "wrap", gap: 12 }}>
        <h2 id="workspace-access-title" className="card__title">
          <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          Module access
        </h2>
        <Select
          aria-label="User to inspect"
          value={user._id}
          onChange={onSelectUser}
          searchable
          options={users.map((entry) => ({ value: entry._id, label: entry.displayName, hint: entry.email }))}
          style={{ marginLeft: "auto", minWidth: 200 }}
        />
      </div>
      <div className="card__body col" style={{ gap: 12 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }} aria-live="polite">
          <strong>{user.displayName}</strong>
          <span className="muted">{user.email}</span>
          <Badge tone={user.role === "Owner" || user.role === "Admin" ? "success" : "info"}>{user.role}</Badge>
          <Badge tone={inactive ? "warn" : "success"}>{user.status ?? "Active"}</Badge>
        </div>
        {inactive && (
          <p style={{ margin: 0, color: "var(--warning)" }}>
            This workspace membership is {user.status?.toLowerCase()}. The table describes the assigned role; it does not grant or activate access.
          </p>
        )}
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
          Role policy; backend checks vary by action. This table summarizes the permissions assigned to this role.
          Record sharing, workflow state, linked records, and other server checks can also affect access. Some modules use different checks; review their notes below.
        </p>
        <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: 0 }}>
          “Some actions” means the role allows part of a module. “Not defined” means there is no corresponding role permission.
          Turning off a module hides its features for the entire workspace; it does not revoke role permissions.
          To change this user's policy, update their role in the Users table. Individual module overrides are not available.
        </p>
        <Link to="/app/settings?tab=modules" className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }}>
          Manage workspace modules
        </Link>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table" aria-label={`Role policy for ${user.displayName}`}>
          <thead>
            <tr>
              <th scope="col">Module / area</th>
              <th scope="col">Workspace feature</th>
              {ACCESS_ACTIONS.map((action) => <th scope="col" key={action}>{actionLabels[action]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" style={{ minWidth: 250, fontWeight: "normal" }}>
                  <strong>{row.label}</strong>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>{row.category}</div>
                  {row.notes.length > 0 && (
                    <details style={{ fontSize: "var(--fs-sm)", marginTop: 6 }}>
                      <summary style={{ cursor: "pointer" }}>Access notes</summary>
                      {row.notes.map((note) => <p key={note} className="muted" style={{ margin: "6px 0 0" }}>{note}</p>)}
                    </details>
                  )}
                </th>
                <td>
                  {row.moduleKey
                    ? <Badge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "Enabled" : "Disabled"}</Badge>
                    : <span className="muted">Core</span>}
                </td>
                {ACCESS_ACTIONS.map((action) => {
                  const coverage = row.actionCoverage[action];
                  return (
                    <td key={action}>
                      {coverage === "full" ? <Badge tone="success">Allowed</Badge>
                        : coverage === "partial" ? <Badge tone="warn">Some actions</Badge>
                        : <span className="muted">{coverage === "unmapped" ? "Not defined" : "Not granted"}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
