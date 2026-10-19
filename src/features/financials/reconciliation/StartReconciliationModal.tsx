import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../../components/Modal";
import { Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import { formatMoney, parseMoneyInput } from "../../../lib/money";
import type { ReconAccount } from "./types";

function lastDayOfMonth(dateOnly: string): string {
  const [y, m] = dateOnly.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** Start a statement reconciliation: statement end date, ending balance and an optional statement document. */
export function StartReconciliationModal({
  open,
  accounts,
  initialAccountId,
  initialEndDate,
  suggestedEndingCents,
  societyId,
  onClose,
  onStarted,
}: {
  open: boolean;
  accounts: ReconAccount[];
  initialAccountId?: string;
  /** Statement end date to start from, e.g. the end of the month chosen on the month strip. */
  initialEndDate?: string;
  /** The bank feed's balance on that date, offered as a starting point for the ending balance. */
  suggestedEndingCents?: number;
  societyId: string;
  onClose: () => void;
  onStarted: (periodId: string, accountId: string) => void;
}) {
  const startPeriod = useMutation(api.reconciliation.startPeriod);
  const documents = useQuery(api.documents.list, open ? { societyId: societyId as any } : "skip") as any[] | undefined;
  const toast = useToast();
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [opening, setOpening] = useState("");
  const [ending, setEnding] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const account = accounts.find((row) => row._id === accountId);
  const openPeriod = Boolean(account?.openPeriodId);

  useEffect(() => {
    if (!open) return;
    setAccountId(initialAccountId ?? accounts.find((row) => !row.openPeriodId)?._id ?? accounts[0]?._id ?? "");
  }, [open, initialAccountId, accounts]);

  useEffect(() => {
    if (!account) return;
    // An opening balance from the Accounts page seeds the first statement.
    const start = account.nextStartDate ?? account.suggestedStartDate ?? "";
    setStartDate(start);
    setEndDate(initialEndDate && (!start || initialEndDate >= start) ? initialEndDate : start ? lastDayOfMonth(start) : "");
    setOpening(account.needsOpeningBalance && account.suggestedOpeningBalanceCents !== undefined ? (account.suggestedOpeningBalanceCents / 100).toFixed(2) : "");
    setEnding(initialEndDate && suggestedEndingCents !== undefined ? (suggestedEndingCents / 100).toFixed(2) : "");
    setErrors({});
  }, [account?._id, account?.nextStartDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!accountId) next.account = "Choose an account.";
    if (openPeriod) next.account = "Finish or discard the open reconciliation for this account first.";
    if (account?.needsOpeningBalance && !startDate) next.startDate = "Enter the statement start date.";
    if (!endDate) next.endDate = "Enter the statement end date.";
    else if (startDate && endDate < startDate) next.endDate = "The end date must be on or after the start date.";
    const endingCents = parseMoneyInput(ending);
    if (endingCents === undefined) next.ending = "Enter the ending balance from the statement.";
    const openingCents = account?.needsOpeningBalance ? parseMoneyInput(opening || "0") : undefined;
    if (account?.needsOpeningBalance && openingCents === undefined) next.opening = "Enter the opening balance.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const id = await startPeriod({
        societyId: societyId as any,
        accountId: accountId as any,
        startDate: account?.needsOpeningBalance ? startDate : undefined,
        endDate,
        endingBalanceCents: endingCents!,
        openingBalanceCents: openingCents,
        statementDocumentId: (documentId || undefined) as any,
      });
      toast.success("Reconciliation started", `${account?.name}: ${formatDate(startDate)} to ${formatDate(endDate)}`);
      onStarted(String(id), accountId);
    } catch (error: any) {
      toast.error("Could not start the reconciliation", error?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start reconciliation"
      size="md"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={busy} onClick={() => void submit()}>Start reconciliation</button>
        </>
      }
    >
      <p className="muted recon-start__intro">Use the figures printed on the bank statement. You'll match its transactions next.</p>
      <Field label="Account" required error={errors.account}>
        <Select
          value={accountId}
          onChange={setAccountId}
          placeholder="Choose account"
          options={accounts.map((row) => ({ value: row._id, label: row.code ? `${row.code} · ${row.name}` : row.name, hint: row.openPeriodId ? "Has an open reconciliation" : undefined }))}
        />
      </Field>
      {account && (
        account.needsOpeningBalance ? (
          <div className="recon-start__row">
            <Field label="Statement start date" required error={errors.startDate}>
              <DatePicker value={startDate} onChange={setStartDate} clearable={false} />
            </Field>
            <Field label="Opening balance" hint="The balance at the start of this first statement." error={errors.opening}>
              <input className="input" inputMode="decimal" placeholder="$0.00" value={opening} onChange={(event) => setOpening(event.target.value)} />
            </Field>
          </div>
        ) : (
          <p className="recon-start__carry">
            Starts {formatDate(startDate)}, the day after the previous statement, with a beginning balance of{" "}
            <strong>{formatMoney(account.nextBeginningBalanceCents ?? 0)}</strong>.
          </p>
        )
      )}
      <div className="recon-start__row">
        <Field label="Statement end date" required error={errors.endDate}>
          <DatePicker value={endDate} onChange={setEndDate} min={startDate || undefined} clearable={false} />
        </Field>
        <Field label="Statement ending balance" required error={errors.ending} hint={initialEndDate && suggestedEndingCents !== undefined ? "Filled in from the bank feed. Check it against the statement." : undefined}>
          <input className="input" inputMode="decimal" placeholder="$0.00" value={ending} onChange={(event) => setEnding(event.target.value)} />
        </Field>
      </div>
      <Field label="Statement document" hint="Optional. Link the statement PDF from Documents.">
        <Select
          value={documentId}
          onChange={setDocumentId}
          clearable
          clearLabel="No document"
          placeholder="No document"
          searchable
          options={(documents ?? []).map((doc) => ({ value: doc._id, label: doc.title ?? doc.fileName ?? "Document" }))}
        />
      </Field>
    </Modal>
  );
}
