import { useState } from "react";
import { Link } from "react-router-dom";
import { InfoPopover } from "./InfoPopover";
import { ChevronDown, Columns3, ShieldCheck } from "lucide-react";
import { Badge, Drawer } from "./ui";
import { Select } from "./Select";
import { Segmented } from "./primitives";
import { ACCESS_ACTIONS, getModuleAccess, type ModuleAccessRow } from "../lib/moduleAccess";
import type { normalizeModuleSettings } from "../lib/modules";
import { useIsMobile } from "../lib/useIsMobile";
import { ROLES, type Role } from "../../shared/functions/access";

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
  entityKind,
}: {
  users: readonly AccessUser[];
  selectedUserId: string;
  onSelectUser: (userId: string) => void;
  moduleSource: Parameters<typeof normalizeModuleSettings>[0];
  /** The organisation's kind; areas that do not apply to it are left out. */
  entityKind?: string | null;
}) {
  const isMobile = useIsMobile();
  const user = users.find((entry) => entry._id === selectedUserId) ?? users[0];
  if (!user) return null;
  // Phones get one role at a time as a list; the per-user, per-action table
  // needs ~860px and stays on wider screens.
  if (isMobile) {
    return <RoleAccess users={users} initialRole={user.role} moduleSource={moduleSource} entityKind={entityKind} />;
  }
  const rows = getModuleAccess(user.role, moduleSource, user.status, entityKind);
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
            "Some actions" means the role allows part of a module; "—" means no role permission covers it. Turning a
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
          <span style={{ color: "var(--warn)", fontSize: "var(--fs-sm)" }}>
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
                    <details className="access-notes" style={{ fontSize: "var(--fs-sm)", marginTop: 6 }}>
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
                        : coverage === "unmapped"
                          ? <span className="muted" title="No role permission covers this action">—</span>
                          : <span className="muted">Not granted</span>}
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

type ModuleSource = Parameters<typeof normalizeModuleSettings>[0];
type Tone = "success" | "info" | "warn" | "neutral";
type AccessLevel = { label: string; short: string; tone: Tone; extras: string[] };

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * One badge for a role's access to a module: the strongest action it grants,
 * with approve/submit and partial grants carried in `extras` for the row's
 * secondary line, so nothing the per-action table shows is lost.
 */
function accessLevel(row: ModuleAccessRow): AccessLevel {
  const coverage = row.actionCoverage;
  const granted = (action: (typeof ACCESS_ACTIONS)[number]) => coverage[action] === "full" || coverage[action] === "partial";
  if (ACCESS_ACTIONS.every((action) => coverage[action] === "unmapped")) {
    return { label: "Own rules", short: "—", tone: "neutral", extras: [] };
  }
  const extras: string[] = [];
  if (granted("approve")) extras.push(coverage.approve === "full" ? "Can approve" : "Some approvals");
  if (granted("submit")) extras.push(coverage.submit === "full" ? "Can submit" : "Some submissions");
  if (coverage.manage === "full") return { label: "Manage", short: "Manage", tone: "success", extras };
  if (coverage.manage === "partial") extras.push("Some manage actions");
  if (granted("write")) {
    return coverage.write === "full"
      ? { label: "Edit", short: "Edit", tone: "success", extras }
      : { label: "Partial edit", short: "Some", tone: "warn", extras };
  }
  if (granted("view")) {
    return coverage.view === "full"
      ? { label: "View", short: "View", tone: "info", extras }
      : { label: "Partial view", short: "Some", tone: "warn", extras };
  }
  return { label: "None", short: "None", tone: "neutral", extras };
}

