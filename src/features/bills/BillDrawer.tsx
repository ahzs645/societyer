import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Send, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import {
  BILL_TERMS,
  BILL_TERMS_LABEL,
  billSubmitProblem,
  dueDateForTerms,
  findDuplicateBill,
  normalizeBillTerms,
  type BillTerms,
} from "../../../shared/bills";
import { centsToInput } from "../businessRegisters/formHelpers";
import { BillDocumentDropZone } from "./BillDocumentDropZone";
import { BillLinesEditor, hasBadAmount, lineCents, newLine, type LineDraft } from "./BillLinesEditor";
import { VendorPicker, type PickerVendor } from "./VendorPicker";
import { errorMessage, type BillRow, type BillsWorkspace } from "./types";

type FormState = {
  vendorId: string;
  billNumber: string;
  billDate: string;
  terms: BillTerms;
  dueDate: string;
  notes: string;
  documentId: string;
  documentTitle: string;
  lines: LineDraft[];
};

function initialForm(bill: BillRow | null, today: string): FormState {
  if (!bill) {
    return {
      vendorId: "",
      billNumber: "",
      billDate: today,
      terms: "net_30",
      dueDate: dueDateForTerms(today, "net_30"),
      notes: "",
      documentId: "",
      documentTitle: "",
      lines: [newLine()],
    };
  }
  return {
    vendorId: bill.vendorId ?? "",
    billNumber: bill.billNumber ?? "",
    billDate: bill.billDate,
    terms: normalizeBillTerms(bill.terms),
    dueDate: bill.dueDate,
    notes: bill.notes ?? "",
    documentId: bill.documentId ?? "",
    documentTitle: bill.document?.title ?? "",
    lines: bill.lines.length
      ? bill.lines.map((line) => ({ key: line.key, accountId: line.accountId ?? "", memo: line.memo ?? "", fundRestrictionId: line.fundRestrictionId ?? "", amount: centsToInput(line.amountCents) }))
      : [newLine()],
  };
}

/**
 * Create or edit a bill: vendor (search or create), bill number, dates and
 * terms, lines with the account each cost goes to, notes and the bill file.
 * Save as a draft or send it for approval. A matching vendor + bill number is
 * flagged before saving.
 */
