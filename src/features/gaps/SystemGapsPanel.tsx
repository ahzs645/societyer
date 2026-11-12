import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Layers, Plus } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { Badge, Banner, Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { InfoPopover } from "../../components/InfoPopover";
import { useConfirm, usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { usePermissions } from "../../hooks/usePermissions";
import {
  GAP_REASON_LABELS,
  GAP_REASONS,
  GAP_STATUS_LABELS as CATALOG_STATUS_LABELS,
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

/** Catalog labels in the words a records reviewer uses ("schema" is developer wording). */
const GAP_STATUS_LABELS: Record<GapStatus, string> = {
  ...CATALOG_STATUS_LABELS,
  schema_change_requested: "New field requested",
};

const PAGE = 25;

const GAP_GROUPS_TABLE = staticRecordTable({
  id: "coverage:system-gap-groups",
  nameSingular: "systemGapGroup",
  namePlural: "systemGapGroups",
  labelSingular: "Information type",
  labelPlural: "Information types",
  labelIdentifierFieldName: "label",
  viewName: "Backlog by information type",
  fields: [
    { name: "label", label: "Information type", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "area", label: "Area", fieldType: FIELD_TYPES.TEXT, size: 150 },
    {
      name: "reason",
      label: "Reason",
      fieldType: FIELD_TYPES.SELECT,
      size: 200,
      config: { options: GAP_REASONS.map((reason) => ({ value: reason, label: GAP_REASON_LABELS[reason], color: "gray" })) },
    },
    { name: "open", label: "Open", fieldType: FIELD_TYPES.NUMBER, size: 90 },
    { name: "keptAsText", label: "Kept as text", fieldType: FIELD_TYPES.NUMBER, size: 120 },
    { name: "fieldRequested", label: "New field requested", fieldType: FIELD_TYPES.NUMBER, size: 160 },
    { name: "closed", label: "Resolved / won't fix", fieldType: FIELD_TYPES.NUMBER, size: 160 },
    { name: "suggestedTarget", label: "Suggested target", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
  ],
});

/** One information type and reason in the backlog, with its gaps counted by status. */
type GapGroupRecord = {
  _id: string;
  label: string;
  area: string;
  reason: string;
  open: number;
  keptAsText: number;
  fieldRequested: number;
  closed: number;
  suggestedTarget: string;
  group: Group;
};

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
  const groupRecords: GapGroupRecord[] = groups.map((group) => ({
    _id: `${group.infoType}|${group.reason}`,
    label: group.label,
    area: group.area,
    reason: group.reason,
    open: group.byStatus.open ?? 0,
    keptAsText: group.byStatus.kept_as_text ?? 0,
    fieldRequested: group.byStatus.schema_change_requested ?? 0,
    closed: (group.byStatus.resolved_native ?? 0) + (group.byStatus.wont_fix ?? 0),
    suggestedTarget: group.suggestedTarget ?? "",
    group,
  }));
  const visibleRows = detailRows?.slice(page * PAGE, page * PAGE + PAGE);
  const recordFocused = Boolean((affectedTable && affectedId) || focusGapId);
  const detailSection = selected || recordFocused ? (
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
  ) : null;

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

      {summary.total > 0 && (
        <p className="coverage-status-summary" aria-label="Gaps by status">
          {GAP_STATUSES.filter((status) => summary.byStatus[status]).map((status) => (
            <span key={status}><strong>{summary.byStatus[status]}</strong> {GAP_STATUS_LABELS[status].toLowerCase()}</span>
          ))}
        </p>
      )}

      {recordFocused && detailSection}
      <section className="card">
        <div className="card__head coverage-head--inline">
          <h2 className="card__title">Backlog by information type</h2>
          <InfoPopover label="About system gaps">
            <p>Details from source files that Societyer can't hold as structured data yet. Gaps appear here from imports, preflight checks and reviewer entries, ranked by open count.</p>
          </InfoPopover>
        </div>
        <RecordListTable<GapGroupRecord>
          variant="card"
          table={GAP_GROUPS_TABLE}
          tableId="coverage-system-gap-groups"
          label="Backlog by information type"
          icon={<Layers size={14} />}
          records={groupRecords}
          highlightedRecordId={selected ? `${selected.infoType}|${selected.reason ?? ""}` : null}
          onOpen={(record) => { setSelected({ infoType: record.group.infoType, reason: record.group.reason }); setPage(0); }}
          toolbarActions={canWrite ? (
            <button type="button" className="btn-action" onClick={() => setCreating(true)}>
              <Plus size={12} /> Record a gap
            </button>
          ) : undefined}
          renderCell={({ record, field }) => {
            if (field.name === "area") return <span className="muted">{record.area}</span>;
            if (field.name === "suggestedTarget") return record.suggestedTarget ? <code style={{ fontSize: 11 }}>{record.suggestedTarget}</code> : <span className="muted">—</span>;
            return undefined;
          }}
          rowMenuSections={(record) => canWrite ? [{ id: "triage", items: [
            { id: "kept_as_text", label: "Keep as text", onSelect: () => void bulk(record.group, "kept_as_text") },
            { id: "schema_change_requested", label: "Request a new field", onSelect: () => void bulk(record.group, "schema_change_requested") },
            { id: "wont_fix", label: "Won't fix", onSelect: () => void bulk(record.group, "wont_fix") },
          ] }] : []}
          renderPhoneCard={(record, { open, selecting }) => (
            <RecordTablePhoneCard
              title={record.label}
              meta={[`${record.open} open`, GAP_REASON_LABELS[record.reason as GapReason] ?? record.reason]}
              detail={[record.area]}
              onOpen={open}
              selecting={selecting}
            />
          )}
          emptyState={<RecordTableEmpty title="No system gaps recorded." />}
        />
      </section>

      {!recordFocused && detailSection}

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
