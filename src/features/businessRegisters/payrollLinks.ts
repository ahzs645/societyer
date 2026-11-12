/**
 * Deep links to payroll records. Each page reads its parameter, opens that
 * record's drawer, and drops the parameter when the drawer closes.
 */

/** `/app/employees?employee=<id>` opens one employee. */
export const EMPLOYEE_PARAM = "employee";
/** `/app/payroll?run=<id>` opens one pay run in the payroll register. */
export const PAY_RUN_PARAM = "run";
/** `/app/payroll?tab=remittances&remittance=<id>` opens one CRA remittance. */
export const REMITTANCE_PARAM = "remittance";

export function employeeHref(employeeId: string) {
  return `/app/employees?${EMPLOYEE_PARAM}=${encodeURIComponent(employeeId)}`;
}

export function payRunHref(payRunId: string) {
  return `/app/payroll?${PAY_RUN_PARAM}=${encodeURIComponent(payRunId)}`;
}

export function payrollRemittanceHref(remittanceId: string) {
  return `/app/payroll?tab=remittances&${REMITTANCE_PARAM}=${encodeURIComponent(remittanceId)}`;
}
