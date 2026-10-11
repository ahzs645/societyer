/**
 * P15: build pending committee rosters from imported roster sheets
 * (organization-seat observations). Previews first, then applies on confirm.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useConfirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";

export function BuildRostersButton({ societyId, disabled, createMissingCommittees = true, label = "Build rosters from roster sheets…" }: { societyId: string; disabled?: boolean; createMissingCommittees?: boolean; label?: string }) {
  const build = useMutation(api.committees.buildRostersFromSeats);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const preview: any = await build({ societyId, dryRun: true, createMissingCommittees });
      if (!preview.newMembers) {
        toast.info("Nothing to add", "Every roster observation is already on a committee roster, or no roster sheet matches a committee.");
        return;
      }
      const rows = (preview.committees as any[]).filter((c) => c.newMembers > 0 && (createMissingCommittees || !c.createsCommittee));
      const skipped = Object.entries(preview.skippedSheets ?? {}) as Array<[string, number]>;
      const approved = await confirm({
        title: "Add roster observations to committees?",
        message: (
          <>
            <p style={{ margin: "0 0 8px" }}>Each person on a roster sheet becomes a <strong>pending</strong> committee member, linked to the person chosen during identity review. Confirm each one on the committee page.</p>
            <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
              {rows.map((c) => (
                <li key={c.committeeId ?? c.sheet}>
                  {c.committeeName}{c.createsCommittee ? " (new committee, status Needs review)" : ""}: {c.newMembers} member{c.newMembers === 1 ? "" : "s"}{c.linkedToPeople ? `, ${c.linkedToPeople} linked to a person` : ""}
                </li>
              ))}
            </ul>
            {skipped.length > 0 && <p className="muted" style={{ margin: 0 }}>Not committees (left out): {skipped.map(([sheet, n]) => `${sheet} (${n})`).join(", ")}. Board rosters can be promoted from the Directors page.</p>}
          </>
        ),
        confirmLabel: "Add to rosters",
      });
      if (!approved) return;
      const result: any = await build({ societyId, dryRun: false, createMissingCommittees });
      toast.success("Rosters built", `${result.newMembers} pending committee members`);
    } catch (error) {
      toast.error("Could not build rosters", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn-action" disabled={disabled || busy} onClick={run}>
      <Users size={12} /> {busy ? "Checking…" : label}
    </button>
  );
}
