import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { CalendarX2, FileUp } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../components/ui";
import { usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissions } from "../../hooks/usePermissions";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { CROSS_REFERENCE_EXPECTATION_KEY, type RecordGap as ContinuityGap } from "../../../shared/continuity";
import { STATUS_META } from "../gaps/statusMeta";

type RunGap = { kind: string; bodyKey?: string; date?: string; year?: number; severity: string; explanation: string };

const BODY_FOR: Record<string, string[]> = { board: ["board"], agm: ["members"], members: ["members"], sgm: ["members"], executive: ["committee"], operations: ["committee"], committee: ["committee"] };
const RUN_GAP_LABEL: Record<string, string> = { missing_minutes: "Minutes cited but not found", draft_only_minutes: "Only a draft exists", agm_missing_for_year: "No AGM minutes for the year", body_month_without_minutes: "Month without minutes" };

/**
 * Record gaps for the current document's body and year: what this run found
 * (cited-but-missing minutes, draft-only minutes, years without AGM minutes)
 * and the organization's record-continuity gaps, with "upload missing file",
 * "mark never held (with reason)" and "accept gap".
 */
export function GapPanel({ societyId, runId, runGaps, body, date }: { societyId: string; runId: string; runGaps: RunGap[]; body?: string; date?: string }) {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const prompt = usePrompt();
  const toast = useToast();
  const canReadContinuity = can("deadlines:read");
  const canMark = can("deadlines:write");
  const markPeriod = usePermissionedMutation(api.continuity.markPeriod, canMark);
  const year = date?.slice(0, 4);
  const continuity = useQuery(api.continuity.gaps, canReadContinuity && year ? { societyId, from: `${year}-01-01`, to: `${year}-12-31` } : "skip") as { recordGaps: ContinuityGap[]; crossReferences: any[] } | undefined;
  const bodies = BODY_FOR[body ?? ""] ?? [];
  const runRows = runGaps.filter((gap) => {
    const gapYear = gap.year ? String(gap.year) : gap.date?.slice(0, 4);
    return (!year || gapYear === year) && (!gap.bodyKey || !body || gap.bodyKey === body || (gap.kind === "agm_missing_for_year"));
  });
  const orgRows = (continuity?.recordGaps ?? []).filter((gap) => (!year || gap.periodKey.startsWith(year)) && (!bodies.length || bodies.some((prefix) => gap.expectationKey.includes(prefix) || gap.bodyLabel.toLowerCase().includes(prefix === "members" ? "member" : prefix))));

  const mark = async (expectationKey: string, periodKey: string, status: "never_held" | "waived", label: string) => {
    const reason = await prompt({
      title: status === "never_held" ? `Mark ${label} as never held` : `Accept the gap: ${label}`,
      message: status === "never_held" ? "Why was there no meeting or record? This is kept with the period." : "Why is this gap accepted (for example: the record is known to be lost)?",
      placeholder: "Reason",
      defaultValue: status === "waived" ? "Known gap accepted during intake review." : "",
      multiline: true,
      required: true,
      confirmLabel: "Save",
    });
    if (reason === null) return;
    try {
      await markPeriod({ societyId, expectationKey, periodKey, status, reason: reason.trim() });
      toast.success(status === "never_held" ? "Marked never held" : "Gap accepted");
    } catch (error) {
      toast.error("Could not update the period", error instanceof Error ? error.message : undefined);
    }
  };
  const upload = (hint: string) => navigate(`/app/intake?missing=${encodeURIComponent(hint)}`);

  return (
    <div className="intake-fields" data-testid="intake-gaps">
      <p className="muted" style={{ margin: "4px 0" }}>Gaps for {body ?? "this body"} in {year ?? "this period"}. <Link to="/app/coverage?tab=record">All record gaps</Link></p>
      <section className="col" style={{ gap: 6 }}>
        <strong style={{ fontSize: 12 }}>Found in this run</strong>
        {!runRows.length && <span className="muted" style={{ fontSize: 12 }}>None for this body and year.</span>}
        {runRows.map((gap, index) => (
          <div key={index} className="intake-entity">
            <div className="intake-entity__head">
              <CalendarX2 size={13} aria-hidden />
              <strong>{RUN_GAP_LABEL[gap.kind] ?? gap.kind}</strong> {gap.date ?? gap.year}
              <Badge tone={gap.severity === "statutory" ? "danger" : "warn"}>{gap.severity}</Badge>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>{gap.explanation}</div>
            {gap.kind === "missing_minutes" && gap.date && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn btn--sm" onClick={() => upload(`Minutes ${gap.date}`)}><FileUp size={12} /> Upload missing</button>
                {canMark && <button type="button" className="btn btn--sm" onClick={() => void mark(CROSS_REFERENCE_EXPECTATION_KEY, gap.date!, "never_held", `the meeting of ${gap.date}`)}>Mark never held…</button>}
                {canMark && <button type="button" className="btn btn--sm btn--ghost" onClick={() => void mark(CROSS_REFERENCE_EXPECTATION_KEY, gap.date!, "waived", `minutes of ${gap.date}`)}>Accept gap…</button>}
              </div>
            )}
            {gap.kind === "agm_missing_for_year" && <button type="button" className="btn btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => upload(`AGM minutes ${gap.year}`)}><FileUp size={12} /> Upload missing</button>}
          </div>
        ))}
      </section>
      <section className="col" style={{ gap: 6 }}>
        <strong style={{ fontSize: 12 }}>Organization record continuity</strong>
        {!canReadContinuity && <span className="muted" style={{ fontSize: 12 }}>Record continuity needs compliance (deadlines) read access.</span>}
        {canReadContinuity && !continuity && year && <span className="muted" style={{ fontSize: 12 }}>Loading…</span>}
        {continuity && !orgRows.length && <span className="muted" style={{ fontSize: 12 }}>No open record gaps for this body in {year}.</span>}
        {orgRows.map((gap) => {
          const meta = STATUS_META[gap.status];
          return (
            <div key={gap.key} className="intake-entity">
              <div className="intake-entity__head">
                <strong>{gap.bodyLabel}: {gap.title}</strong> <span className="muted">{gap.label}</span>
                {meta && <Badge tone={meta.tone}>{meta.glyph} {meta.label}</Badge>}
              </div>
              {gap.note && <div className="muted" style={{ fontSize: 12 }}>{gap.note}</div>}
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn btn--sm" onClick={() => upload(`${gap.title} ${gap.label}`)}><FileUp size={12} /> Upload missing</button>
                {canMark && <button type="button" className="btn btn--sm" onClick={() => void mark(gap.expectationKey, gap.periodKey, "never_held", `${gap.title} (${gap.label})`)}>Mark never held…</button>}
                {canMark && <button type="button" className="btn btn--sm btn--ghost" onClick={() => void mark(gap.expectationKey, gap.periodKey, "waived", `${gap.title} (${gap.label})`)}>Accept gap…</button>}
              </div>
            </div>
          );
        })}
      </section>
      <p className="muted" style={{ fontSize: 11 }}>Run {runId.slice(-6)} · uploads start a new intake run.</p>
    </div>
  );
}
