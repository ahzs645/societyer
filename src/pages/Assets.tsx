import { type SelectHTMLAttributes, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Link2,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  QrCode,
  Repeat2,
  ScanLine,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DataTable } from "../components/DataTable";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { Select as StyledSelect } from "../components/Select";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDate } from "../lib/format";
import { useToast } from "../components/Toast";
import { AssetQrLabel } from "../features/assets/AssetQrLabel";
import { AssetScanner } from "../features/assets/AssetScanner";
import { openGlobalAssetCreate } from "../components/GlobalAssetCreate";
import {
  AssetFormFields,
  useAssetFormData,
  type AssetFormValue,
} from "../features/assets/AssetFormFields";
import {
  ASSET_CATEGORIES,
  ASSET_CONDITIONS,
  ASSET_LABEL_TYPES,
  ASSET_STATUSES,
  CUSTODIAN_TYPES,
  MAINTENANCE_KINDS,
  assetUrl,
  assetsToCsv,
  centsToInput,
  downloadText,
  formFromAsset,
  inputToCents,
  isDue,
  money,
  normalizeAssetForm,
  parseAssetCsv,
  summarizeAssets,
  todayDate,
} from "../features/assets/assetUtils";

export function AssetsPage() {
  const society = useSociety();
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useCurrentUser();
  const assets = useQuery(api.assets.list, society ? { societyId: society._id } : "skip");
  const maintenance = useQuery(api.assets.maintenance, society ? { societyId: society._id } : "skip");
  const verificationRuns = useQuery(api.assets.verificationRuns, society ? { societyId: society._id } : "skip");
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const transactions = useQuery(api.financialHub.transactions, society ? { societyId: society._id, limit: 200 } : "skip");
  const create = useMutation(api.assets.create);
  const update = useMutation(api.assets.update);
  const addConsumableStock = useMutation(api.assets.addConsumableStock);
  const linkReceiptLine = useMutation(api.assets.linkReceiptLine);
  const remove = useMutation(api.assets.remove);
  const startVerificationRun = useMutation(api.assets.startVerificationRun);
  const [drawer, setDrawer] = useState<"new" | "edit" | "import" | "verify" | "stock" | "receiptLine" | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState<string | null>(null);
  const scanResult = useQuery(
    api.assets.resolveScan,
    society && scanCode ? { societyId: society._id, code: scanCode } : "skip",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [stockAsset, setStockAsset] = useState<any>(null);
  const [stockForm, setStockForm] = useState({ observedQuantityBefore: "", quantityAdded: "", notes: "" });
  const [receiptLinkAsset, setReceiptLinkAsset] = useState<any>(null);
  const [receiptLinkForm, setReceiptLinkForm] = useState({ receiptDocumentId: "", financialTransactionId: "", receiptLineLabel: "", receiptLineIndex: "", quantity: "", unitOfMeasure: "each", unitCost: "", totalCost: "", sourceText: "", notes: "", createInventoryItem: true });
  const formData = useAssetFormData(society?._id);
  const [form, setForm] = useState<AssetFormValue | null>(null);
  const [csvInput, setCsvInput] = useState("");
  const [verificationTitle, setVerificationTitle] = useState(`Physical inventory ${todayDate()}`);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "asset",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const rows = (assets ?? []) as any[];
  const stats = useMemo(() => summarizeAssets(rows, (maintenance ?? []) as any[], (verificationRuns ?? []) as any[]), [rows, maintenance, verificationRuns]);
  const records = useMemo(
    () => rows.map((row) => ({
      ...row,
      custodian: row.custodianName ?? "",
      value: row.bookValueCents ?? row.purchaseValueCents ?? 0,
      purchaseEvidence: row.receiptDocumentId || row.purchaseTransactionId ? "linked" : "",
    })),
    [rows],
  );

  useEffect(() => {
    if (!scanCode || scanResult === undefined) return;
    if (scanResult) {
      setScanOpen(false);
      setScanCode(null);
      navigate(`/app/assets/${scanResult._id}`);
    } else {
      toast.error("No asset found for that code", scanCode);
      setScanCode(null);
    }
  }, [scanResult, scanCode, navigate, toast]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openEdit = (row: any) => {
    setEditingId(row._id);
    setForm(formFromAsset(row) as AssetFormValue);
    setDrawer("edit");
  };

  const save = async () => {
    if (!form || !editingId || saving) return;
    const payload = normalizeAssetForm(form);
    if (!payload.assetTag || !payload.name) {
      toast.error("Asset tag and name are required.");
      return;
    }
    setSaving(true);
    try {
      await update({ id: editingId as any, patch: payload as any });
      toast.success("Asset updated");
      setDrawer(null);
    } catch (error: any) {
      toast.error("Could not update asset", error?.message);
    } finally {
      setSaving(false);
    }
  };

  const importRows = async () => {
    if (saving) return;
    const parsed = parseAssetCsv(csvInput).filter((row) => row.assetTag && row.name);
    if (!parsed.length) {
      toast.error("No valid rows found. Each row needs an assetTag and name.");
      return;
    }
    setSaving(true);
    let imported = 0;
    const failures: string[] = [];
    for (const row of parsed) {
      try {
        await create({ societyId: society._id, ...row, sourceDocumentIds: [] } as any);
        imported += 1;
      } catch (error: any) {
        failures.push(`${row.assetTag}: ${error?.message ?? "failed"}`);
      }
    }
    setSaving(false);
    if (imported) toast.success(`${imported} asset${imported === 1 ? "" : "s"} imported`);
    if (failures.length) {
      toast.error(`${failures.length} row${failures.length === 1 ? "" : "s"} skipped`, failures.slice(0, 3).join("; "));
    }
    if (imported) {
      setCsvInput("");
      setDrawer(null);
    }
  };

  const startVerification = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const id = await startVerificationRun({
        societyId: society._id,
        title: verificationTitle || `Physical inventory ${todayDate()}`,
        reviewerName: currentUser?.displayName || "Treasurer",
      });
      toast.success("Verification run started");
      setDrawer(null);
      if (id) navigate(`/app/assets/verification/${id}`);
    } catch (error: any) {
      toast.error("Could not start verification", error?.message);
    } finally {
      setSaving(false);
    }
  };

  const openStockIntake = (row: any) => {
    setStockAsset(row);
    setStockForm({ observedQuantityBefore: row.quantityOnHand?.toString?.() ?? "", quantityAdded: "", notes: "" });
    setDrawer("stock");
  };

  const saveStockIntake = async () => {
    if (!stockAsset || saving) return;
    const observedQuantityBefore = Number(stockForm.observedQuantityBefore);
    const quantityAdded = Number(stockForm.quantityAdded);
    if (!Number.isFinite(observedQuantityBefore) || observedQuantityBefore < 0 || !Number.isFinite(quantityAdded) || quantityAdded < 0) {
      toast.error("Enter non-negative counts for remaining and added quantities.");
      return;
    }
    setSaving(true);
    try {
      await addConsumableStock({
        assetId: stockAsset._id,
        observedQuantityBefore,
        quantityAdded,
        notes: stockForm.notes || undefined,
      });
      toast.success(`Stock updated to ${observedQuantityBefore + quantityAdded}`);
      setDrawer(null);
      setStockAsset(null);
    } catch (error: any) {
      toast.error("Could not update stock", error?.message);
    } finally {
      setSaving(false);
    }
  };

  const openReceiptLineLink = (row: any) => {
    setReceiptLinkAsset(row);
    setReceiptLinkForm({
      receiptDocumentId: row.receiptDocumentId ?? "",
      financialTransactionId: row.purchaseTransactionId ?? "",
      receiptLineLabel: row.name ?? "",
      receiptLineIndex: "",
      quantity: row.category === "Consumable" ? row.quantityOnHand?.toString?.() ?? "" : "1",
      unitOfMeasure: row.quantityUnit ?? "each",
      unitCost: centsToInput(row.purchaseValueCents),
      totalCost: centsToInput(row.purchaseValueCents),
      sourceText: "",
      notes: "",
      createInventoryItem: true,
    });
    setDrawer("receiptLine");
  };

  const saveReceiptLineLink = async () => {
    if (!receiptLinkAsset || saving) return;
    if (!receiptLinkForm.receiptDocumentId) {
      toast.error("Choose a receipt document to link.");
      return;
    }
    setSaving(true);
    try {
      await linkReceiptLine({
        societyId: society._id,
        assetId: receiptLinkAsset._id,
        receiptDocumentId: receiptLinkForm.receiptDocumentId as any,
        financialTransactionId: receiptLinkForm.financialTransactionId ? receiptLinkForm.financialTransactionId as any : undefined,
        receiptLineLabel: receiptLinkForm.receiptLineLabel || undefined,
        receiptLineIndex: receiptLinkForm.receiptLineIndex ? Number(receiptLinkForm.receiptLineIndex) : undefined,
        quantity: receiptLinkForm.quantity ? Number(receiptLinkForm.quantity) : undefined,
        unitOfMeasure: receiptLinkForm.unitOfMeasure || undefined,
        unitCostCents: inputToCents(receiptLinkForm.unitCost),
        totalCostCents: inputToCents(receiptLinkForm.totalCost),
        sourceText: receiptLinkForm.sourceText || undefined,
        notes: receiptLinkForm.notes || undefined,
        createInventoryItem: receiptLinkForm.createInventoryItem,
      } as any);
      toast.success("Receipt line linked");
      setDrawer(null);
      setReceiptLinkAsset(null);
    } catch (error: any) {
      toast.error("Could not link receipt line", error?.message);
    } finally {
      setSaving(false);
    }
  };

  const removeAsset = async (row: any) => {
    if (saving) return;
    if (!window.confirm(`Delete asset ${row.assetTag} — ${row.name}? This also removes its custody, maintenance, verification, and receipt-link history. This cannot be undone.`)) {
      return;
    }
    setSaving(true);
    try {
      await remove({ id: row._id });
      toast.success("Asset deleted", `${row.assetTag} — ${row.name}`);
    } catch (error: any) {
      toast.error("Could not delete asset", error?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Assets"
        subtitle="Asset register, QR labels, custody, grant restrictions, maintenance, insurance, finance, verification, and disposal evidence."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <MoreActionsMenu
              items={[
                { id: "export", label: "Export CSV", icon: <Download size={14} />, onSelect: () => downloadText(`societyer-assets-${todayDate()}.csv`, assetsToCsv(rows)) },
                { id: "import", label: "Import CSV", icon: <Upload size={14} />, onSelect: () => setDrawer("import") },
                { id: "verify", label: "Start verification", icon: <ClipboardCheck size={14} />, onSelect: () => setDrawer("verify") },
              ]}
            />
            <button className="btn-action" onClick={() => setScanOpen(true)}>
              <ScanLine size={12} /> Scan
            </button>
            <button className="btn-action btn-action--primary" onClick={openGlobalAssetCreate}>
              <Plus size={12} /> New asset
            </button>
          </div>
        }
      />

      <div className="stat-grid">
        <Stat label="Assets" value={stats.total} sub={`${stats.active} active`} />
        <Stat label="Checked out" value={stats.checkedOut} sub="assigned custody" tone={stats.checkedOut ? "info" : undefined} />
        <Stat label="Review flags" value={stats.needsReview} sub="condition or status" tone={stats.needsReview ? "warn" : undefined} />
        <Stat label="Register value" value={money(stats.valueCents)} sub={`${stats.dueMaintenance} due soon`} tone={stats.dueMaintenance ? "warn" : undefined} />
      </div>

      {stats.openRun && (
        <div className="callout callout--info">
          <ClipboardCheck size={16} />
          <div>
            <strong>{stats.openRun.title}</strong>
            <div className="muted">A physical inventory run is open.</div>
          </div>
          <Link className="btn btn--sm" to={`/app/assets/verification/${stats.openRun._id}`}>Open</Link>
        </div>
      )}

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="asset" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="assets"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(recordId) => navigate(`/app/assets/${recordId}`)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Package size={14} />}
            label="All inventory"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || assets === undefined}
            renderCell={({ record: row, field }) => {
              if (field.name === "assetTag") return <span className="mono">{row.assetTag}</span>;
              if (field.name === "name") return <AssetCell row={row} />;
              if (field.name === "status") return <StatusBadge status={row.status} />;
              if (field.name === "custodian") return <CustodyCell row={row} />;
              if (field.name === "location") return <span>{row.location}</span>;
              if (field.name === "quantityOnHand") return row.category === "Consumable" ? <span className="mono">{formatQuantity(row.quantityOnHand, row.quantityUnit)}</span> : <span className="muted">—</span>;
              if (field.name === "value") return <span className="mono">{money(row.bookValueCents ?? row.purchaseValueCents, row.currency)}</span>;
              if (field.name === "nextMaintenanceDate") return <DueDate date={row.nextMaintenanceDate} />;
              if (field.name === "purchaseEvidence") return <EvidenceCell row={row} documents={documents ?? []} transactions={transactions ?? []} />;
              return undefined;
            }}
            renderRowActions={(row) => (
              <>
                {row.category === "Consumable" && society.consumableIntakeCountPromptEnabled && (
                  <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); openStockIntake(row); }}>
                    <ClipboardList size={12} /> Add stock
                  </button>
                )}
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); openReceiptLineLink(row); }}>
                  <Link2 size={12} /> Link receipt item
                </button>
                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); openEdit(row); }}>
                  <Pencil size={12} /> Edit
                </button>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Delete ${row.assetTag}`} onClick={(e) => { e.stopPropagation(); removeAsset(row); }}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={drawer === "edit"}
        onClose={() => setDrawer(null)}
        title="Edit asset"
        size="wide"
        footer={
          <>
            <button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save asset"}</button>
          </>
        }
      >
        {form && (
          <AssetFormFields
            value={form}
            onChange={(patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            data={formData}
            autoFocusName={false}
          />
        )}
      </Drawer>

      <Drawer
        open={drawer === "stock"}
        onClose={() => setDrawer(null)}
        title={stockAsset ? `Add stock: ${stockAsset.name}` : "Add consumable stock"}
        footer={
          <>
            <button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--accent" onClick={saveStockIntake} disabled={saving}>{saving ? "Saving…" : "Update stock"}</button>
          </>
        }
      >
        <div className="form-grid">
          <Field label="Current amount left" hint="Count what is still on hand before adding the new stock.">
            <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={stockForm.observedQuantityBefore} onChange={(event) => setStockForm({ ...stockForm, observedQuantityBefore: event.target.value })} />
          </Field>
          <Field label="Amount being added">
            <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={stockForm.quantityAdded} onChange={(event) => setStockForm({ ...stockForm, quantityAdded: event.target.value })} />
          </Field>
          <Field label="Resulting total">
            <input className="input" readOnly value={stockTotalPreview(stockForm)} />
          </Field>
          <Field label="Notes">
            <textarea className="textarea" rows={3} value={stockForm.notes} onChange={(event) => setStockForm({ ...stockForm, notes: event.target.value })} />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={drawer === "receiptLine"}
        onClose={() => setDrawer(null)}
        title={receiptLinkAsset ? `Link receipt item: ${receiptLinkAsset.name}` : "Link receipt item"}
        size="wide"
        footer={
          <>
            <button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--accent" onClick={saveReceiptLineLink} disabled={saving}>{saving ? "Saving…" : "Link item"}</button>
          </>
        }
      >
        <ReceiptLineLinkForm
          form={receiptLinkForm}
          setForm={setReceiptLinkForm}
          documents={documents ?? []}
          transactions={transactions ?? []}
        />
      </Drawer>

      <Drawer
        open={drawer === "import"}
        onClose={() => setDrawer(null)}
        title="Import assets from CSV"
        size="wide"
        footer={
          <>
            <button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--accent" onClick={importRows} disabled={saving}><FileSpreadsheet size={14} /> {saving ? "Importing…" : "Import"}</button>
          </>
        }
      >
        <Field label="CSV rows" hint="Headers should match the export format. assetTag and name are required.">
          <textarea className="textarea" rows={14} value={csvInput} onChange={(event) => setCsvInput(event.target.value)} />
        </Field>
      </Drawer>

      <Drawer
        open={drawer === "verify"}
        onClose={() => setDrawer(null)}
        title="Start physical inventory"
        footer={
          <>
            <button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button>
            <button className="btn btn--accent" onClick={startVerification} disabled={saving}><ClipboardCheck size={14} /> {saving ? "Starting…" : "Start"}</button>
          </>
        }
      >
        <Field label="Run title">
          <input className="input" value={verificationTitle} onChange={(event) => setVerificationTitle(event.target.value)} />
        </Field>
        <p className="muted">This creates a verification checklist for every current asset in the register.</p>
      </Drawer>

      <AssetScanner
        open={scanOpen}
        onClose={() => { setScanOpen(false); setScanCode(null); }}
        onDetected={(code) => setScanCode(code)}
        title="Scan an asset"
        hint="Point the camera at an asset's QR code or barcode to open its record."
      />
    </div>
  );
}

export function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const bundle = useQuery(api.assets.bundle, id ? { id: id as any } : "skip");
  const society = useSociety();
  const documents = useQuery(api.documents.list, society ? { societyId: society._id } : "skip");
  const transactions = useQuery(api.financialHub.transactions, society ? { societyId: society._id, limit: 200 } : "skip");
  const formData = useAssetFormData(society?._id);
  const update = useMutation(api.assets.update);
  const recordEvent = useMutation(api.assets.recordEvent);
  const scheduleMaintenance = useMutation(api.assets.scheduleMaintenance);
  const completeMaintenance = useMutation(api.assets.completeMaintenance);
  const dispose = useMutation(api.assets.dispose);
  const [drawer, setDrawer] = useState<"edit" | "custody" | "maintenance" | "disposal" | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AssetFormValue | null>(null);
  const [eventForm, setEventForm] = useState<any>({ eventType: "checkout", toCustodianType: "member", toCustodianName: "", responsiblePersonName: "", location: "", condition: "Good", expectedReturnDate: "", acceptanceSignature: "", notes: "" });
  const [maintenanceForm, setMaintenanceForm] = useState<any>({ title: "Asset maintenance", kind: "maintenance", dueDate: todayDate(), createTask: true, notes: "" });
  const [disposalForm, setDisposalForm] = useState<any>({ disposedAt: todayDate(), disposalMethod: "sold", disposalReason: "", disposalValue: "", notes: "" });
  const [labelType, setLabelType] = useState("qr");

  useEffect(() => {
    if (bundle?.asset) setLabelType(bundle.asset.preferredLabelType ?? "qr");
  }, [bundle?.asset?._id, bundle?.asset?.preferredLabelType]);

  if (bundle === undefined) return <PageLoading />;
  if (!bundle) return <div className="page"><Link className="btn" to="/app/assets"><ArrowLeft size={14} /> Assets</Link><p>Asset not found.</p></div>;
  const { asset, events, maintenance } = bundle;
  const receiptDocument = (documents ?? []).find((doc: any) => doc._id === asset.receiptDocumentId);
  const purchaseTransaction = (transactions ?? []).find((txn: any) => txn._id === asset.purchaseTransactionId);

  const openEdit = () => {
    setForm(formFromAsset(asset) as AssetFormValue);
    setDrawer("edit");
  };

  const runSave = async (label: string, fn: () => Promise<unknown>, success: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await fn();
      toast.success(success);
      setDrawer(null);
    } catch (error: any) {
      toast.error(label, error?.message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!form) return;
    await runSave("Could not update asset", () => update({ id: asset._id, patch: normalizeAssetForm(form) as any }), "Asset updated");
  };

  const saveEvent = async () => {
    await runSave("Could not record custody event", () => recordEvent({ assetId: asset._id, event: cleanEvent(eventForm) }), "Custody event recorded");
  };

  const saveMaintenance = async () => {
    await runSave("Could not schedule maintenance", () => scheduleMaintenance({ assetId: asset._id, ...maintenanceForm }), "Maintenance scheduled");
  };

  const saveDisposal = async () => {
    await runSave(
      "Could not dispose asset",
      () => dispose({
        assetId: asset._id,
        disposedAt: disposalForm.disposedAt,
        disposalMethod: disposalForm.disposalMethod,
        disposalReason: disposalForm.disposalReason,
        disposalValueCents: inputToCents(disposalForm.disposalValue),
        notes: disposalForm.notes,
      }),
      "Asset disposed",
    );
  };

  return (
    <div className="page">
      <PageHeader
        title={asset.assetTag}
        subtitle={asset.name}
        routeKey="/app/assets"
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link className="btn-action" to="/app/assets"><ArrowLeft size={12} /> Assets</Link>
            <button className="btn-action" onClick={() => setDrawer("custody")}><Repeat2 size={12} /> Custody</button>
            <button className="btn-action" onClick={() => setDrawer("maintenance")}><Wrench size={12} /> Schedule</button>
            <button className="btn-action" onClick={() => setDrawer("disposal")}><Trash2 size={12} /> Dispose</button>
            <button className="btn-action btn-action--primary" onClick={openEdit}><Pencil size={12} /> Edit</button>
          </div>
        }
      />

      <div className="asset-detail-grid">
        <section className="panel">
          <div className="panel__head"><h2>Register</h2><StatusBadge status={asset.status} /></div>
          {asset.imageUrl && (
            <img
              src={asset.imageUrl}
              alt={`Photo of ${asset.name}`}
              style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border, #d8dadf)", marginBottom: 12 }}
            />
          )}
          <dl className="record-kv">
            <div><dt>Category</dt><dd>{asset.category}</dd></div>
            <div><dt>Serial</dt><dd className="mono">{asset.serialNumber || "—"}</dd></div>
            <div><dt>Condition</dt><dd>{asset.condition}</dd></div>
            <div><dt>Quantity on hand</dt><dd>{asset.category === "Consumable" ? formatQuantity(asset.quantityOnHand, asset.quantityUnit) : "—"}</dd></div>
            <div><dt>Location</dt><dd>{asset.location || "—"}</dd></div>
            <div><dt>Responsible person</dt><dd>{asset.responsiblePersonName || "—"}</dd></div>
            <div><dt>Custodian</dt><dd>{asset.custodianName || "—"}</dd></div>
            <div><dt>Supplier</dt><dd>{asset.supplier || "—"}</dd></div>
            <div><dt>Purchase date</dt><dd>{formatDate(asset.purchaseDate)}</dd></div>
            <div><dt>Purchase value</dt><dd>{money(asset.purchaseValueCents, asset.currency)}</dd></div>
            <div><dt>Book value</dt><dd>{money(asset.bookValueCents, asset.currency)}</dd></div>
            <div><dt>Receipt</dt><dd>{receiptDocument ? <Link to={`/app/documents/${receiptDocument._id}`}>{receiptDocument.title}</Link> : "—"}</dd></div>
            <div><dt>Purchase transaction</dt><dd>{purchaseTransaction ? `${formatDate(purchaseTransaction.date)} · ${purchaseTransaction.description} · ${money(Math.abs(purchaseTransaction.amountCents), asset.currency)}` : "—"}</dd></div>
          </dl>
        </section>
        <section className="panel">
          <div className="panel__head"><h2>QR label</h2><QrCode size={16} /></div>
          <Field label="Label type">
            <StyledSelect
              value={labelType}
              onChange={(value) => setLabelType(value)}
              options={ASSET_LABEL_TYPES.map((type) => ({ value: type.value, label: type.label }))}
            />
          </Field>
          <AssetQrLabel assetTag={asset.assetTag} name={asset.name} url={assetUrl(asset._id)} labelType={labelType} />
          <button className="btn btn--sm" onClick={() => window.print()}>Print label</button>
        </section>
        <section className="panel">
          <div className="panel__head"><h2>Maintenance and warranty</h2><Wrench size={16} /></div>
          <dl className="record-kv">
            <div><dt>Warranty expires</dt><dd>{asset.warrantyExpiresAt ? <DueDate date={asset.warrantyExpiresAt} /> : "—"}</dd></div>
            <div><dt>Next maintenance</dt><dd>{asset.nextMaintenanceDate ? <DueDate date={asset.nextMaintenanceDate} /> : "—"}</dd></div>
            <div><dt>Next verification</dt><dd>{asset.nextVerificationDate ? <DueDate date={asset.nextVerificationDate} /> : "—"}</dd></div>
          </dl>
        </section>
        <section className="panel">
          <div className="panel__head"><h2>Grant and compliance</h2></div>
          <dl className="record-kv">
            <div><dt>Funding source</dt><dd>{asset.fundingSource || "—"}</dd></div>
            <div><dt>Grant restrictions</dt><dd>{asset.grantRestrictions || "—"}</dd></div>
            <div><dt>Retention until</dt><dd>{formatDate(asset.retentionUntil)}</dd></div>
            <div><dt>Disposal rules</dt><dd>{asset.disposalRules || "—"}</dd></div>
            <div><dt>Insurance notes</dt><dd>{asset.insuranceNotes || "—"}</dd></div>
          </dl>
        </section>
      </div>

      <DataTable
        label="Maintenance"
        icon={<Wrench size={14} />}
        data={maintenance}
        rowKey={(row) => row._id as string}
        columns={[
          { id: "title", header: "Title", accessor: (row) => row.title },
          { id: "kind", header: "Kind", accessor: (row) => row.kind, render: (row) => <span className="cell-tag">{row.kind}</span> },
          { id: "dueDate", header: "Due", sortable: true, accessor: (row) => row.dueDate, render: (row) => <DueDate date={row.dueDate} /> },
          { id: "status", header: "Status", accessor: (row) => row.status, render: (row) => <Badge tone={row.status === "Completed" ? "success" : "warn"}>{row.status}</Badge> },
        ]}
        renderRowActions={(row) => row.status !== "Completed" ? (
          <button className="btn btn--ghost btn--sm" onClick={() => completeMaintenance({ id: row._id, completedAtISO: new Date().toISOString(), notes: row.notes })}>
            <CheckCircle2 size={12} /> Done
          </button>
        ) : null}
      />

      <DataTable
        label="Custody and audit history"
        icon={<ClipboardCheck size={14} />}
        data={events}
        rowKey={(row) => row._id as string}
        defaultSort={{ columnId: "happenedAtISO", dir: "desc" }}
        columns={[
          { id: "happenedAtISO", header: "Date", sortable: true, accessor: (row) => row.happenedAtISO, render: (row) => <span className="mono">{formatDate(row.happenedAtISO)}</span> },
          { id: "eventType", header: "Event", accessor: (row) => row.eventType, render: (row) => <span className="cell-tag">{row.eventType}</span> },
          { id: "custody", header: "Custody", accessor: (row) => row.toCustodianName, render: (row) => row.toCustodianName || row.location || "—" },
          { id: "condition", header: "Condition", accessor: (row) => row.condition },
          { id: "quantity", header: "Quantity", accessor: (row) => row.quantityAfter ?? row.quantityAdded, render: (row) => row.quantityAfter == null ? "—" : `${row.observedQuantityBefore ?? "—"} + ${row.quantityAdded ?? "—"} = ${row.quantityAfter}` },
          { id: "notes", header: "Notes", accessor: (row) => row.notes },
        ]}
      />

      <Drawer open={drawer === "edit"} onClose={() => setDrawer(null)} title="Edit asset" size="wide" footer={<><button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button><button className="btn btn--accent" onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : "Save"}</button></>}>
        {form && (
          <AssetFormFields
            value={form}
            onChange={(patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            data={formData}
            autoFocusName={false}
          />
        )}
      </Drawer>
      <Drawer open={drawer === "custody"} onClose={() => setDrawer(null)} title="Record custody event" footer={<><button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button><button className="btn btn--accent" onClick={saveEvent} disabled={saving}>{saving ? "Saving…" : "Record"}</button></>}>
        <CustodyForm form={eventForm} setForm={setEventForm} />
      </Drawer>
      <Drawer open={drawer === "maintenance"} onClose={() => setDrawer(null)} title="Schedule maintenance" footer={<><button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button><button className="btn btn--accent" onClick={saveMaintenance} disabled={saving}>{saving ? "Saving…" : "Schedule"}</button></>}>
        <MaintenanceForm form={maintenanceForm} setForm={setMaintenanceForm} />
      </Drawer>
      <Drawer open={drawer === "disposal"} onClose={() => setDrawer(null)} title="Dispose asset" footer={<><button className="btn" onClick={() => setDrawer(null)} disabled={saving}>Cancel</button><button className="btn btn--danger" onClick={saveDisposal} disabled={saving}>{saving ? "Disposing…" : "Dispose"}</button></>}>
        <DisposalForm form={disposalForm} setForm={setDisposalForm} />
      </Drawer>
    </div>
  );
}

export function AssetVerificationPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const society = useSociety();
  const currentUser = useCurrentUser();
  const items = useQuery(api.assets.verificationItems, runId ? { runId: runId as any } : "skip");
  const assets = useQuery(api.assets.list, society ? { societyId: society._id } : "skip");
  const verifyAsset = useMutation(api.assets.verifyAsset);
  const completeRun = useMutation(api.assets.completeVerificationRun);
  const verifierName = currentUser?.displayName || "Treasurer";
  const toast = useToast();
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState<string | null>(null);
  const scanResult = useQuery(
    api.assets.resolveScan,
    society && scanCode ? { societyId: society._id, code: scanCode } : "skip",
  );
  const assetById = new Map(((assets ?? []) as any[]).map((asset) => [asset._id, asset]));
  const rows = ((items ?? []) as any[]).map((item) => ({ ...item, asset: assetById.get(item.assetId) }));
  const pending = rows.filter((row) => row.status === "pending").length;

  useEffect(() => {
    if (!scanCode || scanResult === undefined) return;
    const code = scanCode;
    setScanCode(null);
    if (!scanResult) {
      toast.error("No asset found for that code", code);
      return;
    }
    const item = rows.find((row) => row.assetId === scanResult._id);
    if (!item) {
      toast.error("Not in this run", `${scanResult.assetTag} — ${scanResult.name}`);
      return;
    }
    if (item.status === "verified") {
      toast.info("Already verified", `${scanResult.assetTag} — ${scanResult.name}`);
      return;
    }
    void verifyAsset({
      itemId: item._id,
      status: "verified",
      verifiedByName: verifierName,
      observedLocation: scanResult.location,
      observedCondition: scanResult.condition,
    }).then(() => toast.success("Verified by scan", `${scanResult.assetTag} — ${scanResult.name}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResult, scanCode]);

  return (
    <div className="page">
      <PageHeader
        title="Physical inventory"
        routeKey="/app/assets"
        subtitle={`${pending} asset${pending === 1 ? "" : "s"} still pending.`}
        actions={<><Link className="btn-action" to="/app/assets"><ArrowLeft size={12} /> Assets</Link><button className="btn-action" onClick={() => setScanOpen(true)}><ScanLine size={12} /> Scan to verify</button><button className="btn-action btn-action--primary" onClick={async () => { await completeRun({ id: runId as any }); navigate("/app/assets"); }}><CheckCircle2 size={12} /> Complete run</button></>}
      />
      <DataTable
        label="Verification checklist"
        icon={<CalendarCheck size={14} />}
        data={rows}
        rowKey={(row) => row._id as string}
        loading={items === undefined || assets === undefined}
        columns={[
          { id: "assetTag", header: "Tag", accessor: (row) => row.asset?.assetTag, render: (row) => <span className="mono">{row.asset?.assetTag ?? row.assetId}</span> },
          { id: "name", header: "Asset", accessor: (row) => row.asset?.name },
          { id: "location", header: "Expected location", accessor: (row) => row.asset?.location },
          { id: "condition", header: "Expected condition", accessor: (row) => row.asset?.condition },
          { id: "status", header: "Status", accessor: (row) => row.status, render: (row) => <Badge tone={row.status === "verified" ? "success" : row.status === "pending" ? "neutral" : "warn"}>{row.status}</Badge> },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => verifyAsset({ itemId: row._id, status: "verified", verifiedByName: verifierName, observedLocation: row.asset?.location, observedCondition: row.asset?.condition })}>
              <CheckCircle2 size={12} /> Verified
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => verifyAsset({ itemId: row._id, status: "missing", verifiedByName: verifierName })}>
              Missing
            </button>
          </>
        )}
      />

      <AssetScanner
        open={scanOpen}
        onClose={() => { setScanOpen(false); setScanCode(null); }}
        onDetected={(code) => setScanCode(code)}
        continuous
        title="Scan to verify"
        hint="Scan each asset's code to mark it verified. Keep scanning to work through the shelf."
      />
    </div>
  );
}

