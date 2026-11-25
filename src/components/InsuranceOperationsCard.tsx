import { Link } from "react-router-dom";
import { insuranceAmount } from "../../shared/insuranceRegister";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/Toast";
import { formatDate } from "@/lib/format";
import { InsuranceDialogAction } from "../features/insurance/InsuranceDialogAction";
import { EvidenceRowsEditor, type EvidenceColumn } from "./EvidenceRowsEditor";
import {
  insuranceBalances,
  requirementResult,
} from "../../shared/insuranceOperations";
import { todayDateOnly } from "../../shared/dateOnly";
const baseEvidence: EvidenceColumn[] = [
  { key: "observedDate", label: "Evidence day", type: "date" },
  { key: "sourceUrl", label: "Source URL" },
  { key: "sourceReference", label: "Page / row citation" },
  {
    key: "reviewStatus",
    label: "Review",
    options: ["pending", "verified", "rejected"],
  },
];
export function InsuranceOperationsCard({ policy }: { policy: any }) {
  const { can } = usePermissions();
  const toast = useToast();
  const save = useMutation(api.insurance.appendOperations);
  const scan = useMutation(api.insurance.ensureRenewalTasks);
  const documents = useQuery(
    api.documents.listSummaries,
    can("documents:read") ? { societyId: policy.societyId } : "skip",
  );
  const linked = (documents ?? []).filter((doc: any) =>
    policy.sourceDocumentIds?.includes(doc._id),
  );
  const evidence: EvidenceColumn[] = [
    {
      key: "sourceDocumentId",
      label: "Workspace document",
      choices: (documents ?? []).map((doc: any) => ({
        value: doc._id,
        label: doc.title,
      })),
    },
    ...baseEvidence,
  ];
  const [entries, setEntries] = useState<any[]>([]),
    [amendments, setAmendments] = useState<any[]>([]),
    [checks, setChecks] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  const recorded =
    (policy.moneyEntries?.length ?? 0) +
    (policy.requirementChecks?.length ?? 0) +
    (policy.amendments?.length ?? 0);
  return (
    <section className="card insurance-operations">
      <div className="card__head"><h2 className="card__title">Invoices, payments and amendments</h2>
        <span className="card__subtitle">{recorded} recorded</span>
      </div>
      <div className="card__body"><InsuranceDialogAction label="View entries" title="Invoices, payments and amendments">
      <div className="card__body col" style={{ gap: 12 }}>
        {linked.length > 0 && (
          <div>
            <strong>Linked originals</strong>
            <ul>
              {linked.map((doc: any) => (
                <li key={doc._id}>
                  <Link to={`/app/documents/${doc._id}`}>{doc.title}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {insuranceBalances(policy.moneyEntries ?? []).map((row) => (
          <p key={row.currency}>
            {row.currency}: outstanding{" "}
            {row.outstandingCents == null
              ? "unknown"
              : insuranceAmount(row.outstandingCents, row.currency)}
            ; claim cost{" "}
            {row.claimCostCents == null
              ? "unknown"
              : insuranceAmount(row.claimCostCents, row.currency)}
            , recoveries{" "}
            {row.recoveryCents == null
              ? "unknown"
              : insuranceAmount(row.recoveryCents, row.currency)}
          </p>
        ))}
        {(policy.moneyEntries ?? []).map((row: any) => (
          <p key={row.id}>
            {formatDate(row.observedDate)} · {row.kind} {row.reference} ·{" "}
            {insuranceAmount(row.amountCents, row.currency)}
            {row.itemNumber && ` · Item ${row.itemNumber}`}
            {row.dueDate && ` · Due ${formatDate(row.dueDate)}`} ·{" "}
            {row.reviewStatus} ·{" "}
            {row.sourceDocumentId ? (
              <Link to={`/app/documents/${row.sourceDocumentId}`}>
                {row.sourceReference}
              </Link>
            ) : row.sourceUrl ? (
              <a href={row.sourceUrl}>{row.sourceReference}</a>
            ) : (
              row.sourceReference
            )}
          </p>
        ))}
        {(policy.requirementChecks ?? []).map((row: any) => (
          <p key={row.id}>
            {row.context}: {requirementResult(row)}
          </p>
        ))}
        <EvidenceRowsEditor
          title="Append invoice / payment / claim observations"
          rows={entries}
          onChange={setEntries}
          disabled={!can("financials:write") || busy}
          columns={[
            {
              key: "kind",
              label: "Entry kind",
              options: [
                "invoice",
                "payment",
                "refund",
                "credit",
                "claim_cost",
                "recovery",
              ],
            },
            {
              key: "amountCents",
              label: "Amount in cents (blank = unknown)",
              type: "number",
            },
            { key: "currency", label: "Currency" },
            { key: "reference", label: "Invoice / payment / claim reference" },
            { key: "itemNumber", label: "Invoice item number" },
            { key: "dueDate", label: "Invoice due date", type: "date" },
            ...evidence,
          ]}
        />
        <EvidenceRowsEditor
          title="Append dated policy amendments"
          rows={amendments}
          onChange={setAmendments}
          disabled={!can("financials:write") || busy}
          columns={[
            {
              key: "kind",
              label: "Amendment kind",
              options: ["cancellation", "endorsement", "reinstatement"],
            },
            { key: "notes", label: "Amended terms / reason" },
            ...evidence,
          ]}
        />
        <EvidenceRowsEditor
          title="Append evidence-backed requirement checks"
          rows={checks}
          onChange={setChecks}
          disabled={!can("financials:write") || busy}
          columns={[
            { key: "context", label: "Requirement context" },
            {
              key: "requiredLimitCents",
              label: "Required limit, cents",
              type: "number",
            },
            {
              key: "confirmedLimitCents",
              label: "Confirmed limit, cents",
              type: "number",
            },
            { key: "coverageSource", label: "Policy / endorsement clause" },
            ...evidence,
          ]}
        />
        <div className="insurance-operations__actions">
          <button
            className="btn-action"
            disabled={
              !can("financials:write") ||
              busy ||
              !(entries.length + amendments.length + checks.length)
            }
            onClick={async () => {
              setBusy(true);
              try {
                await save({
                  id: policy._id,
                  moneyEntries: entries,
                  amendments,
                  requirementChecks: checks,
                });
                setEntries([]);
                setAmendments([]);
                setChecks([]);
                toast.success("Insurance evidence appended");
              } catch (error: any) {
                toast.error(error.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Append policy evidence
          </button>
          <button
            className="btn-action"
            disabled={!can("tasks:write") || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await scan({
                  societyId: policy.societyId,
                  asOf: todayDateOnly(),
                });
                toast.success(
                  `${result.created} renewal review tasks created`,
                  `${result.overdue} current terms overdue`,
                );
              } catch (error: any) {
                toast.error(error.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create dated renewal review tasks
          </button>
        </div>
      </div>
      </InsuranceDialogAction></div>
    </section>
  );
}
