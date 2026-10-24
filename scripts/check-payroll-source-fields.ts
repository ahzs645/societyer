import assert from "node:assert/strict";
import {
  cleanPayrollEmployer,
  cleanPayrollProfile,
  cleanPayrollInput,
} from "../shared/payrollCalculationValidation";
import type {
  EmployeeProfileFields,
  EmployerSettingsFields,
} from "../shared/payrollCalculation";
import {
  payrollLocalTimestamp,
  payrollTimestampFromLocal,
} from "../src/features/payrollCalculation/payrollTime";
import { payrollScheduleSelection } from "../src/features/payrollCalculation/payrollSchedule";

const employer: EmployerSettingsFields = {
  year: 2026,
  payFrequency: "monthly",
  payDates: Array.from(
    { length: 12 },
    (_, index) => `2026-${String(index + 1).padStart(2, "0")}-15`,
  ),
  eiEmployerMultiplier: 1.4,
  ehtEmployerClass: "ordinary",
  ehtOpeningRemunerationCents: 0,
  ehtOpeningThroughDate: "2025-12-31",
  ehtOpeningConfirmed: true,
  ehtOpeningSourceReference: "Confirmed new-employer zero opening",
  ehtOpeningRepresentedPayRunIds: [],
  ehtAssociated: true,
  ehtAssociatedGroupRemunerationCents: 100_000_000,
  ehtPermanentEstablishmentDays: 180,
  associatedGroupPermanentEstablishmentDays: 365,
  workSafeRatePer100Dollars: 1.23,
  workSafeAssessableLimitCents: 10_000_000,
  workSafeClassificationCode: "fixture-classification",
  workSafeRateEvidence: "Documented fixture assessment notice",
  employerBenefitsCentsPerPay: 0,
  employerPensionPercent: 0,
};
assert.equal(
  cleanPayrollEmployer(employer).associatedGroupPermanentEstablishmentDays,
  365,
  "Retain group establishment days separately from the employer's part-year days.",
);
assert.equal(
  cleanPayrollEmployer({
    ...employer,
    associatedGroupPermanentEstablishmentDays: undefined,
  }).associatedGroupPermanentEstablishmentDays,
  undefined,
  "Missing group history must remain unknown for the earnings engine to block when required.",
);
assert.throws(
  () =>
    cleanPayrollEmployer({
      ...employer,
      associatedGroupPermanentEstablishmentDays: 366,
    }),
  /Associated group permanent-establishment days/,
  "2026 has 365 days.",
);
assert.throws(
  () =>
    cleanPayrollEmployer({
      ...employer,
      associatedGroupPermanentEstablishmentDays: 180.5,
    }),
  /integer/,
  "Establishment days cannot be fractional.",
);
assert.throws(
  () =>
    cleanPayrollEmployer({
      ...employer,
      associatedGroupPermanentEstablishmentDays: -1,
    }),
  /integer/,
);
assert.equal(
  cleanPayrollEmployer({
    ...employer,
    year: 2028,
    payDates: employer.payDates.map((day) => day.replace("2026", "2028")),
    ehtOpeningThroughDate: "2027-12-31",
    associatedGroupPermanentEstablishmentDays: 366,
  }).associatedGroupPermanentEstablishmentDays,
  366,
  "Storage validation preserves a real leap-year calendar without claiming native tax coverage.",
);

