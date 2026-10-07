import { useState } from "react";
import { Wrench } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../../hooks/usePermissionedMutation";
import { usePermissions } from "../../../hooks/usePermissions";
import { Modal } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";

type RepairReport = {
  dryRun: boolean;
  meetingsScanned: number;
  minutesScanned: number;
  motionsRederived: number;
  motionsOutcomeTextKept: number;
  motionsUnrecognized: number;
  embeddedMotionsSynced: number;
  legacyEmbeddedCleared: number;
  sectionTitlesCleaned: number;
  agendaTitlesCleaned: number;
  meetingTitlesCleaned: number;
  meetingBodiesReclassified: number;
  committeesCreated: number;
  datePrecisionMarked: number;
  meetingTimesPlaced?: number;
  quorumFromSource: number;
  attendeesScreened: number;
  minutesWithAttendanceScreened: number;
  skippedApprovedMinutes: number;
  sameDayDuplicateGroups: number;
};

const ROWS: Array<[keyof RepairReport, string]> = [
  ["motionsRederived", "Motion outcomes re-derived from the source wording (e.g. “Passed” → Carried)"],
  ["embeddedMotionsSynced", "Motions moved from the retired embedded list into the motions register"],
  ["sectionTitlesCleaned", "Section titles with “| ” table artifacts cleaned"],
  ["agendaTitlesCleaned", "Agenda item titles with “| ” table artifacts cleaned"],
  ["meetingTitlesCleaned", "File-name or generic meeting titles replaced (originals kept as source titles)"],
  ["meetingBodiesReclassified", "Board-typed meetings moved to the committee their source names"],
  ["committeesCreated", "Committees created for those meetings"],
  ["datePrecisionMarked", "Meetings marked date-only (no invented 12:00 UTC time)"],
  ["meetingTimesPlaced", "Meetings given their stated local start time in the organization's time zone"],
  ["quorumFromSource", "Quorum recorded where the source states it (pending review)"],
  ["attendeesScreened", "Role words, organizations and headings removed from attendee lists (kept as evidence)"],
];

/** Settings-level action: preview, then apply the idempotent repair of data
 *  produced by earlier rule-based imports (minutes:repairImported). */
export function RepairImportedMinutesAction({ societyId }: { societyId: string }) {
  const { can } = usePermissions();
  const allowed = can("minutes:write") && can("meetings:write") && can("motions:write") && can("agendas:write");
  const repair = usePermissionedMutation(api.minutes.repairImported, allowed);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RepairReport | null>(null);
  const [applied, setApplied] = useState<RepairReport | null>(null);

  const startPreview = async () => {
    setOpen(true);
    setApplied(null);
    setPreview(null);
    setBusy(true);
    try {
      setPreview(await repair({ societyId, dryRun: true }));
    } catch (error: any) {
      toast.error(error?.message ?? "Could not preview the repair");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const result: RepairReport = await repair({ societyId });
      setApplied(result);
      toast.success("Imported minutes repaired", `${result.motionsRederived} motion outcomes, ${result.meetingTitlesCleaned} titles, ${result.quorumFromSource} quorum statements.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Repair failed");
    } finally {
      setBusy(false);
    }
  };
  const report = applied ?? preview;
  const total = report ? ROWS.reduce((sum, [key]) => sum + Number(report[key] ?? 0), 0) : 0;

  return (
    <>
      <button className="btn-action" onClick={startPreview} disabled={!allowed} data-testid="repair-imported-minutes">
        <Wrench size={12} /> Repair imported minutes
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={applied ? "Imported minutes repaired" : "Repair imported minutes"}
        size="md"
        // The report arrives after the dialog opens; a remembered/locked
        // height would clip it, so this dialog sizes to its content.
        resizable={false}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>{applied ? "Close" : "Cancel"}</button>
            {!applied && (
              <button className="btn btn--accent" onClick={apply} disabled={busy || !preview || total === 0} data-testid="repair-imported-minutes-apply">
                Apply repair
              </button>
            )}
          </>
        }
      >
        {busy && !report && <p className="muted">Checking meetings, minutes and motions…</p>}
        {report && (
          <div data-testid="repair-imported-minutes-report">
            <p>
              {applied
                ? "These corrections were applied. Running the repair again changes nothing."
                : total === 0
                  ? "Nothing to repair: imported meetings, minutes and motions already match the source rules."
                  : "The repair corrects data left by earlier rule-based imports. Original wording is kept in source fields and notes; adopted minutes are never changed."}
            </p>
            <table className="table" style={{ width: "100%" }}>
              <tbody>
                {ROWS.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}><strong>{Number(report[key] ?? 0)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8 }}>
              Scanned {report.meetingsScanned} meetings and {report.minutesScanned} minutes.
              {report.motionsUnrecognized ? ` ${report.motionsUnrecognized} motion outcome${report.motionsUnrecognized === 1 ? " is" : "s are"} not stated in a recognisable way and stay undecided for review.` : ""}
              {report.sameDayDuplicateGroups ? ` ${report.sameDayDuplicateGroups} date${report.sameDayDuplicateGroups === 1 ? " has" : "s have"} more than one meeting of the same body; review them for duplicates.` : ""}
              {report.skippedApprovedMinutes ? ` ${report.skippedApprovedMinutes} adopted minutes were left unchanged.` : ""}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
