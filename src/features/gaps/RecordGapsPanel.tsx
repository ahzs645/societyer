import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui";
import { usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { usePermissions } from "../../hooks/usePermissions";
import type { ContinuityRow, CrossReferenceGap, RecordGap } from "../../../shared/continuity";
import { CROSS_REFERENCE_EXPECTATION_KEY } from "../../../shared/continuity";
import { SEVERITY_LABELS, SEVERITY_TONE, STATUS_META } from "./statusMeta";
import type { HeatmapSelect } from "./ContinuityHeatmap";

/** Record gaps by severity (statutory / bylaw / internal practice) plus cross-reference gaps. */
export function RecordGapsPanel({
  societyId,
  recordGaps,
  crossReferences,
  rows,
  onOpen,
}: {
  societyId: string;
  recordGaps: RecordGap[];
  crossReferences: CrossReferenceGap[];
  rows: ContinuityRow[];
  onOpen: HeatmapSelect;
}) {
  const [includeDraft, setIncludeDraft] = useState(false);
  const { can } = usePermissions();
  const canWrite = can("deadlines:write");
  const markPeriod = usePermissionedMutation(api.continuity.markPeriod, canWrite);
  const prompt = usePrompt();
  const toast = useToast();
  const visible = includeDraft ? recordGaps : recordGaps.filter((gap) => gap.status !== "draft_only");
  const groups = useMemo(() => {
    const out = new Map<string, RecordGap[]>();
    for (const gap of visible) out.set(gap.severity, [...(out.get(gap.severity) ?? []), gap]);
    return ["statutory", "bylaw", "practice"].filter((key) => out.has(key)).map((key) => ({ severity: key, gaps: out.get(key)! }));
  }, [visible]);
  const openCrossReferences = crossReferences.filter((gap) => gap.status === "record_missing");

  const open = (gap: RecordGap) => {
    const row = rows.find((candidate) => candidate.expectation.key === gap.expectationKey);
    const period = row?.periods.find((candidate) => candidate.periodKey === gap.periodKey);
    if (row && period) onOpen(row, [period]);
  };

  const markReference = async (gap: CrossReferenceGap, status: "never_held" | "not_applicable" | "cancelled") => {
    const reason = await prompt({
      title: `Referenced minutes of ${gap.referencedDate}`,
      message: status === "never_held" ? "Why is there no meeting for this date (for example: the reference is a typo for another date)?" : "Add a note (optional).",
      placeholder: "Reason",
      multiline: true,
      required: status === "never_held",
      confirmLabel: "Save",
    });
    if (reason === null) return;
    try {
      await markPeriod({ societyId, expectationKey: CROSS_REFERENCE_EXPECTATION_KEY, periodKey: gap.referencedDate, status, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      toast.success("Reference updated");
    } catch (error) {
      toast.error("Could not update the reference", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <label className="row" style={{ gap: 6, fontSize: 13 }}>
        <input type="checkbox" checked={includeDraft} onChange={(event) => setIncludeDraft(event.target.checked)} />
        Include draft or unapproved records ({recordGaps.filter((gap) => gap.status === "draft_only").length})
      </label>
      {!groups.length && <div className="muted">No record gaps in this range{includeDraft ? "" : " (draft-only records hidden)"}.</div>}
      {groups.map((group) => (
        <section key={group.severity} className="card">
          <div className="card__head">
            <h2 className="card__title">{SEVERITY_LABELS[group.severity] ?? group.severity}</h2>
            <span className="card__subtitle">{group.gaps.length} period{group.gaps.length === 1 ? "" : "s"}</span>
          </div>
          <div className="card__body">
            {group.gaps.map((gap) => {
              const meta = STATUS_META[gap.status];
              return (
                <div key={gap.key} className="coverage-gap-row">
                  <div>
                    <strong>{gap.bodyLabel}: {gap.title}</strong> — {gap.label}
                    <div className="coverage-gap-row__meta">
                      <Badge tone={meta.tone}>{meta.glyph} {meta.label}</Badge>
                      <Badge tone={SEVERITY_TONE[gap.severity] ?? "neutral"}>{SEVERITY_LABELS[gap.severity] ?? gap.severity}</Badge>
                      {gap.citation && <span className="muted">{gap.citation}</span>}
                    </div>
                    {gap.note && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{gap.note}</div>}
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => open(gap)}>Review</button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Referenced records that are missing</h2>
          <span className="card__subtitle">"Adopt the minutes of …" with no matching minutes · {openCrossReferences.length} open of {crossReferences.length}</span>
        </div>
        <div className="card__body">
          {!crossReferences.length && <div className="muted">Every "minutes of &lt;date&gt;" reference in your minutes matches a meeting with minutes.</div>}
          {crossReferences.map((gap) => {
            const meta = STATUS_META[gap.status];
            return (
              <div key={gap.key} className="coverage-gap-row">
                <div>
                  <strong>Minutes of {gap.referencedDate}</strong>
                  <div className="coverage-gap-row__meta">
                    <Badge tone={meta.tone}>{meta.glyph} {meta.label}</Badge>
                    <span className="muted">cited by the <Link to={`/app/meetings/${gap.citingMeetingId}`}>{gap.citingDate} meeting</Link></span>
                    {gap.matchedMeetingId && <Link to={`/app/meetings/${gap.matchedMeetingId}`}>Meeting record</Link>}
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{gap.mark?.reason ?? gap.note}</div>
                  <blockquote className="coverage-excerpt">{gap.excerpt}</blockquote>
                </div>
                {canWrite && gap.status === "record_missing" && (
                  <div className="coverage-actions" style={{ marginTop: 0 }}>
                    <Link className="btn btn--sm" to="/app/meetings">Record meeting</Link>
                    <button type="button" className="btn btn--sm" onClick={() => markReference(gap, "never_held")}>Not a meeting…</button>
                    <button type="button" className="btn btn--sm" onClick={() => markReference(gap, "not_applicable")}>Dismiss</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
