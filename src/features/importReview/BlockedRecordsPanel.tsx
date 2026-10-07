import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { CalendarClock, Copy, Pencil, RotateCcw, SkipForward, Undo2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, InspectorNote } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";
import { pluralize } from "../../lib/format";
import { importKindLabel } from "./importKindLabels";

type Blocked = {
  reason: "duplicate" | "waiting" | "invalid";
  issues: string[];
  duplicateOf?: { table: string; id: string; label: string };
  waitingFor?: { kind: string; meetingDate?: string; body?: string; grantTitle?: string };
  atISO?: string;
};
type BlockedRecord = { _id: string; recordKind: string; title?: string; status: string; importedTargets?: Record<string, unknown>; blocked: Blocked };

const REASON: Record<Blocked["reason"], { title: string; explain: string }> = {
  duplicate: { title: "Already in the register", explain: "A record with the same name is already on record. Link these to the existing record, or skip them." },
  waiting: { title: "Waiting for a record that is not applied yet", explain: "These name a meeting (or grant) that is still pending in an import session. They apply automatically as soon as that record is created; defer or skip them to stop waiting." },
  invalid: { title: "Need a fix", explain: "A fact these records need is missing or ambiguous. Edit one and retry it, or defer or skip it." },
};

/**
 * Records "Apply sections" could not apply, grouped by reason, with one-click resolutions
 * (importSessions:resolveBlockedRecords). Everything else in the session was applied already.
 */
