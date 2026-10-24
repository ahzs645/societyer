export type PayrollViewGroup = "run" | "setup" | "records" | "compliance";
export type PayrollRendererKey =
  | "calculate"
  | "sources"
  | "records"
  | "tools"
  | "filings"
  | "leave"
  | "td1"
  | "rules"
  | "roe"
  | "remittances";
export type PayrollSourceView =
  | "profiles"
  | "work"
  | "openings"
  | "employer"
  | "codes";
export type PayrollViewDescriptor = {
  id: string;
  label: string;
  group: PayrollViewGroup;
  renderer: PayrollRendererKey;
  permissions: readonly string[];
  needsEmployees: boolean;
  needsCodes?: boolean;
  needsRecords?: boolean;
  paymentYear: boolean;
  required?: boolean;
  source?: PayrollSourceView;
};
const FINANCE = ["financials:read"] as const,
  PRIVATE = ["financials:read", "employees:read"] as const;
/** Register trusted built-in modules here; preference data can only name IDs. */
export const PAYROLL_VIEWS = [
  {
    id: "calculate",
    label: "Calculate",
    group: "run",
    renderer: "calculate",
    permissions: PRIVATE,
    needsEmployees: true,
    needsCodes: true,
    needsRecords: true,
    paymentYear: true,
    required: true,
  },
  {
    id: "profiles",
    label: "Employee profiles",
    group: "setup",
    renderer: "sources",
    source: "profiles",
    permissions: PRIVATE,
    needsEmployees: true,
    paymentYear: true,
  },
  {
    id: "work",
    label: "Work & leave",
    group: "run",
    renderer: "sources",
    source: "work",
    permissions: PRIVATE,
    needsEmployees: true,
    paymentYear: true,
  },
  {
    id: "leave",
    label: "Vacation time",
    group: "run",
    renderer: "leave",
    permissions: PRIVATE,
    needsEmployees: false,
    paymentYear: false,
  },
  {
    id: "openings",
    label: "Opening balances",
    group: "setup",
    renderer: "sources",
    source: "openings",
    permissions: PRIVATE,
    needsEmployees: true,
    paymentYear: true,
  },
  {
    id: "employer",
    label: "Employer setup",
    group: "setup",
    renderer: "sources",
    source: "employer",
    permissions: PRIVATE,
    needsEmployees: false,
    paymentYear: true,
  },
  {
    id: "codes",
    label: "Earning codes",
    group: "setup",
    renderer: "sources",
    source: "codes",
    permissions: FINANCE,
    needsEmployees: false,
    paymentYear: true,
  },
  {
    id: "records",
    label: "Saved calculations",
    group: "records",
    renderer: "records",
    permissions: PRIVATE,
    needsEmployees: false,
    needsRecords: true,
    paymentYear: true,
  },
  {
    id: "tools",
    label: "Tools",
    group: "run",
    renderer: "tools",
    permissions: FINANCE,
    needsEmployees: false,
    paymentYear: false,
  },
  {
    id: "filings",
    label: "Filings",
    group: "compliance",
    renderer: "filings",
    permissions: PRIVATE,
    needsEmployees: false,
    paymentYear: false,
  },
  {
    id: "td1",
    label: "TD1 import",
    group: "setup",
    renderer: "td1",
    permissions: PRIVATE,
    needsEmployees: false,
    paymentYear: false,
  },
  {
    id: "rules",
    label: "Rules library",
    group: "compliance",
    renderer: "rules",
    permissions: FINANCE,
    needsEmployees: false,
    paymentYear: false,
  },
  {
    id: "roe",
    label: "ROE workflow",
    group: "compliance",
    renderer: "roe",
    permissions: PRIVATE,
    needsEmployees: false,
    paymentYear: false,
  },
  {
    id: "remittances",
    label: "Remittances",
    group: "compliance",
    renderer: "remittances",
    permissions: PRIVATE,
    needsEmployees: false,
    paymentYear: false,
  },
] as const satisfies readonly PayrollViewDescriptor[];
export type PayrollViewId = (typeof PAYROLL_VIEWS)[number]["id"];
export const PAYROLL_VIEW_IDS = PAYROLL_VIEWS.map((view) => view.id);
export const PAYROLL_VIEW_GROUP_LABELS: Record<PayrollViewGroup, string> = {
  run: "Run payroll",
  setup: "Reviewed sources",
  records: "Saved records",
  compliance: "Rules and compliance",
};
export function payrollView(
  id: unknown,
): PayrollViewDescriptor & { id: PayrollViewId } {
  return (PAYROLL_VIEWS.find((view) => view.id === id) ??
    PAYROLL_VIEWS[0]) as PayrollViewDescriptor & { id: PayrollViewId };
}
export type PayrollViewPreferences = {
  version: 1;
  order: PayrollViewId[];
  hidden: PayrollViewId[];
  favorites: PayrollViewId[];
  expanded: Record<PayrollViewId, boolean>;
};
const isView = (value: unknown): value is PayrollViewId =>
  typeof value === "string" &&
  (PAYROLL_VIEW_IDS as readonly string[]).includes(value);
function ids(raw: unknown): PayrollViewId[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(isView))] : [];
}
export function cleanPayrollViewPreferences(
  raw: unknown,
): PayrollViewPreferences {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const order = ids(input.order);
  const expanded =
    input.expanded && typeof input.expanded === "object"
      ? (input.expanded as Record<string, unknown>)
      : {};
  return {
    version: 1,
    order: [
      "calculate",
      ...order.filter((id) => id !== "calculate"),
      ...PAYROLL_VIEW_IDS.filter(
        (id) => id !== "calculate" && !order.includes(id),
      ),
    ],
    hidden: ids(input.hidden).filter((id) => !payrollView(id).required),
    favorites: ids(input.favorites),
    expanded: Object.fromEntries(
      PAYROLL_VIEW_IDS.map((id) => [
        id,
        typeof expanded[id] === "boolean" ? expanded[id] : true,
      ]),
    ) as Record<PayrollViewId, boolean>,
  };
}
export function visiblePayrollViews(
  preferences: PayrollViewPreferences,
  can: (permission: string) => boolean,
) {
  return preferences.order
    .map((id) => payrollView(id))
    .filter(
      (view) =>
        view.permissions.every(can) &&
        (view.required || !preferences.hidden.includes(view.id)),
    )
    .sort((a, b) =>
      a.required
        ? -1
        : b.required
          ? 1
          : Number(preferences.favorites.includes(b.id)) -
            Number(preferences.favorites.includes(a.id)),
    );
}
export const payrollViewPreferenceKey = (societyId: string, userId: string) =>
  `societyer.payroll.views:v1:${encodeURIComponent(societyId)}:${encodeURIComponent(userId)}`;
