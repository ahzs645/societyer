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
  "This shows the fixed role policy. Server checks vary by action, so this is not a complete account of effective access. Individual document rules can also apply.";

const MEMBERSHIP_ONLY_NOTE =
  "Some server actions currently check active workspace membership without enforcing these role grants. A role-policy denial alone does not prevent those actions.";
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
    notes: [MEMBERSHIP_ONLY_NOTE],
  },
  volunteers: {
    permissions: { view: ["volunteers:read"], write: ["volunteers:write"] },
    notes: ["Server roster and screening changes allow Director and above, while the fixed role policy grants writes only to Admin and Owner."],
  },
  grants: {
    permissions: { view: ["grants:read"], write: ["grants:write"] },
    notes: ["Server grant changes allow Director and above, while the fixed role policy grants writes only to Admin and Owner."],
  },
  voting: {
    permissions: {
      view: ["elections:read", "motions:read", "proxies:read"],
      write: ["elections:write", "motions:write", "proxies:write"],
      manage: ["elections:tally"],
    },
    notes: ["Manage means election tallying. Voting eligibility and ballot access have separate rules. Several election changes allow Director on the server, beyond the fixed role policy."],
  },
  auditors: {
    permissions: { view: ["auditors:read"], write: ["auditors:write"] },
    notes: [MEMBERSHIP_ONLY_NOTE],
  },
  attestations: {
    permissions: { view: ["attestations:read"], write: ["attestations:write"] },
    notes: [MEMBERSHIP_ONLY_NOTE],
  },
  courtOrders: {
    permissions: { view: ["courtOrders:read"], write: ["courtOrders:write"] },
    notes: [MEMBERSHIP_ONLY_NOTE],
  },
  filingPrefill: { permissions: {}, notes: [UNMAPPED_NOTE] },
  recordsInspection: { permissions: {}, notes: [UNMAPPED_NOTE] },
  pipaTraining: { permissions: {}, notes: [UNMAPPED_NOTE, MEMBERSHIP_ONLY_NOTE] },
  insurance: { permissions: {}, notes: [UNMAPPED_NOTE, MEMBERSHIP_ONLY_NOTE] },
  secrets: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Vault changes require Admin or Owner. Viewing custody metadata does not grant access to secret values; reveal policies and named custodians apply."],
  },
  transparency: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Publishing changes require Director or above. Published records have a separate public view."],
  },
  reconciliation: { permissions: {}, notes: [UNMAPPED_NOTE, MEMBERSHIP_ONLY_NOTE] },
  assets: { permissions: {}, notes: [UNMAPPED_NOTE, MEMBERSHIP_ONLY_NOTE] },
  donationReceipts: { permissions: {}, notes: [UNMAPPED_NOTE, MEMBERSHIP_ONLY_NOTE] },
  membershipBilling: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Changing billing plans and fee periods requires Admin or Owner. Subscription actions have separate rules."],
  },
  employees: {
    permissions: { view: ["employees:read"], write: ["employees:write"] },
    notes: [MEMBERSHIP_ONLY_NOTE],
  },
  paperless: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Connection configuration requires Admin or Owner. Some document synchronization actions require Director or above."],
  },
  browserConnectors: { permissions: {}, notes: [UNMAPPED_NOTE] },
  workflows: {
    permissions: {},
    notes: [UNMAPPED_NOTE, "Workflow edits require Director or above; external execution can have additional checks."],
  },
};

/** Every optional module is listed, including modules with no dedicated grant. */
export const MODULE_ACCESS_DEFINITIONS: readonly ModuleAccessDefinition[] = [
  core("workspace", "Workspace profile", "Workspace", {
    view: ["society:read"], write: ["society:write", "society:update"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("people", "Members, directors & committees", "Governance", {
    view: ["members:read", "directors:read", "committees:read"],
    write: ["members:write", "directors:write", "committees:write"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("meetings", "Meetings & agendas", "Governance", {
    view: ["meetings:read", "agendas:read"], write: ["meetings:write", "agendas:write"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("minutes", "Minutes", "Governance", {
    view: ["minutes:read"], write: ["minutes:write"], approve: ["minutes:approve"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("conflicts", "Conflicts of interest", "Governance", {
    view: ["conflicts:read"], write: ["conflicts:write"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("filings", "Filings", "Compliance", {
    view: ["filings:read"], write: ["filings:write"], submit: ["filings:submit"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("deadlines", "Deadlines & commitments", "Compliance", {
    view: ["deadlines:read", "commitments:read"], write: ["deadlines:write", "commitments:write"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("financials", "Financial records", "Finance", {
    view: ["financials:read"], write: ["financials:write"],
  }, [MEMBERSHIP_ONLY_NOTE]),
  core("documents", "Documents", "Records", {
    view: ["documents:read"], write: ["documents:write"],
  }, ["Document and meeting-material visibility, individual grants, and archived or withdrawn status can restrict access further."]),
  core("tasks", "Tasks", "Workspace", { view: ["tasks:read"], write: ["tasks:write"] }, [MEMBERSHIP_ONLY_NOTE]),
  core("exports", "Exports", "Records", { view: ["exports:read", "exports:download"] },
    ["View includes browsing and downloading exports; some roles have only the browsing grant.", MEMBERSHIP_ONLY_NOTE]),
  core("users", "Users & invitations", "Administration", {
    view: ["users:read"], manage: ["users:write"],
  }, ["Changing roles and creating users requires Admin or Owner; removing users requires Owner. The last active Owner cannot be removed, demoted, or disabled.",
    "The server user list checks active membership, so members can see the roster beyond the fixed role read grant."]),
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
