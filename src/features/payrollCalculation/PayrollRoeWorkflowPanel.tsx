import { lazy, Suspense, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { useFinancePermissions } from "../../hooks/useFinancePermissions";
import { triggerBlobDownload } from "../../lib/zip";
import {
  ROE_READINESS_LABELS,
  ROE_FOLLOWUP_LABELS,
  ROE_WORKFLOW_SOURCES,
  type RoeWorkflowView,
  type RoeFollowUp,
  type RoeReadinessKey,
  type RoeFollowUpKey,
} from "../../../shared/payrollRoeWorkflow";
import { type PayrollXmlExport } from "../../../shared/payrollReporting";
import { payrollFailure, usePayrollPages } from "./payrollUi";
import { usePayrollRoePages } from "./usePayrollRoePages";
import { PayrollRoeCaseForm, type RoeEmployee } from "./PayrollRoeCaseForm";
const FilingPanel = lazy(() =>
  import("./PayrollFilingPanel").then((module) => ({
    default: module.PayrollFilingPanel,
  })),
);
const localNow = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
function Guidance() {
  return (
    <details className="card payroll-calculator__panel">
      <summary>
        Where to issue an ROE, who gets it, and what happens next
      </summary>
      <ol>
        <li>
          <strong>Confirm the interruption and due date.</strong> Ordinary
          interruptions use seven consecutive days without work or insurable
          earnings; specified illness/family leaves may instead use strictly
          below 60% of normal weekly earnings. Casual, regular annual business
          vacation, self-funded leave and nonstandard arrangements require their
          own review. A pay date is not a pay-period end.
        </li>
        <li>
          <strong>Prepare complete history and separation information.</strong>{" "}
          Review first day worked since the previous ROE, last day for which
          paid, reason, all required consecutive insurable-earnings periods,
          insurable hours, recall, vacation, holidays and other monies. Add
          missing historic periods in the existing export form; do not guess
          hours from dollars. Correct omissions before submission and track
          unanswered requests here.
        </li>
        <li>
          <strong>Use the official channel.</strong>{" "}
          <a
            href={ROE_WORKFLOW_SOURCES[1].url}
            target="_blank"
            rel="noreferrer"
          >
            Open Service Canada ROE Web and registration instructions
          </a>
          . Register the employer organization and business/payroll account
          using the official sign-in route; the authorized Primary Officer
          validates the organization and assigns representative/user access.
          Have the responsible officer complete validation and grant the
          appropriate access. An authorized payroll provider may use its
          supported transfer service. This app prepares an XML extract; it does
          not sign in, send or issue an ROE. Upload the file to ROE Web, review
          validation errors and obtain the actual accepted
          serial/acknowledgment.
        </li>
        <li>
          <strong>Paper is a distinct process.</strong> Use official
          pre-numbered paper forms, obtainable from Service Canada; an XML/PDF
          printout is not an issued paper ROE. Give Part 1 to the employee, send
          Part 2 to Service Canada (PO Box 9000, Bathurst NB E2A 4T3), and
          retain Part 3 securely. Send other correspondence to the appropriate
          Service Canada centre.
        </li>
        <li>
          <strong>Tell the employee how to access it.</strong> Electronic ROEs
          are available through{" "}
          <a
            href={ROE_WORKFLOW_SOURCES[2].url}
            target="_blank"
            rel="noreferrer"
          >
            My Service Canada Account
          </a>
          ; employees do not send a duplicate paper copy to Service Canada. A
          courtesy copy may be provided on request. The employee should apply
          for EI promptly even while waiting for an ROE; Service Canada
          determines eligibility. Record the actual follow-up rather than
          assuming the employee saw a download.
        </li>
        <li>
          <strong>Verify acceptance and correct errors.</strong> A local
          download or attempted upload is not issuance. Record the real
          successful acknowledgment and serial. An issued ROE cannot be
          cancelled: create a linked full amendment using the original serial
          and all correct blocks. No new information means no amendment. For an
          ROE issued in error, follow the guide’s Block 18 instruction “Previous
          ROE issued in error”. A paper ROE amended electronically also needs
          “Amending a paper ROE” plus the original serial in Block 18. Obtain a
          missing serial from the official channel; never invent one.
        </li>
        <li>
          <strong>Retain and follow up.</strong> Keep related payroll and ROE
          records securely for six years after the year to which they relate.
          Electronic records do not require a hard-copy file. Keep
          missing-information, employee-access and acceptance tasks open or
          blocked until actually resolved; a future retention review remains
          tracked after operational closure.
        </li>
      </ol>
      <p>
        Electronic weekly, biweekly and semimonthly deadlines are five calendar
        days after the pay-period end. Monthly/13-period deadlines use the
        earlier of that date and fifteen days after the first interruption day.
        Paper deadlines have their separate interruption/awareness rule.
        Weekends do not automatically move these calendar deadlines.
      </p>
      {ROE_WORKFLOW_SOURCES.map((source) => (
        <p key={source.url}>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>{" "}
          · reviewed {source.reviewedOn}
        </p>
      ))}
    </details>
  );
}
function Readiness({
  societyId,
  row,
  disabled,
  onError,
}: {
  societyId: string;
  row: RoeWorkflowView;
  disabled: boolean;
  onError: (value: string) => void;
}) {
  const [checklist, setChecklist] = useState(row.checklist),
    [busy, setBusy] = useState(false),
    save = useMutation(api.payrollRoeWorkflow.updateChecklist);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      await save({
        societyId,
        id: row._id,
        checklist,
        expectedVersion: row.version,
      });
    } catch (cause) {
      onError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form aria-label="ROE readiness checklist" onSubmit={submit}>
      <fieldset disabled={disabled || busy}>
        <legend>2. Review filing readiness</legend>
        {(
          Object.entries(ROE_READINESS_LABELS) as Array<
            [RoeReadinessKey, string]
          >
        ).map(([key, label]) => (
          <label className="payroll-calculator__check" key={key}>
            <input
              type="checkbox"
              checked={checklist[key]}
              onChange={(event) =>
                setChecklist((old) => ({ ...old, [key]: event.target.checked }))
              }
            />
            {label}
          </label>
        ))}
        <button className="btn btn--sm" type="submit">
          Save readiness review
        </button>
      </fieldset>
    </form>
  );
}
function FollowUpEditor({
  societyId,
  row,
  item,
  canWrite,
  onError,
}: {
  societyId: string;
  row: RoeWorkflowView;
  item: RoeFollowUp;
  canWrite: boolean;
  onError: (message: string) => void;
}) {
  const [dueDate, setDue] = useState(item.dueDate),
    [status, setStatus] = useState(item.status),
    [note, setNote] = useState(item.note ?? ""),
    [busy, setBusy] = useState(false),
    save = useMutation(api.payrollRoeWorkflow.saveFollowUp);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      await save({
        societyId,
        id: row._id,
        key: item.key,
        dueDate,
        status,
        note,
        expectedVersion: row.version,
      });
    } catch (cause) {
      onError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label={`ROE follow-up: ${ROE_FOLLOWUP_LABELS[item.key]}`}
      onSubmit={submit}
    >
      <fieldset disabled={!canWrite || busy}>
        <legend>{ROE_FOLLOWUP_LABELS[item.key]}</legend>
        <div className="form-grid">
          <Field label="Follow-up target date">
            <input
              className="input"
              type="date"
              required
              value={dueDate}
              onChange={(event) => setDue(event.target.value)}
            />
          </Field>
          <Field label="Follow-up status">
            <select
              className="input"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as RoeFollowUp["status"])
              }
            >
              <option value="open">Open</option>
              <option value="blocked">Blocked — waiting / no response</option>
              <option value="done">Done — actually resolved</option>
              {(item.key !== "acceptance" ||
                row.assessment.requirement === "not_required") && (
                <option value="not_applicable">
                  Reviewed — not applicable
                </option>
              )}
            </select>
          </Field>
          <Field label="Protected follow-up evidence">
            <textarea
              className="input"
              maxLength={2000}
              required={status !== "open"}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
        <button type="submit" className="btn btn--sm">
          Save follow-up
        </button>
      </fieldset>
    </form>
  );
}
function CaseDetail({
  societyId,
  row,
  today,
  canWrite,
  canExport,
  onEdit,
  onAmend,
}: {
  societyId: string;
  row: RoeWorkflowView;
  today: string;
  canWrite: boolean;
  canExport: boolean;
  onEdit: () => void;
  onAmend: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [submissionTime, setSubmissionTime] = useState(localNow),
    [channel, setChannel] = useState<"roe_web" | "provider" | "paper">(
      row.facts.format === "paper" ? "paper" : "roe_web",
    ),
    [reference, setReference] = useState(""),
    [submissionNote, setSubmissionNote] = useState(""),
    [issuedTime, setIssuedTime] = useState(localNow),
    [legacyIssuedDate, setLegacyIssuedDate] = useState(
      row.register?.issuedOn ?? "",
    ),
    [serial, setSerial] = useState(row.register?.serialNumber ?? ""),
    [ack, setAck] = useState(""),
    [copies, setCopies] = useState(false),
    [closeNote, setCloseNote] = useState("");
  const generate = useMutation(api.payrollRoeWorkflow.recordGenerated),
    submission = useMutation(api.payrollRoeWorkflow.recordSubmission),
    issuance = useMutation(api.payrollRoeWorkflow.recordIssuance),
    followup = useMutation(api.payrollRoeWorkflow.saveFollowUp),
    close = useMutation(api.payrollRoeWorkflow.closeCase);
  const issued = row.register?.status === "issued",
    editable = canWrite && !issued && !row.submission && !row.closedAtISO,
    ready = row.readinessBlockers.length === 0;
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  async function generated(result: PayrollXmlExport) {
    const bytes = new TextEncoder().encode(result.xml),
      digest = await crypto.subtle.digest("SHA-256", bytes),
      sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    await generate({
      societyId,
      id: row._id,
      caseFingerprint: row.caseFingerprint,
      sha256,
      byteLength: bytes.length,
      filename: result.filename,
      schemaVersion: result.schemaVersion,
      expectedVersion: row.version,
    });
  }
  return (
    <article
      className="card payroll-calculator__panel form-stack"
      aria-label="Selected ROE case"
    >
      <h3>
        {row.employeeName} ·{" "}
        {row.amendmentOfCaseId ? "ROE amendment" : "ROE case"}
      </h3>
      <p role="status">
        Case stage: <strong>{row.stage.replaceAll("_", " ")}</strong> ·
        Register:{" "}
        <strong>{row.register?.status ?? "No obligation created"}</strong> ·
        version {row.version}
      </p>
      <section aria-label="ROE deadline assessment">
        <h4>1. Confirm facts and deadline</h4>
        <p>
          Requirement: {row.assessment.requirement.replaceAll("_", " ")} ·
          Interruption: {row.assessment.interruptionDate ?? "Needs review"} ·{" "}
          <strong>
            Issue/action target: {row.assessment.dueDate ?? "Needs review"}
          </strong>
          {row.assessment.dueDate && row.assessment.dueDate < today && !issued
            ? " — overdue / action required"
            : ""}
        </p>
        <p>{row.assessment.deadlineBasis}</p>
        <p>
          Last day for which paid {row.facts.lastDayPaid}; pay period{" "}
          {row.facts.periodStart}–{row.facts.periodEnd}.{" "}
          {row.facts.anticipatedGap
            ? "Anticipated facts — verify the actual interruption."
            : "Actual facts recorded."}
        </p>
        <p>Source evidence: {row.facts.evidence}</p>
        {row.facts.notes && <p>Case / correction notes: {row.facts.notes}</p>}
        {row.amendmentOriginalSerial && (
          <p>
            Original serial: {row.amendmentOriginalSerial} · Full amendment
            required; the original remains issued.
          </p>
        )}
        {[...row.assessment.blockers, ...row.assessment.warnings].map(
          (message, index) => (
            <p key={index} className="payroll-calculator__notice">
              {message}
            </p>
          ),
        )}
        <div className="payroll-calculator__actions">
          <button
            type="button"
            className="btn btn--sm"
            disabled={!editable || busy}
            onClick={onEdit}
          >
            Edit case facts
          </button>
          <button
            type="button"
            className="btn btn--sm"
            disabled={!canWrite || !issued || busy}
            onClick={onAmend}
          >
            Create linked amendment
          </button>
        </div>
      </section>
      <Readiness
        key={`${row._id}:${row.version}`}
        societyId={societyId}
        row={row}
        disabled={
          !canWrite ||
          Boolean(row.closedAtISO) ||
          (Boolean(row.submission) && !issued)
        }
        onError={setError}
      />
      <section>
        <h4>3. Prepare the file / official form</h4>
        {row.generated && (
          <p>
            XML prepared {row.generated.atISO} · {row.generated.byteLength}{" "}
            bytes · SHA-256{" "}
            <code style={{ overflowWrap: "anywhere" }}>
              {row.generated.sha256}
            </code>
            . This records generation only.
          </p>
        )}
        {row.facts.format === "electronic" ? (
          <>
            <button
              type="button"
              className="btn"
              disabled={!editable || !canExport || !ready || busy}
              onClick={() => setExportOpen((old) => !old)}
            >
              {exportOpen
                ? "Close transient ROE export"
                : "Open reviewed ROE XML export"}
            </button>
            {!ready && (
              <p>
                Save every readiness review and resolve the case assessment
                before generating a linked XML file.
              </p>
            )}
            {exportOpen && editable && ready && (
              <Suspense
                fallback={<p>Loading existing official XML exporter…</p>}
              >
                <FilingPanel
                  societyId={societyId}
                  roeCase={row}
                  onRoeGenerated={generated}
                />
              </Suspense>
            )}
          </>
        ) : (
          <p>
            Use the actual pre-numbered official paper form and instructions
            above. This workflow does not turn an electronic XML into a valid
            paper ROE.
          </p>
        )}
      </section>
      <section>
        <h4>4. Record actual submission and issuance</h4>
        <p>
          Complete the official action outside Societyer. Use these controls
          only after reviewing the real upload/provider/paper evidence. No file
          is sent by this page.
        </p>
        {row.submission && (
          <p>
            Actual submission: {row.submission.atISO} · {row.submission.channel}{" "}
            · {row.submission.reference}. {row.submission.note}
          </p>
        )}
        {!issued && !row.closedAtISO && (
          <>
            <form
              aria-label="Actual ROE submission"
              onSubmit={(event) => {
                event.preventDefault();
                void action(() =>
                  submission({
                    societyId,
                    id: row._id,
                    atISO: new Date(submissionTime).toISOString(),
                    channel,
                    reference,
                    note: submissionNote,
                    expectedVersion: row.version,
                  }),
                );
              }}
            >
              <fieldset disabled={!canWrite || !ready || busy}>
                <legend>Record actual submission attempt</legend>
                <div className="form-grid">
                  <Field label="Actual submission time (local)">
                    <input
                      className="input"
                      type="datetime-local"
                      required
                      value={submissionTime}
                      onChange={(event) =>
                        setSubmissionTime(event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Actual submission channel">
                    <select
                      className="input"
                      value={channel}
                      onChange={(event) =>
                        setChannel(event.target.value as typeof channel)
                      }
                    >
                      {row.facts.format === "paper" ? (
                        <option value="paper">Official paper copies</option>
                      ) : (
                        <>
                          <option value="roe_web">
                            ROE Web — upload or reviewed direct entry
                          </option>
                          <option value="provider">Authorized provider</option>
                        </>
                      )}
                    </select>
                  </Field>
                  <Field label="Actual submission reference">
                    <input
                      className="input"
                      maxLength={100}
                      required
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  </Field>
                  <Field label="Actual submission evidence / rejection details">
                    <textarea
                      className="input"
                      required
                      maxLength={2000}
                      value={submissionNote}
                      onChange={(event) =>
                        setSubmissionNote(event.target.value)
                      }
                    />
                  </Field>
                </div>
                <button className="btn btn--sm" type="submit">
                  Record actual submission
                </button>
                {row.submission && (
                  <button
                    className="btn btn--sm"
                    type="button"
                    onClick={() =>
                      void action(() =>
                        submission({
                          societyId,
                          id: row._id,
                          atISO: new Date(submissionTime).toISOString(),
                          channel,
                          reference,
                          note: submissionNote,
                          outcome: "rejected",
                          expectedVersion: row.version,
                        }),
                      )
                    }
                  >
                    Record actual rejection and reopen correction
                  </button>
                )}
              </fieldset>
            </form>
            <form
              aria-label="Actual ROE issuance"
              onSubmit={(event) => {
                event.preventDefault();
                void action(() =>
                  issuance({
                    societyId,
                    id: row._id,
                    atISO: new Date(issuedTime).toISOString(),
                    serialNumber: serial,
                    acknowledgment: ack,
                    paperCopiesCompleted: copies,
                    expectedVersion: row.version,
                  }),
                );
              }}
            >
              <fieldset disabled={!canWrite || !ready || busy}>
                <legend>Record successful issuance acknowledgment</legend>
                <div className="form-grid">
                  <Field label="Actual issuance time (local)">
                    <input
                      className="input"
                      type="datetime-local"
                      required
                      value={issuedTime}
                      onChange={(event) => setIssuedTime(event.target.value)}
                    />
                  </Field>
                  <Field label="Actual issued ROE serial">
                    <input
                      className="input"
                      required
                      maxLength={9}
                      value={serial}
                      onChange={(event) =>
                        setSerial(event.target.value.toUpperCase())
                      }
                      placeholder={
                        row.facts.format === "paper"
                          ? "E plus 8 digits"
                          : "W plus 8 digits"
                      }
                    />
                  </Field>
                  <Field label="Actual successful acknowledgment evidence">
                    <textarea
                      className="input"
                      required
                      maxLength={2000}
                      value={ack}
                      onChange={(event) => setAck(event.target.value)}
                    />
                  </Field>
                </div>
                {row.facts.format === "paper" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={copies}
                      onChange={(event) => setCopies(event.target.checked)}
                    />{" "}
                    Actual copies completed: Part 1 employee, Part 2 Service
                    Canada, Part 3 retained securely
                  </label>
                )}
                <button type="submit" className="btn btn--accent">
                  Record actual issuance acknowledgment
                </button>
              </fieldset>
            </form>
          </>
        )}
        {issued &&
          (!row.register?.serialNumber || !row.register?.issuedOn) &&
          !row.closedAtISO && (
            <form
              aria-label="Review historical issued ROE acknowledgment"
              onSubmit={(event) => {
                event.preventDefault();
                void action(() =>
                  issuance({
                    societyId,
                    id: row._id,
                    atISO: legacyIssuedDate,
                    serialNumber: serial,
                    acknowledgment: ack,
                    paperCopiesCompleted: copies,
                    expectedVersion: row.version,
                  }),
                );
              }}
            >
              <fieldset disabled={!canWrite || !ready || busy}>
                <legend>
                  Obtain the missing actual original serial / date
                </legend>
                <p>
                  Use the actual existing ROE in the official channel. A
                  reviewed date can be recorded without inventing its time; the
                  acknowledgment review receives its own timestamp.
                </p>
                <Field label="Original actual issued date">
                  <input
                    className="input"
                    type="date"
                    required
                    value={legacyIssuedDate}
                    onChange={(event) =>
                      setLegacyIssuedDate(event.target.value)
                    }
                  />
                </Field>
                <Field label="Original actual issued serial">
                  <input
                    className="input"
                    maxLength={9}
                    required
                    value={serial}
                    onChange={(event) =>
                      setSerial(event.target.value.toUpperCase())
                    }
                  />
                </Field>
                <Field label="Original issuance source evidence">
                  <textarea
                    className="input"
                    maxLength={2000}
                    required
                    value={ack}
                    onChange={(event) => setAck(event.target.value)}
                  />
                </Field>
                {row.facts.format === "paper" && (
                  <label>
                    <input
                      type="checkbox"
                      checked={copies}
                      onChange={(event) => setCopies(event.target.checked)}
                    />{" "}
                    Actual original paper copies reviewed: employee, Service
                    Canada and retained employer copy
                  </label>
                )}
                <button className="btn btn--sm" type="submit">
                  Record reviewed original acknowledgment
                </button>
              </fieldset>
            </form>
          )}
        {issued && (
          <p>
            Issued register serial{" "}
            <strong>
              {row.register?.serialNumber ??
                "Obtain actual serial from official source"}
            </strong>{" "}
            · {row.register?.issuedOn}. Corrections require a full linked
            amendment.
          </p>
        )}
      </section>
      <section>
        <h4>5. Work through follow-ups</h4>
        {row.followUps.map((item) => (
          <FollowUpEditor
            key={`${item.key}:${item.updatedAtISO}`}
            societyId={societyId}
            row={row}
            item={item}
            canWrite={canWrite}
            onError={setError}
          />
        ))}
        {!row.followUps.some((item) => item.key === "missing_information") && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={!canWrite || busy}
            onClick={() =>
              void action(() =>
                followup({
                  societyId,
                  id: row._id,
                  key: "missing_information",
                  dueDate: today,
                  status: "open",
                  note: "Review missing information and any unanswered request; set a real follow-up target.",
                  expectedVersion: row.version,
                }),
              )
            }
          >
            Track missing information / nonresponse
          </button>
        )}
        {row.closedAtISO ? (
          <p>
            Operational case closed {row.closedAtISO}. {row.closeNote} The
            retention review remains tracked.
          </p>
        ) : (
          <form
            aria-label="Close ROE case"
            onSubmit={(event) => {
              event.preventDefault();
              void action(() =>
                close({
                  societyId,
                  id: row._id,
                  note: closeNote,
                  expectedVersion: row.version,
                }),
              );
            }}
          >
            <Field label="Operational closure evidence">
              <textarea
                className="input"
                maxLength={2000}
                required
                disabled={!canWrite || busy}
                value={closeNote}
                onChange={(event) => setCloseNote(event.target.value)}
              />
            </Field>
            <button
              type="submit"
              className="btn btn--sm"
              disabled={
                !canWrite ||
                busy ||
                (!issued && row.assessment.requirement !== "not_required")
              }
            >
              Close resolved operational case
            </button>
          </form>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Protected case history ({row.history.length})</summary>
        <ol>
          {row.history.map((event, index) => (
            <li key={`${event.atISO}:${index}`}>
              {event.atISO} · version {event.version} ·{" "}
              {event.action.replaceAll("_", " ")}
              {event.note && <p>{event.note}</p>}
              {event.sha256 && <p>SHA-256 {event.sha256}</p>}
            </li>
          ))}
        </ol>
      </details>
      <p>
        Rules/source version: {row.rulesVersion}. No SIN or XML contents are
        stored in this case.
      </p>
    </article>
  );
}
export function PayrollRoeWorkflowPanel({ societyId }: { societyId: string }) {
  const permissions = usePermissions(),
    { canExport } = useFinancePermissions(),
    canWrite =
      permissions.can("financials:write") && permissions.can("employees:read"),
    employees = usePayrollPages<RoeEmployee>(
      { societyId, collection: "employees" },
      "ROE employees",
    ),
    [employeeId, setEmployee] = useState(""),
    [selectedId, setSelected] = useState(""),
    [editor, setEditor] = useState<"new" | "edit" | "amend" | null>(null);
  const cases = usePayrollRoePages<RoeWorkflowView>({
      societyId,
      collection: "cases",
      ...(employeeId ? { employeeId } : {}),
    }),
    selected = cases.rows.find((row) => row._id === selectedId),
    person = employees.rows.find(
      (row) =>
        row._id ===
        (selected && editor !== "new" ? selected.employeeId : employeeId),
    );
  function csv() {
    const rows = [
      [
        "Employee",
        "Case ID",
        "Stage",
        "Requirement",
        "Interruption",
        "Deadline",
        "Register status",
        "Actual serial",
        "Amends",
        "Follow-up",
        "Follow-up target",
        "Follow-up status",
      ],
      ...cases.rows.flatMap((row) =>
        (row.followUps.length ? row.followUps : [undefined]).map((item) => [
          row.employeeName,
          row._id,
          row.stage,
          row.assessment.requirement,
          row.assessment.interruptionDate ?? "",
          row.assessment.dueDate ?? "",
          row.register?.status ?? "",
          row.register?.serialNumber ?? "",
          row.amendmentOriginalSerial ?? "",
          item ? ROE_FOLLOWUP_LABELS[item.key] : "",
          item?.dueDate ?? "",
          item?.status ?? "",
        ]),
      ),
    ];
    const text = rows
      .map((row) =>
        row
          .map(
            (cell) =>
              `"${String(/^[=+\-@]/.test(cell) ? `'${cell}` : cell).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    triggerBlobDownload(
      new Blob([`\uFEFF${text}`], { type: "text/csv;charset=utf-8" }),
      "ROE-workflow.csv",
    );
  }
  return (
    <section aria-label="ROE workflow" className="form-stack">
      <h2>Record of Employment workflow</h2>
      <p>
        Assess the deadline, prepare the official extract, record actual
        acknowledgment, and finish employee/retention follow-ups. A generated
        file stays separate from an issued ROE.
      </p>
      <Guidance />
      {employees.loader}
      {cases.loader}
      <div className="form-grid">
        <Field label="ROE workflow employee">
          <select
            className="input"
            value={employeeId}
            disabled={!employees.ready}
            onChange={(event) => {
              setEmployee(event.target.value);
              setSelected("");
              setEditor(null);
            }}
          >
            <option value="">All employees — select one to start a case</option>
            {employees.rows.map((row) => (
              <option key={row._id} value={row._id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ROE workflow case">
          <select
            className="input"
            value={selectedId}
            disabled={!cases.ready}
            onChange={(event) => {
              setSelected(event.target.value);
              setEditor(null);
            }}
          >
            <option value="">Select case</option>
            {cases.rows.map((row) => (
              <option key={row._id} value={row._id}>
                {row.employeeName} · {row.facts.lastDayPaid} ·{" "}
                {row.amendmentOfCaseId ? "amendment · " : ""}
                {row.stage}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="payroll-calculator__actions">
        <button
          type="button"
          className="btn btn--accent"
          disabled={
            !canWrite || !employeeId || !employees.ready || !cases.ready
          }
          onClick={() => setEditor("new")}
        >
          Start guided ROE case
        </button>
        <button
          type="button"
          className="btn"
          disabled={!canExport || !cases.ready}
          onClick={csv}
        >
          Export ROE workflow CSV
        </button>
      </div>
      {(!employees.ready || !cases.ready) && !cases.error && (
        <p role="status">Loading complete ROE workflow records…</p>
      )}
      {cases.error && <p role="alert">{cases.error}</p>}
      {editor && person ? (
        <PayrollRoeCaseForm
          key={`${editor}:${selected?._id ?? "new"}`}
          societyId={societyId}
          employee={person}
          today={cases.today}
          {...(editor === "edit" && selected ? { record: selected } : {})}
          {...(editor === "amend" && selected ? { parent: selected } : {})}
          onSaved={(id) => {
            setSelected(id);
            setEditor(null);
          }}
          onCancel={() => setEditor(null)}
        />
      ) : selected ? (
        <CaseDetail
          key={selected._id}
          societyId={societyId}
          row={selected}
          today={cases.today}
          canWrite={canWrite}
          canExport={canExport}
          onEdit={() => setEditor("edit")}
          onAmend={() => setEditor("amend")}
        />
      ) : (
        cases.ready && (
          <p>
            {cases.rows.length
              ? "Select a case to work through its next step."
              : "No ROE cases in this scope. Select an employee to start with the actual interruption facts."}
          </p>
        )
      )}
    </section>
  );
}
