import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Plus, CalendarCheck, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { annualFilingKind, annualFilingYear } from "../../shared/annualFilings";
import { useConfirm } from "../components/Modal";
import { Select } from "../components/Select";
import { formatDate } from "../lib/format";
import { kindLabel } from "./Dashboard";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type FieldMetadata,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";

/**
 * Annual Filings — per-year, per-jurisdiction annual-filing ledger. Lists each
 * tracked filing on the shared record table, grouped by jurisdiction, showing
 * whether it has been filed and the filed-on date. Clicking a row's year opens
 * the drawer pre-filled to edit; the header action opens an empty drawer to add
 * a filing. A small "outstanding" hint flags years between the min and max
 * tracked year that have no filed row.
 */
type Filing = {
  _id?: string;
  jurisdiction: string;
  year: string;
  filed: boolean;
  filedOn?: string;
  regnNature?: string;
  regnLegislation?: string;
  sourceFilingId?: string;
  sourceMissing?: boolean;
};

/** A ledger row as the table reads it: the year as a number (sort, range filters), the row itself for editing. */
type AnnualFilingRecord = {
  _id: string;
  year: number | null;
  jurisdiction: string;
  filed: boolean;
  filedOn: string | null;
  regnNature: string | null;
  regnLegislation: string | null;
  filing: Filing;
};

const ANNUAL_FILINGS = staticRecordTable({
  id: "annual-filings",
  nameSingular: "annualFiling",
  namePlural: "annualFilings",
  labelSingular: "Annual filing",
  labelPlural: "Annual filings",
  labelIdentifierFieldName: "year",
  // Latest year first, one group per jurisdiction (as the ledger's per-jurisdiction cards were).
  sorts: [{ field: "year", direction: "desc" }],
  groupBy: { field: "jurisdiction", sort: "label", direction: "asc" },
  fields: [
    { name: "year", label: "Year", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { decimals: 0, groupable: false } },
    { name: "jurisdiction", label: "Jurisdiction", fieldType: FIELD_TYPES.TEXT, size: 160, isVisible: false },
    { name: "filed", label: "Filed", fieldType: FIELD_TYPES.BOOLEAN, size: 180 },
    { name: "filedOn", label: "Filed on", fieldType: FIELD_TYPES.DATE, size: 150 },
    { name: "regnNature", label: "Registration nature", fieldType: FIELD_TYPES.TEXT, size: 180, isVisible: false },
    { name: "regnLegislation", label: "Registration legislation", fieldType: FIELD_TYPES.TEXT, size: 180, isVisible: false },
  ],
});

function toAnnualFilingRecord(filing: Filing): AnnualFilingRecord {
  const year = Number(filing.year);
  return {
    _id: filing._id ?? `${filing.jurisdiction}-${filing.year}`,
    year: Number.isInteger(year) ? year : null,
    jurisdiction: filing.jurisdiction,
    filed: filing.filed,
    filedOn: filing.filedOn ?? null,
    regnNature: filing.regnNature ?? null,
    regnLegislation: filing.regnLegislation ?? null,
    filing,
  };
}

function linkedNote(filing: Filing) {
  if (!filing.sourceFilingId) return null;
  return filing.sourceMissing ? "Linked record unavailable" : "Linked record";
}

function renderAnnualFilingCell({ record: { filing }, field }: { record: AnnualFilingRecord; field: FieldMetadata }) {
  if (field.name === "year") return <span>{filing.year}</span>;
  if (field.name === "filed") {
    const note = linkedNote(filing);
    if (!note) return <span>{filing.filed ? "✓" : "✗"}</span>;
    return (
      <div className="record-table__identifier-lines">
        <span className="record-table__identifier-primary">{filing.filed ? "✓" : "✗"}</span>
        <div className="record-table__identifier-secondary muted">{note}</div>
      </div>
    );
  }
  if (field.name === "filedOn") return <span>{filing.filedOn ? formatDate(filing.filedOn) : "—"}</span>;
  return undefined;
}

function renderAnnualFilingCard({ filing }: AnnualFilingRecord, { open, selecting }: RecordTableCardHelpers) {
  return (
    <RecordTablePhoneCard
      title={`${filing.jurisdiction} ${filing.year}`}
      badge={<span>{filing.filed ? "✓" : "✗"}</span>}
      meta={[filing.filedOn ? formatDate(filing.filedOn) : "—", linkedNote(filing) ?? ""]}
      onOpen={open}
      selecting={selecting}
    />
  );
}

