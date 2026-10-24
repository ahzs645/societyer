import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { triggerBlobDownload } from "../../lib/zip";
import {
  REMITTANCE_CHANNEL_LABELS,
  REMITTANCE_OFFICIAL_SOURCES,
  type RemittancePlan,
} from "../../../shared/payrollRemittance";
import { payrollFailure, PayrollQueryBoundary } from "./payrollUi";
import {
  LegacyRemittanceAccountForm,
  RemittancePlanForm,
  RemittanceReadinessForm,
  RemittanceSettlementForm,
} from "./PayrollRemittanceForms";
import "./payroll-remittance.scss";
const money = (n: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    n / 100,
  );
function RemittanceList({
  societyId,
  collection,
  canWrite,
  onPrepare,
  onSelect,
  onConfirmLegacy,
}: {
  societyId: string;
  collection: "obligations" | "plans";
  canWrite: boolean;
  onPrepare: (id: string) => void;
  onSelect: (id: string) => void;
  onConfirmLegacy: (row: any) => void;
}) {
  const [cursors, setCursors] = useState<Array<string | null>>([null]),
    cursor = cursors[cursors.length - 1],
    data = useQuery(api.payrollRemittance.workspace, {
      societyId,
      collection,
      cursor,
    });
  return (
    <section
      className="card payroll-calculator__panel"
      aria-label={
        collection === "obligations" ? "CRA obligations" : "Remittance plans"
      }
    >
      <h3>
        {collection === "obligations"
          ? "CRA obligations"
          : "Saved remittance plans"}
      </h3>
      {!data ? (
        <p>Loading {collection}…</p>
      ) : (
        <>
          <p className="payroll-remittance__table-hint">
            Swipe the table horizontally for dates, balances and review actions.
          </p>
          <div
            className="payroll-calculator__table-wrap"
            role="region"
            aria-label={
              collection === "obligations"
                ? "CRA obligation table"
                : "Saved remittance plan table"
            }
            tabIndex={0}
          >
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col">
                    {collection === "obligations" ? "Due" : "Intended date"}
                  </th>
                  <th scope="col">Amount</th>
                  <th scope="col">
                    {collection === "obligations"
                      ? "Recorded / remaining"
                      : "Status"}
                  </th>
                  <th scope="col">Review</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r: any) => (
                  <tr key={r._id}>
                    <td>
                      {r.periodStart}–{r.periodEnd}
                    </td>
                    <td>
                      {r.dueDate ?? r.scheduledDate ?? "Schedule unconfirmed"}
                    </td>
                    <td>{money(r.amountDueCents ?? r.amountCents)}</td>
                    <td>
                      {collection === "obligations"
                        ? `${money(r.paidCents)} / ${money(Math.max(0, r.amountDueCents - r.paidCents))}`
                        : r.status.replaceAll("_", " ")}
                    </td>
                    <td>
                      {collection === "obligations" &&
                      r.legacyUnattributedPaid ? (
                        <button
                          className="btn btn--sm"
                          disabled={!canWrite}
                          onClick={() => onConfirmLegacy(r)}
                        >
                          Confirm historical CRA account
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={
                            collection === "obligations" &&
                            (!canWrite || r.amountDueCents <= r.paidCents)
                          }
                          onClick={() =>
                            collection === "obligations"
                              ? onPrepare(r._id)
                              : onSelect(r._id)
                          }
                        >
                          {collection === "obligations"
                            ? "Prepare payment plan"
                            : "Review plan"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.rows.length === 0 && <p>No {collection} in this page.</p>}
          <div className="payroll-calculator__actions">
            <button
              className="btn btn--sm"
              disabled={cursors.length === 1}
              onClick={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous {collection}
            </button>
            <span>
              Page {cursors.length} · {data.rows.length} visible
            </span>
            <button
              className="btn btn--sm"
              disabled={data.isDone}
              onClick={() => setCursors((old) => [...old, data.continueCursor])}
            >
              Next {collection}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
function RemittanceReview({
  societyId,
  id,
  canWrite,
  canExport,
  onClose,
  onEdit,
}: {
  societyId: string;
  id: string;
  canWrite: boolean;
  canExport: boolean;
  onClose: () => void;
  onEdit: (plan: RemittancePlan) => void;
}) {
  const data = useQuery(api.payrollRemittance.workspace, {
      societyId,
      collection: "plan",
      id,
    }),
    approve = useMutation(api.payrollRemittance.approve),
    exportInstructions = useMutation(
      api.payrollRemittance.recordPreparedExport,
    ),
    submit = useMutation(api.payrollRemittance.recordManualSubmission),
    reject = useMutation(api.payrollRemittance.reject),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reference, setReference] = useState(""),
    [settling, setSettling] = useState(false);
  async function action(kind: "approve" | "export" | "submit" | "reject") {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      const args = { societyId, id, expectedVersion: data.plan.version };
      if (kind === "approve") await approve(args);
      else if (kind === "submit") await submit({ ...args, reference });
      else if (kind === "reject") await reject({ ...args, reason: reference });
      else {
        const text = await exportInstructions(args);
        triggerBlobDownload(
          new Blob([text], { type: "text/plain;charset=utf-8" }),
          `CRA-remittance-${data.plan.source.periodStart}-instructions.txt`,
        );
      }
      setReference("");
    } catch (cause) {
      setError(payrollFailure(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <p>Loading retained remittance plan…</p>;
  const plan = data.plan as RemittancePlan,
    settled = data.settlements.reduce(
      (sum: number, s: any) => sum + s.amountCents,
      0,
    ),
    active = ["approved", "exported", "manual_submitted"].includes(plan.status);
  return (
    <section
      className="card payroll-calculator__panel"
      aria-label="Remittance plan review"
    >
      <div className="payroll-calculator__heading">
        <div>
          <h3>Review CRA remittance</h3>
          <p>
            {plan.source.periodStart}–{plan.source.periodEnd} · Version{" "}
            {plan.version} · <strong>{plan.status.replaceAll("_", " ")}</strong>
          </p>
        </div>
        <button className="btn btn--sm" onClick={onClose}>
          Close plan
        </button>
      </div>
      <dl>
        <dt>CRA payroll account</dt>
        <dd>{plan.source.payrollAccountNumber}</dd>
        <dt>Plan amount</dt>
        <dd>{money(plan.amountCents)}</dd>
        <dt>Recorded actual settlements</dt>
        <dd>{money(settled)}</dd>
        <dt>
          {plan.status === "rejected"
            ? "Released remaining commitment"
            : "Plan remaining"}
        </dt>
        <dd>{money(plan.amountCents - settled)}</dd>
        <dt>Due / intended payment</dt>
        <dd>
          {plan.source.dueDate} / {plan.scheduledDate}
        </dd>
        <dt>Payment channel</dt>
        <dd>{REMITTANCE_CHANNEL_LABELS[plan.channel]}</dd>
        <dt>Exact CRA destination</dt>
        <dd>{plan.destinationReference}</dd>
        <dt>Source bank</dt>
        <dd>
          {data.bank.name} · {data.bank.currency}
        </dd>
        {data.liabilityAccountName && (
          <>
            <dt>Reviewed source-deductions liability</dt>
            <dd>{data.liabilityAccountName}</dd>
          </>
        )}
        {data.employerExpenseAccountName && (
          <>
            <dt>Reviewed employer CPP / EI expense</dt>
            <dd>{data.employerExpenseAccountName}</dd>
          </>
        )}
        <dt>Approval</dt>
        <dd>{plan.approvedAtISO ?? "Awaiting review"}</dd>
      </dl>
      <p>
        Prepared instructions and external submission records do not establish
        withdrawal or CRA receipt. Only actual reconciled settlements reduce the
        obligation.
      </p>
      {plan.notes && <p>{plan.notes}</p>}
      <div className="payroll-calculator__actions">
        {plan.status === "draft" && (
          <>
            <button
              className="btn"
              disabled={!canWrite || busy}
              onClick={() => onEdit(plan)}
            >
              Revise remittance draft
            </button>
            <button
              className="btn btn--accent"
              disabled={!canWrite || busy}
              onClick={() => void action("approve")}
            >
              Approve remittance plan
            </button>
          </>
        )}
        {active && (
          <>
            <button
              className="btn"
              disabled={!canWrite || !canExport || busy}
              onClick={() => void action("export")}
            >
              Download prepared instructions
            </button>
            <button
              className="btn btn--accent"
              disabled={!canWrite || busy}
              onClick={() => setSettling(true)}
            >
              Reconcile actual payment
            </button>
          </>
        )}
      </div>
      {active && (
        <>
          <Field label="External submission reference or rejection reason">
            <input
              className="input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <div className="payroll-calculator__actions">
            <button
              className="btn"
              disabled={!canWrite || busy || !reference.trim()}
              onClick={() => void action("submit")}
            >
              Record manual submission
            </button>
            <button
              className="btn"
              disabled={!canWrite || busy || !reference.trim()}
              onClick={() => void action("reject")}
            >
              {settled
                ? "Cancel remaining plan"
                : "Reject / cancel unspent plan"}
            </button>
          </div>
        </>
      )}
      {plan.status === "draft" && (
        <>
          <Field label="Draft rejection reason">
            <input
              className="input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <button
            className="btn"
            disabled={!canWrite || busy || !reference.trim()}
            onClick={() => void action("reject")}
          >
            Reject draft plan
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {settling && canWrite && active && (
        <RemittanceSettlementForm
          key={`${id}:${plan.version}`}
          societyId={societyId}
          plan={plan}
          onSaved={() => setSettling(false)}
          onCancel={() => setSettling(false)}
        />
      )}
      <h4>Retained actual payments</h4>
      {data.settlements.length ? (
        <ul>
          {data.settlements.map((s: any) => (
            <li key={s._id}>
              {s.date} · {money(s.amountCents)} ·{" "}
              {s.transactionId ? "Matched bank outflow" : "CRA payment receipt"}
              {s.craConfirmationNumber
                ? ` · CRA confirmation ${s.craConfirmationNumber}`
                : " · CRA receipt date remains unconfirmed"}
              <p>{s.evidence}</p>
              <p>
                {s.journalEntryIds.length
                  ? "Ledger settlement retained"
                  : "No ledger posting recorded"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No actual payments recorded for this plan.</p>
      )}
      <details>
        <summary>Approval and activity history ({plan.history.length})</summary>
        <ol>
          {plan.history.map((event, index) => (
            <li key={`${event.atISO}:${index}`}>
              {event.action.replaceAll("_", " ")} · {event.atISO}
              {event.reference && ` · ${event.reference}`}
            </li>
          ))}
        </ol>
        <p>
          {plan.revisions.length} prior draft versions retained. Source
          fingerprint: {plan.sourceFingerprint}
        </p>
      </details>
    </section>
  );
}
function RemittanceWorkspace({ societyId }: { societyId: string }) {
  const permissions = usePermissions(),
    readiness = useQuery(
      api.payrollRemittance.workspace,
      permissions.loaded && permissions.can("financials:read")
        ? { societyId, collection: "readiness" }
        : "skip",
    ),
    [selected, setSelected] = useState(""),
    [prepare, setPrepare] = useState(""),
    [edit, setEdit] = useState<RemittancePlan>(),
    [setup, setSetup] = useState(false),
    [legacy, setLegacy] = useState<any>(null),
    [retry, setRetry] = useState(0),
    canWrite = permissions.can("financials:write");
  if (!permissions.loaded) return <p>Loading remittance permissions…</p>;
  if (!permissions.can("financials:read"))
    return (
      <p role="status">
        Financial read permission is required to review CRA remittances.
      </p>
    );
  return (
    <section
      aria-label="CRA remittances"
      className="payroll-calculator payroll-remittance"
    >
      <div className="payroll-calculator__heading">
        <div>
          <h2>CRA payroll remittances</h2>
          <p>
            Prepare and approve actual source-deduction obligations, then
            reconcile payments made through CRA, a bank or an approved service.
          </p>
        </div>
        <button
          className="btn"
          disabled={!canWrite}
          onClick={() => setSetup(true)}
        >
          Review automation readiness
        </button>
      </div>
      <p role="status">
        No bank debit connector is installed. Exporting instructions, recording
        a submission or saving readiness does not initiate or confirm a payment.
      </p>
      {!canWrite && (
        <p>
          Read-only financial access: preparation, approval and payment
          recording are disabled.
        </p>
      )}
      <details>
        <summary>What actual payment automation needs</summary>
        {readiness ? (
          <>
            <p>{readiness.explanation}</p>
            <ul>
              {readiness.gaps.map((gap: string) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>Loading reviewed requirements…</p>
        )}
        <p>
          CRA PAD requires at least five business days to create or modify an
          agreement. Bank bill payments may reach CRA the same or next business
          day; posting can take longer. Check the exact provider cutoff and
          verify CRA receipt by the remittance deadline. CRA’s EDI partner route
          requires a trading-partner contract, remittance-specific test files
          and production approval.
        </p>
        <ul>
          {REMITTANCE_OFFICIAL_SOURCES.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
        <p>
          The payroll register also maintains due-date reminders. Reminders do
          not release payment.
        </p>
      </details>
      {setup && readiness && canWrite && (
        <PayrollQueryBoundary
          key={`setup:${retry}`}
          label="Remittance readiness"
          onRetry={() => setRetry((n) => n + 1)}
        >
          <RemittanceReadinessForm
            societyId={societyId}
            initial={readiness.fields}
            onClose={() => setSetup(false)}
          />
        </PayrollQueryBoundary>
      )}
      {prepare && canWrite && (
        <PayrollQueryBoundary
          key={`prepare:${prepare}:${retry}`}
          label="Remittance source preview"
          onRetry={() => setRetry((n) => n + 1)}
        >
          <RemittancePlanForm
            key={`${prepare}:${edit?._id ?? "new"}`}
            societyId={societyId}
            obligationId={prepare}
            initial={edit}
            onCancel={() => {
              setPrepare("");
              setEdit(undefined);
            }}
            onSaved={(id) => {
              setSelected(id);
              setPrepare("");
              setEdit(undefined);
            }}
          />
        </PayrollQueryBoundary>
      )}
      {legacy && canWrite && (
        <LegacyRemittanceAccountForm
          key={legacy._id}
          societyId={societyId}
          obligation={legacy}
          onSaved={() => setLegacy(null)}
          onCancel={() => setLegacy(null)}
        />
      )}
      {selected && (
        <PayrollQueryBoundary
          key={`review:${selected}:${retry}`}
          label="Remittance plan"
          onRetry={() => setRetry((n) => n + 1)}
        >
          <RemittanceReview
            key={selected}
            societyId={societyId}
            id={selected}
            canWrite={canWrite}
            canExport={permissions.can("exports:download")}
            onClose={() => setSelected("")}
            onEdit={(plan) => {
              setPrepare(plan.obligationId);
              setEdit(plan);
              setSelected("");
            }}
          />
        </PayrollQueryBoundary>
      )}
      <RemittanceList
        key={`${societyId}:obligations`}
        societyId={societyId}
        collection="obligations"
        canWrite={canWrite}
        onPrepare={(id) => {
          setPrepare(id);
          setEdit(undefined);
        }}
        onSelect={setSelected}
        onConfirmLegacy={setLegacy}
      />
      <RemittanceList
        key={`${societyId}:plans`}
        societyId={societyId}
        collection="plans"
        canWrite={canWrite}
        onPrepare={setPrepare}
        onSelect={setSelected}
        onConfirmLegacy={setLegacy}
      />
    </section>
  );
}
export function PayrollRemittancePanel({ societyId }: { societyId: string }) {
  return <RemittanceWorkspace key={societyId} societyId={societyId} />;
}
