import {
  ROE_PAY_PERIODS,
  ROE_REASONS,
  type RoeFilingInput,
} from "./payrollReporting";
/** Reviewed public guidance. Case evidence, XML generation and actual issuance are separate records. */
export const ROE_WORKFLOW_RULES_VERSION = "service-canada-roe-guide-2026-10-23";
export const ROE_WORKFLOW_SOURCES = [
  {
    title: "Service Canada — How to complete the Record of Employment",
    url: "https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/reports/roe-guide.html",
    reviewedOn: "2026-10-23",
  },
  {
    title: "Record of Employment on the Web (ROE Web)",
    url: "https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/ei-roe.html",
    reviewedOn: "2026-10-23",
  },
  {
    title: "My Service Canada Account — employee access",
    url: "https://www.canada.ca/en/employment-social-development/services/my-account.html",
    reviewedOn: "2026-10-23",
  },
] as const;
export type RoeWorkflowTrigger =
  | "seven_days"
  | "reduced_earnings"
  | "wage_loss"
  | "request"
  | "other";
export type RoeWorkflowException =
  | "ordinary"
  | "casual"
  | "annual_vacation"
  | "self_funded"
  | "nonstandard"
  | "needs_review";
export type RoeWorkflowFacts = {
  trigger: RoeWorkflowTrigger;
  format: "electronic" | "paper";
  payPeriodCode: keyof typeof ROE_PAY_PERIODS;
  firstDayWorked: string;
  lastDayPaid: string;
  interruptionDate?: string;
  awareDate: string;
  periodStart: string;
  periodEnd: string;
  noWorkNoEarningsDays: number;
  anticipatedGap: boolean;
  normalWeeklyEarningsCents?: number;
  reducedWeeklyEarningsCents?: number;
  reductionWeekDate?: string;
  reductionReason?:
    | "illness_injury_quarantine"
    | "pregnancy"
    | "parental"
    | "family_care"
    | "other";
  exception: RoeWorkflowException;
  requestFrom: "none" | "employee" | "service_canada";
  inactiveCasual: boolean;
  otherRequirementConfirmed: boolean;
  reasonCode: (typeof ROE_REASONS)[number];
  evidence: string;
  requestedDueDate?: string;
  reviewTargetDate?: string;
  notes?: string;
};
export const ROE_READINESS_LABELS = {
  insurability: "Insurable employment and the ROE requirement reviewed",
  dates_reason:
    "First/last paid dates, interruption, pay period and reason reviewed",
  history:
    "Complete insurable earnings, hours and consecutive pay-period history reviewed",
  separation:
    "Vacation, holidays, final and other separation payments reviewed",
  identifiers:
    "Employer payroll account and employee identifiers available securely",
  portal_access:
    "Authorized ROE Web/provider access or official paper forms ready",
  employee_access:
    "Employee access and paper/electronic copy instructions reviewed",
} as const;
export type RoeReadinessKey = keyof typeof ROE_READINESS_LABELS;
export type RoeReadiness = Record<RoeReadinessKey, boolean>;
export const emptyRoeReadiness = (): RoeReadiness => ({
  insurability: false,
  dates_reason: false,
  history: false,
  separation: false,
  identifiers: false,
  portal_access: false,
  employee_access: false,
});
export const ROE_FOLLOWUP_LABELS = {
  acceptance: "Confirm Service Canada acceptance / actual ROE serial",
  employee_access: "Confirm employee access and any requested copy",
  missing_information: "Resolve missing information or an unanswered request",
  retention: "Review retention of the protected ROE/payroll records",
} as const;
export type RoeFollowUpKey = keyof typeof ROE_FOLLOWUP_LABELS;
export type RoeFollowUp = {
  key: RoeFollowUpKey;
  dueDate: string;
  status: "open" | "blocked" | "done" | "not_applicable";
  note?: string;
  updatedAtISO: string;
  deadlineId?: string;
  completedAtISO?: string;
};
export type RoeWorkflowEvent = {
  atISO: string;
  actorUserId: string;
  action: string;
  note?: string;
  version: number;
  sha256?: string;
  byteLength?: number;
  filename?: string;
  caseFingerprint?: string;
  schemaVersion?: string;
};
export type RoeWorkflowCase = {
  _id: string;
  societyId: string;
  employeeId: string;
  employeeName: string;
  registerId?: string;
  amendmentOfCaseId?: string;
  amendmentOriginalSerial?: string;
  facts: RoeWorkflowFacts;
  checklist: RoeReadiness;
  rulesVersion: string;
  version: number;
  history: RoeWorkflowEvent[];
  followUps: RoeFollowUp[];
  deadlineId?: string;
  generated?: {
    atISO: string;
    sha256: string;
    byteLength: number;
    filename: string;
    caseFingerprint: string;
    schemaVersion: string;
  };
  submission?: {
    atISO: string;
    channel: "roe_web" | "provider" | "paper";
    reference: string;
    note: string;
  };
  closedAtISO?: string;
  closeNote?: string;
  createdAtISO: string;
  updatedAtISO: string;
};
export type RoeAssessment = {
  requirement: "required" | "review_required" | "not_required";
  interruptionDate?: string;
  dueDate?: string;
  deadlineBasis: string;
  warnings: string[];
  blockers: string[];
  rulesVersion: string;
};
export type RoeRegister = {
  _id: string;
  employeeId?: string;
  employeeName: string;
  lastDayPaid: string;
  reasonCode: string;
  dueDate?: string;
  status: string;
  issuedOn?: string;
  serialNumber?: string;
};
export type RoeWorkflowView = RoeWorkflowCase & {
  assessment: RoeAssessment;
  stage:
    | "preparing"
    | "generated"
    | "submitted"
    | "issued"
    | "closed"
    | "not_required";
  register: RoeRegister | null;
  caseFingerprint: string;
  readinessBlockers: string[];
  originalCase?: {
    _id: string;
    employeeName: string;
    serialNumber?: string;
    issuedOn?: string;
  } | null;
};
export type RoeWorkflowWorkspace = {
  page: Array<RoeWorkflowView | RoeRegister>;
  isDone: boolean;
  continueCursor: string;
  today: string;
  detail?: RoeWorkflowView | null;
  sources: typeof ROE_WORKFLOW_SOURCES;
};
function calendar(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be a valid YYYY-MM-DD date.`);
  return value;
}
export function roeCalendarAdd(value: string, days: number) {
  const date = new Date(`${calendar(value, "Date")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function optionalDate(value: unknown, label: string) {
  return value === undefined || value === ""
    ? undefined
    : calendar(value, label);
}
function nonnegative(
  value: unknown,
  label: string,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new Error(`${label} must be a nonnegative supported integer.`);
  return value;
}
function text(value: unknown, label: string, required = false, max = 2000) {
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "string" ||
    value.length > max ||
    /(?:^|[^0-9])\d{3}[- ]?\d{3}[- ]?\d{3}(?:[^0-9]|$)/.test(value) ||
    (required && !value.trim()) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)
  )
    throw new Error(
      `${label} ${required ? "is required and " : ""}must contain at most ${max} valid characters.`,
    );
  return value.trim();
}
function choice<const T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (!values.includes(value as T))
    throw new Error(`Choose a supported ${label}.`);
  return value as T;
}
function flag(value: unknown, label: string) {
  if (typeof value !== "boolean")
    throw new Error(`Review ${label} explicitly.`);
  return value;
}
function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}
export function cleanRoeWorkflowFacts(raw: RoeWorkflowFacts): RoeWorkflowFacts {
  const firstDayWorked = calendar(raw.firstDayWorked, "First day worked"),
    lastDayPaid = calendar(raw.lastDayPaid, "Last day paid"),
    awareDate = calendar(raw.awareDate, "Employer awareness date"),
    periodStart = calendar(raw.periodStart, "Pay-period start"),
    periodEnd = calendar(raw.periodEnd, "Pay-period end");
  if (firstDayWorked > lastDayPaid || periodEnd < periodStart)
    throw new Error("ROE employment/pay-period dates are inconsistent.");
  return defined({
    trigger: choice(
      raw.trigger,
      ["seven_days", "reduced_earnings", "wage_loss", "request", "other"],
      "interruption trigger",
    ),
    format: choice(raw.format, ["electronic", "paper"], "ROE format"),
    payPeriodCode: choice(
      raw.payPeriodCode,
      Object.keys(ROE_PAY_PERIODS) as Array<keyof typeof ROE_PAY_PERIODS>,
      "pay-period frequency",
    ),
    firstDayWorked,
    lastDayPaid,
    interruptionDate: optionalDate(raw.interruptionDate, "Interruption date"),
    awareDate,
    periodStart,
    periodEnd,
    noWorkNoEarningsDays: nonnegative(
      raw.noWorkNoEarningsDays,
      "Consecutive days without work and insurable earnings",
      3660,
    ),
    anticipatedGap: flag(
      raw.anticipatedGap,
      "anticipated/actual interruption facts",
    ),
    normalWeeklyEarningsCents:
      raw.normalWeeklyEarningsCents == null
        ? undefined
        : nonnegative(raw.normalWeeklyEarningsCents, "Normal weekly earnings"),
    reducedWeeklyEarningsCents:
      raw.reducedWeeklyEarningsCents == null
        ? undefined
        : nonnegative(
            raw.reducedWeeklyEarningsCents,
            "Reduced weekly earnings",
          ),
    reductionWeekDate: optionalDate(
      raw.reductionWeekDate,
      "Reduced-earnings week date",
    ),
    reductionReason:
      raw.reductionReason === undefined
        ? undefined
        : choice(
            raw.reductionReason,
            [
              "illness_injury_quarantine",
              "pregnancy",
              "parental",
              "family_care",
              "other",
            ],
            "reduction reason",
          ),
    exception: choice(
      raw.exception,
      [
        "ordinary",
        "casual",
        "annual_vacation",
        "self_funded",
        "nonstandard",
        "needs_review",
      ],
      "interruption exception",
    ),
    requestFrom: choice(
      raw.requestFrom,
      ["none", "employee", "service_canada"],
      "request source",
    ),
    inactiveCasual: flag(
      raw.inactiveCasual,
      "casual employee active-list status",
    ),
    otherRequirementConfirmed: flag(
      raw.otherRequirementConfirmed,
      "other ROE requirement",
    ),
    reasonCode: choice(raw.reasonCode, ROE_REASONS, "ROE reason code"),
    evidence: text(raw.evidence, "Trigger/date/source evidence", true)!,
    requestedDueDate: optionalDate(
      raw.requestedDueDate,
      "Service Canada requested deadline",
    ),
    reviewTargetDate: optionalDate(
      raw.reviewTargetDate,
      "Reviewed action target",
    ),
    notes: text(raw.notes, "ROE case notes"),
  });
}
export function assessRoeWorkflow(
  input: RoeWorkflowFacts,
  amendment = false,
): RoeAssessment {
  const f = cleanRoeWorkflowFacts(input),
    warnings: string[] = [],
    blockers: string[] = [];
  let requirement: RoeAssessment["requirement"] = "review_required",
    interruption = f.interruptionDate;
  if (amendment) {
    requirement = "required";
    warnings.push(
      "An amendment repeats the complete correct ROE and references the original serial. Issued ROEs cannot be cancelled; use the official correction workflow.",
    );
    return {
      requirement,
      interruptionDate: interruption,
      dueDate: f.reviewTargetDate,
      deadlineBasis:
        "Amend as soon as correction is known; this action target is reviewed by the employer, not an invented statutory amendment period.",
      warnings,
      blockers: !f.reviewTargetDate
        ? ["Set an explicit review/action target for this amendment."]
        : [],
      rulesVersion: ROE_WORKFLOW_RULES_VERSION,
    };
  }
  if (f.requestFrom === "service_canada") {
    requirement = "required";
    if (!f.requestedDueDate)
      blockers.push(
        "Obtain and review the actual Service Canada request target or instructions; an ordinary estimated deadline is not a confirmed request deadline.",
      );
  } else if (
    ["annual_vacation", "self_funded", "nonstandard", "needs_review"].includes(
      f.exception,
    )
  ) {
    requirement = "review_required";
    blockers.push(
      "An exception or nonstandard work arrangement needs specific Service Canada guidance before treating this as an ordinary interruption.",
    );
  } else if (f.trigger === "seven_days") {
    interruption = f.lastDayPaid;
    if (f.interruptionDate && f.interruptionDate !== interruption)
      blockers.push(
        "For the ordinary seven-day rule, the guide identifies the first interruption day as the last day for which paid. Review the date rather than adding a day automatically.",
      );
    requirement =
      f.noWorkNoEarningsDays >= 7 ||
      (f.exception === "casual" && f.inactiveCasual)
        ? "required"
        : "not_required";
    if (
      f.exception === "casual" &&
      requirement === "required" &&
      f.requestFrom !== "employee" &&
      !f.inactiveCasual &&
      f.noWorkNoEarningsDays < 30
    ) {
      requirement = "review_required";
      blockers.push(
        "Part-time/on-call/casual workers do not automatically need an ROE for each seven-day gap. Review a request, removal from the active list, Service Canada direction or the 30-day condition.",
      );
    }
  } else if (f.trigger === "reduced_earnings") {
    if (
      !f.normalWeeklyEarningsCents ||
      f.reducedWeeklyEarningsCents == null ||
      !f.reductionWeekDate
    ) {
      blockers.push(
        "Record actual normal/reduced weekly earnings and a date in the first reduced week.",
      );
    } else {
      const below =
        BigInt(f.reducedWeeklyEarningsCents) * 100n <
        BigInt(f.normalWeeklyEarningsCents) * 60n;
      const date = new Date(`${f.reductionWeekDate}T00:00:00Z`);
      interruption = roeCalendarAdd(f.reductionWeekDate, -date.getUTCDay());
      requirement =
        below &&
        [
          "illness_injury_quarantine",
          "pregnancy",
          "parental",
          "family_care",
        ].includes(f.reductionReason ?? "")
          ? "required"
          : below
            ? "review_required"
            : "not_required";
      if (below && requirement === "review_required")
        blockers.push(
          "The under-60% rule applies to the listed illness, pregnancy, parental and family-care circumstances; another reason needs specific review.",
        );
      if (f.interruptionDate && f.interruptionDate !== interruption)
        blockers.push(
          "For the under-60% rule, review the Sunday of the first qualifying week as the interruption date.",
        );
    }
  } else if (
    f.trigger === "request" &&
    f.requestFrom === "employee" &&
    f.noWorkNoEarningsDays >= 7
  ) {
    requirement = "required";
    interruption = f.lastDayPaid;
  } else if (f.trigger === "wage_loss") {
    requirement = "required";
    warnings.push(
      "Review whether WLI is insurable and whether the later interruption needs a second ROE; do not merge the distinct insurance events automatically.",
    );
    if (!interruption)
      blockers.push(
        "Record the actual interruption date when wage-loss-insurance payments begin; review whether a later second ROE is needed for insurable WLI.",
      );
  } else if (f.otherRequirementConfirmed) {
    requirement = "required";
    warnings.push(
      "This case relies on the explicitly reviewed request/other requirement recorded in the source evidence.",
    );
  } else
    blockers.push(
      "Review the actual request or special reason with Service Canada; the case cannot assume that every employment change is an interruption.",
    );
  if (requirement === "not_required")
    warnings.push(
      "The recorded facts do not meet this ordinary trigger. Reassess if the gap, earnings, employment status or a Service Canada request changes.",
    );
  if (
    interruption &&
    (interruption < f.periodStart || interruption > f.periodEnd)
  )
    blockers.push(
      "The pay period must contain the reviewed interruption date; the payroll payment date is a different date.",
    );
  let dueDate: string | undefined,
    deadlineBasis = "Interruption/deadline requires review.";
  if (f.requestedDueDate && f.requestFrom === "service_canada") {
    dueDate = f.requestedDueDate;
    deadlineBasis =
      "Specific Service Canada request deadline entered from the actual request.";
  } else if (requirement === "required" && interruption) {
    if (f.format === "paper") {
      const anchor = interruption > f.awareDate ? interruption : f.awareDate;
      dueDate = roeCalendarAdd(anchor, 5);
      deadlineBasis =
        "Paper: five calendar days from the interruption or the day the employer becomes aware, using the later applicable date.";
    } else {
      const payPeriodDue = roeCalendarAdd(f.periodEnd, 5);
      if (["M", "O", "H"].includes(f.payPeriodCode)) {
        const interruptionDue = roeCalendarAdd(interruption, 15);
        dueDate =
          payPeriodDue < interruptionDue ? payPeriodDue : interruptionDue;
        deadlineBasis =
          "Electronic monthly/13 periods: earlier of period end + five calendar days and first interruption day + fifteen calendar days.";
      } else {
        dueDate = payPeriodDue;
        deadlineBasis =
          "Electronic weekly/biweekly/semimonthly: five calendar days after the end of the pay period containing the interruption.";
      }
    }
  }
  if (f.requestFrom === "service_canada" && !f.requestedDueDate)
    deadlineBasis = `Estimated ordinary timing only: ${deadlineBasis} Review the actual Service Canada request instructions before treating a request deadline as confirmed.`;
  if (requirement === "required" && !dueDate)
    blockers.push(
      "Confirm the interruption date or the actual Service Canada requested deadline before relying on an issue-by date.",
    );
  return defined({
    requirement,
    interruptionDate: interruption,
    dueDate,
    deadlineBasis,
    warnings,
    blockers,
    rulesVersion: ROE_WORKFLOW_RULES_VERSION,
  });
}
export function cleanRoeReadiness(raw: RoeReadiness): RoeReadiness {
  const result = emptyRoeReadiness();
  for (const key of Object.keys(result) as RoeReadinessKey[])
    result[key] = flag(raw[key], ROE_READINESS_LABELS[key]);
  return result;
}
export function roeReadinessBlockers(
  row: Pick<
    RoeWorkflowCase,
    "facts" | "checklist" | "amendmentOfCaseId" | "amendmentOriginalSerial"
  >,
) {
  const assessment = assessRoeWorkflow(
      row.facts,
      Boolean(row.amendmentOfCaseId),
    ),
    blockers = [...assessment.blockers];
  if (assessment.requirement !== "required")
    blockers.push(
      "Resolve whether an ROE is required before recording a filing-ready generated file.",
    );
  for (const key of Object.keys(ROE_READINESS_LABELS) as RoeReadinessKey[])
    if (!row.checklist[key]) blockers.push(ROE_READINESS_LABELS[key]);
  if (row.amendmentOfCaseId && !row.amendmentOriginalSerial)
    blockers.push(
      "Obtain the original issued ROE serial before preparing an amendment; do not invent one.",
    );
  return blockers;
}
export function validateRoeIssuedSerial(
  value: unknown,
  format: "electronic" | "paper",
) {
  const serial = text(
    value,
    "Actual issued ROE serial",
    true,
    9,
  )!.toUpperCase();
  if (
    !(format === "electronic" ? /^[WMSY]\d{8}$/ : /^[AEK]\d{8}$/).test(serial)
  )
    throw new Error(
      format === "electronic"
        ? "Enter the actual nine-character Service Canada electronic ROE serial (W/M/S/Y and eight digits)."
        : "Enter the actual preprinted paper ROE serial (A/E/K and eight digits).",
    );
  return serial;
}
export async function roeWorkflowFingerprint(value: unknown): Promise<string> {
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object")
      return `{${Object.entries(v)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
        .join(",")}}`;
    return JSON.stringify(v ?? null);
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
/** Only identifier-free case facts may seed the transient filing form. */
export function roeCaseFilingDefaults(
  row: RoeWorkflowView,
): Partial<RoeFilingInput> {
  return {
    firstDayWorked: row.facts.firstDayWorked,
    lastDayPaid: row.facts.lastDayPaid,
    finalPayPeriodEnd: row.facts.periodEnd,
    payPeriodCode: row.facts.payPeriodCode,
    reason: row.facts.reasonCode,
    ...(row.amendmentOriginalSerial
      ? {
          amendedSerialNumber: row.amendmentOriginalSerial,
          ...(/^[AEKLZ]/.test(row.amendmentOriginalSerial)
            ? {
                comments: `Amending a paper ROE ${row.amendmentOriginalSerial}`,
              }
            : {}),
        }
      : {}),
  };
}
