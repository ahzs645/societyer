import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { Money } from "../../components/Money";
import { usePermissions } from "../../hooks/usePermissions";
import type { PayrollTd1Form } from "../../../shared/payrollTd1";
import type {
  PayrollTd1ReviewedForm,
  PayrollTd1Workspace,
} from "../../../shared/payrollTd1Settings";
import {
  payrollFailure,
  PayrollQueryBoundary,
  usePayrollPages,
} from "./payrollUi";
import { pickerName, type PayrollPickerRow } from "./PayrollSourceForms";
import {
  blankTd1Review,
  parsedTd1Review,
  reviewedTd1Form,
  type Td1ReviewDraft,
} from "./td1ReviewFields";
import { PayrollTd1FormReview } from "./PayrollTd1FormReview";
import { PayrollTd1Example } from "./PayrollTd1Example";

function Td1History({
  societyId,
  employeeId,
  onToday,
}: {
  societyId: string;
  employeeId: string;
  onToday: (today: string) => void;
}) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const response = useQuery(api.payrollTd1.workspace, {
    societyId,
    employeeId,
    cursor: cursors.at(-1),
  }) as PayrollTd1Workspace | undefined;
  useEffect(() => {
    if (response) onToday(response.today);
  }, [response, onToday]);
  return (
    <section aria-label="Reviewed TD1 history">
      <h3>Reviewed declarations and payment-date history</h3>
      {!response ? (
        <p role="status">Loading reviewed declarations…</p>
      ) : (
        <>
          <p>
            Current resolution date: {response.resolved.asOf}. Reviewed imports
            override matching jurisdiction fields on the payroll payment date;
            earlier frozen calculations retain their original snapshots.
          </p>
          {response.page.map((record) => (
            <details key={record._id} className="payroll-calculator__notice">
              <summary>
                {record.form === "federal" ? "Federal TD1" : "BC TD1"} ·
                applicable {record.year} · effective {record.effectiveFrom}
              </summary>
              <p>
                Received {record.receivedOn} · recorded {record.recordedAtISO} ·
                employer-reviewed import.
              </p>
              <dl className="payroll-calculator__amounts">
                <div>
                  <dt>Annual total claim</dt>
                  <dd>
                    <Money cents={record.totalClaimCents} currency="CAD" />
                  </dd>
                </div>
                <div>
                  <dt>Concurrent employers/payers</dt>
                  <dd>{record.multipleEmployers ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt>Total income below claims</dt>
                  <dd>{record.totalIncomeLessThanClaims ? "Yes" : "No"}</dd>
                </div>
                {record.form === "federal" && (
                  <>
                    <div>
                      <dt>Additional tax per payment</dt>
                      <dd>
                        <Money
                          cents={record.additionalTaxCents ?? 0}
                          currency="CAD"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Annual prescribed-zone claim</dt>
                      <dd>
                        <Money
                          cents={record.annualZoneDeductionCents ?? 0}
                          currency="CAD"
                        />
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              <p>
                {record.reviewReference} · source form year{" "}
                {record.sourceFormYear ?? record.year} · {record.source.method},{" "}
                {record.source.pageCount} pages.
              </p>
              {record.source.sha256 && (
                <p className="payroll-calculator__fingerprint">
                  Document SHA-256: {record.source.sha256}
                </p>
              )}
              {record.priorYearReviewed && (
                <p>
                  Prior-year applicability reviewed:{" "}
                  {record.priorYearReviewReference}
                </p>
              )}
              <p className="muted">
                Original file is not stored here. This record does not certify
                an employee electronic signature.
              </p>
            </details>
          ))}
          {!response.page.length && (
            <p>
              No reviewed TD1 imports for this employee. Existing reviewed
              payroll-profile settings remain the fallback.
            </p>
          )}
          <div className="payroll-calculator__actions">
            <button
              type="button"
              className="btn btn--sm"
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous TD1 history page
            </button>
            <span>
              History page {cursors.length} · {response.page.length} records
              shown
            </span>
            <button
              type="button"
              className="btn btn--sm"
              disabled={response.isDone}
              onClick={() => {
                if (
                  response.continueCursor &&
                  !cursors.includes(response.continueCursor)
                )
                  setCursors((old) => [...old, response.continueCursor]);
              }}
            >
              Next TD1 history page
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Td1ReviewWorkflow({
  societyId,
  employeeId,
  today,
  canWrite,
  onApplied,
}: {
  societyId: string;
  employeeId: string;
  today: string;
  canWrite: boolean;
  onApplied?: () => void;
}) {
  const [year, setYear] = useState(Number(today.slice(0, 4))),
    [receivedOn, setReceivedOn] = useState(today),
    [effectiveFrom, setEffectiveFrom] = useState(today),
    [drafts, setDrafts] = useState<Record<PayrollTd1Form, Td1ReviewDraft>>(
      () => ({
        federal: blankTd1Review("federal", Number(today.slice(0, 4))),
        BC: blankTd1Review("BC", Number(today.slice(0, 4))),
      }),
    ),
    [jobs, setJobs] = useState<
      Record<PayrollTd1Form, { busy: boolean; progress: string; error: string }>
    >({
      federal: { busy: false, progress: "", error: "" },
      BC: { busy: false, progress: "", error: "" },
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const controllers = useRef<Partial<Record<PayrollTd1Form, AbortController>>>(
      {},
    ),
    files = useRef<Partial<Record<PayrollTd1Form, File>>>({}),
    apply = useMutation(api.payrollTd1.applyReviewed);
  useEffect(
    () => () => {
      for (const controller of Object.values(controllers.current))
        controller?.abort();
      files.current = {};
    },
    [],
  );
  const patch = (form: PayrollTd1Form, change: Partial<Td1ReviewDraft>) => {
    setDrafts((old) => ({ ...old, [form]: { ...old[form], ...change } }));
    setNotice("");
  };
  function cancel(form: PayrollTd1Form) {
    controllers.current[form]?.abort();
    delete controllers.current[form];
    setJobs((old) => ({
      ...old,
      [form]: {
        busy: false,
        progress: "",
        error: "Parsing cancelled. Review fields again before applying.",
      },
    }));
  }
  async function parse(form: PayrollTd1Form, file: File, forceOcr = false) {
    controllers.current[form]?.abort();
    const controller = new AbortController();
    controllers.current[form] = controller;
    files.current[form] = file;
    setJobs((old) => ({
      ...old,
      [form]: { busy: true, progress: "Reading local form…", error: "" },
    }));
    patch(form, {
      parsed: undefined,
      fieldsReviewed: false,
      signed: false,
      resident: false,
    });
    try {
      const { parseTd1File } = await import("./td1FileParser");
      const result = await parseTd1File(file, {
        expectedYear: year,
        expectedForm: form,
        signal: controller.signal,
        forceOcr,
        onProgress: (progress) => {
          if (!controller.signal.aborted)
            setJobs((old) => ({
              ...old,
              [form]: {
                busy: true,
                progress: `${progress.stage}${progress.page ? ` · page ${progress.page}${progress.total ? ` of ${progress.total}` : ""}` : ""}`,
                error: "",
              },
            }));
        },
      });
      if (!controller.signal.aborted) {
        setDrafts((old) => ({ ...old, [form]: parsedTd1Review(result) }));
        setJobs((old) => ({
          ...old,
          [form]: {
            busy: false,
            progress: "Local extraction complete; review required.",
            error: "",
          },
        }));
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setJobs((old) => ({
          ...old,
          [form]: { busy: false, progress: "", error: payrollFailure(cause) },
        }));
    }
  }
  const reviewed = useMemo(() => {
    try {
      const forms = Object.values(drafts)
        .filter((draft) => draft.enabled)
        .map((draft) => reviewedTd1Form(draft, year));
      return {
        forms,
        error: forms.length ? "" : "Select at least one jurisdiction to apply.",
      };
    } catch (cause) {
      return {
        forms: [] as PayrollTd1ReviewedForm[],
        error: payrollFailure(cause),
      };
    }
  }, [drafts, year]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    setError("");
    setNotice("");
    try {
      if (!canWrite)
        throw new Error(
          "Finance write permission is required to apply reviewed declarations.",
        );
      if (reviewed.error) throw new Error(reviewed.error);
      if (effectiveFrom < receivedOn)
        throw new Error(
          "Effective date cannot precede the actual receipt date.",
        );
      if (receivedOn > today)
        throw new Error(
          "Received date must be an actual current or past date.",
        );
      if (Number(effectiveFrom.slice(0, 4)) !== year)
        throw new Error(
          "Effective date must belong to the applicable withholding year.",
        );
      setSaving(true);
      await apply({
        societyId,
        employeeId,
        receivedOn,
        effectiveFrom,
        forms: reviewed.forms,
      });
      setNotice(
        "Reviewed declarations saved. Payroll resolves them by payment date; wage-profile periods and existing frozen payroll records are retained.",
      );
      onApplied?.();
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      aria-label="Reviewed TD1 import"
      className="card payroll-calculator__panel"
      onSubmit={submit}
    >
      <h3>Review and apply declarations</h3>
      <p>
        Import either jurisdiction or both. A one-form import preserves the
        other jurisdiction’s reviewed record. Retain original signed forms
        through your authorized records process; no SIN, address, signature
        image, raw extracted text or file is saved in these payroll records.
      </p>
      <div className="payroll-calculator__form-grid">
        <Field label="Applicable withholding year">
          <input
            className="input"
            type="number"
            min="2024"
            max="2100"
            value={year}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 2024 && value <= 2100) {
                cancel("federal");
                cancel("BC");
                setYear(value);
                setDrafts({
                  federal: blankTd1Review("federal", value),
                  BC: blankTd1Review("BC", value),
                });
              }
            }}
          />
        </Field>
        <Field label="TD1 received on">
          <input
            className="input"
            type="date"
            required
            max={today}
            value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)}
          />
        </Field>
        <Field
          label="TD1 effective from"
          hint="Applies to payroll payment dates on or after receipt; it does not split an earnings profile."
        >
          <input
            className="input"
            type="date"
            required
            min={receivedOn}
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </Field>
      </div>
      {(["federal", "BC"] as const).map((form) => (
        <PayrollTd1FormReview
          key={form}
          draft={drafts[form]}
          year={year}
          onChange={(change) => {
            if (change.mode) {
              delete files.current[form];
            }
            if (change.enabled === false) cancel(form);
            patch(form, change);
          }}
          onFile={(file) => void parse(form, file)}
          onCancel={() => cancel(form)}
          onOcr={() => {
            const file = files.current[form];
            if (file) void parse(form, file, true);
          }}
          progress={jobs[form].progress}
          busy={jobs[form].busy}
          error={jobs[form].error}
        />
      ))}
      <PayrollTd1Example forms={reviewed.forms} year={year} />
      {reviewed.error && (
        <p className="muted">Review still needed: {reviewed.error}</p>
      )}
      {error && (
        <p role="alert" className="payroll-calculator__blockers">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="payroll-calculator__notice">
          {notice}
        </p>
      )}
      <button
        className="btn btn--accent"
        disabled={!canWrite || saving || jobs.federal.busy || jobs.BC.busy}
      >
        {saving
          ? "Applying reviewed declarations…"
          : "Apply reviewed TD1 declarations"}
      </button>
    </form>
  );
}

export function PayrollTd1ImportPanel({
  societyId,
  employeeId: fixedEmployeeId,
  onApplied,
}: {
  societyId: string;
  employeeId?: string;
  onApplied?: () => void;
}) {
  const permissions = usePermissions(),
    employees = usePayrollPages<PayrollPickerRow>(
      { societyId, collection: "employees" },
      "TD1 employee sources",
    ),
    [selected, setSelected] = useState(fixedEmployeeId ?? ""),
    [today, setToday] = useState<string | undefined>(),
    [attempt, setAttempt] = useState(0);
  const employeeId = fixedEmployeeId ?? selected,
    onToday = useCallback((date: string) => setToday(date), []);
  return (
    <section aria-label="TD1 import">
      <h2>TD1 import and review</h2>
      <p>
        Employer-reviewed federal and British Columbia declarations. Automatic
        extraction supports 2026 forms and always needs human review.
      </p>
      {employees.loader}
      {!employees.ready && !employees.error && (
        <p role="status">Loading complete employee choices…</p>
      )}
      <Field label="TD1 employee">
        <select
          className="input"
          value={employeeId}
          disabled={!employees.ready || !!fixedEmployeeId}
          onChange={(event) => {
            setSelected(event.target.value);
            setToday(undefined);
            setAttempt(0);
          }}
        >
          <option value="">Select an employee</option>
          {employees.rows.map((employee) => (
            <option value={employee._id} key={employee._id}>
              {pickerName(employee)}
            </option>
          ))}
        </select>
      </Field>
      {employeeId && (
        <>
          <PayrollQueryBoundary
            key={`${employeeId}:${attempt}`}
            label="Reviewed TD1 history"
            onRetry={() => setAttempt((old) => old + 1)}
          >
            <Td1History
              societyId={societyId}
              employeeId={employeeId}
              onToday={onToday}
            />
          </PayrollQueryBoundary>
          {today ? (
            <Td1ReviewWorkflow
              key={employeeId}
              societyId={societyId}
              employeeId={employeeId}
              today={today}
              canWrite={permissions.can("financials:write")}
              onApplied={onApplied}
            />
          ) : (
            <p role="status">
              Waiting for the organization’s actual review date…
            </p>
          )}
        </>
      )}
    </section>
  );
}
