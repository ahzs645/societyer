import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Banner, Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useConfirm, usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { usePermissions } from "../../hooks/usePermissions";
import {
  GAP_REASON_LABELS,
  GAP_REASONS,
  GAP_STATUS_LABELS,
  GAP_STATUSES,
  INFO_TYPES,
  infoTypeDefinition,
  type GapReason,
  type GapStatus,
} from "../../../shared/gapCatalog";

const STATUS_TONE: Record<string, "warn" | "neutral" | "success" | "info" | "gray"> = {
  open: "warn",
  kept_as_text: "neutral",
  resolved_native: "success",
  schema_change_requested: "info",
  wont_fix: "gray",
};

const PAGE = 25;

type Group = { infoType: string; label: string; area: string; suggestedTarget?: string; reason: string; total: number; byStatus: Record<string, number>; examples: { _id: string; title?: string; sourceTitle?: string }[] };

/** System-gap backlog: grouped by information type and reason, with triage. */
export function SystemGapsPanel({ societyId, affectedTable, affectedId, focusGapId }: { societyId: string; affectedTable?: string; affectedId?: string; focusGapId?: string }) {
  const { can } = usePermissions();
  const canWrite = can("documents:write");
  const summary = useQuery(api.representationGaps.summary, { societyId }) as any;
  const [selected, setSelected] = useState<{ infoType: string; reason?: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const listArgs = !(affectedTable && affectedId) && selected ? { societyId, infoType: selected.infoType, limit: 2000 } : null;
  const list = useQuery(api.representationGaps.list, listArgs ?? "skip") as { total: number; rows: any[] } | undefined;
  const forRecord = useQuery(api.representationGaps.forRecord, affectedTable && affectedId ? { societyId, affectedTable, affectedId } : "skip") as any[] | undefined;
  const focused = useQuery(api.representationGaps.get, focusGapId ? { id: focusGapId } : "skip") as any;
  const setStatus = usePermissionedMutation(api.representationGaps.setStatus, canWrite);
  const bulkSetStatus = usePermissionedMutation(api.representationGaps.bulkSetStatus, canWrite);
  const runBackfill = usePermissionedMutation(api.representationGaps.backfillFromSourceEvidence, canWrite);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();

  const detailRows = useMemo(() => {
    const source = affectedTable && affectedId ? forRecord : focusGapId && !selected ? (focused ? [focused] : undefined) : list?.rows;
    if (!source) return undefined;
    const needle = search.trim().toLowerCase();
    return source.filter((row: any) =>
      (!selected?.reason || row.reason === selected.reason)
      && (statusFilter === "all" || row.status === statusFilter || Boolean(focusGapId && !selected))
      && (!needle || [row.title, row.sourceTitle, row.excerpt].join(" ").toLowerCase().includes(needle)),
    );
  }, [affectedTable, affectedId, forRecord, focusGapId, focused, list, selected, statusFilter, search]);

  if (!summary) return <div className="muted">Loading system gaps…</div>;
  const legacyRemaining = summary.legacyEvidence.total - summary.legacyEvidence.converted;

  const convert = async () => {
    const ok = await confirm({
      title: "Convert legacy source evidence?",
      message: `${legacyRemaining} untyped "model evidence" source rows will each get a typed gap (information type, reason, observed date, body). The source evidence rows are kept unchanged.`,
      confirmLabel: "Convert",
    });
    if (!ok) return;
    let done = 0;
    setBackfill({ done, total: legacyRemaining });
    try {
      for (let guard = 0; guard < 100; guard += 1) {
        const result: any = await runBackfill({ societyId, limit: 400 });
        done += result.created;
        setBackfill({ done, total: legacyRemaining });
        if (!result.remaining || !result.created) break;
      }
      toast.success(`Converted ${done} source rows into typed gaps`);
    } catch (error) {
      toast.error("Conversion stopped", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBackfill(null);
    }
  };

  const bulk = async (group: Group, status: GapStatus) => {
    const fromStatus = status === "open" ? undefined : group.byStatus.open ? "open" : undefined;
    const ok = await confirm({
      title: `${GAP_STATUS_LABELS[status]}: ${group.label}`,
      message: `Set ${fromStatus ? `${group.byStatus.open ?? 0} open` : `all ${group.total}`} gap(s) of type "${group.label}" (${GAP_REASON_LABELS[group.reason as GapReason] ?? group.reason}) to "${GAP_STATUS_LABELS[status]}". Each change is kept in the gap's review history.`,
      confirmLabel: "Update",
    });
    if (!ok) return;
    const note = status === "schema_change_requested" ? `Suggested target: ${group.suggestedTarget ?? "new field"}` : undefined;
    try {
      const result: any = await bulkSetStatus({ societyId, infoType: group.infoType, reason: group.reason, ...(fromStatus ? { fromStatus } : {}), status, ...(note ? { note } : {}) });
      toast.success(`${result.updated} gap(s) updated`);
    } catch (error) {
      toast.error("Could not update gaps", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const changeStatus = async (row: any, status: GapStatus) => {
    let note: string | undefined;
    if (status === "resolved_native" || status === "wont_fix") {
      const answer = await prompt({ title: GAP_STATUS_LABELS[status], message: status === "resolved_native" ? "Where is this detail recorded natively now? (for example: entered as the motion's seconder)" : "Why will this not be represented?", multiline: true, confirmLabel: "Save" });
      if (answer === null) return;
      note = answer.trim() || undefined;
    }
    try {
      await setStatus({ id: row._id, status, ...(note ? { note } : {}), ...(status === "resolved_native" && row.affectedTable && row.affectedId ? { resolvedTable: row.affectedTable, resolvedId: row.affectedId } : {}) });
      toast.success(`Gap set to ${GAP_STATUS_LABELS[status].toLowerCase()}`);
    } catch (error) {
      toast.error("Could not update the gap", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const groups: Group[] = summary.groups;
  const visibleRows = detailRows?.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="col" style={{ gap: 16 }}>
      {legacyRemaining > 0 && (
        <Banner tone="info">
          <div className="row" style={{ gap: 12, flexWrap: "wrap", justifyContent: "space-between", width: "100%" }}>
            <span>{legacyRemaining} source files were mapped to a model area as untyped "model evidence" and never transposed. Convert them into typed gaps to count and triage them here.</span>
            {canWrite && (
              <button type="button" className="btn btn--sm btn--accent" disabled={Boolean(backfill)} onClick={convert}>
                {backfill ? `Converting… ${backfill.done}/${backfill.total}` : `Convert ${legacyRemaining} rows`}
              </button>
            )}
          </div>
        </Banner>
      )}

      <div className="stat-grid">
        {GAP_STATUSES.map((status) => (
          <div key={status} className="stat">
            <div className="stat__label">{GAP_STATUS_LABELS[status]}</div>
            <div className="stat__value">{summary.byStatus[status] ?? 0}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Backlog by information type</h2>
          <span className="card__subtitle">{summary.total} gaps · ranked by open count</span>
          {canWrite && (
            <button type="button" className="btn-action" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
              <Plus size={12} /> Record a gap
            </button>
          )}
        </div>
        <div className="coverage-table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Information type</th>
                <th>Reason</th>
                <th>Open</th>
                <th>Kept as text</th>
                <th>Schema change</th>
                <th>Resolved / won't fix</th>
                <th>Suggested target</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {!groups.length && (
                <tr><td colSpan={8} className="table__empty">No system gaps recorded. Gaps appear here from imports, preflight checks and reviewer entries.</td></tr>
              )}
              {groups.map((group) => {
                const isSelected = selected?.infoType === group.infoType && selected?.reason === group.reason;
                return (
                  <tr key={`${group.infoType}|${group.reason}`} className={isSelected ? "is-selected" : undefined}>
                    <td>
                      <button type="button" className="btn-link" onClick={() => { setSelected({ infoType: group.infoType, reason: group.reason }); setPage(0); }}>
                        {group.label}
                      </button>
                      <div className="muted" style={{ fontSize: 11 }}>{group.infoType} · {group.area}</div>
                    </td>
                    <td>{GAP_REASON_LABELS[group.reason as GapReason] ?? group.reason}</td>
                    <td>{group.byStatus.open ?? 0}</td>
                    <td>{group.byStatus.kept_as_text ?? 0}</td>
                    <td>{group.byStatus.schema_change_requested ?? 0}</td>
                    <td>{(group.byStatus.resolved_native ?? 0) + (group.byStatus.wont_fix ?? 0)}</td>
                    <td><code style={{ fontSize: 11 }}>{group.suggestedTarget ?? "—"}</code></td>
                    <td>
                      {canWrite && (
                        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                          <button type="button" className="btn btn--sm" onClick={() => bulk(group, "kept_as_text")}>Keep as text</button>
                          <button type="button" className="btn btn--sm" onClick={() => bulk(group, "schema_change_requested")}>Request schema change</button>
                          <button type="button" className="btn btn--sm" onClick={() => bulk(group, "wont_fix")}>Won't fix</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {(selected || (affectedTable && affectedId) || focusGapId) && (
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">
              {affectedTable && affectedId ? `Unsupported details for this ${affectedTable.replace(/s$/, "")}` : selected ? infoTypeDefinition(selected.infoType).label : "Gap"}
            </h2>
            <span className="card__subtitle">
              {selected?.reason ? GAP_REASON_LABELS[selected.reason as GapReason] : ""} {detailRows ? `· ${detailRows.length} shown` : ""}
            </span>
            <div className="row" style={{ marginLeft: "auto", gap: 8, flexWrap: "wrap" }}>
              {affectedTable && affectedId && <Link className="btn btn--sm" to="/app/coverage?tab=system">Show all gaps</Link>}
              <input className="input" aria-label="Search gaps" placeholder="Search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} style={{ width: 160 }} />
              <Select
                aria-label="Status filter"
                value={statusFilter}
                onChange={(value) => { setStatusFilter(value); setPage(0); }}
                options={[{ value: "all", label: "All statuses" }, ...GAP_STATUSES.map((status) => ({ value: status, label: GAP_STATUS_LABELS[status] }))]}
              />
            </div>
          </div>
          <div className="card__body">
            {detailRows === undefined && <div className="muted">Loading…</div>}
            {detailRows?.length === 0 && <div className="muted">No gaps match these filters.</div>}
            {visibleRows?.map((row: any) => (
              <article key={row._id} className="coverage-gap-row" id={`gap-${row._id}`}>
                <div>
                  <strong>{row.sourceTitle ?? row.title ?? infoTypeDefinition(row.infoType).label}</strong>
                  <div className="coverage-gap-row__meta">
                    <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{GAP_STATUS_LABELS[row.status as GapStatus] ?? row.status}</Badge>
                    <Badge tone="neutral">{infoTypeDefinition(row.infoType).label}</Badge>
                    {row.observedDate && <span className="muted">Observed {row.observedDate}</span>}
                    {row.origin && <span className="muted">via {row.origin}</span>}
                    {row.sourceDocumentId && <Link to={`/app/documents/${row.sourceDocumentId}`}>Source document</Link>}
                    {row.affectedTable === "meetings" && row.affectedId && <Link to={`/app/meetings/${row.affectedId}`}>Affected meeting</Link>}
                    {row.locator && <span className="muted">{Object.entries(row.locator).map(([key, value]) => `${key} ${value}`).join(" · ")}</span>}
                  </div>
                  {row.excerpt && (
                    <details>
                      <summary style={{ fontSize: 12 }}>Source excerpt</summary>
                      <pre className="coverage-excerpt">{row.excerpt}</pre>
                    </details>
                  )}
                  {row.resolutionNote && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Note: {row.resolutionNote}</div>}
                </div>
                {canWrite && (
                  <Select
                    aria-label={`Status for ${row.sourceTitle ?? row.title ?? "gap"}`}
                    value={row.status}
                    onChange={(value) => changeStatus(row, value as GapStatus)}
                    options={GAP_STATUSES.map((status) => ({ value: status, label: GAP_STATUS_LABELS[status] }))}
                  />
                )}
              </article>
            ))}
            {detailRows && detailRows.length > PAGE && (
              <div className="row" style={{ gap: 12, marginTop: 12 }}>
                <button type="button" className="btn" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {page + 1} of {Math.ceil(detailRows.length / PAGE)}</span>
                <button type="button" className="btn" disabled={(page + 1) * PAGE >= detailRows.length} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        </section>
      )}

      <RecordGapDrawer open={creating} onClose={() => setCreating(false)} societyId={societyId} affectedTable={affectedTable} affectedId={affectedId} />
    </div>
  );
}

/** Reviewer "can't represent" entry. */
function RecordGapDrawer({ open, onClose, societyId, affectedTable, affectedId }: { open: boolean; onClose: () => void; societyId: string; affectedTable?: string; affectedId?: string }) {
  const { can } = usePermissions();
  const create = usePermissionedMutation(api.representationGaps.create, can("documents:write"));
  const toast = useToast();
  const [form, setForm] = useState({ infoType: "motion.dissent", reason: "no_schema_field" as string, excerpt: "", sourceTitle: "", observedDate: "", proposedField: "" });
  const save = async () => {
    try {
      await create({
        societyId,
        infoType: form.infoType,
        reason: form.reason,
        origin: "reviewer",
        ...(form.excerpt.trim() ? { excerpt: form.excerpt.trim() } : {}),
        ...(form.sourceTitle.trim() ? { sourceTitle: form.sourceTitle.trim() } : {}),
        ...(form.observedDate.trim() ? { observedDate: form.observedDate.trim() } : {}),
        ...(form.proposedField.trim() ? { proposedField: form.proposedField.trim() } : {}),
        ...(affectedTable && affectedId ? { affectedTable, affectedId } : {}),
      });
      toast.success("Gap recorded");
      setForm((prev) => ({ ...prev, excerpt: "", sourceTitle: "", observedDate: "", proposedField: "" }));
      onClose();
    } catch (error) {
      toast.error("Could not record the gap", error instanceof Error ? error.message : "Please try again.");
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Record a detail Societyer can't represent"
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn--accent" onClick={save}>Record gap</button></>}
    >
      <div className="col" style={{ gap: 12 }}>
        {affectedTable && affectedId && <Banner tone="info">Linked to this {affectedTable.replace(/s$/, "")}.</Banner>}
        <Field label="Information type">
          <Select searchable value={form.infoType} onChange={(value) => setForm({ ...form, infoType: value })} options={INFO_TYPES.map((type) => ({ value: type.key, label: type.label }))} />
        </Field>
        <Field label="Why it can't be represented">
          <Select value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} options={GAP_REASONS.map((reason) => ({ value: reason, label: GAP_REASON_LABELS[reason] }))} />
        </Field>
        <Field label="Source wording">
          <textarea className="input" rows={4} value={form.excerpt} onChange={(event) => setForm({ ...form, excerpt: event.target.value })} />
        </Field>
        <Field label="Source title (optional)">
          <input className="input" value={form.sourceTitle} onChange={(event) => setForm({ ...form, sourceTitle: event.target.value })} />
        </Field>
        <Field label="Observed date (optional)" hint="YYYY, YYYY-MM or YYYY-MM-DD">
          <input className="input" value={form.observedDate} onChange={(event) => setForm({ ...form, observedDate: event.target.value })} />
        </Field>
        <Field label="Field it should go in (optional)">
          <input className="input" value={form.proposedField} onChange={(event) => setForm({ ...form, proposedField: event.target.value })} placeholder="e.g. opposedBy" />
        </Field>
      </div>
    </Drawer>
  );
}
