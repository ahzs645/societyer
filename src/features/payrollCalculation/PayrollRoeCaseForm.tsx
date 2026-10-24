import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import {
  ROE_PAY_PERIOD_LABELS,
  ROE_REASON_LABELS,
  ROE_REASONS,
} from "../../../shared/payrollReporting";
import {
  assessRoeWorkflow,
  type RoeWorkflowFacts,
  type RoeWorkflowView,
  type RoeRegister,
} from "../../../shared/payrollRoeWorkflow";
import { amountInput, payrollFailure, payrollMoney } from "./payrollUi";
import { usePayrollRoePages } from "./usePayrollRoePages";
export type RoeEmployee = {
  _id: string;
  name: string;
  startDate: string;
  endDate?: string;
};
export function PayrollRoeCaseForm({
  societyId,
  employee,
  today,
  record,
  parent,
  onSaved,
  onCancel,
}: {
  societyId: string;
  employee: RoeEmployee;
  today: string;
  record?: RoeWorkflowView;
  parent?: RoeWorkflowView;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const initial = record?.facts ?? parent?.facts,
    [facts, setFacts] = useState<RoeWorkflowFacts>(
      initial
        ? {
            ...initial,
            ...(parent ? { reviewTargetDate: today, notes: "" } : {}),
          }
        : {
            trigger: "seven_days",
            format: "electronic",
            payPeriodCode: "B",
            firstDayWorked: employee.startDate,
            lastDayPaid: employee.endDate ?? today,
            awareDate: today,
            periodStart: employee.endDate ?? today,
            periodEnd: employee.endDate ?? today,
            noWorkNoEarningsDays: 7,
            anticipatedGap: false,
            exception: "ordinary",
            requestFrom: "none",
            inactiveCasual: false,
            otherRequirementConfirmed: false,
            reasonCode: "A00",
            evidence: "",
          },
    ),
    [normal, setNormal] = useState(
      amountInput(initial?.normalWeeklyEarningsCents),
    ),
    [reduced, setReduced] = useState(
      amountInput(initial?.reducedWeeklyEarningsCents),
    ),
    [registerId, setRegisterId] = useState(record?.registerId ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = useMutation(api.payrollRoeWorkflow.saveCase),
    registers = usePayrollRoePages<RoeRegister>(
      !record && !parent
        ? { societyId, employeeId: employee._id, collection: "registers" }
        : undefined,
    );
  const set = <K extends keyof RoeWorkflowFacts>(
    key: K,
    value: RoeWorkflowFacts[K],
  ) => setFacts((old) => ({ ...old, [key]: value }));
  let assessment;
  try {
    assessment = assessRoeWorkflow(
      {
        ...facts,
        ...(normal
          ? {
              normalWeeklyEarningsCents: payrollMoney(
                normal,
                "Normal weekly earnings",
              ),
            }
          : {}),
        ...(reduced
          ? {
              reducedWeeklyEarningsCents: payrollMoney(
                reduced,
                "Reduced weekly earnings",
              ),
            }
          : {}),
      },
      Boolean(parent ?? record?.amendmentOfCaseId),
    );
  } catch {
    /* Validation errors are surfaced at save; incomplete fields remain editable. */
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = {
        ...facts,
        ...(normal
          ? {
              normalWeeklyEarningsCents: payrollMoney(
                normal,
                "Normal weekly earnings",
              ),
            }
          : {}),
        ...(reduced
          ? {
              reducedWeeklyEarningsCents: payrollMoney(
                reduced,
                "Reduced weekly earnings",
              ),
            }
          : {}),
      };
      if (!normal) delete next.normalWeeklyEarningsCents;
      if (!reduced) delete next.reducedWeeklyEarningsCents;
      const id = await save({
        societyId,
        employeeId: employee._id,
        facts: next,
        ...(record ? { id: record._id, expectedVersion: record.version } : {}),
        ...(registerId ? { registerId } : {}),
        ...((parent?._id ?? record?.amendmentOfCaseId)
          ? { amendmentOfCaseId: parent?._id ?? record?.amendmentOfCaseId }
          : {}),
      });
      onSaved(id);
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  const input = (
    label: string,
    key:
      | "firstDayWorked"
      | "lastDayPaid"
      | "interruptionDate"
      | "awareDate"
      | "periodStart"
      | "periodEnd"
      | "reductionWeekDate"
      | "requestedDueDate"
      | "reviewTargetDate",
    required = false,
  ) => (
    <Field label={label}>
      <input
        className="input"
        type="date"
        required={required}
        value={facts[key] ?? ""}
        onChange={(event) =>
          set(key, event.target.value || (undefined as never))
        }
      />
    </Field>
  );
  return (
    <form
      aria-label="ROE case facts"
      className="card payroll-calculator__panel form-stack"
      onSubmit={submit}
    >
      <h3>
        {parent
          ? "Create complete ROE amendment"
          : record
            ? "Review ROE case facts"
            : "Start ROE case"}{" "}
        — {employee.name}
      </h3>
      <p>
        Record actual payroll dates and source facts. Do not enter a SIN, full
        payroll account, or XML in case notes. Identifiers are entered only in
        the transient export form.
      </p>
      {parent && (
        <p>
          Amends actual ROE {parent.register?.serialNumber}. Explain the
          corrected information and repeat all required blocks. An issued ROE
          cannot be cancelled.
        </p>
      )}
      {registers.loader}
      {!record && !parent && (
        <Field label="Existing ROE register record">
          <select
            className="input"
            value={registerId}
            disabled={!registers.ready}
            onChange={(event) => setRegisterId(event.target.value)}
          >
            <option value="">
              Create the corresponding register obligation when required
            </option>
            {registers.rows.map((row) => (
              <option key={row._id} value={row._id}>
                {row.lastDayPaid} · {row.status} ·{" "}
                {row.serialNumber ?? "Not issued"}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-grid">
        <Field label="Interruption trigger">
          <select
            className="input"
            value={facts.trigger}
            onChange={(event) =>
              set("trigger", event.target.value as RoeWorkflowFacts["trigger"])
            }
          >
            <option value="seven_days">
              Seven consecutive days without work or insurable earnings
            </option>
            <option value="reduced_earnings">
              Weekly earnings below 60% for a listed leave reason
            </option>
            <option value="wage_loss">
              Wage-loss-insurance payments begin
            </option>
            <option value="request">
              Actual request from employee / Service Canada
            </option>
            <option value="other">
              Other specifically reviewed requirement
            </option>
          </select>
        </Field>
        <Field label="ROE format">
          <select
            className="input"
            value={facts.format}
            onChange={(event) =>
              set("format", event.target.value as "electronic" | "paper")
            }
          >
            <option value="electronic">
              Electronic — ROE Web / authorized provider
            </option>
            <option value="paper">Official pre-numbered paper ROE</option>
          </select>
        </Field>
        <Field label="Case pay-period frequency">
          <select
            className="input"
            value={facts.payPeriodCode}
            onChange={(event) =>
              set(
                "payPeriodCode",
                event.target.value as RoeWorkflowFacts["payPeriodCode"],
              )
            }
          >
            {Object.entries(ROE_PAY_PERIOD_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {input("First day worked since previous ROE", "firstDayWorked", true)}
        {input("Last day for which paid", "lastDayPaid", true)}
        {input("Employer became aware on", "awareDate", true)}
        {input(
          "Pay period containing interruption starts",
          "periodStart",
          true,
        )}
        {input("Pay period containing interruption ends", "periodEnd", true)}
        {input(
          "Reviewed interruption date (optional for ordinary rule)",
          "interruptionDate",
        )}
        <Field label="Consecutive no-work / no-insurable-earnings days">
          <input
            className="input"
            type="number"
            min="0"
            max="3660"
            step="1"
            value={facts.noWorkNoEarningsDays}
            onChange={(event) =>
              set("noWorkNoEarningsDays", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Work-arrangement review">
          <select
            className="input"
            value={facts.exception}
            onChange={(event) =>
              set(
                "exception",
                event.target.value as RoeWorkflowFacts["exception"],
              )
            }
          >
            <option value="ordinary">Ordinary rule reviewed</option>
            <option value="casual">
              Part-time / on-call / casual special rule
            </option>
            <option value="annual_vacation">
              Regular annual business vacation exception review
            </option>
            <option value="self_funded">
              Self-funded leave agreement review
            </option>
            <option value="nonstandard">
              Nonstandard work arrangement review
            </option>
            <option value="needs_review">
              Other facts require Service Canada review
            </option>
          </select>
        </Field>
        <Field label="Actual request from">
          <select
            className="input"
            value={facts.requestFrom}
            onChange={(event) =>
              set(
                "requestFrom",
                event.target.value as RoeWorkflowFacts["requestFrom"],
              )
            }
          >
            <option value="none">No actual request recorded</option>
            <option value="employee">Employee</option>
            <option value="service_canada">Service Canada</option>
          </select>
        </Field>
        <Field label="Case reason for issuing ROE">
          <select
            className="input"
            value={facts.reasonCode}
            onChange={(event) =>
              set(
                "reasonCode",
                event.target.value as RoeWorkflowFacts["reasonCode"],
              )
            }
          >
            {ROE_REASONS.map((code) => (
              <option key={code} value={code}>
                {code} — {ROE_REASON_LABELS[code]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label>
        <input
          type="checkbox"
          checked={facts.anticipatedGap}
          onChange={(event) => set("anticipatedGap", event.target.checked)}
        />{" "}
        These are reviewed anticipated interruption facts; update if actual
        facts differ
      </label>
      <label>
        <input
          type="checkbox"
          checked={facts.inactiveCasual}
          onChange={(event) => set("inactiveCasual", event.target.checked)}
        />{" "}
        Casual / on-call employee has actually been removed from the active
        employment list
      </label>
      {facts.trigger === "reduced_earnings" && (
        <div className="form-grid">
          <Field label="Normal weekly insurable earnings (CAD)">
            <input
              className="input"
              inputMode="decimal"
              value={normal}
              onChange={(event) => setNormal(event.target.value)}
            />
          </Field>
          <Field label="Reduced weekly insurable earnings (CAD)">
            <input
              className="input"
              inputMode="decimal"
              value={reduced}
              onChange={(event) => setReduced(event.target.value)}
            />
          </Field>
          {input(
            "Date in first reduced-earnings week",
            "reductionWeekDate",
            true,
          )}
          <Field label="Reduced-earnings reason">
            <select
              className="input"
              value={facts.reductionReason ?? ""}
              onChange={(event) =>
                set(
                  "reductionReason",
                  event.target.value as RoeWorkflowFacts["reductionReason"],
                )
              }
            >
              <option value="">Choose actual reason</option>
              <option value="illness_injury_quarantine">
                Illness, injury or quarantine
              </option>
              <option value="pregnancy">Pregnancy</option>
              <option value="parental">
                Parental / newborn or adopted child care
              </option>
              <option value="family_care">
                Compassionate / critically ill family care
              </option>
              <option value="other">Other — specific review required</option>
            </select>
          </Field>
        </div>
      )}
      {facts.requestFrom === "service_canada" &&
        input(
          "Actual Service Canada requested deadline (if supplied)",
          "requestedDueDate",
        )}
      {(parent || record?.amendmentOfCaseId) &&
        input("Reviewed amendment action target", "reviewTargetDate", true)}
      {["other", "request"].includes(facts.trigger) && (
        <label>
          <input
            type="checkbox"
            checked={facts.otherRequirementConfirmed}
            onChange={(event) =>
              set("otherRequirementConfirmed", event.target.checked)
            }
          />{" "}
          I reviewed the specific requirement with Service Canada and recorded
          its source below
        </label>
      )}
      <Field label="Trigger, date and source evidence">
        <textarea
          className="input"
          required
          maxLength={2000}
          value={facts.evidence}
          onChange={(event) => set("evidence", event.target.value)}
        />
      </Field>
      <Field label="Case / correction notes">
        <textarea
          className="input"
          maxLength={2000}
          value={facts.notes ?? ""}
          onChange={(event) => set("notes", event.target.value)}
        />
      </Field>
      {assessment && (
        <div role="status">
          <strong>
            Assessment: {assessment.requirement.replaceAll("_", " ")} ·{" "}
            {assessment.dueDate
              ? `Issue/action target ${assessment.dueDate}`
              : "No confirmed deadline"}
          </strong>
          <p>{assessment.deadlineBasis}</p>
          {[...assessment.blockers, ...assessment.warnings].map(
            (message, i) => (
              <p key={i}>{message}</p>
            ),
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel case editor
        </button>
        <button
          type="submit"
          className="btn btn--accent"
          disabled={busy || (!record && !parent && !registers.ready)}
        >
          {busy ? "Saving…" : "Save ROE case"}
        </button>
      </div>
    </form>
  );
}
