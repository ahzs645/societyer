import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { money } from "../../../lib/format";

type GrantRef = { _id: string; title?: string; archivedAtISO?: string };

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Remove-a-grant dialog. Archiving is the default: it hides the grant from the
 * pipeline but keeps reports, ledger rows, journal lines and restricted funds.
 * Permanent deletion is only offered when no ledger history references the
 * grant (the server enforces the same rule), and it names everything it removes.
 */
export function GrantRemoveDialog({
  grant,
  onClose,
  onRemoved,
}: {
  grant: GrantRef | null;
  onClose: () => void;
  onRemoved?: (outcome: "archived" | "restored" | "deleted") => void;
}) {
  const toast = useToast();
  const impact = useQuery(api.grants.deletionImpact, grant ? { id: grant._id as any } : "skip");
  const setArchived = useMutation(api.grants.setArchived);
  const removeGrant = useMutation(api.grants.removeGrant);
  const [busy, setBusy] = useState<"archive" | "delete" | null>(null);
  const open = Boolean(grant);
  const title = grant?.title?.trim() || "Untitled grant";
  const archived = Boolean(impact?.archived ?? grant?.archivedAtISO);

  const run = async (kind: "archive" | "delete") => {
    if (!grant) return;
    setBusy(kind);
    try {
      if (kind === "archive") {
        await setArchived({ id: grant._id as any, archived: !archived });
        toast.success(archived ? "Grant restored" : "Grant archived", archived ? title : `${title} is hidden from the pipeline. Its ledger history is kept.`);
        onRemoved?.(archived ? "restored" : "archived");
      } else {
        await removeGrant({ id: grant._id as any });
        toast.success("Grant deleted", title);
        onRemoved?.("deleted");
      }
      onClose();
    } catch (error: any) {
      toast.error(kind === "archive" ? "Could not archive grant" : "Could not delete grant", error?.data?.message ?? error?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const loading = open && impact === undefined;
  const reports = impact?.reports ?? [];
  const canHardDelete = Boolean(impact?.canHardDelete);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={archived ? `Restore or delete "${title}"?` : `Archive or delete "${title}"?`}
      size="md"
      resizable={false}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy !== null}>Cancel</button>
          <button
            className="btn btn--danger"
            onClick={() => void run("delete")}
            disabled={loading || !canHardDelete || busy !== null}
            title={canHardDelete ? undefined : "Grants with ledger history can only be archived."}
          >
            <Trash2 size={12} /> Delete permanently
          </button>
          <button className="btn btn--accent" onClick={() => void run("archive")} disabled={loading || busy !== null} autoFocus>
            {archived ? <><ArchiveRestore size={12} /> Restore to pipeline</> : <><Archive size={12} /> Archive grant</>}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="muted">Checking what references this grant…</p>
      ) : impact === null ? (
        <p className="muted">This grant no longer exists.</p>
      ) : (
        <div className="confirm-body">
          <div className="confirm-icon confirm-icon--warn"><AlertTriangle /></div>
          <div>
            <p style={{ margin: "0 0 8px" }}>
              {archived
                ? "This grant is archived. Restoring it returns it to the grant pipeline."
                : <>Archiving hides <strong>{title}</strong> from the pipeline and keeps every report, ledger entry and restricted fund. You can restore it later.</>}
            </p>
            <ul style={{ margin: "0 0 8px", paddingLeft: 18 }} data-testid="grant-remove-impact">
              <li>{plural(reports.length, "grant report")}{reports.length ? `: ${reports.slice(0, 4).map((row: any) => row.title).join(", ")}${reports.length > 4 ? "…" : ""}` : ""}</li>
              <li>
                {plural(impact?.ledgerTransactionCount ?? 0, "restricted-fund ledger entry", "restricted-fund ledger entries")}
                {impact?.ledgerTransactionCount ? ` (${money(impact.ledgerAmountCents)})` : ""}
              </li>
              <li>{plural(impact?.journalLineCount ?? 0, "posted journal line")}</li>
              <li>
                {impact?.fundRestrictions?.length
                  ? `Restricted fund${impact.fundRestrictions.length === 1 ? "" : "s"}: ${impact.fundRestrictions.map((row: any) => row.name).join(", ")}`
                  : "No restricted fund"}
              </li>
              {impact?.applicationCount ? <li>{plural(impact.applicationCount, "linked application")} (kept, unlinked on delete)</li> : null}
              {impact?.employeeLinkCount ? <li>{plural(impact.employeeLinkCount, "funded-employee link")}</li> : null}
            </ul>
            {canHardDelete ? (
              <p className="muted" style={{ margin: 0 }}>
                Delete permanently removes the grant{reports.length ? ` and its ${plural(reports.length, "report")}` : ""}. This cannot be undone.
              </p>
            ) : (
              <p className="muted" style={{ margin: 0 }} role="note">
                Permanent deletion is unavailable: {impact?.blockers?.join(", ")} reference this grant. Archive it to keep the financial history intact.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
