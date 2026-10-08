import { Link } from "react-router-dom";
import { InfoPopover } from "./InfoPopover";
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
      <div className="card__head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 id="workspace-access-title" className="card__title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ShieldCheck size={14} aria-hidden="true" />
          Module access
        </h2>
        <InfoPopover label="About module access">
          <p>
            What each role's permissions allow, module by module. Record sharing, workflow state and other server checks can
            narrow this further; specialized operations note any extra authority they need.
          </p>
          <p>
            "Some actions" means the role allows part of a module; "Not defined" means no role permission covers it. Turning a
            module off hides it for the whole workspace but doesn't change role permissions. Change a user's policy by changing
            their role; per-user overrides aren't available.
          </p>
        </InfoPopover>
        <Select
          aria-label="User to inspect"
          value={user._id}
          onChange={onSelectUser}
          searchable
          size="sm"
          options={users.map((entry) => ({ value: entry._id, label: entry.displayName, hint: entry.email }))}
          style={{ marginLeft: "auto", width: 220, maxWidth: "100%" }}
        />
      </div>
      <div className="card__body row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }} aria-live="polite">
        <Badge tone={user.role === "Owner" || user.role === "Admin" ? "success" : "info"}>{user.role}</Badge>
        {inactive ? (
          <span style={{ color: "var(--warning)", fontSize: "var(--fs-sm)" }}>
            {user.status}: the table shows the assigned role but grants no access.
          </span>
        ) : (
          <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{user.email}</span>
        )}
        <Link to="/app/settings?tab=modules" style={{ marginLeft: "auto", fontSize: "var(--fs-sm)" }}>
          Manage modules
        </Link>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="table access-policy-table" aria-label={`Role policy for ${user.displayName}`}>
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
                <th scope="row" style={{ minWidth: 200, fontWeight: "normal", textAlign: "left" }}>
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