function RoleAccess({
  users,
  initialRole,
  moduleSource,
  entityKind,
}: {
  users: readonly AccessUser[];
  initialRole: string;
  moduleSource: ModuleSource;
  entityKind?: string | null;
}) {
  const [role, setRole] = useState<Role>(isRole(initialRole) ? initialRole : ROLES[0]);
  const [comparing, setComparing] = useState(false);
  const rows = getModuleAccess(role, moduleSource, undefined, entityKind);
  const holders = users.filter((entry) => entry.role === role);
  const levels = rows.map((row) => ({ row, level: accessLevel(row) }));
  const granted = levels.filter((entry) => entry.level.label !== "Own rules");
  const ownRules = levels.filter((entry) => entry.level.label === "Own rules");

  return (
    <section className="card role-access" aria-labelledby="role-access-title" style={{ marginTop: 16 }}>
      <div className="card__head">
        <h2 id="role-access-title" className="card__title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <ShieldCheck size={14} aria-hidden="true" />
          Role access
        </h2>
        <InfoPopover label="About role access">
          <p>
            What each role's permissions allow, module by module. Record sharing, workflow state and other server checks can
            narrow this further; specialized operations note any extra authority they need.
          </p>
          <p>
            "Own rules" means no role permission covers the module and its own rules apply. Turning a module off hides it
            for the whole workspace but doesn't change role permissions. Change a user's policy by changing their role;
            per-user overrides aren't available.
          </p>
        </InfoPopover>
      </div>
      <div className="role-access__picker">
        <Segmented<Role> value={role} onChange={setRole} items={ROLES.map((entry) => ({ id: entry, label: entry }))} />
        <p className="role-access__holders" aria-live="polite">
          {holders.length === 0
            ? `No users have the ${role} role.`
            : `Held by ${holders.map((entry) => entry.displayName).join(", ")}${holders.some((entry) => entry.status !== undefined && entry.status !== "Active") ? " (inactive memberships get no access)" : ""}`}
        </p>
      </div>
      <RoleAccessList label={`${role} access by module`} rows={granted} />
      {ownRules.length > 0 && (
        /* These modules carry no role permission, so they read the same for
           every role; one fold keeps them out of the way. */
        <details className="role-access__own-rules">
          <summary>
            <span className="role-access__own-rules-title">
              {ownRules.length} modules use their own rules
            </span>
            <Badge>Own rules</Badge>
            <ChevronDown size={16} aria-hidden="true" className="role-access__chevron" />
          </summary>
          <RoleAccessList label="Modules with their own rules" rows={ownRules} />
        </details>
      )}
      <div className="role-access__foot">
        <button type="button" className="btn-action" onClick={() => setComparing(true)}>
          <Columns3 size={12} aria-hidden="true" /> Compare all roles
        </button>
        <Link to="/app/settings?tab=modules">Manage modules</Link>
      </div>
      <Drawer open={comparing} onClose={() => setComparing(false)} title="Compare all roles" size="wide" bodyClassName="role-compare">
        <RoleCompareTable moduleSource={moduleSource} entityKind={entityKind} />
      </Drawer>
    </section>
  );
}

function RoleAccessList({ label, rows }: { label: string; rows: { row: ModuleAccessRow; level: AccessLevel }[] }) {
  return (
    <ul className="role-access__list" aria-label={label}>
      {rows.map(({ row, level }) => {
        const meta = [row.category, ...level.extras, ...(row.moduleKey && !row.enabled ? ["Off in this workspace"] : [])];
        return (
          <li key={row.key} className="role-access__row">
            <div className="role-access__text">
              <span className="role-access__label">{row.label}</span>
              <span className="role-access__meta">{meta.join(" · ")}</span>
            </div>
            <Badge tone={level.tone}>{level.label}</Badge>
            {row.notes.length > 0 ? (
              <InfoPopover label={`Access notes: ${row.label}`}>
                {row.notes.map((note) => <p key={note}>{note}</p>)}
              </InfoPopover>
            ) : <span aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}

/** Every role side by side, one level badge per cell. */
function RoleCompareTable({ moduleSource, entityKind }: { moduleSource: ModuleSource; entityKind?: string | null }) {
  const byRole = ROLES.map((role) => ({ role, rows: getModuleAccess(role, moduleSource, undefined, entityKind) }));
  const modules = byRole[0]?.rows ?? [];
  return (
    <>
      <p className="role-compare__legend">
        The strongest action each role has. "Some" means part of a module's actions; "—" means no role permission
        covers the module and its own rules apply.
      </p>
      <div className="role-compare__scroll">
        <table className="table role-compare__table" aria-label="Access level by role">
          <thead>
            <tr>
              <th scope="col">Module</th>
              {ROLES.map((role) => <th scope="col" key={role}>{role}</th>)}
            </tr>
          </thead>
          <tbody>
            {modules.map((row, index) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {byRole.map(({ role, rows }) => {
                  const level = accessLevel(rows[index]);
                  return (
                    <td key={role} title={`${role}: ${level.label}`}>
                      {level.short === "—" ? <span className="muted">—</span> : <Badge tone={level.tone}>{level.short}</Badge>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
