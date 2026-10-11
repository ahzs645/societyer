import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Paperclip, Upload } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Field } from "../../components/ui";
import { usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { usePermissions } from "../../hooks/usePermissions";
import type { ContinuityPeriod, EffectiveExpectation } from "../../../shared/continuity";
import { describeCadenceRule } from "../../../shared/continuityRules";
import { evidenceHref, SEVERITY_LABELS, SEVERITY_TONE, STATUS_META } from "./statusMeta";

export type PeriodSelection = {
  societyId: string;
  expectation: Pick<EffectiveExpectation, "key" | "title" | "kind" | "severity" | "citation" | "caveat" | "rule" | "origin"> & { bodyLabel: string };
  periods: ContinuityPeriod[];
};

/** Detail and actions for one or more expected periods of one expectation. */
export function PeriodDrawer({ selection, onClose }: { selection: PeriodSelection | null; onClose: () => void }) {
  const { can } = usePermissions();
  const canWrite = can("deadlines:write");
  const markPeriod = usePermissionedMutation(api.continuity.markPeriod, canWrite);
  const clearMark = usePermissionedMutation(api.continuity.clearPeriodMark, canWrite);
  const prompt = usePrompt();
  const toast = useToast();
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const candidates = useQuery(
    api.continuity.evidenceDocuments,
    selection && attachFor && search.trim().length >= 2 && can("documents:read") ? { societyId: selection.societyId, search } : "skip",
  ) as { _id: string; title: string; category?: string }[] | undefined;

  if (!selection) return null;
  const { expectation } = selection;

  const mark = async (period: ContinuityPeriod, status: string, opts: { askReason?: boolean; requireReason?: boolean; evidenceDocumentIds?: string[] } = {}) => {
    let reason: string | undefined;
    if (opts.askReason) {
      const answer = await prompt({
        title: `${STATUS_META[status as keyof typeof STATUS_META]?.label ?? status}: ${period.label}`,
        message: status === "never_held"
          ? "Say why this period had no meeting or record (for example: board did not meet over the summer)."
          : status === "waived"
            ? "Say how the requirement was met or excused (for example: registrar extension, resolution in lieu of an AGM)."
            : "Add a note (optional).",
        placeholder: "Reason",
        multiline: true,
        required: opts.requireReason,
        confirmLabel: "Save",
      });
      if (answer === null) return;
      reason = answer.trim() || undefined;
    }
    try {
      await markPeriod({
        societyId: selection.societyId,
        expectationKey: expectation.key,
        periodKey: period.periodKey,
        status,
        ...(reason ? { reason } : {}),
        ...(opts.evidenceDocumentIds ? { evidenceDocumentIds: opts.evidenceDocumentIds } : {}),
      });
      toast.success(`${period.label} marked ${STATUS_META[status as keyof typeof STATUS_META]?.label.toLowerCase() ?? status}`);
      setAttachFor(null);
      setSearch("");
    } catch (error) {
      toast.error("Could not update the period", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <Drawer open={Boolean(selection)} onClose={onClose} title={`${expectation.title} — ${expectation.bodyLabel}`} size="wide">
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Badge tone={SEVERITY_TONE[String(expectation.severity)] ?? "neutral"}>{SEVERITY_LABELS[String(expectation.severity)] ?? expectation.severity}</Badge>
          <Badge tone="neutral">{describeCadenceRule(expectation.rule)}</Badge>
          {expectation.origin === "rule_pack" && <Badge tone="info">Rule pack (draft)</Badge>}
        </div>
        {expectation.citation && <div className="muted" style={{ fontSize: 13 }}>Authority: {expectation.citation}</div>}
        {expectation.caveat && <div className="muted" style={{ fontSize: 12 }}>{expectation.caveat}</div>}
        {selection.periods.map((period) => {
          const meta = STATUS_META[period.status];
          const isMarked = Boolean(period.mark);
          return (
            <section key={period.periodKey} className="coverage-period" aria-label={`${period.label}: ${meta.label}`}>
              <div className="coverage-period__head">
                <strong>{period.label}</strong>
                <span className="row" style={{ gap: 6 }}>
                  <Badge tone={meta.tone}>{meta.glyph} {meta.label}</Badge>
                  {period.expectedCount > 1 && <span className="muted" style={{ fontSize: 12 }}>{period.foundCount} of {period.expectedCount}</span>}
                </span>
              </div>
              {period.note && <p style={{ margin: "6px 0 0" }}>{period.note}</p>}
              {period.action && <p style={{ margin: "6px 0 0" }}><Link className="btn btn--sm btn--accent" to={period.action.href}>{period.action.label}</Link></p>}
              {period.dueDate && period.status === "upcoming" && <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>Due {period.dueDate}</p>}
              {period.evidence.length > 0 && (
                <ul className="coverage-evidence">
                  {period.evidence.map((item, index) => {
                    const href = evidenceHref(item.table, item.id);
                    return (
                      <li key={`${item.table}:${item.id}:${index}`}>
                        {href ? <Link to={href}>{item.label}</Link> : item.label}
                        {item.date ? <span className="muted"> · {item.date}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canWrite && (
                <div className="coverage-actions">
                  {!isMarked && period.status !== "satisfied" && (
                    <>
                      <button type="button" className="btn btn--sm" onClick={() => mark(period, "never_held", { askReason: true, requireReason: true })}>Mark never held…</button>
                      <button type="button" className="btn btn--sm" onClick={() => mark(period, "cancelled", { askReason: true })}>Mark cancelled…</button>
                      <button type="button" className="btn btn--sm" onClick={() => mark(period, "waived", { askReason: true, requireReason: true })}>Waive…</button>
                      <button type="button" className="btn btn--sm" onClick={() => mark(period, "not_applicable", { askReason: true })}>Not applicable</button>
                    </>
                  )}
                  <button type="button" className="btn btn--sm" onClick={() => { setAttachFor(attachFor === period.periodKey ? null : period.periodKey); setSearch(""); }}>
                    <Paperclip size={12} /> Attach evidence
                  </button>
                  <Link className="btn btn--sm" to="/app/documents"><Upload size={12} /> Upload missing file</Link>
                  {(expectation.kind === "agm" || expectation.kind === "meeting") && (
                    <Link className="btn btn--sm" to="/app/meetings">Record meeting</Link>
                  )}
                  {isMarked && period.mark && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={async () => {
                        try {
                          await clearMark({ id: period.mark!.id });
                          toast.success(`Cleared the mark on ${period.label}`);
                        } catch (error) {
                          toast.error("Could not clear the mark", error instanceof Error ? error.message : "Please try again.");
                        }
                      }}
                    >
                      Clear mark
                    </button>
                  )}
                </div>
              )}
              {attachFor === period.periodKey && (
                <div style={{ marginTop: 10 }}>
                  <Field label="Find a document by title">
                    <input className="input" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. AGM minutes 2018" />
                  </Field>
                  {search.trim().length >= 2 && candidates === undefined && <div className="muted">Searching…</div>}
                  {candidates?.length === 0 && <div className="muted">No documents match. Upload the file in Documents first.</div>}
                  <ul className="coverage-evidence">
                    {candidates?.map((doc) => (
                      <li key={doc._id}>
                        <button type="button" className="btn btn--sm" onClick={() => mark(period, "satisfied", { evidenceDocumentIds: [...(period.mark?.evidenceDocumentIds ?? []), doc._id] })}>
                          Attach
                        </button>{" "}
                        {doc.title} {doc.category ? <span className="muted">· {doc.category}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
