import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { FileUp } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useCurrentUserId } from "../../../hooks/useCurrentUser";
import { Drawer } from "../../../components/ui";
import { Money } from "../../../components/Money";
import { useToast } from "../../../components/Toast";
import { formatDate, pluralize } from "../../../lib/format";
import { parseBankCsv, type ParsedCsvRow } from "../../../lib/bankCsv";
import { errorMessage, type BankAccountRow } from "./types";

/**
 * Import a bank or card statement CSV into one account, through the same
 * parser and import as the Transactions tab (deduplicated per account, rules
 * applied to new lines).
 */
export function AccountCsvImportDrawer({ account, societyId, onClose }: { account: BankAccountRow | null; societyId: string; onClose: () => void }) {
  const importCsv = useMutation(api.financialHub.importBankCsvTransactions);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [rows, setRows] = useState<ParsedCsvRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRows(null);
    setFileName(null);
  }, [account?._id]);

  const onFile = async (file: File) => {
    setFileName(file.name);
    try {
      const parsed = parseBankCsv(await file.text());
      setRows(parsed);
      if (!parsed.length) toast.warn("No rows found", "The CSV needs date, description and amount (or debit and credit) columns.");
    } catch (error: unknown) {
      setRows(null);
      toast.error("Could not read the CSV", errorMessage(error));
    }
  };

  const run = async () => {
    if (!account || !rows?.length) return;
    setBusy(true);
    try {
      const result = await importCsv({ societyId, accountId: account._id, rows, actingUserId });
      toast.success(
        `Imported ${pluralize(result.inserted, "transaction")}`,
        [result.skipped ? `${pluralize(result.skipped, "duplicate")} skipped` : "", result.categorized ? `${result.categorized} categorised by rules` : ""].filter(Boolean).join(" · ") || undefined,
      );
      onClose();
    } catch (error: unknown) {
      toast.error("Import failed", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const total = (rows ?? []).reduce((sum, row) => sum + row.amountCents, 0);
  const dates = (rows ?? []).map((row) => row.date).sort();
  return (
    <Drawer
      open={Boolean(account)}
      onClose={onClose}
      title={account ? `Import CSV into ${account.name}` : "Import CSV"}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={busy || !rows?.length} onClick={() => void run()}>
            Import {rows?.length ? pluralize(rows.length, "row") : ""}
          </button>
        </>
      }
    >
      <p className="muted bank-account-drawer__intro">
        Download the statement from your bank as CSV. Lines already imported into this account are skipped, and your
        categorisation rules run on the new ones.
      </p>
      <label className="btn btn--sm bank-csv-import__file">
        <FileUp size={12} aria-hidden="true" /> {fileName ? "Choose another file" : "Choose CSV file"}
        <input
          className="bank-csv-import__file-input"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {fileName && rows && rows.length > 0 && (
        <dl className="bank-csv-summary">
          <div><dt>File</dt><dd>{fileName}</dd></div>
          <div><dt>Rows</dt><dd>{rows.length}</dd></div>
          <div><dt>Dates</dt><dd>{formatDate(dates[0])} – {formatDate(dates[dates.length - 1])}</dd></div>
          <div><dt>Net</dt><dd><Money cents={total} signDisplay="exceptZero" /></dd></div>
        </dl>
      )}
    </Drawer>
  );
}
