/**
 * P7: merge two directory profiles. The reviewer chooses which profile
 * survives; everything linked to the other one moves to it, the other name is
 * kept as an alias, and the merge is recorded so it can be undone.
 */
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Modal } from "../../components/Modal";
import { Checkbox } from "../../components/Controls";
import { useToast } from "../../components/Toast";

export type MergeCandidate = { id: string; fullName: string; occurrences?: number; observed?: string };

export function PersonMergeDialog({ societyId, people, reasons, onClose, onMerged }: { societyId: string; people: [MergeCandidate, MergeCandidate]; reasons?: string[]; onClose: () => void; onMerged?: (survivorId: string) => void }) {
  const merge = useMutation(api.personHistory.mergePeople);
  const toast = useToast();
  const [survivorId, setSurvivorId] = useState(people[0].id);
  const [keepAlias, setKeepAlias] = useState(true);
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const survivor = people.find((p) => p.id === survivorId)!;
  const merged = people.find((p) => p.id !== survivorId)!;
  return (
    <Modal
      open
      onClose={onClose}
      title="Merge duplicate profiles"
      size="md"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn--accent"
            disabled={busy || !rationale.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const result: any = await merge({ societyId, survivorId: survivor.id, mergedIds: [merged.id], rationale, keepNameAsAlias: keepAlias });
                const moved = result.merges?.[0]?.moved ?? 0;
                toast.success(`Merged into ${survivor.fullName}`, `${moved} linked record${moved === 1 ? "" : "s"} moved. You can undo this from the merge history.`);
                onMerged?.(survivor.id);
                onClose();
              } catch (e: any) {
                toast.error("Could not merge", e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Merging…" : `Merge into ${survivor.fullName}`}
          </button>
        </>
      }
    >
      {reasons?.length ? <p className="muted" style={{ marginTop: 0 }}>Why these were suggested: {reasons.join("; ")}.</p> : null}
      <fieldset style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Keep which profile?</legend>
        {people.map((p) => (
          <label key={p.id} className="row" style={{ gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
            <input type="radio" name="survivor" checked={survivorId === p.id} onChange={() => setSurvivorId(p.id)} />
            <span>
              <strong>{p.fullName}</strong>
              {p.occurrences !== undefined && <span className="muted"> · {p.occurrences} source observation{p.occurrences === 1 ? "" : "s"}</span>}
              {p.observed && <span className="muted"> · {p.observed}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <p style={{ marginTop: 0 }}>
        Everything linked to <strong>{merged.fullName}</strong> moves to <strong>{survivor.fullName}</strong>: source occurrences, dated history,
        contact details, attendance records, motions, tasks, committee and role registers, minutes and seat observations.
        The merged profile is kept as a pointer so old links still work.
      </p>
      <Checkbox checked={keepAlias} onChange={setKeepAlias} label={`Keep “${merged.fullName}” as an alias of ${survivor.fullName}`} />
      <label style={{ display: "block", marginTop: 12 }}>
        Why are these the same person?
        <input className="input" value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. same organization and role across 2016–2018 minutes; spelling differs" />
      </label>
    </Modal>
  );
}