const profile: EmployeeProfileFields = {
  effectiveFrom: "2026-01-01",
  provinceOfEmployment: "BC",
  employmentKind: "ordinary",
  compensation: "hourly",
  rateCents: 2_500,
  normalWeeklyMinutes: 2_400,
  averageWeeklyMinutes: 2_400,
  policy: "ordinary_bc",
  restPeriodsConfirmed: true,
  historyCompleteFrom: "2025-12-01",
  historyCompleteThrough: "2026-12-31",
  ytdConfirmed: true,
  vacationMode: "accrue",
  td1: {
    confirmed: true,
    declarationReference: "Reviewed fixture declaration",
  },
  cpp: { exempt: false },
  eiExempt: false,
  fifthYearVacationReconciliation: {
    fifthYearGrossWagesCents: 5_000_000,
    vacationAlreadyPaidCents: 0,
    vacationAlreadyAccruedCents: 200_000,
    previousVacationRatePercent: 4,
    reviewed: true,
    evidence: "Complete fifth-year wage and vacation-liability ledger",
  },
};
const cleaned = cleanPayrollProfile(profile);
assert.equal(
  cleaned.fifthYearVacationReconciliation?.vacationAlreadyAccruedCents,
  200_000,
  "Existing unpaid vacation liability must not be counted as paid or lost.",
);
assert.equal(
  cleaned.fifthYearVacationReconciliation?.vacationAlreadyPaidCents,
  0,
);
assert.equal(
  cleanPayrollProfile({
    ...profile,
    fifthYearVacationReconciliation: {
      ...profile.fifthYearVacationReconciliation!,
      vacationAlreadyAccruedCents: 0,
    },
  }).fifthYearVacationReconciliation?.vacationAlreadyAccruedCents,
  0,
  "Explicit zero liability differs from missing history.",
);
assert.equal(
  cleanPayrollProfile({
    ...profile,
    fifthYearVacationReconciliation: {
      ...profile.fifthYearVacationReconciliation!,
      vacationAlreadyAccruedCents: undefined,
    },
  }).fifthYearVacationReconciliation?.vacationAlreadyAccruedCents,
  undefined,
);
assert.throws(
  () =>
    cleanPayrollProfile({
      ...profile,
      fifthYearVacationReconciliation: {
        ...profile.fifthYearVacationReconciliation!,
        vacationAlreadyAccruedCents: -1,
      },
    }),
  /Vacation already accrued/,
);
assert.throws(
  () =>
    cleanPayrollProfile({
      ...profile,
      fifthYearVacationReconciliation: {
        ...profile.fifthYearVacationReconciliation!,
        vacationAlreadyAccruedCents: 0.5,
      },
    }),
  /integer/,
);
assert.equal(
  cleaned.fundingAllocations,
  undefined,
  "An optional missing allocation does not become a made-up funding split.",
);
const salaryProfile = cleanPayrollProfile({
  ...profile,
  compensation: "monthly",
  salaryProration: {
    basis: "calendar_days",
    reviewed: true,
    evidence: "Reviewed employment contract clause 7",
  },
});
assert.deepEqual(salaryProfile.salaryProration, {
  basis: "calendar_days",
  reviewed: true,
  evidence: "Reviewed employment contract clause 7",
});
assert.equal(
  cleanPayrollProfile(profile).salaryProration,
  undefined,
  "A profile without reviewed contract policy must not acquire an assumed proration method.",
);
assert.throws(
  () =>
    cleanPayrollProfile({
      ...profile,
      salaryProration: { basis: "calendar_days", reviewed: true, evidence: "" },
    }),
  /Salary proration evidence/,
);
assert.throws(
  () =>
    cleanPayrollProfile({
      ...profile,
      salaryProration: {
        basis: "working_days",
        reviewed: true,
        evidence: "Different contract method",
      },
    }),
  /salary proration basis/,
);
const payDates = ["2026-08-15", "2026-08-31"];
assert.deepEqual(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-15",
    runType: "regular",
  }),
  {
    scheduled: true,
    showSelector: false,
    required: false,
    regularPayDate: undefined,
  },
  "Ordinary scheduled flow remains automatic.",
);
assert.equal(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-15",
    runType: "final",
    selectedDate: "2026-08-31",
  }).regularPayDate,
  undefined,
  "A scheduled final payment uses its actual date instead of a contradictory selected period.",
);
assert.deepEqual(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-12",
    runType: "final",
  }),
  {
    scheduled: false,
    showSelector: true,
    required: true,
    regularPayDate: undefined,
  },
  "Early final pay starts blank and cannot infer the preceding or following regular period.",
);
assert.equal(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-12",
    runType: "final",
    selectedDate: "2026-08-15",
  }).regularPayDate,
  "2026-08-15",
);
assert.equal(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-12",
    runType: "off_cycle",
  }).required,
  true,
);
assert.equal(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-12",
    runType: "bonus",
  }).required,
  false,
  "Server may resolve a bonus against an exact prior regular-period match.",
);
assert.equal(
  payrollScheduleSelection({
    payDates,
    payDate: "2026-08-12",
    runType: "final",
    selectedDate: "2026-08-13",
  }).regularPayDate,
  undefined,
  "A stale/noncalendar selection cannot become a submitted scheduled date.",
);
const finalInput = {
  periodStart: "2026-08-01",
  periodEnd: "2026-08-10",
  payDate: "2026-08-12",
  regularPayDate: "2026-08-15",
  employeeIds: ["employee-fixture"],
  runType: "final",
  method: "option1",
  termination: { at: "2026-08-10T17:00:00-07:00", initiatedBy: "employer" },
};
assert.equal(
  cleanPayrollInput(finalInput).regularPayDate,
  "2026-08-15",
  "Explicit scheduled-date evidence remains in the frozen input.",
);
assert.equal(
  cleanPayrollInput({ ...finalInput, regularPayDate: undefined })
    .regularPayDate,
  undefined,
);
assert.throws(
  () => cleanPayrollInput({ ...finalInput, regularPayDate: "2026-02-30" }),
  /Applicable regular pay date/,
);
assert.throws(
  () => cleanPayrollInput({ ...finalInput, regularPayDate: "2027-01-15" }),
  /actual payment year/,
);
const previousTimezone = process.env.TZ;
try {
  process.env.TZ = "America/Vancouver";
  const instant = "2026-07-15T18:04:37.125Z";
  assert.equal(payrollLocalTimestamp(instant), "2026-07-15T11:04:37.125");
  assert.equal(
    payrollTimestampFromLocal(payrollLocalTimestamp(instant)!, instant),
    instant,
    "Editing a draft preserves its exact final-pay instant, including subseconds.",
  );
  assert.equal(
    payrollTimestampFromLocal("2026-07-15T11:05:37.125"),
    "2026-07-15T18:05:37.125Z",
  );
  assert.equal(
    payrollTimestampFromLocal("2026-07-15T11:04", "2026-07-15T18:04:00Z"),
    "2026-07-15T18:04:00Z",
    "Browser removal of zero seconds must not rewrite an unchanged timestamp.",
  );
  // Toronto retains a fall overlap; current Vancouver timezone data uses
  // permanent daylight time after March 2026.
  process.env.TZ = "America/Toronto";
  const laterDstInstant = "2026-11-01T06:30:45.123Z";
  assert.equal(
    payrollLocalTimestamp(laterDstInstant),
    "2026-11-01T01:30:45.123",
  );
  assert.equal(
    payrollTimestampFromLocal(
      payrollLocalTimestamp(laterDstInstant)!,
      laterDstInstant,
    ),
    laterDstInstant,
    "An unchanged later DST-overlap instant must not shift to the earlier occurrence.",
  );
  assert.throws(
    () => payrollTimestampFromLocal("2026-03-08T02:30"),
    /does not exist/,
    "A spring-forward gap cannot silently change final-pay timing.",
  );
  assert.throws(
    () => payrollTimestampFromLocal("2026-02-30T12:00"),
    /does not exist/,
  );
} finally {
  if (previousTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimezone;
}
console.log("Payroll source field and exact timestamp checks passed.");
