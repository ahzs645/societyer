import editions from "./reviewed-2026.json";
export type PayrollRateSet = typeof editions[number];
export function payrollRateSetFor(payDate: string, province: string, method: "option1" | "option2"): PayrollRateSet {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate) || !Number.isFinite(Date.parse(payDate)) || new Date(payDate).toISOString().slice(0, 10) !== payDate) throw new Error("Enter an exact valid payroll payment date.");
  const found = editions.find(edition => edition.province === province && edition.method === method && payDate >= edition.effectiveFrom && payDate <= edition.effectiveTo);
  if (!found) throw new Error(`Native CRA deductions do not support ${province || "an unspecified province"} on ${payDate} using ${method}. Import a verified provider calculation or choose a supported payment date and province.`);
  return JSON.parse(JSON.stringify(found));
}
