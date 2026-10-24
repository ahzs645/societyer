import { Money } from "../../components/Money";
import { StatTile } from "../../components/StatTile";
import { formatDate, formatDateTime } from "../../lib/format";
import type { PayrollStatement } from "../../../shared/payrollReporting";

export function PayrollCalculationResult({
  statement,
  warnings = [],
  blockers = [],
  frozen = false,
}: {
  statement: PayrollStatement;
  warnings?: string[];
  blockers?: string[];
  frozen?: boolean;
}) {
  const totals = statement.totals;
  return (
    <section
      className="payroll-calculator__result"
      aria-label="Payroll calculation result"
    >
      <div className="payroll-calculator__heading">
        <div>
          <h2>{statement.employee.name}</h2>
          <p>
            {formatDate(statement.periodStart)}–
            {formatDate(statement.periodEnd)} · Pay date{" "}
            {formatDate(statement.payDate)} · {statement.currency}
          </p>
        </div>
        <strong className="payroll-calculator__status">
          {statement.status}
          {frozen ? " · frozen snapshot" : " · calculated preview"}
        </strong>
      </div>
      <p>
        Province of employment:{" "}
        <strong>{statement.employee.provinceOfEmployment}</strong>. Rule
        edition: <strong>{statement.rules.edition}</strong> · Method:{" "}
        <strong>{statement.rules.method}</strong>.
      </p>
      {statement.status === "reversed" && (
        <p className="payroll-calculator__notice">
          This retained statement shows the original calculation. Its dated
          reversal and any replacement are separate records.
        </p>
      )}
      {blockers.length > 0 && (
        <section
          className="payroll-calculator__blockers"
          role="alert"
          aria-label="Calculation blockers"
        >
          <h3>Resolve before approval</h3>
          <ul>
            {blockers.map((blocker, index) => (
              <li key={`${index}:${blocker}`}>{blocker}</li>
            ))}
          </ul>
        </section>
      )}
      {warnings.length + statement.warnings.length > 0 && (
        <section
          className="payroll-calculator__notice"
          aria-label="Calculation warnings"
        >
          <h3>Review these assumptions</h3>
          <ul>
            {[...new Set([...warnings, ...statement.warnings])].map(
              (warning) => (
                <li key={warning}>{warning}</li>
              ),
            )}
          </ul>
        </section>
      )}
      <div className="stat-grid payroll-calculator__stats">
        <StatTile
          label="Taxable employment income"
          value={
            <Money cents={totals.taxableCents} currency={statement.currency} />
          }
        />
        <StatTile
          label="Cash remuneration"
          value={
            <Money cents={totals.cashCents} currency={statement.currency} />
          }
          sub="Includes applicable cash reimbursements"
        />
        <StatTile
          label="Net cash pay"
          value={
            <Money cents={totals.netCents} currency={statement.currency} />
          }
        />
        <StatTile
          label="Full employer cost"
          value={
            <Money
              cents={totals.employerCostCents}
              currency={statement.currency}
            />
          }
          sub="Employee withholding is not an extra employer cost"
        />
      </div>
      <div className="payroll-calculator__table-wrap">
        <table className="table" aria-label="Detailed calculated earnings">
          <thead>
            <tr>
              <th scope="col">Earning</th>
              <th scope="col">Date</th>
              <th scope="col">Hours</th>
              <th scope="col">Rate</th>
              <th scope="col">Amount</th>
              <th scope="col">Classification bases</th>
            </tr>
          </thead>
          <tbody>
            {statement.earnings.map((line) => (
              <tr key={line.key}>
                <th scope="row">
                  {line.label}
                  <small>{line.code}</small>
                </th>
                <td>{line.date ? formatDate(line.date) : "Period total"}</td>
                <td>
                  {line.hours === undefined
                    ? "—"
                    : line.hours.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                  {line.multiplier && line.multiplier !== 1
                    ? ` × ${line.multiplier}`
                    : ""}
                </td>
                <td>
                  <Money cents={line.rateCents} currency={statement.currency} />
                </td>
                <td>
                  <Money
                    cents={line.amountCents}
                    currency={statement.currency}
                  />
                </td>
                <td>
                  <details>
                    <summary>View bases</summary>
                    <dl>
                      {[
                        ["Cash", line.cashCents],
                        ["Taxable", line.taxableCents],
                        ["Pensionable", line.pensionableCents],
                        ["Insurable", line.insurableCents],
                        ["Vacationable", line.vacationableCents],
                        ["EHT", line.ehtCents],
                        ["WorkSafe", line.workSafeCents],
                      ].map(([label, value]) => (
                        <div key={String(label)}>
                          <dt>{label}</dt>
                          <dd>
                            <Money
                              cents={Number(value)}
                              currency={statement.currency}
                            />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="payroll-calculator__columns">
        <section
          className="card payroll-calculator__panel"
          aria-label="Employee deductions"
        >
          <h3>Employee deductions</h3>
          <dl className="payroll-calculator__amounts">
            {[
              ["CPP", totals.cppEmployeeCents],
              ["CPP2", totals.cpp2EmployeeCents],
              ["EI", totals.eiEmployeeCents],
              ["Combined income tax", totals.incomeTaxCents],
              ["Other deductions", totals.otherDeductionsCents],
            ].map(([label, amount]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>
                  <Money cents={Number(amount)} currency={statement.currency} />
                </dd>
              </div>
            ))}
            <div>
              <dt>Federal tax component</dt>
              <dd>
                {totals.federalTaxCents == null ? (
                  "Unknown"
                ) : (
                  <Money
                    cents={totals.federalTaxCents}
                    currency={statement.currency}
                  />
                )}
              </dd>
            </div>
            <div>
              <dt>Provincial tax component</dt>
              <dd>
                {totals.provincialTaxCents == null ? (
                  "Unknown"
                ) : (
                  <Money
                    cents={totals.provincialTaxCents}
                    currency={statement.currency}
                  />
                )}
              </dd>
            </div>
          </dl>
          {statement.otherDeductions.length > 0 && (
            <details>
              <summary>Other deduction details</summary>
              <dl className="payroll-calculator__amounts">
                {statement.otherDeductions.map((deduction, index) => (
                  <div key={index}>
                    <dt>{deduction.label}</dt>
                    <dd>
                      <Money
                        cents={deduction.amountCents}
                        currency={statement.currency}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <p className="muted">
            Known federal and provincial components are included in combined
            income tax. Some CRA rules provide combined tax only; an unknown
            split is retained as unknown.
          </p>
          <p>
            Noncash taxable benefits:{" "}
            <Money
              cents={totals.nonCashTaxableCents}
              currency={statement.currency}
            />{" "}
            · Nontaxable cash:{" "}
            <Money
              cents={totals.nonTaxableCashCents}
              currency={statement.currency}
            />
            .
          </p>
        </section>
        <section
          className="card payroll-calculator__panel"
          aria-label="Employer cost breakdown"
        >
          <h3>Employer cost breakdown</h3>
          <dl className="payroll-calculator__amounts">
            {(
              [
                ["Cash remuneration", totals.cashCents],
                ["Employer CPP", totals.cppEmployerCents],
                ["Employer CPP2", totals.cpp2EmployerCents],
                ["Employer EI", totals.eiEmployerCents],
              ] as const
            ).map(([label, amount]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <Money cents={amount} currency={statement.currency} />
                </dd>
              </div>
            ))}
            {statement.employerCosts.map((cost, index) => (
              <div key={`${index}:${cost.label}`}>
                <dt>{cost.label}</dt>
                <dd>
                  <Money
                    cents={cost.amountCents}
                    currency={statement.currency}
                  />
                </dd>
              </div>
            ))}
            <div className="payroll-calculator__total">
              <dt>Full employer cost</dt>
              <dd>
                <Money
                  cents={totals.employerCostCents}
                  currency={statement.currency}
                />
              </dd>
            </div>
          </dl>
          <p className="muted">
            These are the server-calculated cost components. Vacation already
            paid in earnings is not added again.
          </p>
        </section>
      </div>
      {statement.yearToDate && (
        <section
          className="card payroll-calculator__panel"
          aria-label="Legal employer year-to-date"
        >
          <h3>Legal employer year-to-date · {statement.yearToDate.year}</h3>
          <dl className="payroll-calculator__amounts">
            {[
              ["Employment income", statement.yearToDate.grossCents],
              ["Pensionable earnings", statement.yearToDate.pensionableCents],
              ["Insurable earnings", statement.yearToDate.insurableCents],
              ["Employee CPP", statement.yearToDate.cppEmployeeCents],
              ["Employee CPP2", statement.yearToDate.cpp2EmployeeCents],
              ["Employee EI", statement.yearToDate.eiEmployeeCents],
              ["Income tax", statement.yearToDate.incomeTaxCents],
            ].map(([label, amount]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>
                  <Money cents={Number(amount)} currency={statement.currency} />
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Insurable hours:{" "}
            {statement.yearToDate.insurableHours?.toLocaleString(undefined, {
              maximumFractionDigits: 4,
            }) ?? "Unknown"}
            .
          </p>
        </section>
      )}
      <section
        className="card payroll-calculator__panel"
        aria-label="Rules and calculation explanations"
      >
        <h3>Rules and calculation explanations</h3>
        <p>
          {statement.rules.edition} · {statement.rules.method}. Earnings use
          work dates; deduction rules use the payment date.
        </p>
        <ol>
          {statement.rules.explanations.map((explanation, index) => (
            <li key={index}>{explanation}</li>
          ))}
        </ol>
        <h4>Source references</h4>
        <ul>
          {statement.rules.sources.map((source, index) => (
            <li key={index}>
              {/^https:\/\//.test(source) ? (
                <a href={source} target="_blank" rel="noopener noreferrer">
                  {source}
                </a>
              ) : (
                source
              )}
            </li>
          ))}
        </ul>
        <details>
          <summary>Snapshot audit details</summary>
          <dl>
            <div>
              <dt>Statement</dt>
              <dd>
                {statement.statementNumber} · version{" "}
                {statement.calculationVersion}
              </dd>
            </div>
            {statement.finalizedAtISO && (
              <div>
                <dt>Finalized</dt>
                <dd>{formatDateTime(statement.finalizedAtISO)}</dd>
              </div>
            )}
            {statement.correctionOf && (
              <div>
                <dt>Corrects</dt>
                <dd>{statement.correctionOf}</dd>
              </div>
            )}
            {statement.rules.inputFingerprint && (
              <div>
                <dt>Input fingerprint</dt>
                <dd className="payroll-calculator__fingerprint">
                  {statement.rules.inputFingerprint}
                </dd>
              </div>
            )}
            {statement.rules.resultFingerprint && (
              <div>
                <dt>Result fingerprint</dt>
                <dd className="payroll-calculator__fingerprint">
                  {statement.rules.resultFingerprint}
                </dd>
              </div>
            )}
          </dl>
        </details>
      </section>
    </section>
  );
}
