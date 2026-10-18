import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { useToast } from "../../../components/Toast";
import { dollarInputToCents } from "../../../lib/format";
import { todayDateOnly } from "../../../../shared/dateOnly";
import {
  claimPartyKey,
  claimSubmissionDecision,
  evaluateClaimPolicy,
  findLikelyDuplicate,
} from "../../../../shared/expensePolicy";
import { DuplicateNotice, ExceptionRequest } from "./ClaimChecks";
import { ReceiptDropZone } from "./ReceiptDropZone";
import { Segmented } from "../../../components/primitives";
import { mileageAmountCents, type ClaimType } from "../../../../shared/expensePolicy";
import { ClaimBudgetField, ClaimMileageFields, parseDistance } from "./ClaimMileageAndBudget";

export type ClaimEditorDraft = {
  id?: string;
  claimantName: string;
  claimantUserId: string;
  title: string;
  category: string;
  amountDollars: string;
  currency: string;
  incurredAtISO: string;
  submittedAtISO: string;
  status: string;
  receiptDocumentId: string;
  paymentReference: string;
  notes: string;
  /** Mileage claims are priced at the policy's rate per kilometre. */
  claimType?: ClaimType;
  distanceKm?: string;
  fromLocation?: string;
  toLocation?: string;
  tripDescription?: string;
  spendBudgetId?: string;
};

/**
 * The Treasurer dashboard's expense-claim editor: claim details, a receipt
 * drop zone, and — when the claim is being submitted — the claim policy
 * (with "Request an exception") and the soft duplicate check.
 */
