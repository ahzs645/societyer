import { useState } from "react";
import { Money } from "../../components/Money";
import type { PayrollTd1ReviewedForm } from "../../../shared/payrollTd1Settings";
import { payrollFailure } from "./payrollUi";

export function PayrollTd1Example({
  forms,
  year,
}: {
  forms: PayrollTd1ReviewedForm[];
  year: number;
}) {
  const [state, setState] = useState<{
      key: string;
      baseline: number;
      reviewed: number;
      error: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify(forms),
    current = state?.key === key ? state : null;
  async function calculate() {
    setBusy(true);
    try {
      const { calculatePayrollDeductions, emptyPayrollYtd } =
        await import("../../../shared/payrollDeductions");
      const base = {
        payDate: "2026-07-15",
        provinceOfEmployment: "BC",
        method: "option1" as const,
        payPeriodsPerYear: 12,
        periodNumber: 7,
        regular: {
          cashCents: 300000,
          taxableCents: 300000,
          pensionableCents: 300000,
          insurableCents: 300000,
        },
        ytd: emptyPayrollYtd(),
        ytdConfirmed: true,
        td1: { confirmed: true },
        cpp: { eligible: true, contributionMonths: 12 },
        ei: { exempt: false, employerMultiplier: 1.4 },
        ytdEmployerMatches: true,
        employmentKind: "ordinary" as const,
      };
      const federal = forms.find((form) => form.form === "federal"),
        provincial = forms.find((form) => form.form === "BC");
      const reviewed = calculatePayrollDeductions({
        ...base,
        td1: {
          confirmed: true,
          federalClaimCents: federal?.totalClaimCents,
          provincialClaimCents: provincial?.totalClaimCents,
          federalMultipleEmployers: federal?.multipleEmployers,
          provincialMultipleEmployers: provincial?.multipleEmployers,
          federalTaxExempt: federal?.totalIncomeLessThanClaims,
          provincialTaxExempt: provincial?.totalIncomeLessThanClaims,
          additionalTaxCents: federal?.additionalTaxCents,
        },
        deductions: {
          annualZoneDeductionCents: federal?.annualZoneDeductionCents,
        },
      });
      setState({
        key,
        baseline: calculatePayrollDeductions(base).incomeTaxCents,
        reviewed: reviewed.incomeTaxCents,
        error: "",
      });
    } catch (error) {
      setState({ key, baseline: 0, reviewed: 0, error: payrollFailure(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="payroll-calculator__notice"
      aria-label="TD1 withholding illustration"
    >
      <h3>Claim amounts and withholding</h3>
      <p>
        The total claim is an annual credit input to payroll formulas. It is not
        tax paid or a percentage refund. Additional federal withholding is a
        separate amount per payment.
      </p>
      <p>
        Illustration: CAD $3,000 monthly ordinary B.C. cash pay, payment July
        15, 2026, Option 1, 12 scheduled pays, zero same-employer YTD, CPP
        eligible for 12 months, EI nonexempt, no other deductions. Any
        jurisdiction omitted from this illustration uses the bundled basic
        claim. This illustration is separate from the employee’s actual payroll.
      </p>
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy || year !== 2026 || !forms.length}
        onClick={() => void calculate()}
      >
        {busy
          ? "Calculating illustration…"
          : "Calculate illustrative withholding"}
      </button>
      {year !== 2026 && (
        <p>
          No illustration is calculated with unreviewed rates for this year.
        </p>
      )}
      {current?.error && <p role="alert">{current.error}</p>}
      {current && !current.error && (
        <dl className="payroll-calculator__amounts">
          <div>
            <dt>Income tax with bundled basic claims</dt>
            <dd>
              <Money cents={current.baseline} currency="CAD" />
            </dd>
          </div>
          <div>
            <dt>Income tax with these reviewed declarations</dt>
            <dd>
              <Money cents={current.reviewed} currency="CAD" />
            </dd>
          </div>
          <div>
            <dt>Change in this sample’s withholding</dt>
            <dd>
              <Money
                cents={current.reviewed - current.baseline}
                currency="CAD"
              />
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
