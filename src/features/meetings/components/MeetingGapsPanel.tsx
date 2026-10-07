/**
 * Representation gaps for one meeting (WP-C A14 on the meeting page): source
 * details that Societyer could not hold natively for this meeting or its
 * minutes, with quick triage. Renders nothing when there are none.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { FileWarning } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "@/components/ui";
import { useSociety } from "@/hooks/useSociety";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { useToast } from "@/components/Toast";
import { GAP_REASON_LABELS, GAP_STATUS_LABELS, infoTypeDefinition } from "../../../../shared/gapCatalog";

export function MeetingGapsPanel({ meetingId, minutesId }: { meetingId: string; minutesId?: string }) {
  const society = useSociety();
  const { can } = usePermissions();
  const canRead = can("documents:read");
  const canWrite = can("documents:write");
  const forMeeting = useQuery(api.representationGaps.forRecord, society && canRead ? { societyId: society._id, affectedTable: "meetings", affectedId: String(meetingId) } : "skip") as any[] | undefined;
  const forMinutes = useQuery(api.representationGaps.forRecord, society && canRead && minutesId ? { societyId: society._id, affectedTable: "minutes", affectedId: String(minutesId) } : "skip") as any[] | undefined;
  const setStatus = usePermissionedMutation(api.representationGaps.setStatus, canWrite);
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const gaps = [...(forMeeting ?? []), ...(forMinutes ?? [])];
  if (!gaps.length) return null;
  const open = gaps.filter((gap) => gap.status === "open" || gap.status === "schema_change_requested");
  const shown = showAll ? gaps : open.length ? open : gaps;
  const visible = shown.slice(0, showAll ? 200 : 8);
  const triage = async (gap: any, status: string) => {
    try {
      await setStatus({ id: gap._id, status, note: "Triaged from the meeting page." });
      toast.success("Gap updated", GAP_STATUS_LABELS[status as keyof typeof GAP_STATUS_LABELS] ?? status);
    } catch (error: any) {
      toast.error("Could not update the gap", error?.message ?? String(error));
    }
  };
  return (
    <div className="card meeting-gaps-panel" data-testid="meeting-gaps-panel">
      <div className="card__head">
        <h2 className="card__title"><FileWarning size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Details not represented natively</h2>
        <span className="card__subtitle">{open.length} open · {gaps.length} total</span>
        <Link className="btn-action" style={{ marginLeft: "auto" }} to={`/app/coverage?tab=system&affectedTable=meetings&affectedId=${encodeURIComponent(String(meetingId))}`}>
          Open in Coverage &amp; gaps
        </Link>
      </div>
      <div className="card__body">
        <ul className="meeting-gaps-panel__list">
          {visible.map((gap) => (
            <li key={gap._id} className="meeting-gaps-panel__item">
              <div className="meeting-gaps-panel__head">
                <strong>{gap.title || infoTypeDefinition(gap.infoType).label}</strong>
                <Badge tone="neutral">{GAP_REASON_LABELS[gap.reason as keyof typeof GAP_REASON_LABELS] ?? gap.reason}</Badge>
                <Badge tone={gap.status === "open" ? "warn" : gap.status === "resolved_native" ? "success" : "neutral"}>{GAP_STATUS_LABELS[gap.status as keyof typeof GAP_STATUS_LABELS] ?? gap.status}</Badge>
              </div>
              {(gap.sourceTitle || gap.excerpt) && (
                <p className="muted meeting-gaps-panel__excerpt">
                  {gap.sourceTitle ? <em>{gap.sourceTitle}</em> : null}
                  {gap.sourceTitle && gap.excerpt ? " — " : ""}
                  {String(gap.excerpt ?? "").slice(0, 240)}{String(gap.excerpt ?? "").length > 240 ? "…" : ""}
                </p>
              )}
              {canWrite && gap.status === "open" && (
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn-action" onClick={() => { void triage(gap, "resolved_native"); }}>Now represented</button>
                  <button type="button" className="btn-action" onClick={() => { void triage(gap, "kept_as_text"); }}>Keep as text</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {shown.length > visible.length || (!showAll && gaps.length > shown.length) ? (
          <button type="button" className="btn-action" onClick={() => setShowAll(true)}>Show all {gaps.length}</button>
        ) : null}
      </div>
    </div>
  );
}
