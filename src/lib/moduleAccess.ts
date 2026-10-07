import { listPermissionsForRole, type Permission } from "../../shared/functions/permissions";
import { MODULE_DEFINITIONS, normalizeModuleSettings, type ModuleKey } from "./modules";

/** A read-only projection of the fixed role policy, never an authorization check. */
export const ACCESS_ACTIONS = ["view", "write", "approve", "submit", "manage"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type AccessCoverage = "full" | "partial" | "none" | "unmapped";

export type ModuleAccessDefinition = {
  key: string;
  label: string;
  category: string;
  moduleKey?: ModuleKey;
  permissions: Partial<Record<AccessAction, readonly Permission[]>>;
  notes: readonly string[];
};

export type ModuleAccessRow = Omit<ModuleAccessDefinition, "permissions" | "notes"> & {
  enabled: boolean;
  actions: Record<AccessAction, boolean | null>;
  actionCoverage: Record<AccessAction, AccessCoverage>;
  actionPermissions: Record<AccessAction, readonly Permission[]>;
  notes: string[];
};

export const MODULE_ACCESS_POLICY_NOTE =
  "This shows the fixed role policy enforced by the shared action guard. Active membership, record sharing, and operation state can restrict access further.";

const ACTION_POLICY_NOTE =
  "Protected actions require active workspace membership and the corresponding role permission. Record-specific checks can restrict access further.";
const UNMAPPED_NOTE =
  "No dedicated permission is defined for this module in the fixed role policy. Its own workspace and action rules apply.";

const core = (
  key: string,
  label: string,
  category: string,
  permissions: ModuleAccessDefinition["permissions"],
  notes: readonly string[] = [],
): ModuleAccessDefinition => ({ key, label, category, permissions, notes });

const OPTIONAL_POLICY: Record<ModuleKey, Pick<ModuleAccessDefinition, "permissions" | "notes">> = {
  communications: {
    permissions: { view: ["communications:read"], write: ["communications:write"] },
    notes: [ACTION_POLICY_NOTE],
  },
  volunteers: {
    permissions: { view: ["volunteers:read"], write: ["volunteers:write"] },
    notes: ["Roster and screening changes require the volunteers:write permission, granted to Admin and Owner."],
  },
  grants: {
    permissions: { view: ["grants:read"], write: ["grants:write"] },
    notes: ["Grant changes require the grants:write permission, granted to Admin and Owner."],
  },
  agreements: {
    permissions: { view: ["agreements:read"], write: ["agreements:write"] },
    notes: ["Agreement changes require the agreements:write permission, granted to Admin and Owner. Converting system gaps also needs documents:write."],
  },
  voting: {
    permissions: {
      view: ["elections:read", "motions:read", "proxies:read"],
      write: ["elections:write", "motions:write", "proxies:write"],
      manage: ["elections:tally"],
    },
    notes: ["Manage means election tallying. Election administration requires the matching action permission. Legal voting eligibility and ballot access have separate rules."],
  },
  auditors: {
    permissions: { view: ["auditors:read"], write: ["auditors:write"] },
    notes: [ACTION_POLICY_NOTE],
  },
  attestations: {
    permissions: { view: ["attestations:read"], write: ["attestations:write"] },
    notes: [ACTION_POLICY_NOTE],
  },
  courtOrders: {
    permissions: { view: ["courtOrders:read"], write: ["courtOrders:write"] },
    notes: [ACTION_POLICY_NOTE],
  },
  filingPrefill: { permissions: {}, notes: [UNMAPPED_NOTE] },
  recordsInspection: { permissions: {}, notes: [UNMAPPED_NOTE] },
  pipaTraining: { permissions: {}, notes: [UNMAPPED_NOTE, ACTION_POLICY_NOTE] },
  insurance: { permissions: {}, notes: [UNMAPPED_NOTE, ACTION_POLICY_NOTE] },
  secrets: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Vault changes require Admin or Owner. Viewing custody metadata does not grant access to secret values; reveal policies and named custodians apply."],
  },
  transparency: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Publishing changes use the shared settings action policy. Published records have a separate public view."],
  },
  reconciliation: { permissions: {}, notes: [UNMAPPED_NOTE, ACTION_POLICY_NOTE] },
  assets: { permissions: {}, notes: [UNMAPPED_NOTE, ACTION_POLICY_NOTE] },
  donationReceipts: { permissions: {}, notes: [UNMAPPED_NOTE, ACTION_POLICY_NOTE] },
  membershipBilling: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Changing billing plans and fee periods requires Admin or Owner. Subscription actions have separate rules."],
  },
  employees: {
    permissions: { view: ["employees:read"], write: ["employees:write"] },
    notes: [ACTION_POLICY_NOTE],
  },
  paperless: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Connection configuration requires Admin or Owner. Some document synchronization actions require Director or above."],
  },
  browserConnectors: { permissions: {}, notes: [UNMAPPED_NOTE] },
  workflows: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Workflow edits and execution require tasks:write. Each execution step also checks the current initiating membership; external service capabilities have additional requirements."],
  },
};