export function ClaimEditorDrawer({
  draft,
  onChange,
  onClose,
  societyId,
  users,
  documents,
  claims,
  categories,
  statuses,
}: {
  draft: ClaimEditorDraft | null;
  onChange: (draft: ClaimEditorDraft) => void;
  onClose: () => void;
  societyId: string;
  users: readonly any[] | undefined;
  documents: readonly any[] | undefined;
  /** Every claim (expenseReports.list), for the duplicate check. */
  claims: readonly any[] | undefined;
  categories: readonly string[];
  statuses: readonly string[];
}) {
  const upsert = useMutation(api.expenseReports.upsert);
  const queue = useQuery(api.expenseReports.approvalQueue, draft ? { societyId: societyId as any } : "skip") as any;
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [submitTried, setSubmitTried] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const open = Boolean(draft);
  useEffect(() => {
    setExceptionReason("");
    setSubmitTried(false);
    setDuplicatePrompt(false);
    setDuplicateAcknowledged(false);
  }, [open, draft?.id]);

  const set = (patch: Partial<ClaimEditorDraft>) => {
    if (!draft) return;
    onChange({ ...draft, ...patch });
  };

  const isMileage = draft?.claimType === "mileage";
  const mileageRate = queue?.claimPolicy?.mileageRateCentsPerKm as number | null | undefined;
  const distance = parseDistance(draft?.distanceKm);
  const amountCents = isMileage ? (distance && mileageRate ? mileageAmountCents(distance, mileageRate) : 0) : dollarInputToCents(draft?.amountDollars) ?? 0;
  const storedStatus = draft?.id ? (claims ?? []).find((claim: any) => claim._id === draft.id)?.status : undefined;
  const submitting = Boolean(draft && draft.status === "Submitted" && storedStatus !== "Submitted");
  const policy = queue?.claimPolicy;
  const issues = useMemo(
    () => (draft && submitting && policy
      ? evaluateClaimPolicy(policy, { claimType: draft.claimType, amountCents, receiptDocumentId: draft.receiptDocumentId || null, notes: draft.notes, incurredAtISO: draft.incurredAtISO }, todayDateOnly())
      : []),
    [draft, submitting, policy, amountCents],
  );
  const duplicate = useMemo(() => {
    if (!draft || !(draft.claimantName || draft.claimantUserId)) return null;
    const candidates = (claims ?? [])
      .filter((claim: any) => !["Rejected", "Recalled"].includes(claim.status))
      .map((claim: any) => ({ _id: String(claim._id), partyKey: claimPartyKey(claim), amountCents: claim.amountCents ?? 0, date: String(claim.incurredAtISO ?? ""), title: String(claim.title ?? "") }));
    return findLikelyDuplicate(
      { _id: draft.id, partyKey: claimPartyKey({ claimantUserId: draft.claimantUserId || null, claimantName: draft.claimantName }), amountCents, date: draft.incurredAtISO },
      candidates,
    );
  }, [draft, claims, amountCents]);

  const save = async (duplicateOk = duplicateAcknowledged) => {
    if (!draft) return;
    if (submitting) {
      setSubmitTried(true);
      if (policy && !claimSubmissionDecision(policy, issues, exceptionReason).allowed) return;
      if (duplicate && !duplicateOk) {
        setDuplicatePrompt(true);
        return;
      }
    }
    setBusy(true);
    try {
      await upsert({
        id: draft.id as any,
        societyId: societyId as any,
        claimantName: draft.claimantName,
        claimantUserId: (draft.claimantUserId || undefined) as any,
        title: draft.title,
        category: draft.category,
        amountCents,
        currency: draft.currency || "CAD",
        incurredAtISO: draft.incurredAtISO,
        submittedAtISO: draft.submittedAtISO || undefined,
        status: draft.status,
        receiptDocumentId: (draft.receiptDocumentId || undefined) as any,
        paymentReference: draft.paymentReference || undefined,
        notes: draft.notes || undefined,
        policyExceptionReason: submitting && exceptionReason.trim() ? exceptionReason.trim() : undefined,
        claimType: isMileage ? "mileage" : undefined,
        mileage: isMileage
          ? { distanceKm: distance ?? 0, fromLocation: draft.fromLocation || undefined, toLocation: draft.toLocation || undefined, tripDescription: draft.tripDescription || undefined }
          : undefined,
        spendBudgetId: draft.spendBudgetId || undefined,
      });
      toast.success(
        submitting ? "Claim submitted for approval" : "Expense report saved",
        submitting && issues.length ? (exceptionReason.trim() ? "Approvers will see your exception request." : "Approvers will see that it misses the claim policy.") : undefined,
      );
      onClose();
    } catch (error: any) {
      toast.error("Could not save the claim", error?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={draft?.id ? "Edit expense report" : "New expense report"}
      className="claim-editor"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={busy || !draft?.title || !draft?.claimantName} onClick={() => void save()}>
            {submitting ? "Submit" : "Save"}
          </button>
        </>
      }
    >
      {draft && (
        <div className="claim-editor__body">
          <Field label="Claim type">
            <Segmented<ClaimType>
              value={draft.claimType ?? "expense"}
              onChange={(claimType) => set(claimType === "mileage" && !draft.title ? { claimType, category: categories.includes("Travel") ? "Travel" : draft.category, title: "Mileage" } : { claimType })}
              items={[{ id: "expense", label: "Expense" }, { id: "mileage", label: "Mileage" }]}
            />
          </Field>
          <Field label="Claim title">
            <input className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <div className="claim-editor__grid">
            <Field label="Claimant">
              <input className="input" value={draft.claimantName} onChange={(e) => set({ claimantName: e.target.value })} />
            </Field>
            <Field label="Linked user">
              <Select
                value={draft.claimantUserId ?? ""}
                onChange={(value) => {
                  const selected = (users ?? []).find((user: any) => user._id === value);
                  set({ claimantUserId: value, claimantName: selected?.displayName || draft.claimantName });
                }}
                options={[{ value: "", label: "No linked user" }, ...(users ?? []).map((user: any) => ({ value: user._id, label: user.displayName }))]}
              />
            </Field>
          </div>
          <div className="claim-editor__grid">
            <Field label="Category">
              <Select value={draft.category} onChange={(category) => set({ category })} options={categories.map((value) => ({ value, label: value }))} />
            </Field>
            <Field label="Status">
              <Select value={draft.status} onChange={(status) => set({ status })} options={statuses.map((value) => ({ value, label: value }))} />
            </Field>
          </div>
          {isMileage ? (
            <>
              <Field label="Trip date">
                <DatePicker value={draft.incurredAtISO} onChange={(incurredAtISO) => set({ incurredAtISO })} />
              </Field>
              <ClaimMileageFields
                value={{ distanceKm: draft.distanceKm ?? "", fromLocation: draft.fromLocation ?? "", toLocation: draft.toLocation ?? "", tripDescription: draft.tripDescription ?? "" }}
                rateCentsPerKm={mileageRate}
                onChange={set}
              />
            </>
          ) : (
            <div className="claim-editor__grid">
              <Field label="Amount">
                <input className="input" type="number" min="0" step="0.01" value={draft.amountDollars} onChange={(e) => set({ amountDollars: e.target.value })} />
              </Field>
              <Field label="Incurred date">
                <DatePicker value={draft.incurredAtISO} onChange={(incurredAtISO) => set({ incurredAtISO })} />
              </Field>
            </div>
          )}
          <ClaimBudgetField
            societyId={societyId}
            claimantUserId={draft.claimantUserId || undefined}
            incurredAtISO={draft.incurredAtISO}
            amountCents={amountCents}
            claimId={draft.id}
            value={draft.spendBudgetId ?? ""}
            onChange={(spendBudgetId) => set({ spendBudgetId })}
          />
          <Field label="Receipt document" hint={isMileage ? "Optional: mileage claims don't need a receipt." : "Link a document you already have, or upload the receipt below."}>
            <Select
              value={draft.receiptDocumentId ?? ""}
              onChange={(receiptDocumentId) => set({ receiptDocumentId })}
              options={[{ value: "", label: "No receipt linked" }, ...(documents ?? []).map((document: any) => ({ value: document._id, label: document.title }))]}
            />
          </Field>
          {!draft.receiptDocumentId && !isMileage && (
            <ReceiptDropZone
              societyId={societyId}
              claimTitle={draft.title}
              onUploaded={(receiptDocumentId) => {
                set({ receiptDocumentId });
                toast.success("Receipt uploaded", "It's linked to this claim and saved in Documents.");
              }}
            />
          )}
          <div className="claim-editor__grid">
            <Field label="Submitted date">
              <DatePicker value={draft.submittedAtISO ?? ""} onChange={(submittedAtISO) => set({ submittedAtISO })} />
            </Field>
            <Field label="Payment reference">
              <input className="input" value={draft.paymentReference ?? ""} onChange={(e) => set({ paymentReference: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <MarkdownEditor rows={4} value={draft.notes ?? ""} onChange={(notes) => set({ notes })} />
          </Field>

          {submitting && policy && (
            <ExceptionRequest issues={issues} enforcement={policy.enforcement} value={exceptionReason} onChange={setExceptionReason} showError={submitTried} />
          )}
          {duplicate && !duplicateAcknowledged && (
            <DuplicateNotice
              duplicate={duplicate}
              onView={() => {
                onClose();
                navigate(`/app/approvals?claim=${encodeURIComponent(duplicate._id)}`);
              }}
              onContinue={duplicatePrompt ? () => { setDuplicateAcknowledged(true); setDuplicatePrompt(false); void save(true); } : undefined}
              continueLabel="Submit anyway"
            />
          )}
        </div>
      )}
    </Drawer>
  );
}