function ReceiptLineLinkForm({
  form,
  setForm,
  documents,
  transactions,
}: {
  form: any;
  setForm: (form: any) => void;
  documents: any[];
  transactions: any[];
}) {
  const receiptDocuments = documents.filter((doc) =>
    doc.category === "Receipt" ||
    doc.category === "FinancialStatement" ||
    (doc.tags ?? []).some((tag: string) => /receipt|invoice|finance/i.test(tag)),
  );
  const purchaseTransactions = transactions.filter((txn) => txn.amountCents < 0);
  return (
    <div className="form-grid">
      <Field label="Receipt document" required>
        <StyledSelect
          value={form.receiptDocumentId}
          onChange={(value) => setForm({ ...form, receiptDocumentId: value })}
          options={[
            { value: "", label: "Choose receipt or invoice" },
            ...receiptDocuments.map((doc) => ({ value: doc._id, label: doc.title })),
          ]}
        />
      </Field>
      <Field label="Financial transaction">
        <StyledSelect
          value={form.financialTransactionId}
          onChange={(value) => setForm({ ...form, financialTransactionId: value })}
          options={[
            { value: "", label: "No transaction linked" },
            ...purchaseTransactions.map((txn) => ({ value: txn._id, label: `${txn.date} · ${txn.description} · ${money(Math.abs(txn.amountCents))}` })),
          ]}
        />
      </Field>
      <Field label="Receipt line label">
        <input className="input" value={form.receiptLineLabel} onChange={(event) => setForm({ ...form, receiptLineLabel: event.target.value })} />
      </Field>
      <Field label="Line number">
        <input className="input" type="number" inputMode="numeric" min="0" value={form.receiptLineIndex} onChange={(event) => setForm({ ...form, receiptLineIndex: event.target.value })} />
      </Field>
      <Field label="Quantity">
        <input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
      </Field>
      <Field label="Unit">
        <input className="input" value={form.unitOfMeasure} onChange={(event) => setForm({ ...form, unitOfMeasure: event.target.value })} />
      </Field>
      <Field label="Unit cost">
        <input className="input" inputMode="decimal" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} />
      </Field>
      <Field label="Total cost">
        <input className="input" inputMode="decimal" value={form.totalCost} onChange={(event) => setForm({ ...form, totalCost: event.target.value })} />
      </Field>
      <Field label="Inventory">
        <label className="checkbox">
          <input type="checkbox" checked={Boolean(form.createInventoryItem)} onChange={(event) => setForm({ ...form, createInventoryItem: event.target.checked })} />
          Link this asset to an inventory item
        </label>
      </Field>
      <Field label="Receipt line text">
        <textarea className="textarea" rows={3} value={form.sourceText} onChange={(event) => setForm({ ...form, sourceText: event.target.value })} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      </Field>
    </div>
  );
}
function CustodyForm({ form, setForm }: { form: any; setForm: (form: any) => void }) {
  return (
    <div className="form-grid">
      <Field label="Event"><Select value={form.eventType} options={["checkout", "checkin", "transfer", "note"]} onChange={(eventType) => setForm({ ...form, eventType })} /></Field>
      <Field label="Custodian type"><Select value={form.toCustodianType} options={CUSTODIAN_TYPES} onChange={(toCustodianType) => setForm({ ...form, toCustodianType })} /></Field>
      <Field label="Custodian"><input className="input" value={form.toCustodianName} onChange={(event) => setForm({ ...form, toCustodianName: event.target.value })} /></Field>
      <Field label="Responsible person"><input className="input" value={form.responsiblePersonName} onChange={(event) => setForm({ ...form, responsiblePersonName: event.target.value })} /></Field>
      <Field label="Location"><input className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field>
      <Field label="Condition"><Select value={form.condition} options={ASSET_CONDITIONS} onChange={(condition) => setForm({ ...form, condition })} /></Field>
      <Field label="Expected return"><DatePicker value={form.expectedReturnDate} onChange={(value) => setForm({ ...form, expectedReturnDate: value })} /></Field>
      <Field label="Acceptance signature"><input className="input" value={form.acceptanceSignature} onChange={(event) => setForm({ ...form, acceptanceSignature: event.target.value })} /></Field>
      <Field label="Notes"><MarkdownEditor rows={4} value={form.notes} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
    </div>
  );
}

