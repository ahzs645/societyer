/**
 * Source panel for a task that came from minutes (P4): the meeting it was
 * recorded at, every dated source observation (including folded
 * carried-forward copies), the owner as written, tags, and the
 * "not a verified current obligation" notice.
 */
import { Link } from "react-router-dom";
import { ArrowUpRight, History } from "lucide-react";
import { Badge } from "../../components/ui";
import { isHistoricalSourceAction, taskStatusLabel } from "../../../shared/taskStatus";

export function HistoricalActionSource({ task, meetingTitle, onPromote }: { task: any; meetingTitle?: string; onPromote?: () => void | Promise<void> }) {
  const historical = isHistoricalSourceAction(task);
  const observations: any[] = [...(task.sourceObservations ?? [])].sort((a, b) => String(a.observedDate ?? "").localeCompare(String(b.observedDate ?? "")));
  const first = observations[0]?.observedDate;
  const last = observations.at(-1)?.observedDate;
  return (
    <section className="card task-source" aria-label="Source of this task" style={{ marginBottom: 12 }}>
      <div className="card__head">
        <h3 className="card__title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <History size={13} /> {historical ? "Historical source action" : "Source"}
        </h3>
        {onPromote && (
          <button type="button" className="btn btn--sm" style={{ marginLeft: "auto" }} onClick={() => void onPromote()}>
            <ArrowUpRight size={12} /> Convert to current task
          </button>
        )}
      </div>
      <div className="card__body col" style={{ gap: 6, fontSize: "var(--fs-sm)" }}>
        {historical && (
          <p className="muted" style={{ margin: 0 }} role="note">
            Recorded in past minutes. Not a verified current obligation: the source does not say whether it was completed.
            Status: {taskStatusLabel(task.status)}.
          </p>
        )}
        {task.meetingId && (
          <div>
            Meeting: <Link to={`/app/meetings/${task.meetingId}?tab=minutes`}>{meetingTitle ?? "Open source meeting"}</Link>
          </div>
        )}
        {first && <div>Source date{first !== last ? "s" : ""}: {first}{last && last !== first ? ` – ${last}` : ""}{observations.length > 1 ? ` (${observations.length} observations)` : ""}</div>}
        {task.sourceAssignee && <div>Owner as written: <strong>{task.sourceAssignee}</strong></div>}
        {!!task.mergedExternalActionIds?.length && <div>Includes {task.mergedExternalActionIds.length} carried-forward cop{task.mergedExternalActionIds.length === 1 ? "y" : "ies"} from later minutes.</div>}
        {!!task.tags?.length && (
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            {task.tags.map((tag: string) => <Badge key={tag}>{tag}</Badge>)}
          </div>
        )}
        {observations.length > 0 && (
          <details>
            <summary>Source observations ({observations.length})</summary>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {observations.map((o) => (
                <li key={o.id}>
                  {o.observedDate ?? "Date unknown"} · {o.rawStatus ?? "status not stated"}
                  {o.foldedFromTaskTitle && o.foldedFromTaskTitle !== task.title ? ` · “${o.foldedFromTaskTitle}”` : ""}
                  {" · "}
                  {o.sourceUrl ? <a href={o.sourceUrl} target="_blank" rel="noreferrer">{o.sourceReference ?? "Source"}</a> : o.sourceReference}
                  {o.meetingId && o.meetingId !== task.meetingId && <> · <Link to={`/app/meetings/${o.meetingId}?tab=minutes`}>meeting</Link></>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
