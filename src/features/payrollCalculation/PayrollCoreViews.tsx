import type {
  CalculationInput,
  EarningCodeFields,
} from "../../../shared/payrollCalculation";
import { Money } from "../../components/Money";
import { formatDate } from "../../lib/format";
import { PayrollRunForm, type PayrollRecordSummary } from "./PayrollRunForm";
import { PayrollPreview, PayrollSavedReview } from "./PayrollRunReview";
import { PayrollQueryBoundary, type PayrollRow } from "./payrollUi";
import type { PayrollPickerRow } from "./PayrollSourceForms";

export function PayrollCalculateView({
  societyId,
  today,
  employees,
  codes,
  records,
  initial,
  input,
  draftId,
  formVersion,
  previewAttempt,
  canWrite,
  onNew,
  onPreview,
  onChanged,
  onRetry,
  onSaved,
}: {
  societyId: string;
  today: string;
  employees: PayrollPickerRow[];
  codes: PayrollRow<EarningCodeFields>[];
  records: PayrollRecordSummary[];
  initial?: CalculationInput;
  input?: CalculationInput;
  draftId?: string;
  formVersion: number;
  previewAttempt: number;
  canWrite: boolean;
  onNew: () => void;
  onPreview: (input: CalculationInput) => void;
  onChanged: () => void;
  onRetry: () => void;
  onSaved: (id: string) => void;
}) {
  return (
    <>
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn"
          disabled={!canWrite}
          onClick={onNew}
        >
          New calculation
        </button>
        {draftId && <span>Editing saved draft {draftId}</span>}
      </div>
      <PayrollRunForm
        key={formVersion}
        societyId={societyId}
        today={today}
        employees={employees}
        codes={codes}
        records={records}
        value={initial}
        canWrite={canWrite}
        onPreview={onPreview}
        onChanged={onChanged}
      />
      {input && (
        <PayrollQueryBoundary
          key={`${JSON.stringify(input)}:${previewAttempt}`}
          label="Payroll preview"
          onRetry={onRetry}
        >
          <PayrollPreview
            societyId={societyId}
            input={input}
            draftId={draftId}
            canWrite={canWrite}
            onSaved={onSaved}
          />
        </PayrollQueryBoundary>
      )}
    </>
  );
}

export function PayrollRecordsView({
  societyId,
  year,
  today,
  records,
  recordId,
  canWrite,
  onOpen,
  onEdit,
  onReplacement,
}: {
  societyId: string;
  year: number;
  today: string;
  records: PayrollRecordSummary[];
  recordId: string | null;
  canWrite: boolean;
  onOpen: (id?: string) => void;
  onEdit: (input: CalculationInput, id: string) => void;
  onReplacement: (input: CalculationInput) => void;
}) {
  return (
    <section aria-label="Saved calculations">
      <h2>Saved payroll calculations · {year}</h2>
      {recordId ? (
        <>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => onOpen()}
          >
            Back to saved calculations
          </button>
          <PayrollSavedReview
            key={recordId}
            societyId={societyId}
            id={recordId}
            today={today}
            canWrite={canWrite}
            onEdit={onEdit}
            onReplacement={onReplacement}
          />
        </>
      ) : records.length ? (
        records.map((record) => (
          <article key={record._id} className="payroll-calculator__record">
            <div>
              <strong>
                {formatDate(record.payDate)} · {record.runType} ·{" "}
                {record.status}
              </strong>
              <p>
                {formatDate(record.periodStart)}–{formatDate(record.periodEnd)}{" "}
                · {record.employeeIds.length} employees · version{" "}
                {record.version}
                {record.blockerCount
                  ? ` · ${record.blockerCount} blockers`
                  : ""}
              </p>
              {record.totals && (
                <p>
                  Net <Money cents={record.totals.netCents} currency="CAD" /> ·
                  Full employer cost{" "}
                  <Money
                    cents={record.totals.employerCostCents}
                    currency="CAD"
                  />
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onOpen(record._id)}
            >
              Review saved calculation
            </button>
          </article>
        ))
      ) : (
        <p>No saved calculations in this payment year.</p>
      )}
    </section>
  );
}
