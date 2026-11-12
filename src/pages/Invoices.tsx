import { Select } from "../components/Select";
import { InvoiceTemplatesPanel } from "../features/invoicing/InvoiceTemplatesPanel";
import { PriceListsPanel } from "../features/invoicing/PriceListsPanel";
import { QuotesPanel } from "../features/invoicing/QuotesPanel";
import { CustomerStatementsPanel } from "../features/invoicing/CustomerStatementsPanel";
import { BillingAutomationPanel } from "../features/invoicing/BillingAutomationPanel";
import { RepairJobsPanel } from "../features/invoicing/RepairJobsPanel";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { Ban, Bell, BookCheck, Download, FileCheck2, FileSpreadsheet, FileText, Landmark, Plus, ReceiptText, Send, Settings2, Users, X } from "lucide-react";
import type { BulkAction } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Banner, EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import { StatStrip, StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { pluralize } from "../lib/format";
import { downloadTableExport, readLastExportFormat, rememberExportFormat, type TableExportFormat } from "../lib/tableExport";
import { addDays, isOpenStatus, partyKey, invoiceCurrencySummary, invoiceCashActivity, summarizeCustomers } from "../../shared/invoicing";
import { isSociety } from "../../shared/organizationDomain";
import { InvoiceGlMappingDrawer } from "../features/invoicing/InvoiceGlMappingDrawer";
import { PostExistingInvoicesModal } from "../features/invoicing/PostExistingInvoicesModal";
import { InvoiceBuilder } from "../features/invoicing/InvoiceBuilder";
import { InvoiceDetailDrawer } from "../features/invoicing/InvoiceDetailDrawer";
import { CatalogPanel } from "../features/invoicing/CatalogPanel";
import { CustomersPanel } from "../features/invoicing/CustomersPanel";
import { SeriesPanel } from "../features/invoicing/SeriesPanel";
import { DuesGeneratorModal } from "../features/invoicing/DuesGeneratorModal";
import { InvoiceSettingsDrawer } from "../features/invoicing/InvoiceSettingsDrawer";
import type { BillToValue } from "../features/invoicing/BillToPicker";
import type { InvoiceRow, InvoiceTab, InvoiceWorkspace } from "../features/invoicing/types";
import { invoiceExportSheet, invoiceExportTextRows } from "../features/invoicing/invoiceExport";

import { useInvoiceCollections } from "../features/invoicing/useInvoiceCollections";
import { InvoiceListTable } from "../features/invoicing/InvoiceListTable";
import "../features/invoicing/invoiceViews.css";

const TABS: InvoiceTab[] = ["all", "drafts", "outstanding", "overdue", "paid", "needs_action", "recurring", "customers", "catalog", "templates", "price_lists", "repairs", "quotes", "statements", "automation"];
const LIST_TABS = new Set<InvoiceTab>(["all", "drafts", "outstanding", "overdue", "paid", "needs_action"]);
const SECTIONS = [
  { id: "invoices", label: "Invoices", tabs: ["all", "drafts", "outstanding", "overdue", "paid", "needs_action", "recurring"] },
  { id: "quotes", label: "Quotes", tabs: ["quotes"] },
  { id: "customers", label: "Customers", tabs: ["customers", "statements"] },
  { id: "items", label: "Items & pricing", tabs: ["catalog", "price_lists"] },
  { id: "repairs", label: "Repairs", tabs: ["repairs"] },
  { id: "setup", label: "Setup", tabs: ["templates", "automation"] },
] as const satisfies readonly { id: string; label: string; tabs: readonly InvoiceTab[] }[];
type InvoiceSection = (typeof SECTIONS)[number]["id"];
const sectionForTab = (tab: InvoiceTab) => SECTIONS.find((section) => (section.tabs as readonly InvoiceTab[]).includes(tab)) ?? SECTIONS[0];

function rowsForTab(rows: InvoiceRow[], tab: InvoiceTab): InvoiceRow[] {
  switch (tab) {
    case "drafts": return rows.filter((row) => row.status === "draft");
    case "outstanding": return rows.filter((row) => isOpenStatus(row.status));
    case "overdue": return rows.filter((row) => row.status === "overdue");
    case "paid": return rows.filter((row) => row.status === "paid");
    case "needs_action": return rows.filter((row) => row.needsAction.length > 0);
    default: return rows;
  }
}

const EMPTY: Record<string, { title: string; description: string }> = {
  all: { title: "No invoices yet", description: "Create an invoice for a rental, a program fee or a sponsorship, then record payments as they arrive." },
  drafts: { title: "No drafts", description: "Invoices you're still working on wait here until you finalize them." },
  outstanding: { title: "Nothing outstanding", description: "Every finalized invoice has been settled." },
  overdue: { title: "Nothing overdue", description: "No finalized invoice is past its due date." },
  paid: { title: "No paid invoices yet", description: "Invoices move here once their balance is zero." },
  needs_action: { title: "Nothing needs action", description: "Every finalized invoice is in the books and its payments match their deposits." },
};

/**
 * Receivables: summary cards that filter the table, tabs and saved views,
 * bulk actions, the full-page builder with a printable preview, the invoice
 * panel (payments, bank links, timeline), recurring series, customers and
 * the catalog.
 */
export function InvoicesPage() {
  const society = useSociety();
  const { canWrite, canExport, canManageIntegration } = useFinancePermissions();
  const initialWorkspace = useQuery(api.invoices.workspace, society ? { societyId: society._id } : "skip") as InvoiceWorkspace | undefined;
  const collections = useInvoiceCollections(initialWorkspace,society?._id);
  const queriedWorkspace = collections.workspace;
  const [params, setParams] = useSearchParams();
  const [currencyFilter, setCurrencyFilter] = useState("");
  const currency = currencyFilter || queriedWorkspace?.ledger.workspaceCurrency || "CAD";
  const workspace = useMemo(() => queriedWorkspace ? { ...queriedWorkspace,
    invoices: queriedWorkspace.invoices.filter((row) => row.currency === currency),
    summary: invoiceCurrencySummary(queriedWorkspace.invoices, currency, queriedWorkspace.today),
    customers: summarizeCustomers(queriedWorkspace.invoices.filter((row) => row.currency === currency), queriedWorkspace.parties.organizations),
  } : undefined, [queriedWorkspace, currency]);
  const markSent = useMutation(api.invoices.markSent);
  const issue = useMutation(api.invoices.issue);
  const sendReminders = useMutation(api.invoices.sendReminders);
  const voidInvoices = useMutation(api.invoices.voidInvoices);
  const confirm = useConfirm();
  const toast = useToast();
  const rawTab = params.get("tab") as InvoiceTab | null;
  const tab: InvoiceTab = rawTab && TABS.includes(rawTab) ? rawTab : "all";
  const openId = params.get("invoice");
  const builder = params.get("builder");
  const [readyBuilder,setReadyBuilder]=useState<string|null>(null);
  useEffect(()=>{if(!builder)setReadyBuilder(null);else if(collections.ready)setReadyBuilder(builder);},[builder,collections.ready]);
  const duesOpen = params.get("dues") === "1";
  const [recentOnly, setRecentOnly] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<{ key: string; name: string } | null>(null);
  const [seriesFilter, setSeriesFilter] = useState<{ id: string; name: string } | null>(null);
  const [focusSeriesId, setFocusSeriesId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [glMappingOpen, setGlMappingOpen] = useState(false);
  const [postExistingOpen, setPostExistingOpen] = useState(false);
  const [prefill, setPrefill] = useState<BillToValue | null>(null);

  const setParam = (changes: Record<string, string | null>, replace = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value == null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  };
  const setTab = (next: InvoiceTab, keepFilters = false) => {
    setParam({ tab: next === "all" ? null : next });
    if (!keepFilters) {
      setRecentOnly(false);
      setCustomerFilter(null);
      setSeriesFilter(null);
    }
  };

  // The page narrows the list by tab and by the filters other views hand it
  // (a customer, a series, recent cash activity); search, column filters and
  // sort belong to the table. Rows arrive newest first.
  const rows = useMemo(() => {
    if (!workspace) return [];
    const since = addDays(workspace.today, -30);
    let list = rowsForTab(workspace.invoices, tab);
    if (recentOnly) list = list.filter((row) => invoiceCashActivity(row.payments, since, workspace.today).hasActivity);
    if (customerFilter) list = list.filter((row) => partyKey(row) === customerFilter.key);
    if (seriesFilter) list = list.filter((row) => row.seriesId === seriesFilter.id);
    return [...list].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.sequence - a.sequence);
  }, [workspace, tab, recentOnly, customerFilter, seriesFilter]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const societyLike = isSociety(society as any);
  const showMembers = societyLike && (workspace?.parties.members.length ?? 0) > 0;
  const openInvoice = queriedWorkspace?.invoices.find((row) => row._id === openId) ?? null;
  const monthLabel = workspace ? new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${workspace.today}T12:00:00Z`)) : "";

  const openBuilder = (id: string | "new", party?: BillToValue | null) => {
    setPrefill(party ?? null);
    setParam({ builder: id, invoice: null }, false);
  };
  const closeBuilder = () => {
    setPrefill(null);
    setParam({ builder: null });
  };

  if (builder && readyBuilder !== builder && !collections.ready) {
    return collections.error ? <div className="page"><Banner tone="warn" title="Invoice lists could not load">{collections.error}<button className="btn" onClick={collections.retry}>Retry loading lists</button><button className="btn" onClick={closeBuilder}>Back to invoices</button></Banner></div> : <PageLoading />;
  }
  if (builder && workspace) {
    const invoice = builder === "new" ? null : queriedWorkspace?.invoices.find((row) => row._id === builder) ?? null;
    if (builder !== "new" && !invoice) {
      return (
        <div className="page">
          <EmptyState icon={<FileText size={20} />} title="Invoice not found" description="It may have been deleted." action={<button type="button" className="btn" onClick={closeBuilder}>Back to invoices</button>} />
        </div>
      );
    }
    return (
      <div className="page page--invoice-builder">
        <InvoiceBuilder
          key={`${builder}:${invoice?.reopenedAtISO ?? ""}`}
          workspace={queriedWorkspace!}
          invoice={invoice}
          prefill={prefill}
          societyId={society._id}
          logoUrl={(society as any).logoUrl ?? null}
          showMembers={showMembers}
          canWrite={canWrite}
          canExport={canExport}
          onClose={closeBuilder}
          onSaved={(id) => setParam({ builder: id })}
          onFinalized={(id) => setParam({ builder: null, invoice: id })}
          onOpenBuilder={(id) => openBuilder(id)}
        />
      </div>
    );
  }

  const exportRows = async (list: InvoiceRow[], label: string, format: TableExportFormat = readLastExportFormat()) => {
    try {
      const fileName = await downloadTableExport(`Invoices - ${label} ${workspace?.today ?? ""}`, format, {
        title: `Invoices - ${label}`,
        textRows: () => invoiceExportTextRows(list),
        sheet: () => invoiceExportSheet(list),
      });
      rememberExportFormat(format);
      toast.success(`Exported ${pluralize(list.length, "invoice")}`, fileName);
    } catch (error) {
      toast.error("Export failed", error instanceof Error ? error.message : undefined);
    }
  };

  const bulkFinalize = async (selectedRows: InvoiceRow[]) => {
    const drafts = selectedRows.filter((row) => row.lifecycle === "draft");
    if (!drafts.length) return toast.info("Select draft invoices to finalize");
    const ok = await confirm({ title: `Finalize ${pluralize(drafts.length, "draft invoice")}?`, message: "This locks their details and records the invoices in the books when their accounts are configured. Download and send each invoice yourself afterward.", confirmLabel: "Finalize drafts" });
    if (!ok) return;
    setBusy(true);
    try {
      const result: any = await issue({ societyId: society._id, ids: drafts.map((row) => row._id) });
      toast.success(`${pluralize(result.issued, "invoice")} finalized`, "Open an invoice to download it and record external sending.");
    } catch (err: any) {
      toast.error("Could not finalize invoices", err?.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkMarkSent = async (selectedRows: InvoiceRow[]) => {
    const issued = selectedRows.filter((row) => row.lifecycle === "issued");
    if (!issued.length) return toast.info("Select finalized invoices whose sending has not been recorded");
    const ok = await confirm({ title: "Record external sending today?", message: `Confirm that you have already sent ${pluralize(issued.length, "invoice")} yourself today. Societyer will record today's date and will not send an email. For another date or delivery details, open each invoice.`, confirmLabel: "Record sending" });
    if (!ok) return;
    setBusy(true);
    try {
      const result: any = await markSent({ societyId: society._id, ids: issued.map((row) => row._id), sentDate: workspace!.today, method: "other" });
      toast.success(`External sending recorded for ${pluralize(result.sent, "invoice")}`);
    } catch (err: any) {
      toast.error("Could not mark as sent", err?.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkRemind = async (selectedRows: InvoiceRow[]) => {
    const open = selectedRows.filter((row) => row.lifecycle === "sent" && isOpenStatus(row.status));
    if (!open.length) return toast.info("Reminders are for sent invoices with a balance");
    setBusy(true);
    try {
      const result: any = await sendReminders({ societyId: society._id, ids: open.map((row) => row._id) as any });
      const notes = [result.skippedNoEmail ? `${result.skippedNoEmail} without an email` : ""].filter(Boolean).join(", ");
      toast.success(result.created ? `${pluralize(result.created, "reminder")} drafted in the Outbox` : "No reminders drafted", notes ? `Skipped ${notes}.` : "Review and send them from the Outbox.");
    } catch (err: any) {
      toast.error("Could not draft reminders", err?.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkVoid = async (selectedRows: InvoiceRow[]) => {
    const voidable = selectedRows.filter((row) => row.lifecycle !== "void");
    if (!voidable.length) return;
    const withPayments = voidable.filter((row) => row.paidCents > 0).length;
    const ok = await confirm({
      title: `Void ${pluralize(voidable.length, "invoice")}?`,
      message: (
        <div>
          <p>Void invoices keep their numbers but no longer count as owed. You can restore each one from its panel.</p>
          {withPayments > 0 && <p className="muted">{pluralize(withPayments, "invoice")} with payments will be skipped.</p>}
        </div>
      ),
      confirmLabel: `Void ${pluralize(voidable.length, "invoice")}`,
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result: any = await voidInvoices({ societyId: society._id, ids: voidable.map((row) => row._id) as any });
      toast.success(`${pluralize(result.voided, "invoice")} voided`, result.skippedPaid ? `${result.skippedPaid} with payments skipped.` : undefined);
    } catch (err: any) {
      toast.error("Could not void", err?.message);
    } finally {
      setBusy(false);
    }
  };

  /** A customer opens as their invoices: the whole list, filtered to them. */
  const showCustomer = (customer: { key: string; name: string }) => {
    setParam({ tab: null, invoice: null });
    setSeriesFilter(null);
    setRecentOnly(false);
    setCustomerFilter({ key: customer.key, name: customer.name });
  };
  const openSeries = (seriesId: string) => {
    setFocusSeriesId(seriesId);
    setParam({ invoice: null, tab: "recurring" });
  };

  const rowsFor = (ids: string[]) => rows.filter((row) => ids.includes(row._id));
  const bulkActions: BulkAction[] = [
    ...(canWrite
      ? [
          { id: "remind", label: "Draft reminder email", icon: <Bell size={12} aria-hidden="true" />, onRun: (ids: string[]) => bulkRemind(rowsFor(ids)) },
          { id: "finalize", label: "Finalize drafts", icon: <FileCheck2 size={12} aria-hidden="true" />, onRun: (ids: string[]) => bulkFinalize(rowsFor(ids)) },
          { id: "mark-sent", label: "Record external sending", icon: <Send size={12} aria-hidden="true" />, onRun: (ids: string[]) => bulkMarkSent(rowsFor(ids)) },
        ]
      : []),
    ...(canExport ? [{ id: "export", label: "Export", icon: <Download size={12} aria-hidden="true" />, keepSelection: true, onRun: (ids: string[]) => exportRows(rowsFor(ids), "selected") }] : []),
    ...(canWrite ? [{ id: "void", label: "Void", icon: <Ban size={12} aria-hidden="true" />, tone: "danger" as const, onRun: (ids: string[]) => bulkVoid(rowsFor(ids)) }] : []),
  ];

  const summary = workspace?.summary;
  const counts = workspace
    ? {
        all: workspace.invoices.length,
        drafts: workspace.invoices.filter((r) => r.status === "draft").length,
        outstanding: workspace.invoices.filter((r) => isOpenStatus(r.status)).length,
        overdue: workspace.invoices.filter((r) => r.status === "overdue").length,
        paid: workspace.invoices.filter((r) => r.status === "paid").length,
        needs_action: workspace.summary.needsActionCount,
        recurring: workspace.series.length,
        customers: workspace.customers.length,
        templates: workspace.templates?.filter((t) => t.active).length ?? 0, price_lists: workspace.priceLists?.length ?? 0, repairs: workspace.repairJobs?.filter((job) => !["completed", "cancelled"].includes(job.status)).length ?? 0,
        catalog: workspace.catalog.filter((item) => item.active).length,
      }
    : null;
  const duesCount = workspace?.duesCandidates.filter((c) => !c.existingInvoiceId).length ?? 0;
  const section = sectionForTab(tab);
  const sectionTabs = (
    <Tabs<InvoiceSection>
      value={section.id}
      onChange={(next) => setTab(SECTIONS.find((item) => item.id === next)!.tabs[0])}
      tabRoles
      ariaLabel="Invoice sections"
      items={[
        { id: "invoices", label: "Invoices", count: counts?.all ?? null },
        { id: "quotes", label: "Quotes" },
        { id: "customers", label: "Customers", count: counts?.customers ?? null },
        { id: "items", label: "Items & pricing", count: counts?.catalog ?? null },
        { id: "repairs", label: "Repairs", count: counts?.repairs ?? null },
        { id: "setup", label: "Setup" },
      ]}
    />
  );
  const allViews: { id: InvoiceTab; label: string; count?: number | null }[] = [
    { id: "all", label: "All", count: counts?.all ?? null },
    { id: "drafts", label: "Drafts", count: counts?.drafts ?? null },
    { id: "outstanding", label: "Outstanding", count: counts?.outstanding ?? null },
    { id: "overdue", label: "Overdue", count: counts?.overdue ?? null },
    { id: "paid", label: "Paid", count: counts?.paid ?? null },
    { id: "needs_action", label: "Needs action", count: counts?.needs_action ?? null },
    { id: "recurring", label: "Recurring", count: counts?.recurring ?? null },
    { id: "customers", label: "All customers", count: counts?.customers ?? null },
    { id: "statements", label: "Statements" },
    { id: "catalog", label: "Items & services", count: counts?.catalog ?? null },
    { id: "price_lists", label: "Price lists", count: counts?.price_lists ?? null },
    { id: "templates", label: "Templates", count: counts?.templates ?? null },
    { id: "automation", label: "Automation" },
  ];
  const currencyChoices = [...new Set([queriedWorkspace?.ledger.workspaceCurrency ?? "CAD", ...(queriedWorkspace?.invoices ?? []).map((row) => row.currency), ...(currencyFilter ? [currencyFilter] : [])])];
  const views = allViews.filter((view) => (section.tabs as readonly InvoiceTab[]).includes(view.id));
  const invoiceTabs = views.length > 1 ? <Tabs<InvoiceTab> value={tab} onChange={(next) => setTab(next)} tabRoles ariaLabel={`${section.label} views`} items={views} /> : null;

  return (
    <div className="page invoices-page">
      <PageHeader
        title="Invoices"
        icon={<ReceiptText size={16} />}
        iconColor="green"
        subtitle={societyLike ? "Bill dues, program fees, space rentals and sponsorships, and track what's owed." : "Bill customers, record payments and track what's owed."}
        info={
          <p>
            Invoices are numbered in order and never reuse a number. Status follows the payments you record and the due date in your
            organization's time zone. Finalize and download the invoice, send it yourself, then record external sending and the client's response. Payments are recorded separately.
          </p>
        }
        actions={
          <>
            {currencyChoices.length > 1 && <Select className="page-header-filter" aria-label="Invoice list currency" value={currency} onChange={setCurrencyFilter} options={currencyChoices.map((value) => ({ value, label: value }))} />}
            <MoreActionsMenu
              items={[
                ...(societyLike && workspace?.plans.length ? [{ id: "dues", label: "Generate dues invoices", hint: duesCount ? `${duesCount} this month` : undefined, icon: <Users size={14} />, disabled: !canWrite, onSelect: () => setParam({ dues: "1" }) }] : []),
                { id: "export-xlsx", label: "Export to Excel", icon: <FileSpreadsheet size={14} />, disabled: !canExport || !workspace?.invoices.length, onSelect: () => workspace && void exportRows(LIST_TABS.has(tab) ? rows : workspace.invoices, tab, "xlsx") },
                { id: "export-csv", label: "Export to CSV", icon: <Download size={14} />, disabled: !canExport || !workspace?.invoices.length, onSelect: () => workspace && void exportRows(LIST_TABS.has(tab) ? rows : workspace.invoices, tab, "csv") },
                { id: "gl-mapping", label: "Edit GL account mapping", icon: <Landmark size={14} />, disabled: !workspace, onSelect: () => setGlMappingOpen(true) },
                { id: "post-existing", label: "Post existing invoices to the ledger", hint: workspace?.ledger.readyCount ? `${workspace.ledger.readyCount} ready` : undefined, icon: <BookCheck size={14} />, disabled: !workspace, onSelect: () => setPostExistingOpen(true) },
                { id: "settings", label: "Invoice settings", icon: <Settings2 size={14} />, onSelect: () => setSettingsOpen(true) },
              ]}
            />
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={() => openBuilder("new")}>
              <Plus size={12} aria-hidden="true" /> New invoice
            </button>
          </>
        }
      />

      {section.id === "invoices" && <StatStrip className="invoice-stats" ariaLabel="Invoice summary">
        <StatTile
          label="Outstanding"
          value={<Money currency={currency} cents={summary?.outstandingCents ?? null} variant="hero" />}
          sub={summary ? pluralize(summary.outstandingCount, "open invoice") : undefined}
          onClick={() => setTab("outstanding")}
          pressed={tab === "outstanding"}
          actionLabel="Show outstanding invoices"
        />
        <StatTile
          label="Overdue"
          value={<Money currency={currency} cents={summary?.overdueCents ?? null} variant="hero" />}
          tone={summary?.overdueCount ? "warn" : "neutral"}
          sub={summary ? (summary.overdueCount ? pluralize(summary.overdueCount, "invoice") + " past due" : "Nothing past due") : undefined}
          subTone={summary?.overdueCount ? "warn" : undefined}
          onClick={() => setTab("overdue")}
          pressed={tab === "overdue"}
          actionLabel="Show overdue invoices"
        />
        <StatTile
          label="Net received, 30 days"
          value={<Money currency={currency} cents={summary?.paidLast30Cents ?? null} variant="hero" />}
          sub={summary ? pluralize(summary.paidLast30Count, "invoice") : undefined}
          onClick={() => { setTab("all"); setRecentOnly(true); }}
          pressed={tab === "all" && recentOnly}
          actionLabel="Show invoices with cash activity in the last 30 days"
        />
        <StatTile
          label="Drafts"
          value={<Money currency={currency} cents={summary?.draftCents ?? null} variant="hero" />}
          sub={summary ? pluralize(summary.draftCount, "draft") : undefined}
          onClick={() => setTab("drafts")}
          pressed={tab === "drafts"}
          actionLabel="Show draft invoices"
        />
      </StatStrip>}

      {section.id === "invoices" && workspace && workspace.ledger.foreignCurrency.count > 0 && (
        <Banner tone="warn" className="invoice-banner" title={`${pluralize(workspace.ledger.foreignCurrency.count, "invoice")} in ${workspace.ledger.foreignCurrency.currencies.join(", ")}`}>
          The books are kept in {workspace.ledger.workspaceCurrency}. Set an explicit invoice exchange rate and settlement rate to post foreign invoices and their exchange differences.{" "}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTab("needs_action")}>Show them</button>
        </Banner>
      )}
      {section.id === "invoices" && workspace && workspace.ledger.readyCount > 0 && (
        <Banner tone="info" className="invoice-banner" title={`${pluralize(workspace.ledger.readyCount, "invoice")} not in the books yet`}>
          Finalized invoices from before the books were connected, or recorded while their accounts weren't mapped, can be posted now.{" "}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPostExistingOpen(true)}>Post existing invoices</button>
        </Banner>
      )}

      {sectionTabs}
      {invoiceTabs && <div className="invoice-subtabs">{invoiceTabs}</div>}

      {collections.loading && <p className="muted" role="status">Loading complete template, pricing and repair lists…</p>}
      {collections.error && <Banner tone="warn" title="Complete invoice lists could not load">{collections.error} <button className="btn btn--sm" onClick={collections.retry}>Retry loading lists</button></Banner>}
      {workspace === undefined ? (
        <div className="card"><div className="card__body"><div className="record-table__loading">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div></div>
      ) : tab === "recurring" ? (
        <SeriesPanel
          series={workspace.series}
          societyId={society._id}
          today={workspace.today}
          canWrite={canWrite}
          focusId={focusSeriesId}
          onShowInvoices={(series) => { setParam({ tab: null }); setCustomerFilter(null); setRecentOnly(false); setSeriesFilter({ id: series._id, name: series.name }); }}
          onOpenInvoice={(id) => setParam({ tab: null, invoice: id })}
        />
      ) : tab === "customers" ? (
        <CustomersPanel
          currency={currency}
          customers={workspace.customers}
          organizations={workspace.parties.organizations}
          societyId={society._id}
          canWrite={canWrite}
          onShowInvoices={showCustomer}
          onStatement={customer => setParam({ tab: "statements", statementCustomer: customer.key })}
          onNewInvoice={(customer) => openBuilder("new", {
            partyKind: customer.partyKind as BillToValue["partyKind"],
            memberId: customer.memberId,
            counterpartyId: customer.counterpartyId,
            billToName: customer.name,
            billToEmail: customer.email,
            billToAddress: customer.address,
          })}
        />
      ) : tab === "quotes" ? (
        <QuotesPanel workspace={queriedWorkspace!} societyId={society._id} canWrite={canWrite} canExport={canExport} onOpenInvoice={id => setParam({ tab: null, invoice: id, builder: null })} onOpenCustomer={showCustomer} />
      ) : tab === "statements" ? (
        <CustomerStatementsPanel key={`${params.get("statementCustomer") ?? ""}:${currency}`} workspace={queriedWorkspace!} societyId={society._id} canExport={canExport} initialCustomerKey={params.get("statementCustomer") ?? undefined} initialCurrency={currency} />
      ) : tab === "automation" ? (
        <BillingAutomationPanel societyId={society._id} canWrite={canWrite} />
      ) : tab === "templates" ? (
        <InvoiceTemplatesPanel key={society._id} workspace={workspace} societyId={society._id} canWrite={canWrite} logoUrl={(society as any).logoUrl ?? null} />
      ) : tab === "price_lists" ? (
        <PriceListsPanel workspace={workspace} societyId={society._id} canWrite={canWrite} />
      ) : tab === "repairs" ? (
        <RepairJobsPanel key={params.get("repair")} workspace={workspace} societyId={society._id} canWrite={canWrite} canExport={canExport} logoUrl={(society as any).logoUrl ?? null} focusId={params.get("repair")} onOpenInvoice={(id) => setParam({ invoice: id, builder: null })} onOpenCustomer={showCustomer} />
      ) : tab === "catalog" ? (
        <CatalogPanel items={workspace.catalog} societyId={society._id} canWrite={canWrite} defaultCurrency={workspace.ledger.workspaceCurrency} assessmentDate={workspace.today} organization={workspace.organization} />
      ) : LIST_TABS.has(tab) ? (
        <>
          {(recentOnly || customerFilter || seriesFilter) && (
            <div className="invoice-chips" aria-label="Invoice list filters" role="group">
              {recentOnly && <FilterChip label="Cash activity in the last 30 days" onClear={() => setRecentOnly(false)} />}
              {customerFilter && <FilterChip label={customerFilter.name} onClear={() => setCustomerFilter(null)} />}
              {seriesFilter && <FilterChip label={`Series: ${seriesFilter.name}`} onClear={() => setSeriesFilter(null)} />}
            </div>
          )}
          <InvoiceListTable
            rows={rows}
            currency={currency}
            label={tab === "all" ? "All invoices" : allViews.find((view) => view.id === tab)?.label ?? "Invoices"}
            openId={openId}
            selectable={canWrite || canExport}
            bulkActions={bulkActions}
            onOpen={(id) => setParam({ invoice: id })}
            onOpenCustomer={(row) => showCustomer({ key: partyKey(row), name: row.billToName })}
            onOpenSeries={openSeries}
            emptyState={
              recentOnly || customerFilter || seriesFilter ? (
                <EmptyState variant="filtered" onClearFilters={() => { setRecentOnly(false); setCustomerFilter(null); setSeriesFilter(null); }} />
              ) : (
                <EmptyState
                  icon={<ReceiptText size={20} />}
                  title={EMPTY[tab].title}
                  description={EMPTY[tab].description}
                  variant={tab === "overdue" || tab === "outstanding" ? "caught-up" : "default"}
                  action={tab === "all" || tab === "drafts" ? <button type="button" className="btn btn--accent" disabled={!canWrite} onClick={() => openBuilder("new")}><Plus size={14} aria-hidden="true" /> New invoice</button> : undefined}
                />
              )
            }
          />
        </>
      ) : null}

      {openInvoice && workspace && (
        <InvoiceDetailDrawer
          key={openInvoice._id}
          invoice={openInvoice}
          workspace={queriedWorkspace!}
          logoUrl={(society as any).logoUrl ?? null}
          canWrite={canWrite}
          onClose={() => setParam({ invoice: null })}
          onEdit={(id) => openBuilder(id)}
          onOpenSeries={openSeries}
          onEditMapping={() => setGlMappingOpen(true)}
          canExport={canExport}
          canPost={canManageIntegration}
        />
      )}
      {duesOpen && workspace && (
        <DuesGeneratorModal
          open
          onClose={() => setParam({ dues: null })}
          candidates={workspace.duesCandidates}
          societyId={society._id}
          monthLabel={monthLabel}
          onOpenInvoice={(id) => setParam({ dues: null, invoice: id })}
        />
      )}
      {glMappingOpen && workspace && (
        <InvoiceGlMappingDrawer open onClose={() => setGlMappingOpen(false)} workspace={workspace} societyId={society._id} canWrite={canWrite} />
      )}
      {postExistingOpen && (
        <PostExistingInvoicesModal
          open
          onClose={() => setPostExistingOpen(false)}
          societyId={society._id}
          canPost={canManageIntegration}
          onOpenInvoice={(id) => setParam({ invoice: id })}
          onEditMapping={() => setGlMappingOpen(true)}
        />
      )}
      {settingsOpen && workspace && (
        <InvoiceSettingsDrawer open onClose={() => setSettingsOpen(false)} settings={workspace.settings} societyId={society._id} canWrite={canWrite} />
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="invoice-chip">
      {label}
      <button type="button" className="invoice-chip__clear" aria-label={`Clear filter: ${label}`} onClick={onClear}>
        <X size={12} />
      </button>
    </span>
  );
}