export function AnnualFilingsPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("filings:write");
  const items = useQuery(
    api.annualFilings.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<Filing> | undefined;
  const jurisdictions = useQuery(
    api.annualFilings.jurisdictions,
    society ? { societyId: society._id } : "skip",
  ) as Array<string> | undefined;
  const detailed = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const upsert = useMutation(api.annualFilings.upsert);
  const remove = useMutation(api.annualFilings.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const records = useMemo(() => (items ?? []).map(toAnnualFilingRecord), [items]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canEdit) return;
    setForm({
      id: undefined,
      jurisdiction: "",
      year: "",
      filed: false,
      filedOn: "",
      regnNature: "",
      regnLegislation: "",
      sourceFilingId: "",
    });
    setOpen(true);
  };

  const openEdit = (r: Filing) => {
    if (!canEdit) return;
    setForm({
      id: r._id,
      jurisdiction: r.jurisdiction,
      year: r.year,
      filed: r.filed,
      filedOn: r.filedOn ?? "",
      regnNature: r.regnNature ?? "",
      regnLegislation: r.regnLegislation ?? "",
      sourceFilingId: r.sourceFilingId ?? "",
      sourceMissing: r.sourceMissing,
    });
    setOpen(true);
  };

  const save = async () => {
    if (saving || !canEdit) return;
    if (!form.jurisdiction.trim() || !/^[1-9]\d{3}$/.test(form.year.trim())) {
      toast.error("Enter a jurisdiction and a four-digit filing year.");
      return;
    }
    if (form.filed && !form.filedOn) {
      toast.error("Add the filed-on date before marking this filing as filed.");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        id: form.id || undefined,
        societyId: society._id,
        jurisdiction: form.jurisdiction.trim(),
        year: form.year.trim(),
        filed: !!form.filed,
        filedOn: form.filedOn || undefined,
        regnNature: form.regnNature || undefined,
        regnLegislation: form.regnLegislation || undefined,
        sourceFilingId: form.sourceFilingId || undefined,
        nowISO: new Date().toISOString(),
      });
      setOpen(false);
      toast.success("Annual filing saved");
    } catch (error: any) {
      toast.error("Could not save annual filing", error?.message ?? String(error));
    } finally { setSaving(false); }
  };

  const rows = items;
  const juris = jurisdictions;

  // Compute outstanding years per jurisdiction: years between the min and max
  // tracked year that have no filed=true row.
  const outstandingFor = (j: string): number[] => {
    if (!rows) return [];
    const forJuris = rows.filter((r) => r.jurisdiction === j);
    const years = forJuris
      .map((r) => Number(r.year))
      .filter((y) => Number.isInteger(y) && y >= 1000 && y <= 9999);
    if (years.length === 0) return [];
    const min = Math.min(...years);
    const max = Math.max(...years);
    const filedYears = new Set(
      forJuris.filter((r) => r.filed).map((r) => Number(r.year)),
    );
    const out: number[] = [];
    for (let y = min; y <= max; y++) {
      if (!filedYears.has(y)) out.push(y);
    }
    return out;
  };
  const outstandingRows = (juris ?? [])
    .map((jurisdiction) => ({ jurisdiction, years: outstandingFor(jurisdiction) }))
    .filter((row) => row.years.length > 0);

  return (
    <div className="page">
      <PageHeader
        title="Annual filings"
        icon={<CalendarCheck size={16} />}
        iconColor="green"
        subtitle="Which annual filings are done, by jurisdiction and year."
        info={
          <>
            <p>
              A simple per-year ledger. Detailed records with evidence and receipts live in{" "}
              <Link to="/app/filings">Filings</Link>; link one here to reuse its status.
            </p>
          </>
        }
        actions={
          <button className="btn-action btn-action--primary" disabled={!canEdit} onClick={openNew}>
            <Plus size={12} /> Add filing
          </button>
        }
      />

      <p className="muted annual-filings__note">
        Manual entries and linked records are self-reported; neither verifies government acceptance.
      </p>

      {outstandingRows.length > 0 && (
        <div>
          {outstandingRows.map(({ jurisdiction, years }) => (
            <p key={jurisdiction} style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 4px" }}>
              <strong>{jurisdiction}</strong> · Outstanding: {years.join(", ")}
            </p>
          ))}
        </div>
      )}

      <RecordListTable<AnnualFilingRecord>
        table={ANNUAL_FILINGS}
        tableId="annual-filings"
        label="Annual filings"
        icon={<CalendarCheck size={14} />}
        records={records}
        loading={rows === undefined || juris === undefined}
        showTotals={false}
        onOpen={canEdit ? (record) => openEdit(record.filing) : undefined}
        renderCell={renderAnnualFilingCell}
        renderPhoneCard={renderAnnualFilingCard}
        emptyState={<RecordTableEmpty title="No annual filings yet." />}
        renderRowActions={({ filing: r }) => (
          <button
            className="btn btn--ghost btn--sm btn--icon"
            aria-label={`Delete ${r.jurisdiction} ${r.year} filing`}
            disabled={!canEdit}
            onClick={async (e) => {
              e.stopPropagation();
              if (!canEdit || !r._id) return;
              const ok = await confirm({
                title: `Delete the ${r.jurisdiction} ${r.year} ledger entry?`,
                message: `The ${r.year} row will be removed from this ledger and the year will show as outstanding again.${r.sourceFilingId ? " The linked filing in Filings is not changed." : ""}`,
                confirmLabel: "Delete entry",
                tone: "danger",
              });
              if (!ok) return;
              try {
                await remove({ id: r._id });
                toast.success("Ledger entry deleted");
              } catch (error: unknown) {
                toast.error("Could not delete annual filing", error instanceof Error ? error.message : String(error));
              }
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={form?.id ? "Edit filing" : "Add filing"}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save} disabled={saving || !canEdit}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form && (
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <Field label="Detailed annual filing" hint="Link an annual filing whose period names a year (2025, 2025 AGM, FY2024-25). Its status and date stay controlled in Filings.">
              <Select
                value={form.sourceFilingId ?? ""}
                onChange={(value) => {
                  const source = detailed?.find(row => row._id === value);
                  setForm({ ...form, sourceFilingId: value,
                    ...(source ? { jurisdiction: source.jurisdictionCode ?? society.jurisdictionCode ?? "", year: annualFilingYear(source.periodLabel) ?? "",
                      filed: source.status === "Filed", filedOn: source.status === "Filed" ? source.filedAt ?? "" : "" } : {}) });
                }}
                options={[
                  { value: "", label: "Manual ledger entry" },
                  ...(form.sourceMissing ? [{ value: form.sourceFilingId, label: "Linked record unavailable" }] : []),
                  ...(detailed ?? [])
                    .filter(row => annualFilingKind(row.kind) && annualFilingYear(row.periodLabel) && row.jurisdictionCode)
                    .map(row => ({ value: String(row._id), label: `${kindLabel(row.kind)} · ${row.jurisdictionCode} · ${row.periodLabel === annualFilingYear(row.periodLabel) ? row.periodLabel : `${row.periodLabel} (${annualFilingYear(row.periodLabel)})`} · ${row.status}` })),
                ]}
              />
            </Field>
            <Field label="Jurisdiction">
              <input
                className="input"
                disabled={!!form.sourceFilingId}
                value={form.jurisdiction}
                onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
              />
            </Field>
            <Field label="Year">
              <input
                className="input"
                disabled={!!form.sourceFilingId}
                placeholder="2026"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </Field>
            <Field label="Filed">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  disabled={!!form.sourceFilingId}
                  checked={!!form.filed}
                  onChange={(e) => setForm({ ...form, filed: e.target.checked })}
                />
                <span>Marked as filed</span>
              </label>
            </Field>
            <Field label="Filed on">
              <DatePicker
                disabled={!!form.sourceFilingId}
                value={form.filedOn}
                onChange={(value) => setForm({ ...form, filedOn: value })}
              />
            </Field>
            <Field label="Registration nature">
              <input
                className="input"
                value={form.regnNature}
                onChange={(e) => setForm({ ...form, regnNature: e.target.value })}
              />
            </Field>
            <Field label="Registration legislation">
              <input
                className="input"
                value={form.regnLegislation}
                onChange={(e) => setForm({ ...form, regnLegislation: e.target.value })}
              />
            </Field>
          </fieldset>
        )}
      </Drawer>
    </div>
  );
}

export default AnnualFilingsPage;