/** Every optional module is listed, including modules with no dedicated grant. */
export const MODULE_ACCESS_DEFINITIONS: readonly ModuleAccessDefinition[] = [
  core("workspace", "Workspace profile", "Workspace", {
    view: ["society:read"], write: ["society:write", "society:update"],
  }, [ACTION_POLICY_NOTE]),
  core("people", "Members, directors & committees", "Governance", {
    view: ["members:read", "directors:read", "committees:read"],
    write: ["members:write", "directors:write", "committees:write"],
  }, [ACTION_POLICY_NOTE]),
  core("meetings", "Meetings & agendas", "Governance", {
    view: ["meetings:read", "agendas:read"], write: ["meetings:write", "agendas:write"],
  }, [ACTION_POLICY_NOTE]),
  core("minutes", "Minutes", "Governance", {
    view: ["minutes:read"], write: ["minutes:write"], approve: ["minutes:approve"],
  }, [ACTION_POLICY_NOTE]),
  core("conflicts", "Conflicts of interest", "Governance", {
    view: ["conflicts:read"], write: ["conflicts:write"],
  }, [ACTION_POLICY_NOTE]),
  core("filings", "Filings", "Compliance", {
    view: ["filings:read"], write: ["filings:write"], submit: ["filings:submit"],
  }, [ACTION_POLICY_NOTE]),
  core("deadlines", "Deadlines & commitments", "Compliance", {
    view: ["deadlines:read", "commitments:read"], write: ["deadlines:write", "commitments:write"],
  }, [ACTION_POLICY_NOTE]),
  core("financials", "Financial records", "Finance", {
    view: ["financials:read"], write: ["financials:write"],
  }, [ACTION_POLICY_NOTE]),
  core("documents", "Documents", "Records", {
    view: ["documents:read"], write: ["documents:write"],
  }, ["Document and meeting-material visibility, individual grants, and archived or withdrawn status can restrict access further."]),
  core("tasks", "Tasks", "Workspace", { view: ["tasks:read"], write: ["tasks:write"] }, [ACTION_POLICY_NOTE]),
  core("exports", "Exports", "Records", { view: ["exports:read", "exports:download"] },
    ["View includes browsing and downloading exports; some roles have only the browsing grant.", ACTION_POLICY_NOTE]),
  core("users", "Users & invitations", "Administration", {
    view: ["users:read"], manage: ["users:write"],
  }, ["Admin manages Director, Member and Viewer access. Only Owner can manage Owner or Admin authority or remove users. Ordinary changes preserve an Active Owner; incident disabling can instead enter controlled recovery.",
    "The workspace roster requires users:read. Users can read their own profile; Admin and Owner can inspect another user’s role policy."]),
  core("settings", "Workspace settings", "Administration", {
    view: ["settings:read"], write: ["settings:write"], manage: ["settings:manage"],
  }, ["The fixed policy reserves settings:manage for Owner. Module configuration changes allow Admin or Owner."]),
  core("audit", "Audit history", "Administration", { view: ["audit:read"] }),
  core("corporationRegisters", "Corporate registers & equity", "Governance", {}, [UNMAPPED_NOTE]),
  ...MODULE_DEFINITIONS.map((module): ModuleAccessDefinition => ({
    key: module.key,
    label: module.label,
    category: module.category,
    moduleKey: module.key,
    ...OPTIONAL_POLICY[module.key],
  })),
];

/** Feature availability and membership state never rewrite the role policy. */
export function getModuleAccess(
  role: string | null | undefined,
  source?: Parameters<typeof normalizeModuleSettings>[0],
  status?: string | null,
): ModuleAccessRow[] {
  const grants = new Set<Permission>(listPermissionsForRole(role ?? ""));
  const settings = normalizeModuleSettings(source);
  return MODULE_ACCESS_DEFINITIONS.map(({ permissions, notes, ...definition }) => {
    const actions = {} as ModuleAccessRow["actions"];
    const actionCoverage = {} as ModuleAccessRow["actionCoverage"];
    const actionPermissions = {} as ModuleAccessRow["actionPermissions"];
    for (const action of ACCESS_ACTIONS) {
      const mapped = permissions[action] ?? [];
      const count = mapped.filter((permission) => grants.has(permission)).length;
      actionPermissions[action] = mapped;
      actions[action] = mapped.length ? count > 0 : null;
      actionCoverage[action] = !mapped.length ? "unmapped"
        : !count ? "none" : count === mapped.length ? "full" : "partial";
    }
    const enabled = !definition.moduleKey || settings[definition.moduleKey];
    return {
      ...definition, enabled, actions, actionCoverage, actionPermissions,
      notes: [
        ...notes,
        ...(!enabled ? ["This feature is disabled for the workspace. Its role grants remain unchanged; a feature switch is not an access-control grant."] : []),
        ...(status && status !== "Active" ? ["This membership is not active. The policy below describes its assigned role; it does not activate account access."] : []),
      ],
    };
  });
}
