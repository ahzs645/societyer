import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Archive, ArchiveRestore, FileUp, Link2, Pencil, RefreshCw, Scale, Unplug } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { MenuSection } from "../../../components/Menu";
import { useConfirm, usePrompt } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { errorMessage, type BankAccountRow } from "./types";

/**
 * The actions menu for an account on the Accounts page: rename, last four
 * digits, ledger link, CSV import, Wave sync or reconnect, reconcile, archive.
 */
export function useAccountMenu({ canWrite, onLink, onImport }: { canWrite: boolean; onLink: (row: BankAccountRow) => void; onImport: (row: BankAccountRow) => void }) {
  const updateAccount = useMutation(api.bankAccounts.updateAccount);
  const setArchived = useMutation(api.bankAccounts.setArchived);
  const sync = useAction(api.financialHub.sync);
  const prompt = usePrompt();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);

  const rename = async (row: BankAccountRow) => {
    const name = await prompt({ title: "Rename account", message: "The name shown in lists, reconciliations and statements.", defaultValue: row.name, confirmLabel: "Rename", required: true });
    if (!name || name.trim() === row.name) return;
    try {
      await updateAccount({ id: row._id, name: name.trim() });
      toast.success("Account renamed");
    } catch (error: unknown) {
      toast.error("Could not rename the account", errorMessage(error));
    }
  };

  const editLastFour = async (row: BankAccountRow) => {
    const value = await prompt({ title: "Account details", message: "The last four digits of the account or card number, shown beside its name.", defaultValue: row.lastFour ?? "", placeholder: "1234", confirmLabel: "Save" });
    if (value == null) return;
    try {
      await updateAccount({ id: row._id, lastFour: value.trim() });
      toast.success("Account details saved");
    } catch (error: unknown) {
      toast.error("Could not save the details", errorMessage(error));
    }
  };

  const archive = async (row: BankAccountRow, archived: boolean) => {
    if (archived) {
      const ok = await confirm({
        title: `Archive ${row.name}?`,
        message: "It leaves the Accounts page and reconciliation pickers. Its transactions, statements and ledger history stay.",
        confirmLabel: "Archive",
        tone: "warn",
      });
      if (!ok) return;
    }
    try {
      await setArchived({ id: row._id, archived });
      toast.success(archived ? "Account archived" : "Account restored");
    } catch (error: unknown) {
      toast.error(archived ? "Could not archive the account" : "Could not restore the account", errorMessage(error));
    }
  };

  const syncNow = async (connectionId: string) => {
    setSyncing(true);
    try {
      await sync({ connectionId });
      toast.success("Sync started", "New Wave transactions appear here as they arrive.");
    } catch (error: unknown) {
      toast.error("Could not sync", errorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  const menuFor = (row: BankAccountRow): MenuSection[] => [
    {
      id: "edit",
      items: [
        { id: "rename", label: "Rename", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => void rename(row) },
        { id: "details", label: "Edit last four digits", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => void editLastFour(row) },
        { id: "ledger", label: "Link to ledger account", icon: <Link2 size={14} />, disabled: !canWrite, onSelect: () => onLink(row) },
      ],
    },
    {
      id: "feed",
      items: [
        { id: "import", label: "Import CSV", icon: <FileUp size={14} />, disabled: !canWrite || row.archived, onSelect: () => onImport(row) },
        ...(row.source === "wave" && row.connectionId
          ? row.connectionStatus === "connected"
            ? [{ id: "sync", label: "Sync now", icon: <RefreshCw size={14} />, disabled: !canWrite || syncing, onSelect: () => void syncNow(row.connectionId!) }]
            : [{ id: "reconnect", label: "Reconnect Wave", icon: <Unplug size={14} />, disabled: !canWrite, onSelect: () => navigate("/app/financials") }]
          : []),
        { id: "reconcile", label: "Reconcile", icon: <Scale size={14} />, onSelect: () => navigate(`/app/reconciliation?account=${encodeURIComponent(row._id)}`) },
      ],
    },
    {
      id: "archive",
      items: [
        row.archived
          ? { id: "restore", label: "Restore", icon: <ArchiveRestore size={14} />, disabled: !canWrite, onSelect: () => void archive(row, false) }
          : { id: "archive", label: "Archive", icon: <Archive size={14} />, destructive: true, disabled: !canWrite, onSelect: () => void archive(row, true) },
      ],
    },
  ];

  return menuFor;
}
