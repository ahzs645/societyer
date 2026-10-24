import assert from "node:assert/strict";
import {
  readVacationPayoutDrafts,
  vacationPayoutDrafts,
  type PayrollVacationPayoutDraft,
} from "../src/features/payrollCalculation/PayrollVacationPayoutFields";
import {
  readRunCostDrafts,
  runCostDrafts,
  type PayrollRunCostDraft,
} from "../src/features/payrollCalculation/PayrollRunEmployerCostsFields";

const payout: PayrollVacationPayoutDraft = {
  employeeId: "employee-a",
  amount: "123.45",
  sourceReference: "Reviewed prior accrual ledger",
  treatment: "vacation_leave",
  hours: "7.5",
  vacationRequestId: "approved-request-a",
  requestLabel: "Approved time off",
};
assert.deepEqual(readVacationPayoutDrafts([payout], ["employee-a"]), [
  {
    employeeId: "employee-a",
    amountCents: 12345,
    sourceReference: "Reviewed prior accrual ledger",
    treatment: "vacation_leave",
    insurableMinutes: 450,
    vacationRequestId: "approved-request-a",
  },
]);
assert.deepEqual(
  readVacationPayoutDrafts(
    vacationPayoutDrafts(readVacationPayoutDrafts([payout], ["employee-a"])),
    ["employee-a"],
  ),
  readVacationPayoutDrafts([payout], ["employee-a"]),
  "Editing retains exact money, minutes, treatment and approved-request provenance.",
);
assert.equal(
  readVacationPayoutDrafts(
    [
      {
        ...payout,
        hours: "",
        vacationRequestId: "",
        treatment: "unused_cashout",
      },
    ],
    ["employee-a"],
  )?.[0].insurableMinutes,
  undefined,
  "Unknown insurable hours are not fabricated from the monetary amount.",
);
assert.equal(
  readVacationPayoutDrafts(
    [{ ...payout, hours: String(1 / 60) }],
    ["employee-a"],
  )?.[0].insurableMinutes,
  1,
  "Actual one-minute leave remains exact.",
);
assert.throws(
  () => readVacationPayoutDrafts([payout], ["employee-b"]),
  /selected employee/,
);
assert.throws(
  () =>
    readVacationPayoutDrafts([{ ...payout, hours: "0.001" }], ["employee-a"]),
  /whole minutes/,
);
assert.throws(
  () =>
    readVacationPayoutDrafts(
      [{ ...payout, sourceReference: "" }],
      ["employee-a"],
    ),
  /source reference/,
);
assert.throws(
  () =>
    readVacationPayoutDrafts([{ ...payout, amount: "0.00" }], ["employee-a"]),
  /greater than zero/,
);
assert.throws(
  () =>
    readVacationPayoutDrafts([{ ...payout, amount: "-1.00" }], ["employee-a"]),
  /nonnegative/,
);
assert.equal(readVacationPayoutDrafts([], ["employee-a"]), undefined);

const cost: PayrollRunCostDraft = {
  employeeId: "employee-a",
  evidence: "Reviewed actual extra benefit invoice",
  benefitsCents: "0.00",
  pensionCents: "12.34",
  benefitsAlreadyInEarningsCents: "",
  pensionAlreadyInEarningsCents: "",
};
const parsed = readRunCostDrafts([cost], ["employee-a"])!;
assert.equal(
  parsed[0].benefitsCents,
  0,
  "Explicit zero override differs from inherited defaults.",
);
assert.equal(parsed[0].pensionCents, 1234);
assert.equal(parsed[0].benefitsAlreadyInEarningsCents, undefined);
assert.deepEqual(
  readRunCostDrafts(runCostDrafts(parsed), ["employee-a"]),
  parsed,
  "Actual run-cost instructions survive draft editing without recurring-cost guesses.",
);
assert.throws(
  () => readRunCostDrafts([cost, cost], ["employee-a"]),
  /one employer-cost override/,
);
assert.throws(
  () => readRunCostDrafts([cost], ["employee-b"]),
  /selected employee/,
);
assert.throws(
  () => readRunCostDrafts([{ ...cost, evidence: "" }], ["employee-a"]),
  /evidence/,
);
assert.equal(readRunCostDrafts([], ["employee-a"]), undefined);
console.log(
  "Payroll vacation-payout and actual employer-cost form checks passed.",
);
