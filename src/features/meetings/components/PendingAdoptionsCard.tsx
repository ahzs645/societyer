import { useState } from "react";
import { BookCheck, Plus } from "lucide-react";
import { Badge } from "../../../components/ui";
import { RecordChip } from "../../../components/ui";
import { formatDate } from "../../../lib/format";

export type PendingAdoption = {
  minutesId: string;
  meetingId: string;
  meetingTitle: string;
  meetingType: string;
  scheduledAt: string;
  /** An adoption motion linking to these minutes already exists on the
   *  current meeting (pending or otherwise). */
  motionExists: boolean;
};

/**
 * "Minutes awaiting adoption" — prior meetings of the same category whose
 * minutes have no approvedAt yet, pulled live from the database. Handles the
 * missed-meeting case naturally: every outstanding set of minutes is listed,
 * not just the single most recent one. One click seeds a linked adoption
 * motion; carrying that motion stamps the minutes approved automatically.
 */
export function PendingAdoptionsCard({
  pending,
  onAddAdoptionMotion,
}: {
  pending: PendingAdoption[];
  onAddAdoptionMotion: (entry: PendingAdoption) => Promise<void> | void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!pending.length) return null;
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card__head">
        <h3 className="card__title" style={{ fontSize: "var(--fs-md)" }}>
          <BookCheck size={13} style={{ verticalAlign: -1, marginRight: 6 }} />
          Minutes awaiting adoption
        </h3>
        <span className="card__subtitle">
          {pending.length} prior meeting{pending.length === 1 ? "" : "s"} with unapproved minutes
        </span>
      </div>
      <div className="card__body">
        {pending.map((entry) => (
          <div key={entry.minutesId} className="meeting-conflict-row">
            <div className="meeting-conflict-row__main">
              <RecordChip
                to={`/app/meetings/${entry.meetingId}`}
                tone={entry.meetingType === "AGM" ? "purple" : "gray"}
                avatar={(entry.meetingType || "MT").slice(0, 2).toUpperCase()}
                label={<strong>{entry.meetingTitle}</strong>}
              />
              <span className="muted"> · {formatDate(entry.scheduledAt)}</span>
              <div className="meeting-conflict-row__badges">
                <Badge tone="warn">Not yet approved</Badge>
                {entry.motionExists && <Badge tone="info">Adoption motion on this agenda</Badge>}
              </div>
            </div>
            <div className="meeting-conflict-row__actions">
              {!entry.motionExists && (
                <button
                  className="btn-action"
                  type="button"
                  disabled={busyId === entry.minutesId}
                  onClick={async () => {
                    setBusyId(entry.minutesId);
                    try {
                      await onAddAdoptionMotion(entry);
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  <Plus size={12} /> {busyId === entry.minutesId ? "Adding…" : "Add adoption motion"}
                </button>
              )}
            </div>
          </div>
        ))}
        <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "8px 0 0" }}>
          Recording an adoption motion as Carried marks the linked minutes approved automatically.
        </p>
      </div>
    </div>
  );
}
