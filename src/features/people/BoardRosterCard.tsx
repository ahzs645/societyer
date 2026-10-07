/**
 * P16: board roster observations from source rosters, next to the director
 * register. Explains why the register can be empty while rosters exist, and
 * promotes an observation to a "Needs review" director entry on request.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";
import { Badge } from "../../components/ui";
import { sourceRoleLabel } from "../../../shared/personHistory";

const PAGE = 20;

export function BoardRosterCard({ societyId, activeDirectorCount }: { societyId: string; activeDirectorCount: number }) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const rows = useQuery(api.directors.rosterSuggestions, can("directors:read") && can("members:read") ? { societyId } : "skip") as any[] | undefined;
  const promote = useMutation(api.directors.promoteRosterObservation);
  const toast = useToast();
  const confirm = useConfirm();
  const [sheet, setSheet] = useState("");
  const [page, setPage] = useState(0);
  const sheets = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.sheet))).sort().reverse(), [rows]);
  if (!rows?.length) return null;
  const shown = rows.filter((r) => !sheet || r.sheet === sheet);
  const unregistered = rows.filter((r) => !r.directorId).length;
  return (
    <details className="card" style={{ marginBottom: 16 }} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card__head" style={{ cursor: "pointer" }}>
        <span className="card__title">Board rosters from source documents ({rows.length})</span>
        {unregistered > 0 && <Badge tone="warn">{unregistered} not on the register</Badge>}
      </summary>
      {open && (
        <div className="card__body col" style={{ gap: 8 }}>
          <p className="muted" style={{ margin: 0 }}>
            {activeDirectorCount === 0 ? "The director register is empty, but these source rosters list board members. " : ""}
            A roster shows who sat on the board when it was written; it does not prove an election, a term or consent.
            Add a person to the register as <strong>Needs review</strong>, then confirm the appointment and set them Active.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label>Roster{" "}
              <select className="input" value={sheet} onChange={(e) => { setSheet(e.target.value); setPage(0); }} aria-label="Roster sheet" style={{ width: "auto", display: "inline-block" }}>
                <option value="">All board rosters</option>
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Person</th><th>Role</th><th>Organization</th><th>Roster</th><th>Register</th><th /></tr></thead>
              <tbody>
                {shown.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                  <tr key={`${r.seatId}:${r.observationId}`}>
                    <td>{r.personId ? <Link to={`/app/people-directory/${r.personId}`}>{r.personFullName ?? r.personName}</Link> : r.personName}</td>
                    <td>{sourceRoleLabel(r.roleTitle)}</td>
                    <td className="muted">{r.organizationName}</td>
                    <td className="muted">{r.sheet} · {r.observedDate ?? "date unknown"} · {r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceReference}</a> : r.sourceReference}</td>
                    <td>{r.directorId ? <Badge tone={r.directorStatus === "Active" ? "success" : "warn"}>{r.directorStatus === "NeedsReview" ? "Needs review" : r.directorStatus}</Badge> : <span className="muted">Not listed</span>}</td>
                    <td>
                      {!r.directorId && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={!can("directors:write")}
                          onClick={async () => {
                            const ok = await confirm({ title: `Add ${r.personFullName ?? r.personName} to the director register?`, message: `The entry starts as “Needs review”, with term start ${r.termStart ?? r.observedDate ?? "unknown"} from the ${r.sheet} roster, no consent and no residency recorded. It does not count as an active director until you confirm it.`, confirmLabel: "Add as needs review" });
                            if (!ok) return;
                            try { await promote({ seatId: r.seatId, observationId: r.observationId }); toast.success("Added to the director register", "Status: Needs review"); }
                            catch (e: any) { toast.error("Could not add", e.message); }
                          }}
                        >
                          Add to register…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > PAGE && (
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <button type="button" className="btn btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="muted">Page {page + 1} of {Math.ceil(shown.length / PAGE)}</span>
              <button type="button" className="btn btn--sm" disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