export function BillDrawer({
  open,
  onClose,
  societyId,
  workspace,
  bill,
  canWrite,
  onOpenBill,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  workspace: BillsWorkspace;
  /** null for a new bill. */
  bill: BillRow | null;
  canWrite: boolean;
  onOpenBill: (id: string) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const save = usePermissionedMutation(api.bills.upsert, canWrite);
  const submit = usePermissionedMutation(api.bills.submit, canWrite);
  const remove = usePermissionedMutation(api.bills.remove, canWrite);
  const upsertVendor = usePermissionedMutation(api.bills.upsertVendor, canWrite);
  const [form, setForm] = useState<FormState>(() => initialForm(bill, workspace.today));
  const [createdVendor, setCreatedVendor] = useState<PickerVendor | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(bill, workspace.today));
    setCreatedVendor(null);
    setTried(false);
    // Reset only when the drawer opens on another bill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bill?._id]);

  const vendors = useMemo<PickerVendor[]>(
    () => (createdVendor && !workspace.vendors.some((vendor) => vendor._id === createdVendor._id) ? [...workspace.vendors, createdVendor] : workspace.vendors),
    [workspace.vendors, createdVendor],
  );
  const accountOptions = workspace.accounts.expense.map((account) => ({ value: account._id, label: account.label }));
  const fundOptions = workspace.funds.map((fund) => ({ value: fund._id, label: fund.name }));
  const dueDate = dueDateForTerms(form.billDate, form.terms, form.dueDate);
  const badAmount = hasBadAmount(form.lines);
  const duplicate = findDuplicateBill(
    { _id: bill?._id, vendorId: form.vendorId || null, billNumber: form.billNumber },
    workspace.bills.map((row) => ({ ...row, lifecycle: row.lifecycle })),
  );
  const payloadLines = form.lines
    .filter((line) => line.accountId || line.memo.trim() || lineCents(line))
    .map((line) => ({
      key: line.key,
      accountId: (line.accountId || undefined) as Id<"financialAccounts"> | undefined,
      amountCents: lineCents(line),
      memo: line.memo.trim() || undefined,
      fundRestrictionId: (line.fundRestrictionId || undefined) as Id<"fundRestrictions"> | undefined,
    }));
  const submitProblem = billSubmitProblem({ vendorId: form.vendorId || null, billDate: form.billDate, dueDate, lines: payloadLines });
  const editable = !bill || bill.lifecycle === "draft" || bill.lifecycle === "awaiting_approval";
  const disabled = !canWrite || !editable || busy;

  const chooseVendor = (vendor: PickerVendor | null) => {
    setForm((current) => {
      const next = { ...current, vendorId: vendor?._id ?? "" };
      if (vendor?.defaultTerms && !bill) {
        next.terms = normalizeBillTerms(vendor.defaultTerms);
        next.dueDate = dueDateForTerms(current.billDate, next.terms);
      }
      // Lines without an account take the vendor's default account.
      if (vendor?.defaultAccountId) next.lines = current.lines.map((line) => (line.accountId ? line : { ...line, accountId: vendor.defaultAccountId! }));
      return next;
    });
  };

  const createVendor = async (name: string) => {
    try {
      const id = await upsertVendor({ societyId: societyId as Id<"societies">, name });
      const vendor: PickerVendor = { _id: String(id), name };
      setCreatedVendor(vendor);
      toast.success(`${name} added to vendors`, "Add contact and payment details from Vendors.");
      return vendor;
    } catch (error) {
      toast.error("Couldn't add the vendor", errorMessage(error));
      return undefined;
    }
  };

  const persist = async (send: boolean) => {
    setTried(true);
    if (badAmount) return;
    if (send && submitProblem) return;
    if (duplicate && !(await confirm({
      title: "This looks like a duplicate",
      message: <p>{duplicate.vendorName} bill {duplicate.billNumber} is already in Societyer. Save this one anyway?</p>,
      confirmLabel: "Save anyway",
      tone: "warn",
    }))) return;
    setBusy(true);
    try {
      const result = await save({
        ...(bill ? { id: bill._id as Id<"bills"> } : {}),
        societyId: societyId as Id<"societies">,
        billNumber: form.billNumber.trim() || undefined,
        vendorId: (form.vendorId || undefined) as Id<"accountingCounterparties"> | undefined,
        billDate: form.billDate,
        terms: form.terms,
        dueDate: form.terms === "custom" ? form.dueDate : undefined,
        lines: payloadLines,
        notes: form.notes.trim() || undefined,
        documentId: (form.documentId || undefined) as Id<"documents"> | undefined,
      });
      const id = String((result as { id: string }).id);
      if (send) {
        const submitted = (await submit({ id: id as Id<"bills"> })) as { requiredApprovals: number };
        toast.success("Sent for approval", `It needs ${submitted.requiredApprovals} approval${submitted.requiredApprovals === 1 ? "" : "s"} under your approval rules.`);
        onOpenBill(id);
      } else {
        toast.success(bill ? "Bill saved" : "Draft saved");
        onClose();
      }
    } catch (error) {
      toast.error(send ? "Couldn't send the bill for approval" : "Couldn't save the bill", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const deleteDraft = async () => {
    if (!bill) return;
    const ok = await confirm({ title: "Delete this draft?", message: <p>The draft is removed. An attached file stays in Documents.</p>, confirmLabel: "Delete draft", tone: "danger" });
    if (!ok) return;
    setBusy(true);
    try {
      await remove({ id: bill._id as Id<"bills"> });
      toast.success("Draft deleted");
      onClose();
    } catch (error) {
      toast.error("Couldn't delete the draft", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const title = bill ? (bill.vendorName ? `${bill.vendorName}${bill.billNumber ? ` · ${bill.billNumber}` : ""}` : bill.source === "upload" ? "Uploaded bill" : "Draft bill") : "New bill";
  const deletable = bill && bill.lifecycle === "draft" && !bill.submittedAtISO;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      size="wide"
      className="bill-editor"
      footer={
        <>
          {deletable && canWrite && (
            <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => void deleteDraft()} disabled={busy}>
              <Trash2 size={12} aria-hidden="true" /> Delete draft
            </button>
          )}
          <span className="register-drawer__spacer" />
          <button type="button" className="btn" onClick={onClose}>{canWrite && editable ? "Cancel" : "Close"}</button>
          {canWrite && editable && (
            <>
              <button type="button" className="btn" onClick={() => void persist(false)} disabled={disabled}>{bill?.lifecycle === "awaiting_approval" ? "Save changes" : "Save draft"}</button>
              {bill?.lifecycle !== "awaiting_approval" && (
                <button type="button" className="btn btn--accent" onClick={() => void persist(true)} disabled={disabled} title={submitProblem ?? undefined}>
                  <Send size={12} aria-hidden="true" /> Send for approval
                </button>
              )}
            </>
          )}
        </>
      }
    >
      {bill?.source === "upload" && bill.lifecycle === "draft" && !bill.vendorId && (
        <InspectorNote title="Fill in the bill">
          {bill.document?.title ?? "The file"} is attached. Societyer doesn't read bills automatically, so enter the vendor, number, dates and amounts from the file.
        </InspectorNote>
      )}
      {bill?.declinedReason && bill.lifecycle === "draft" && (
        <InspectorNote tone="warn" title={`Declined by ${bill.declinedByName ?? "an approver"}`}>{bill.declinedReason}</InspectorNote>
      )}
      {bill?.lifecycle === "awaiting_approval" && bill.approvals.length > 0 && (
        <InspectorNote tone="warn" title="Saving clears the approvals">Changes to a bill waiting for approval need fresh approvals.</InspectorNote>
      )}
      {duplicate && (
        <InspectorNote tone="warn" title="Possible duplicate">
          {duplicate.vendorName} bill {duplicate.billNumber} ({formatDate(duplicate.billDate)}) has the same number.{" "}
          <button type="button" className="link-button" onClick={() => onOpenBill(duplicate._id)}>Open it</button>
        </InspectorNote>
      )}

      <Field label="Vendor" required error={tried && !form.vendorId ? "Choose the vendor." : undefined}>
        <VendorPicker vendorId={form.vendorId} vendors={vendors} onChange={chooseVendor} onCreate={canWrite ? createVendor : undefined} disabled={disabled} />
      </Field>
      <div className="register-field-row">
        <Field label="Bill #" hint="The vendor's invoice number.">
          <input className="input" value={form.billNumber} onChange={(event) => setForm({ ...form, billNumber: event.target.value })} disabled={disabled} placeholder="e.g. INV-1042" />
        </Field>
        <Field label="Bill date" required>
          <DatePicker value={form.billDate} clearable={false} disabled={disabled} onChange={(value) => value && setForm({ ...form, billDate: value, dueDate: form.terms === "custom" ? form.dueDate : dueDateForTerms(value, form.terms) })} />
        </Field>
        <Field label="Terms">
          <Select<BillTerms>
            value={form.terms}
            onChange={(terms) => setForm({ ...form, terms, dueDate: terms === "custom" ? dueDate : dueDateForTerms(form.billDate, terms) })}
            options={BILL_TERMS.map((terms) => ({ value: terms, label: BILL_TERMS_LABEL[terms] }))}
            disabled={disabled}
          />
        </Field>
        <Field label="Due date" required>
          <DatePicker value={dueDate} clearable={false} min={form.billDate} disabled={disabled} onChange={(value) => value && setForm({ ...form, terms: "custom", dueDate: value })} />
        </Field>
      </div>

      <section className="bill-lines" aria-labelledby="bill-lines-title">
        <div className="bill-lines__head">
          <h3 id="bill-lines-title" className="claim-drawer__section-title">Lines</h3>
          <span className="muted bill-lines__hint">Each line goes to an expense or asset account; approving posts it against Accounts payable.</span>
        </div>
        <BillLinesEditor
          lines={form.lines}
          onChange={(lines: LineDraft[]) => setForm((current) => ({ ...current, lines }))}
          accountOptions={accountOptions}
          fundOptions={fundOptions}
          newLineAccountId={vendors.find((vendor) => vendor._id === form.vendorId)?.defaultAccountId ?? ""}
          disabled={disabled}
          showErrors={tried}
        />
        {tried && badAmount && <p className="field__error" role="alert">Check the amounts: one of them isn't a number.</p>}
        {tried && !badAmount && submitProblem && <p className="field__error" role="alert">{submitProblem}</p>}
      </section>

      <Field label="Notes">
        <textarea className="input textarea" rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={disabled} placeholder="Anything approvers should know" />
      </Field>

      <section className="claim-drawer__section" aria-labelledby="bill-document-title">
        <h3 id="bill-document-title" className="claim-drawer__section-title">Bill document</h3>
        {form.documentId ? (
          <p className="bill-document">
            <Link to={`/app/documents/${form.documentId}`}>{form.documentTitle || "Bill document"}</Link>
            {!disabled && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setForm({ ...form, documentId: "", documentTitle: "" })}>Remove from bill</button>
            )}
          </p>
        ) : (
          <BillDocumentDropZone
            societyId={societyId}
            label={[vendors.find((vendor) => vendor._id === form.vendorId)?.name, form.billNumber].filter(Boolean).join(" ")}
            disabled={disabled}
            onUploaded={(documentId, documentTitle) => setForm((current) => ({ ...current, documentId, documentTitle }))}
          />
        )}
      </section>
    </Drawer>
  );
}
