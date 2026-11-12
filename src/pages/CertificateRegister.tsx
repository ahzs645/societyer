import { useConfirm } from "../components/Modal";
import { calendarDateKey } from "../lib/calendarDates";
import { isCorporation } from "../../shared/organizationDomain";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { ScrollText, Plus, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import { todayDateOnly } from "../../shared/dateOnly";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type FieldMetadata,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";

type Certificate = {
  _id?: string;
  certificateNumber: string;
  holderName: string;
  shareClass: string;
  shares: number;
  issuedOn: string;
  replacesCertificateNumber?: string;
  cancelledOn?: string;
};

/**
 * Physical share-certificate register. Tracks each issued paper certificate
 * (number, holder, class, shares) with an "as of" date that drives the
 * register's outstanding-by-class summary. Active certificates can be
 * cancelled (setting cancelledOn) or removed; replacement certificates record
 * the number they supersede.
 */
export function CertificateRegisterPage() {
  const society = useSociety();
  const permissions = usePermissions();
  const canEdit = permissions.loaded && permissions.can("documents:write");
  const [asOf, setAsOf] = useState<string>(() => todayDateOnly());
  const register = useQuery(
    api.shareCertificates.register,
    society ? { societyId: society._id, asOf } : "skip",
  ) as
    | { active: Array<Certificate>; outstandingByClass: Record<string, number> }
    | undefined;
  const list = useQuery(
    api.shareCertificates.list,
    society ? { societyId: society._id } : "skip",
  ) as Array<Certificate> | undefined;
  const reconciliation = useQuery(
    api.shareCertificates.reconcile,
    society && isCorporation(society) ? { societyId: society._id, asOf } : "skip",
  ) as
    | { rows: Array<ReconciliationRow>; issues: string[]; notes: string[]; balanced: boolean }
    | undefined;
  const create = useMutation(api.shareCertificates.create);
  const update = useMutation(api.shareCertificates.update);
  const remove = useMutation(api.shareCertificates.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const certificateRecords = useMemo(() => (list ?? []).map(toCertificateRecord), [list]);
  const reconciliationRecords = useMemo(
    () => (reconciliation?.rows ?? []).map(toReconciliationRecord),
    [reconciliation?.rows],
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const outstanding = register?.outstandingByClass ?? {};

  const openNew = () => {
    if (!canEdit) return;
    setForm({
      certificateNumber: "",
      holderName: "",
      shareClass: "",
      shares: "",
      issuedOn: todayDateOnly(),
      replacesCertificateNumber: "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (saving || !canEdit) return;
    // Friendly, field-level checks before the server's validator (G-29 showed
    // the raw "Invalid certificate: certificateNumber is required; ...").
    const shares = Number(form.shares);
    const problems = [
      !String(form.certificateNumber ?? "").trim() ? "a certificate number" : "",
      !String(form.holderName ?? "").trim() ? "the holder's name" : "",
      !String(form.shareClass ?? "").trim() ? "the share class" : "",
      !form.issuedOn ? "the issue date" : "",
      !(Number.isInteger(shares) && shares > 0) ? "a whole, positive number of shares" : "",
    ].filter(Boolean);
    if (problems.length) {
      toast.error("Could not record certificate", `Enter ${problems.join(", ")}.`);
      return;
    }
    setSaving(true);
    try {
    await create({
      societyId: society._id,
      certificateNumber: form.certificateNumber,
      holderName: form.holderName,
      shareClass: form.shareClass,
      shares: Number(form.shares),
      issuedOn: form.issuedOn,
      replacesCertificateNumber: form.replacesCertificateNumber || undefined,
      nowISO: new Date().toISOString(),
    });
    setOpen(false);
    toast.success("Certificate recorded");
    } catch (error: any) {
      toast.error("Could not record certificate", error?.message ?? String(error));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id?: string) => {
    if (!id || !canEdit) return;
    await update({
      id,
      patch: { cancelledOn: todayDateOnly() },
    });
  };

  return (
    <div className="page">
      <PageHeader
        title="Certificate register"
        icon={<ScrollText size={16} />}
        iconColor="purple"
        subtitle="Physical share certificates issued, with outstanding shares by class on any date."
        info={
          <p>
            Each certificate records its holder, class, shares and issue date. Cancel a certificate when it's returned;
            a replacement records the number it supersedes.
            {!isCorporation(society) && ` Optional for ${society.name}: a society has members, not shareholders.`}
          </p>
        }
        actions={
          <button className="btn-action btn-action--primary" disabled={!canEdit} onClick={openNew}>
            <Plus size={12} /> Issue certificate
          </button>
        }
      />

      {list !== undefined && list.length > 0 && (
        <div className="register-asof">
          <label className="register-asof__date">
            <span>Outstanding as of</span>
            <DatePicker value={asOf} onChange={(value) => setAsOf(value)} />
          </label>
          <span className="register-asof__totals">
            {Object.keys(outstanding).length > 0
              ? Object.entries(outstanding)
                  .map(([cls, shares]) => `${cls} ${shares.toLocaleString()}`)
                  .join(" · ")
              : "No shares outstanding on this date"}
          </span>
        </div>
      )}

      <RecordListTable<CertificateRecord>
        table={CERTIFICATES}
        tableId="certificate-register"
        label="Share certificates"
        icon={<ScrollText size={14} />}
        records={certificateRecords}
        loading={list === undefined}
        showTotals={false}
        renderCell={renderCertificateCell}
        renderPhoneCard={renderCertificateCard}
        emptyState={<RecordTableEmpty title="No certificates issued yet" />}
        renderRowActions={({ certificate: c }) => (
          <>
            {!c.cancelledOn && (
              <button
                className="btn btn--sm"
                disabled={!canEdit}
                onClick={() => cancel(c._id).catch((error: unknown) => toast.error("Could not cancel certificate", errorMessage(error)))}
              >
                Cancel
              </button>
            )}
            <button
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Delete certificate ${c.certificateNumber}`}
              disabled={!canEdit}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete certificate ${c.certificateNumber}?`,
                  message: `The register entry for ${c.holderName} (${c.shares.toLocaleString()} ${c.shareClass}) will be removed and outstanding share totals recalculated. To record a returned certificate, use Cancel instead.`,
                  confirmLabel: "Delete certificate",
                  tone: "danger",
                });
                if (!ok) return;
                remove({ id: c._id }).catch((error: unknown) => toast.error("Could not delete certificate", errorMessage(error)));
              }}
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      />

      {isCorporation(society) && list !== undefined && list.length > 0 && reconciliation && (
        <div className="card">
          <div className="card__head"><h2 className="card__title">Certificates against the share ledger on {asOf}</h2></div>
          <div className="card__body" style={{ display: "grid", gap: 8 }}>
            <p className="muted" style={{ margin: 0 }}>
              For each holder and class, the shares on outstanding certificates should equal the posted share ledger at the end of this date.
              When a certificate is cancelled on a transfer, the new certificate and any balance certificate together must equal the cancelled one.
            </p>
            {reconciliation.balanced
              ? <p style={{ margin: 0 }}><strong>Certificates match the ledger.</strong></p>
              : reconciliation.issues.map((issue) => <p key={issue} style={{ margin: 0, color: "var(--danger)" }}>{issue}</p>)}
            {reconciliation.notes.map((note) => <p key={note} className="muted" style={{ margin: 0 }}>{note}</p>)}
          </div>
          {reconciliationRecords.length > 0 && (
            <RecordListTable<ReconciliationRecord>
              variant="card"
              table={RECONCILIATION}
              tableId="certificate-reconciliation"
              label="Certificate reconciliation"
              icon={<ScrollText size={14} />}
              records={reconciliationRecords}
              renderCell={renderReconciliationCell}
              renderPhoneCard={renderReconciliationCard}
            />
          )}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Issue certificate"
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
          <div>
            <Field label="Certificate number">
              <input
                className="input"
                value={form.certificateNumber}
                onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })}
              />
            </Field>
            <Field label="Holder name">
              <input
                className="input"
                value={form.holderName}
                onChange={(e) => setForm({ ...form, holderName: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Share class">
                <input
                  className="input"
                  value={form.shareClass}
                  onChange={(e) => setForm({ ...form, shareClass: e.target.value })}
                />
              </Field>
              <Field label="Shares">
                <input
                  className="input"
                  type="number"
                  value={form.shares}
                  onChange={(e) => setForm({ ...form, shares: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Issued on">
              <DatePicker
                value={form.issuedOn}
                onChange={(value) => setForm({ ...form, issuedOn: value })}
              />
            </Field>
            <Field label="Replaces certificate number (optional)" hint="On a transfer, the transferee's certificate and any balance certificate both name the cancelled certificate. Certificate numbers must be unique.">
              <input
                className="input"
                value={form.replacesCertificateNumber}
                onChange={(e) =>
                  setForm({ ...form, replacesCertificateNumber: e.target.value })
                }
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

const RECONCILIATION_STATUS: Record<string, string> = {
  matched: "Matches",
  mismatch: "Does not match",
  uncertificated: "No certificate",
  no_ledger_holding: "Not in ledger",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function certificateStatusText(c: Certificate) {
  if (c.cancelledOn) return `Cancelled ${c.cancelledOn}`;
  if (c.replacesCertificateNumber) return `Replaces ${c.replacesCertificateNumber}`;
  return "Active";
}

/** A certificate as the table reads it: its state as a select value (filters, grouping), the row itself for its actions. */
type CertificateRecord = {
  _id: string;
  certificateNumber: string;
  holderName: string;
  shareClass: string;
  shares: number;
  issuedOn: string;
  status: "active" | "replacement" | "cancelled";
  cancelledOn: string | null;
  replacesCertificateNumber: string | null;
  certificate: Certificate;
};

const CERTIFICATES = staticRecordTable({
  id: "certificate-register",
  nameSingular: "shareCertificate",
  namePlural: "shareCertificates",
  labelSingular: "Certificate",
  labelPlural: "Certificates",
  labelIdentifierFieldName: "certificateNumber",
  fields: [
    { name: "certificateNumber", label: "Certificate #", fieldType: FIELD_TYPES.TEXT, size: 150, config: { groupable: false } },
    { name: "holderName", label: "Holder", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "shareClass", label: "Class", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "shares", label: "Shares", fieldType: FIELD_TYPES.NUMBER, size: 110, config: { groupable: false } },
    { name: "issuedOn", label: "Issued on", fieldType: FIELD_TYPES.DATE, size: 130 },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 190,
      config: {
        options: [
          { value: "active", label: "Active", color: "green" },
          { value: "replacement", label: "Replacement", color: "blue" },
          { value: "cancelled", label: "Cancelled", color: "gray" },
        ],
      },
    },
    { name: "cancelledOn", label: "Cancelled on", fieldType: FIELD_TYPES.DATE, size: 130, isVisible: false },
    { name: "replacesCertificateNumber", label: "Replaces certificate", fieldType: FIELD_TYPES.TEXT, size: 150, isVisible: false },
  ],
});

function toCertificateRecord(c: Certificate): CertificateRecord {
  return {
    _id: c._id ?? c.certificateNumber,
    certificateNumber: c.certificateNumber,
    holderName: c.holderName,
    shareClass: c.shareClass,
    shares: c.shares,
    issuedOn: c.issuedOn,
    status: c.cancelledOn ? "cancelled" : c.replacesCertificateNumber ? "replacement" : "active",
    cancelledOn: c.cancelledOn ?? null,
    replacesCertificateNumber: c.replacesCertificateNumber ?? null,
    certificate: c,
  };
}

function renderCertificateCell({ record: { certificate }, field }: { record: CertificateRecord; field: FieldMetadata }) {
  // The register shows its stored date and its own status wording, as before.
  if (field.name === "issuedOn") return <span>{certificate.issuedOn}</span>;
  if (field.name === "status") return <span>{certificateStatusText(certificate)}</span>;
  return undefined;
}

function renderCertificateCard({ certificate }: CertificateRecord, { selecting }: RecordTableCardHelpers) {
  return (
    <RecordTablePhoneCard
      title={`${certificate.certificateNumber} · ${certificate.holderName}`}
      recordName={certificate.certificateNumber}
      meta={[`${certificate.shares.toLocaleString()} ${certificate.shareClass}`, certificate.issuedOn]}
      detail={[certificateStatusText(certificate)]}
      selecting={selecting}
    />
  );
}

type ReconciliationRow = {
  rightsClassId?: string;
  className: string;
  holderKey: string;
  holderName: string;
  certificateShares: number;
  ledgerShares: number;
  status: string;
};
type ReconciliationRecord = ReconciliationRow & { _id: string };

const RECONCILIATION = staticRecordTable({
  id: "certificate-reconciliation",
  nameSingular: "certificateReconciliationRow",
  namePlural: "certificateReconciliationRows",
  labelSingular: "Holding",
  labelPlural: "Holdings",
  labelIdentifierFieldName: "holderName",
  fields: [
    { name: "holderName", label: "Holder", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "className", label: "Class", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "certificateShares", label: "Certificates", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false } },
    { name: "ledgerShares", label: "Ledger", fieldType: FIELD_TYPES.NUMBER, size: 120, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 150,
      config: {
        options: [
          { value: "matched", label: RECONCILIATION_STATUS.matched, color: "green" },
          { value: "mismatch", label: RECONCILIATION_STATUS.mismatch, color: "red" },
          { value: "uncertificated", label: RECONCILIATION_STATUS.uncertificated, color: "orange" },
          { value: "no_ledger_holding", label: RECONCILIATION_STATUS.no_ledger_holding, color: "orange" },
        ],
      },
    },
  ],
});

function toReconciliationRecord(row: ReconciliationRow): ReconciliationRecord {
  return { ...row, _id: `${row.rightsClassId}:${row.holderKey}` };
}

function renderReconciliationCell({ record: row, field }: { record: ReconciliationRecord; field: FieldMetadata }) {
  if (field.name === "status") return <span>{RECONCILIATION_STATUS[row.status] ?? row.status}</span>;
  return undefined;
}

function renderReconciliationCard(row: ReconciliationRecord, { field, selecting }: RecordTableCardHelpers) {
  return (
    <RecordTablePhoneCard
      title={row.holderName}
      badge={field("status")}
      meta={[row.className, `Certificates ${row.certificateShares.toLocaleString()}`, `Ledger ${row.ledgerShares.toLocaleString()}`]}
      selecting={selecting}
    />
  );
}

export default CertificateRegisterPage;