function MaintenanceForm({ form, setForm }: { form: any; setForm: (form: any) => void }) {
  return (
    <div className="form-grid">
      <Field label="Title"><input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
      <Field label="Kind"><Select value={form.kind} options={MAINTENANCE_KINDS} onChange={(kind) => setForm({ ...form, kind })} /></Field>
      <Field label="Due date"><DatePicker value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} /></Field>
      <Field label="Create task"><label className="checkbox"><input type="checkbox" checked={Boolean(form.createTask)} onChange={(event) => setForm({ ...form, createTask: event.target.checked })} /> Add to Tasks</label></Field>
      <Field label="Notes"><MarkdownEditor rows={4} value={form.notes} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
    </div>
  );
}

function DisposalForm({ form, setForm }: { form: any; setForm: (form: any) => void }) {
  return (
    <div className="form-grid">
      <Field label="Disposed at"><DatePicker value={form.disposedAt} onChange={(value) => setForm({ ...form, disposedAt: value })} /></Field>
      <Field label="Method"><Select value={form.disposalMethod} options={["sold", "donated", "recycled", "destroyed", "lost", "returned to funder"]} onChange={(disposalMethod) => setForm({ ...form, disposalMethod })} /></Field>
      <Field label="Disposal value"><input className="input" value={form.disposalValue} onChange={(event) => setForm({ ...form, disposalValue: event.target.value })} /></Field>
      <Field label="Reason"><MarkdownEditor rows={3} value={form.disposalReason} onChange={(markdown) => setForm({ ...form, disposalReason: markdown })} /></Field>
      <Field label="Notes"><MarkdownEditor rows={3} value={form.notes} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
  ...props
}: {
  value?: string;
  options: string[];
  onChange: (value: string) => void;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select {...props} className="input" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

function AssetCell({ row }: { row: any }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "nowrap" }}>
      {row.imageUrl && (
        <img className="asset-cell__thumb" src={row.imageUrl} alt="" style={{ width: 32, height: 32, flex: "0 0 auto", borderRadius: 6, objectFit: "cover", border: "1px solid var(--border, #d8dadf)" }} />
      )}
      <div>
        <strong>{row.name}</strong>
        <div className="muted">{[row.category, row.serialNumber].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}

function CustodyCell({ row }: { row: any }) {
  return (
    <div>
      <strong>{row.custodianName || "Unassigned"}</strong>
      <div className="muted">{row.responsiblePersonName || row.custodianType || "No responsible person"}</div>
    </div>
  );
}

function EvidenceCell({ row, documents, transactions }: { row: any; documents: any[]; transactions: any[] }) {
  const doc = documents.find((candidate) => candidate._id === row.receiptDocumentId);
  const txn = transactions.find((candidate) => candidate._id === row.purchaseTransactionId);
  if (!doc && !txn) return <span className="muted">No receipt linked</span>;
  return (
    <div>
      {doc ? <Link to={`/app/documents/${doc._id}`}>{doc.title}</Link> : <span className="muted">No receipt document</span>}
      {txn && <div className="muted">{formatDate(txn.date)} · {txn.description}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const tone = status === "Available" ? "success" : status === "Checked out" ? "info" : status === "Disposed" || status === "Lost" ? "danger" : "warn";
  return <Badge tone={tone as any}>{status || "Unknown"}</Badge>;
}

function DueDate({ date }: { date?: string }) {
  if (!date) return <span className="muted">Not scheduled</span>;
  return <Badge tone={isDue(date, 0) ? "danger" : isDue(date, 30) ? "warn" : "neutral"}>{formatDate(date)}</Badge>;
}

function formatQuantity(quantity?: number | null, unit?: string | null) {
  if (quantity == null) return "—";
  return `${quantity.toLocaleString("en-CA")}${unit ? ` ${unit}` : ""}`;
}

function stockTotalPreview(form: { observedQuantityBefore: string; quantityAdded: string }) {
  const observed = Number(form.observedQuantityBefore);
  const added = Number(form.quantityAdded);
  if (!Number.isFinite(observed) || !Number.isFinite(added)) return "";
  return String(observed + added);
}

function Stat({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: "info" | "warn" | "danger" }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function cleanEvent(form: any) {
  return {
    eventType: form.eventType,
    toCustodianType: form.toCustodianType || undefined,
    toCustodianName: form.toCustodianName || undefined,
    responsiblePersonName: form.responsiblePersonName || undefined,
    location: form.location || undefined,
    condition: form.condition || undefined,
    expectedReturnDate: form.expectedReturnDate || undefined,
    acceptanceSignature: form.acceptanceSignature || undefined,
    notes: form.notes || undefined,
  };
}
