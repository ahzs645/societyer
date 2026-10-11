import { useState } from "react";
import { useQuery } from "convex/react";
import { Archive, Loader2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { usePermissions } from "../../hooks/usePermissions";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";
import { formatDateTime, pluralize } from "../../lib/format";

const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Plan = {
  extractions: number;
  openExtractions: number;
  lastCompaction: null | { atISO: string; bytesFreed: number; reviewRowsFolded: number; reviewBatchRows: number; provenanceSlimmed: number; sessionRecordsRemoved: number; extractsRemoved: number };
  reviews: { rows: number; folded: number; batchRows: number; bytes: number };
  provenance: { rows: number; slimmable: number; bytes: number };
  sessions: { sessions: number; records: number; bytes: number };
  extracts: { total: number; removable: number; kept: number; bytes: number };
  rowsRemoved: number;
  bytesFreed: number;
  nothingToDo: boolean;
};

/**
 * "Compact this intake run": after review and promotion, fold per-field review rows into batch rows, stop
 * copying values into provenance rows, and remove staging the workspace no longer needs (applied import
 * records of promotion sessions, extracted text of files no open review uses). Originals, provenance and the
 * review audit stay. The plan is computed on request (it reads every extraction of the run).
 */
export function CompactRunPanel({ societyId, runId }: { societyId: string; runId: string }) {
  const { can } = usePermissions();
  const allowed = can("settings:write") && can("documents:write");
  const [requested, setRequested] = useState(false);
  const plan = useQuery(api.intake.compactionPlan, requested ? { societyId, runId } : "skip") as Plan | undefined;
  const compactRun = usePermissionedMutation(api.intake.compactRun, allowed);
  const confirm = useConfirm();
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);

  const run = async () => {
    if (!plan || plan.nothingToDo) return;
    const lost = [
      plan.extracts.removable ? `the extracted text and layout of ${pluralize(plan.extracts.removable, "file")} that no open review uses (the review screen's Text view for those files; promoted documents keep their text and saved originals stay)` : null,
      plan.sessions.records ? `${pluralize(plan.sessions.records, "staged copy", "staged copies")} of applied import records in ${pluralize(plan.sessions.sessions, "promotion session")} (each session keeps a summary of what was applied and where)` : null,
    ].filter(Boolean);
    const kept = [
      plan.reviews.folded ? `${plan.reviews.folded.toLocaleString()} per-field review rows become ${plan.reviews.batchRows.toLocaleString()} batch rows with the same decision, reviewer, time and note for every field` : null,
      plan.provenance.slimmable ? `${plan.provenance.slimmable.toLocaleString()} provenance rows stop copying values and quotes; View source reads them from the extraction` : null,
    ].filter(Boolean);
    const ok = await confirm({
      title: "Compact this intake run?",
      message: (
        <div className="col" style={{ gap: 8 }}>
          {lost.length > 0 && <p>This permanently removes {lost.join("; and ")}.</p>}
          {kept.length > 0 && <p>Kept, in less space: {kept.join("; ")}.</p>}
          <p>Originals, extractions, field provenance, review decisions, native records and the processing log are not removed. About {megabytes(plan.bytesFreed)} and {plan.rowsRemoved.toLocaleString()} records are freed.</p>
        </div>
      ),
      confirmLabel: "Compact run",
      tone: lost.length ? "danger" : "default",
    });
    if (!ok) return;
    try {
      let cursor: unknown = null;
      for (let step = 1; ; step++) {
        setProgress(`Compacting… step ${step}`);
        const result: any = await compactRun({ societyId, runId, cursor });
        if (result.done) {
          const totals = result.totals;
          toast.success("Intake run compacted", `${megabytes(totals.bytesFreed)} freed: ${pluralize(totals.reviewRowsFolded, "review row")} folded, ${pluralize(totals.provenanceSlimmed, "provenance row")} slimmed, ${pluralize(totals.sessionRecordsRemoved, "staged record")} and ${pluralize(totals.extractsRemoved, "extract")} removed.`);
          break;
        }
        cursor = result.cursor;
        setProgress(`Compacting… ${String(result.cursor.phase)} (${(result.totals.reviewRowsFolded + result.totals.provenanceSlimmed + result.totals.sessionRecordsRemoved + result.totals.extractsRemoved).toLocaleString()} records so far)`);
      }
    } catch (error) {
      toast.error("Could not compact the run", error instanceof Error ? error.message : undefined);
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="intake-compact" aria-labelledby={`compact-${runId}`} data-testid="intake-compact-panel">
      <h3 id={`compact-${runId}`} className="intake-compact__title"><Archive size={14} /> Storage</h3>
      {!requested && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted">After review and promotion, compact the run so the workspace and its backups stay small.</span>
          <button type="button" className="btn btn--sm" onClick={() => setRequested(true)}>Check what can be compacted</button>
        </div>
      )}
      {requested && plan === undefined && <p className="muted"><Loader2 size={12} className="spin" /> Measuring the run…</p>}
      {plan && (
        <div className="col" style={{ gap: 8 }}>
          {plan.lastCompaction && <p className="muted">Last compacted {formatDateTime(plan.lastCompaction.atISO)} ({megabytes(plan.lastCompaction.bytesFreed)} freed).</p>}
          {plan.nothingToDo ? (
            <p className="muted">Nothing to compact: review rows, provenance and staging are already compact.</p>
          ) : (
            <ul className="intake-compact__list">
              {plan.reviews.folded > 0 && <li>{plan.reviews.folded.toLocaleString()} per-field review rows → {plan.reviews.batchRows.toLocaleString()} batch rows</li>}
              {plan.provenance.slimmable > 0 && <li>{plan.provenance.slimmable.toLocaleString()} of {plan.provenance.rows.toLocaleString()} provenance rows read their value and quote from the extraction</li>}
              {plan.sessions.records > 0 && <li>{plan.sessions.records.toLocaleString()} staged copies of applied records in {pluralize(plan.sessions.sessions, "session")} removed</li>}
              {plan.extracts.removable > 0 && <li>Extracted text of {pluralize(plan.extracts.removable, "file")} removed; {pluralize(plan.extracts.kept, "file")} with an open review keep theirs ({pluralize(plan.openExtractions, "open document")})</li>}
              <li><strong>About {megabytes(plan.bytesFreed)} and {plan.rowsRemoved.toLocaleString()} records freed</strong></li>
            </ul>
          )}
          <div>
            <button type="button" className="btn btn--sm" onClick={() => void run()} disabled={!allowed || plan.nothingToDo || Boolean(progress)} data-testid="intake-compact-run">
              {progress ? <Loader2 size={12} className="spin" /> : <Archive size={12} />} {progress ?? "Compact this intake run…"}
            </button>
            {!allowed && <span className="muted"> Needs settings and documents write access.</span>}
          </div>
        </div>
      )}
    </section>
  );
}
