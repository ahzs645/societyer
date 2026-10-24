import { Field } from "../../components/ui";
import {
  PAYROLL_TD1_SOURCES,
  type PayrollTd1Form,
} from "../../../shared/payrollTd1";
import type { Td1ReviewDraft, Td1BooleanReview } from "./td1ReviewFields";

export function PayrollTd1FormReview({
  draft,
  year,
  onChange,
  onFile,
  onCancel,
  onOcr,
  progress,
  busy,
  error,
}: {
  draft: Td1ReviewDraft;
  year: number;
  onChange: (change: Partial<Td1ReviewDraft>) => void;
  onFile: (file: File) => void;
  onCancel: () => void;
  onOcr: () => void;
  progress: string;
  busy: boolean;
  error: string;
}) {
  const title = draft.form === "federal" ? "Federal TD1" : "BC TD1",
    parsed = draft.parsed;
  function edit(change: Partial<Td1ReviewDraft>) {
    onChange({ ...change, fieldsReviewed: false, signed: false });
  }
  return (
    <fieldset
      className="payroll-calculator__fieldset"
      aria-label={`${title} review`}
    >
      <legend>{title}</legend>
      <label>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />{" "}
        Apply {title}
      </label>
      <p>
        {PAYROLL_TD1_SOURCES[draft.form].map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open official {title} form
          </a>
        ))}
      </p>
      {draft.enabled && (
        <>
          <Field label={`${title} review source`}>
            <select
              className="input"
              value={draft.mode}
              onChange={(event) => {
                onCancel();
                onChange({
                  mode: event.target.value as Td1ReviewDraft["mode"],
                  parsed: undefined,
                  fieldsReviewed: false,
                  signed: false,
                  resident: false,
                });
              }}
            >
              <option value="upload">Read a local PDF or image</option>
              <option value="manual">
                Reviewed manual / paper declaration
              </option>
            </select>
          </Field>
          {draft.mode === "upload" ? (
            <>
              <Field
                label={`${title} file`}
                hint="The local parser never certifies the employee’s signature. File bytes and extracted raw text are not saved to payroll records."
              >
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  disabled={busy || year !== 2026}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onFile(file);
                    event.target.value = "";
                  }}
                />
              </Field>
              {year !== 2026 && (
                <p role="alert">
                  Automatic form extraction currently recognizes 2026. Use a
                  separately reviewed manual declaration for other applicable
                  years.
                </p>
              )}
              {busy && (
                <p role="status">
                  {progress || "Reading the local form…"}{" "}
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={onCancel}
                  >
                    Cancel {title} parsing
                  </button>
                </p>
              )}
              {error && <p role="alert">{error}</p>}
              {parsed && (
                <div
                  className={
                    parsed.status === "blocked"
                      ? "payroll-calculator__blockers"
                      : "payroll-calculator__notice"
                  }
                >
                  <p>
                    {parsed.status === "blocked"
                      ? "File cannot be applied"
                      : "Manual field review required"}{" "}
                    · source method {parsed.source.method} ·{" "}
                    {parsed.source.pageCount} pages. Signature verification:{" "}
                    <strong>Not performed</strong>.
                  </p>
                  {parsed.blockers.length > 0 && (
                    <ul>
                      {parsed.blockers.map((blocker, index) => (
                        <li key={index}>{blocker}</li>
                      ))}
                    </ul>
                  )}
                  {parsed.warnings.length > 0 && (
                    <ul>
                      {parsed.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={busy}
                    onClick={onOcr}
                  >
                    Reread {title} with local OCR
                  </button>
                  <details className="payroll-calculator__td1-evidence">
                    <summary>{title} field and page evidence</summary>
                    <dl>
                      {Object.entries(parsed.fields).map(([key, field]) => (
                        <div key={key}>
                          <dt>
                            {key} · {field.confidence} confidence ·{" "}
                            {field.value === null
                              ? "Unknown"
                              : typeof field.value === "boolean"
                                ? field.value
                                  ? "Yes"
                                  : "No"
                                : (field.value / 100).toFixed(2)}
                          </dt>
                          <dd>
                            {field.evidence.map((item, index) => (
                              <p key={index}>
                                {item.method}
                                {item.page ? ` · page ${item.page}` : ""}
                                {item.sourceField
                                  ? ` · field ${item.sourceField}`
                                  : ""}{" "}
                                · {item.description}
                              </p>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {parsed.claimLines.length > 0 && (
                      <div
                        className="payroll-calculator__table-wrap"
                        role="region"
                        aria-label={`${title} claim lines table`}
                        tabIndex={0}
                      >
                        <table
                          className="table"
                          aria-label={`${title} extracted claim lines`}
                        >
                          <thead>
                            <tr>
                              <th>Line</th>
                              <th>Claim</th>
                              <th>Extracted amount</th>
                              <th>Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsed.claimLines.map((line) => (
                              <tr key={line.line}>
                                <td>{line.line}</td>
                                <td>{line.label}</td>
                                <td>
                                  {line.amountCents.value === null
                                    ? "Unknown"
                                    : (line.amountCents.value / 100).toFixed(2)}
                                </td>
                                <td>{line.amountCents.confidence}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="payroll-calculator__fingerprint">
                      Uploaded document SHA-256: {parsed.source.sha256}
                    </p>
                  </details>
                </div>
              )}
            </>
          ) : (
            <p className="payroll-calculator__notice">
              Record the actual signed declaration you reviewed. No document
              hash is invented for a paper/manual source. Enter a meaningful
              source reference; retain the original through your authorized
              records process.
            </p>
          )}
          <div className="payroll-calculator__form-grid">
            <Field
              label={`${title} annual total claim amount`}
              hint="Annual claim amount in CAD; this is not an amount of tax withheld."
            >
              <input
                className="input"
                inputMode="decimal"
                value={draft.claim}
                onChange={(event) => edit({ claim: event.target.value })}
              />
            </Field>
            {(
              [
                ["multiple", "Concurrent employer/payer declaration"],
                ["below", "Total income below total claims declaration"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={`${title} ${label.toLowerCase()}`}>
                <select
                  className="input"
                  value={draft[key]}
                  onChange={(event) =>
                    edit({ [key]: event.target.value as Td1BooleanReview })
                  }
                >
                  <option value="unknown">Review the actual form</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </Field>
            ))}
            {draft.form === "federal" && (
              <>
                <Field
                  label="Federal TD1 additional withholding per payment"
                  hint="Enter explicit zero when no additional withholding is requested."
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={draft.additional}
                    onChange={(event) =>
                      edit({ additional: event.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Federal TD1 annual prescribed-zone deduction"
                  hint="Enter explicit zero when no prescribed-zone claim applies."
                >
                  <input
                    className="input"
                    inputMode="decimal"
                    value={draft.zone}
                    onChange={(event) => edit({ zone: event.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label={`${title} actual source form year`}>
              <input
                className="input"
                type="number"
                min="2000"
                max={year}
                value={draft.sourceYear}
                onChange={(event) =>
                  edit({
                    sourceYear: event.target.value,
                    priorYearReviewed: false,
                  })
                }
              />
            </Field>
            {draft.mode === "manual" && (
              <Field label={`${title} actual source page count`}>
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="20"
                  value={draft.sourcePages}
                  onChange={(event) =>
                    edit({ sourcePages: event.target.value })
                  }
                />
              </Field>
            )}
            <Field label={`${title} review reference`}>
              <input
                className="input"
                value={draft.reference}
                onChange={(event) =>
                  onChange({ reference: event.target.value })
                }
              />
            </Field>
          </div>
          {Number(draft.sourceYear) !== year && (
            <div className="payroll-calculator__notice">
              <label>
                <input
                  type="checkbox"
                  checked={draft.priorYearReviewed}
                  onChange={(event) =>
                    onChange({ priorYearReviewed: event.target.checked })
                  }
                />{" "}
                I reviewed the older declaration’s continued applicability and
                current indexed claims for {year}
              </label>
              <Field label={`${title} prior-year applicability reference`}>
                <input
                  className="input"
                  value={draft.priorYearReference}
                  onChange={(event) =>
                    onChange({ priorYearReference: event.target.value })
                  }
                />
              </Field>
            </div>
          )}
          <div className="form-stack">
            <label>
              <input
                type="checkbox"
                checked={draft.resident}
                onChange={(event) =>
                  onChange({ resident: event.target.checked })
                }
              />{" "}
              I confirmed ordinary Canadian resident treatment for this {title}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.signed}
                onChange={(event) => onChange({ signed: event.target.checked })}
              />{" "}
              I reviewed the employee’s signed and dated {title} declaration
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.fieldsReviewed}
                onChange={(event) =>
                  onChange({ fieldsReviewed: event.target.checked })
                }
              />{" "}
              I reviewed every claim and declaration flag against the {title}
            </label>
          </div>
          <p className="muted">
            A nonresident declaration needs its supported policy review. The
            parser cannot establish residency, signature validity or employee
            certification.
          </p>
        </>
      )}
    </fieldset>
  );
}
export const td1FormName = (form: PayrollTd1Form) =>
  form === "federal" ? "Federal TD1" : "BC TD1";