export function BlockedRecordsPanel({ sessionId, records, canWrite, onEdit }: { sessionId: string; records: any[]; canWrite: boolean; onEdit: (recordId: string) => void }) {
  const resolve = useMutation(api.importSessions.resolveBlockedRecords);
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const blocked = useMemo(
    () => (records as BlockedRecord[]).filter((record) => record.blocked && record.status === "Approved" && !record.importedTargets?.sections),
    [records],
  );
  if (!blocked.length) return null;
  const groups = (["duplicate", "waiting", "invalid"] as const).map((reason) => ({ reason, rows: blocked.filter((record) => record.blocked.reason === reason) })).filter((group) => group.rows.length);

  const act = async (action: "skip" | "defer" | "link_existing" | "retry", rows: BlockedRecord[], label: string) => {
    if (!rows.length) return;
    if (action === "skip") {
      const ok = await confirm({
        title: `Skip ${pluralize(rows.length, "record")}?`,
        message: `${rows.length === 1 ? `"${rows[0].title ?? importKindLabel(rows[0].recordKind)}" is` : `${pluralize(rows.length, "record")} are`} marked rejected and never applied. The reason is kept in the review notes; you can approve ${rows.length === 1 ? "it" : "them"} again later.`,
        confirmLabel: `Skip ${rows.length}`,
        tone: "danger",
      });
      if (!ok) return;
    }
    setBusy(`${action}:${rows.map((row) => row._id).join(",")}`);
    try {
      let updated = 0, still = 0;
      for (let offset = 0; offset < rows.length; offset += 500) {
        const result: any = await resolve({ sessionId, recordIds: rows.slice(offset, offset + 500).map((row) => row._id), action });
        updated += result.updated ?? 0;
        still += result.stillBlocked ?? 0;
      }
      toast.success(label, action === "retry" ? `${pluralize(updated, "record")} applied${still ? `, ${still} still blocked` : ""}` : pluralize(updated, "record"));
    } catch (error) {
      toast.error(`Could not ${label.toLowerCase()}`, error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <InspectorNote tone="warn" title={`${pluralize(blocked.length, "approved record")} could not be applied`}>
      <div className="col blocked-records" style={{ gap: 12 }} data-testid="import-blocked-records">
        <p style={{ margin: 0 }}>Everything else in this session was applied. These records stay approved with the reason below.</p>
        {groups.map(({ reason, rows }) => {
          const linkable = rows.filter((row) => row.blocked.duplicateOf);
          return (
            <section key={reason} className="col" style={{ gap: 6 }} aria-label={REASON[reason].title}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{REASON[reason].title}</strong> <Badge tone={reason === "invalid" ? "danger" : reason === "waiting" ? "info" : "warn"}>{rows.length}</Badge>
                <span className="muted" style={{ flex: "1 1 260px" }}>{REASON[reason].explain}</span>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {reason === "duplicate" && linkable.length > 0 && (
                  <button type="button" className="btn btn--sm" disabled={!canWrite || Boolean(busy)} onClick={() => void act("link_existing", linkable, "Linked to existing records")}>
                    <Copy size={12} /> Link {linkable.length === rows.length ? "all" : linkable.length} to the existing record{linkable.length === 1 ? "" : "s"}
                  </button>
                )}
                {reason !== "waiting" && (
                  <button type="button" className="btn btn--sm" disabled={!canWrite || Boolean(busy)} onClick={() => void act("retry", rows, "Retried")}>
                    <RotateCcw size={12} /> Retry {rows.length === 1 ? "" : "all"}
                  </button>
                )}
                <button type="button" className="btn btn--sm" disabled={!canWrite || Boolean(busy)} onClick={() => void act("defer", rows, "Deferred to pending")}>
                  <Undo2 size={12} /> Defer {rows.length === 1 ? "" : "all"}
                </button>
                <button type="button" className="btn btn--sm btn--danger" disabled={!canWrite || Boolean(busy)} onClick={() => void act("skip", rows, "Skipped")}>
                  <SkipForward size={12} /> Skip {rows.length === 1 ? "" : "all"}…
                </button>
              </div>
              <ul className="blocked-records__list">
                {rows.slice(0, 50).map((row) => (
                  <li key={row._id} className="blocked-records__row">
                    <div className="blocked-records__main">
                      <span className="blocked-records__title">{row.title || importKindLabel(row.recordKind)}</span>
                      <span className="muted"> · {importKindLabel(row.recordKind)}</span>
                      {row.blocked.duplicateOf && <span className="muted"> · same as “{row.blocked.duplicateOf.label}”</span>}
                      {row.blocked.waitingFor?.kind === "meeting" && <span className="muted"> · <CalendarClock size={11} aria-hidden /> waits for the {row.blocked.waitingFor.body ?? ""} meeting of {row.blocked.waitingFor.meetingDate}</span>}
                      {row.blocked.waitingFor?.kind === "grant" && <span className="muted"> · waits for the grant “{row.blocked.waitingFor.grantTitle ?? "?"}”</span>}
                      <div className="muted blocked-records__issues">{row.blocked.issues.join(" ")}</div>
                    </div>
                    <div className="row blocked-records__actions" style={{ gap: 4 }}>
                      {row.blocked.duplicateOf && <button type="button" className="btn btn--sm btn--ghost" disabled={!canWrite || Boolean(busy)} onClick={() => void act("link_existing", [row], "Linked to the existing record")} aria-label={`Link ${row.title ?? "record"} to the existing record`}><Copy size={11} /> Link</button>}
                      {reason === "invalid" && <button type="button" className="btn btn--sm btn--ghost" disabled={!canWrite} onClick={() => onEdit(row._id)} aria-label={`Edit ${row.title ?? "record"}`}><Pencil size={11} /> Edit</button>}
                      {reason !== "waiting" && <button type="button" className="btn btn--sm btn--ghost" disabled={!canWrite || Boolean(busy)} onClick={() => void act("retry", [row], "Retried")} aria-label={`Retry ${row.title ?? "record"}`}><RotateCcw size={11} /> Retry</button>}
                      <button type="button" className="btn btn--sm btn--ghost" disabled={!canWrite || Boolean(busy)} onClick={() => void act("defer", [row], "Deferred to pending")} aria-label={`Defer ${row.title ?? "record"}`}><Undo2 size={11} /> Defer</button>
                      <button type="button" className="btn btn--sm btn--ghost" disabled={!canWrite || Boolean(busy)} onClick={() => void act("skip", [row], "Skipped")} aria-label={`Skip ${row.title ?? "record"}`}><SkipForward size={11} /> Skip</button>
                    </div>
                  </li>
                ))}
                {rows.length > 50 && <li className="muted">and {pluralize(rows.length - 50, "more record")}; the actions above apply to all {rows.length}.</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </InspectorNote>
  );
}
