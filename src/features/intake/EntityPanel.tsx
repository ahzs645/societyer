import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { UserCheck, Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { pluralize } from "../../lib/format";
import type { EntityGroup } from "../../../shared/intake/review";

/**
 * People panel: every name or role word written in the document, grouped,
 * with people-directory candidates (and office holders on the meeting date
 * for "the Chair", "Vice President"). One decision links or accepts the name
 * everywhere it occurs in the run's unpromoted documents.
 */
export function EntityPanel({ societyId, extractionId, readOnly, onLink, onAcceptAsWritten, onShow }: {
  societyId: string;
  extractionId: string;
  readOnly: boolean;
  onLink: (group: EntityGroup, personId: string, fullName: string) => void;
  onAcceptAsWritten: (group: EntityGroup) => void;
  onShow: (path: string) => void;
}) {
  const data = useQuery(api.intake.entityCandidates, { societyId, extractionId }) as { directoryReadable: boolean; directorySize: number; groups: EntityGroup[] } | undefined;
  if (!data) return <p className="muted" style={{ padding: 12 }}>Loading names…</p>;
  return (
    <div className="intake-fields" data-testid="intake-entities">
      {!data.directoryReadable && <p className="muted">Your role cannot read the people directory, so names can be accepted as written but not linked.</p>}
      {data.directoryReadable && !data.directorySize && <p className="muted">The people directory is empty. <Link to="/app/people-directory">Add people</Link> to link names to records.</p>}
      {!data.groups.length && <p className="muted">No names or role words were extracted from this document.</p>}
      {data.groups.map((group) => (
        <div key={group.key} className="intake-entity">
          <div className="intake-entity__head">
            <Users size={13} aria-hidden />
            <strong>{group.name}</strong>
            {group.roleWord && <span className="intake-chip intake-chip--inferred">role word</span>}
            <span className={`intake-chip intake-chip--${group.status === "matched" ? "high" : group.status === "ambiguous" ? "mid" : "low"}`}>{group.status}</span>
            <span className="muted" style={{ fontSize: 11 }}>{pluralize(group.occurrences.length, "occurrence")} here</span>
          </div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {group.occurrences.slice(0, 6).map((occurrence) => (
              <button key={occurrence.path} type="button" className="intake-locator" onClick={() => onShow(occurrence.path)}>{occurrence.path}</button>
            ))}
            {group.occurrences.length > 6 && <span className="muted">+{group.occurrences.length - 6}</span>}
          </div>
          {group.candidates.length > 0 && (
            <div className="intake-entity__candidates">
              {group.candidates.map((candidate) => (
                <div key={candidate.personId} className="intake-entity__candidate">
                  <span><strong>{candidate.fullName}</strong> <span className="muted">· {Math.round(candidate.score * 100)}% · {candidate.reason}</span></span>
                  {!readOnly && <button type="button" className="btn btn--sm" onClick={() => onLink(group, candidate.personId, candidate.fullName)}><UserCheck size={12} /> Link all occurrences</button>}
                </div>
              ))}
            </div>
          )}
          {!readOnly && <div><button type="button" className="btn btn--sm btn--ghost" onClick={() => onAcceptAsWritten(group)}>Accept as written everywhere</button></div>}
        </div>
      ))}
    </div>
  );
}
