import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../../hooks/usePermissions";
import { relative } from "../../lib/format";

/**
 * Native coverage per AI intake run, for the Coverage & gaps page: documents
 * promoted, fields written with provenance, the run's native-coverage
 * estimate, and the system and record gaps it produced.
 */
export function IntakeRunCoverage({ societyId }: { societyId: string }) {
  const { can } = usePermissions();
  const runs = useQuery(api.intake.runSummaries, can("settings:read") ? { societyId } : "skip") as any[] | undefined;
  if (!can("settings:read")) return null;
  return (
    <section className="card" aria-labelledby="intake-run-coverage">
      <div className="card__head">
        <h2 className="card__title" id="intake-run-coverage"><Sparkles size={14} /> Native coverage per intake run</h2>
        <Link className="card__subtitle" to="/app/intake" style={{ marginLeft: "auto" }}>AI intake</Link>
      </div>
      {!runs && <div className="card__body muted">Loading…</div>}
      {runs && !runs.length && <div className="card__body muted">No AI intake runs yet. <Link to="/app/intake">Start one</Link> to turn source files into native records and gaps.</div>}
      {runs && runs.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Run</th><th>Documents promoted</th><th>Fields with provenance</th><th>Native coverage (reviewed)</th><th>Extractable coverage</th><th>System gaps</th><th>Record gaps</th></tr></thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td><Link to={`/app/intake/${run.runId}/review`}>{run.name}</Link><div className="muted" style={{ fontSize: 11 }}>{relative(run.createdAtISO)} · {run.status}</div></td>
                  <td className="mono">{run.promoted}/{run.extractions}{run.rejected ? ` (${run.rejected} rejected)` : ""}</td>
                  <td className="mono">{run.promotedFields}</td>
                  <td className="mono" title="Promoted fields ÷ extracted facts: what is native after review">{typeof run.promotedCoverage === "number" ? `${Math.round(run.promotedCoverage * 100)}%` : "—"}<div className="muted" style={{ fontSize: 11 }}>{run.promotedFields}/{run.extractedFields} facts</div></td>
                  <td className="mono" title="At extraction: native-mappable facts ÷ (native + system-gap + unresolved facts), before review">{typeof run.coverage?.coverage === "number" ? `${Math.round(run.coverage.coverage * 100)}%` : "—"}</td>
                  <td className="mono">{run.systemGaps === null ? "—" : <Link to="/app/coverage?tab=system">{run.systemGaps}</Link>}</td>
                  <td className="mono">{run.recordGaps ? <Link to={`/app/intake?run=${run.runId}`}>{run.recordGaps}</Link> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
