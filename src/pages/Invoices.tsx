import { Select } from "../components/Select";
import { InvoiceTemplatesPanel } from "../features/invoicing/InvoiceTemplatesPanel";
import { PriceListsPanel } from "../features/invoicing/PriceListsPanel";
import { QuotesPanel } from "../features/invoicing/QuotesPanel";
import { CustomerStatementsPanel } from "../features/invoicing/CustomerStatementsPanel";
import { BillingAutomationPanel } from "../features/invoicing/BillingAutomationPanel";
import { RepairJobsPanel } from "../features/invoicing/RepairJobsPanel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Ban, Bell, BookCheck, Download, FileSpreadsheet, FileText, Landmark, Plus, ReceiptText, Search, Send, Settings2, Users, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Banner, EmptyState } from "../components/ui";
import { Tabs } from "../components/primitives";
import { useIsBottomSheet } from "../lib/useSheetDrag";
import { StatStrip, StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { Checkbox } from "../components/Controls";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatDate, pluralize } from "../lib/format";
import { downloadTableExport, readLastExportFormat, rememberExportFormat, type TableExportFormat } from "../lib/tableExport";
import { addDays, isOpenStatus, partyKey, invoiceCurrencySummary, invoiceCashActivity, summarizeCustomers, type CustomerSummary } from "../../shared/invoicing";
import { isSociety } from "../../shared/organizationDomain";
import { InvoiceStatusPill, NeedsActionPill } from "../features/invoicing/InvoiceStatusPill";
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
import { InvoiceViewControls } from "../features/invoicing/InvoiceViewControls";
import { InvoiceListTable } from "../features/invoicing/InvoiceListTable";
import { DEFAULT_INVOICE_LIST_VIEW, cleanInvoiceListView, type InvoiceListView } from "../../shared/billingPricing";
import "../features/invoicing/invoiceViews.css";

function readView(params: URLSearchParams): InvoiceListView {
  try { const raw = params.get("view"); return cleanInvoiceListView(raw ? JSON.parse(raw) : DEFAULT_INVOICE_LIST_VIEW); }
  catch { return cleanInvoiceListView(DEFAULT_INVOICE_LIST_VIEW); }
}

const TABS: InvoiceTab[] = ["all", "drafts", "outstanding", "overdue", "paid", "needs_action", "recurring", "customers", "catalog", "templates", "price_lists", "repairs", "quotes", "statements", "automation"];
const LIST_TABS = new Set<InvoiceTab>(["all", "drafts", "outstanding", "overdue", "paid", "needs_action"]);
type SortKey = "number" | "customer" | "issueDate" | "dueDate" | "total" | "balance";

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
  drafts: { title: "No drafts", description: "Invoices you're still working on wait here until you mark them as sent." },
  outstanding: { title: "Nothing outstanding", description: "Every sent invoice has been paid." },
  overdue: { title: "Nothing overdue", description: "No sent invoice is past its due date." },
  paid: { title: "No paid invoices yet", description: "Invoices move here once their balance is zero." },
  needs_action: { title: "Nothing needs action", description: "Every sent invoice is in the books and its payments match their deposits." },
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
  const [initialView] = useState(() => readView(params));
  const [advancedView, setAdvancedView] = useState(initialView);
  const [currencyFilter, setCurrencyFilter] = useState(initialView.currency);
  const currency = currencyFilter || queriedWorkspace?.ledger.workspaceCurrency || "CAD";
  const workspace = useMemo(() => queriedWorkspace ? { ...queriedWorkspace,
    invoices: queriedWorkspace.invoices.filter((row) => row.currency === currency),
    summary: invoiceCurrencySummary(queriedWorkspace.invoices, currency, queriedWorkspace.today),
    customers: summarizeCustomers(queriedWorkspace.invoices.filter((row) => row.currency === currency)),
  } : undefined, [queriedWorkspace, currency]);
  const markSent = useMutation(api.invoices.markSent);
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
  const [recentOnly, setRecentOnly] = useState(initialView.recentOnly);
  const [customerFilter, setCustomerFilter] = useState<{ key: string; name: string } | null>(initialView.customerKey ? { key: initialView.customerKey, name: "Customer" } : null);
  const [seriesFilter, setSeriesFilter] = useState<{ id: string; name: string } | null>(initialView.seriesId ? { id: initialView.seriesId, name: "Recurring series" } : null);
  const [focusSeriesId, setFocusSeriesId] = useState<string | null>(null);
  const [search, setSearch] = useState(initialView.search);
  // Phones: search is an icon beside the tabs until it's opened (or in use).
  const isPhone = useIsBottomSheet();
  const [searchOpen, setSearchOpen] = useState(false);
  const phoneSearchShown = searchOpen || search.length > 0;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: initialView.sortKey, dir: initialView.sortDirection });
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    setSelected(new Set());
    if (!keepFilters) {
      setRecentOnly(false);
      setCustomerFilter(null);
      setSeriesFilter(null);
    }
  };

  const listView: InvoiceListView = { ...advancedView, tab: LIST_TABS.has(tab) ? tab as InvoiceListView["tab"] : "all", currency: currencyFilter, search, customerKey: customerFilter?.key ?? "", seriesId: seriesFilter?.id ?? "", recentOnly, sortKey: sort.key, sortDirection: sort.dir };
  const viewJson = JSON.stringify(listView);
  useEffect(() => {
    setParams(previous => {
      if (previous.get("view") === viewJson) return previous;
      const next = new URLSearchParams(previous); next.set("view", viewJson); return next;
    }, { replace: true });
  }, [viewJson, setParams]);
  const applyView = (value: InvoiceListView) => {
    setAdvancedView(value); setCurrencyFilter(value.currency); setSearch(value.search); setRecentOnly(value.recentOnly);
    setCustomerFilter(value.customerKey ? { key: value.customerKey, name: queriedWorkspace?.customers.find(c => c.key === value.customerKey)?.name ?? "Customer" } : null);
    setSeriesFilter(value.seriesId ? { id: value.seriesId, name: queriedWorkspace?.series.find(s => s._id === value.seriesId)?.name ?? "Recurring series" } : null);
    setSort({ key: value.sortKey, dir: value.sortDirection }); setParam({ tab: value.tab === "all" ? null : value.tab }); setSelected(new Set());
  };

  const rows = useMemo(() => {
    if (!workspace) return [];
    const since = addDays(workspace.today, -30);
    const q = search.trim().toLowerCase();
    let list = rowsForTab(workspace.invoices, tab);
    if (recentOnly) list = list.filter((row) => invoiceCashActivity(row.payments, since, workspace.today).hasActivity);
    if (customerFilter) list = list.filter((row) => partyKey(row) === customerFilter.key);
    if (seriesFilter) list = list.filter((row) => row.seriesId === seriesFilter.id);
    list = list.filter(row => (!advancedView.fromDate || row.issueDate >= advancedView.fromDate) && (!advancedView.toDate || row.issueDate <= advancedView.toDate) && (!advancedView.dueFrom || row.dueDate >= advancedView.dueFrom) && (!advancedView.dueTo || row.dueDate <= advancedView.dueTo) && (advancedView.minimumBalanceCents == null || (row.status === "void" ? 0 : row.balanceCents) >= advancedView.minimumBalanceCents) && (advancedView.maximumBalanceCents == null || (row.status === "void" ? 0 : row.balanceCents) <= advancedView.maximumBalanceCents));
    if (q) list = list.filter((row) => `${row.number} ${row.billToName} ${row.billToEmail ?? ""} ${row.reference ?? ""} ${row.lines.map((l) => l.item).join(" ")}`.toLowerCase().includes(q));
    const value = (row: InvoiceRow): string | number => {
      switch (sort.key) {
        case "number": return row.sequence;
        case "customer": return row.billToName.toLowerCase();
        case "dueDate": return row.dueDate;
        case "total": return row.totalCents;
        case "balance": return row.status === "void" ? 0 : row.balanceCents;
        default: return `${row.issueDate}-${String(row.sequence).padStart(8, "0")}`;
      }
    };
    return [...list].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [workspace, tab, recentOnly, customerFilter, seriesFilter, search, sort, advancedView]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const societyLike = isSociety(society as any);
  const showMembers = societyLike && (workspace?.parties.members.length ?? 0) > 0;
  const openInvoice = queriedWorkspace?.invoices.find((row) => row._id === openId) ?? null;
  const selectedRows = rows.filter((row) => selected.has(row._id));
  const selectedTotal = selectedRows.reduce((sum, row) => sum + (row.status === "void" ? 0 : row.balanceCents), 0);
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
          key={builder}
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
          onOpenBuilder={(id) => openBuilder(id)}
        />
      </div>
    );
  }

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const exportRows = async (list: InvoiceRow[], label: string, format: TableExportFormat = readLastExportFormat()) => {
    try {
      const fileName = await downloadTableExport(`Invoices - ${label} ${workspace?.today ?? ""}`, format, {
        title: `Invoices - ${label}`,
        textRows: () => invoiceExportTextRows(list, listView.columns),
        sheet: () => invoiceExportSheet(list, listView.columns),
      });
      rememberExportFormat(format);
      toast.success(`Exported ${pluralize(list.length, "invoice")}`, fileName);
    } catch (error) {
      toast.error("Export failed", error instanceof Error ? error.message : undefined);
    }
  };

  const bulkMarkSent = async () => {
    const drafts = selectedRows.filter((row) => row.lifecycle === "draft");
    if (!drafts.length) return toast.info("Only drafts can be marked as sent");
    setBusy(true);
    try {
      const result: any = await markSent({ societyId: society._id, ids: drafts.map((row) => row._id) as any });
      toast.success(`${pluralize(result.sent, "invoice")} marked as sent`);
      setSelected(new Set());
    } catch (err: any) {
      toast.error("Could not mark as sent", err?.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkRemind = async () => {
    const open = selectedRows.filter((row) => isOpenStatus(row.status));
    if (!open.length) return toast.info("Reminders are for sent invoices with a balance");
    setBusy(true);
    try {
      const result: any = await sendReminders({ societyId: society._id, ids: open.map((row) => row._id) as any });
      const notes = [result.skippedNoEmail ? `${result.skippedNoEmail} without an email` : ""].filter(Boolean).join(", ");
      toast.success(result.created ? `${pluralize(result.created, "reminder")} drafted in the Outbox` : "No reminders drafted", notes ? `Skipped ${notes}.` : "Review and send them from the Outbox.");
      setSelected(new Set());
    } catch (err: any) {
      toast.error("Could not draft reminders", err?.message);
    } finally {
      setBusy(false);
    }
  };

  const bulkVoid = async () => {
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
      setSelected(new Set());
    } catch (err: any) {
      toast.error("Could not void", err?.message);
    } finally {
      setBusy(false);
    }
  };

  const showCustomer = (customer: CustomerSummary) => {
    setParam({ tab: null });
    setSelected(new Set());
    setSeriesFilter(null);
    setRecentOnly(false);
    setCustomerFilter({ key: customer.key, name: customer.name });
  };

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
  const invoiceTabs = (
    <Tabs<InvoiceTab>
      value={tab}
      onChange={(next) => setTab(next)}
      tabRoles
      ariaLabel="Invoice views"
      items={[
        { id: "all", label: "All", count: counts?.all ?? null },
        { id: "drafts", label: "Drafts", count: counts?.drafts ?? null },
        { id: "outstanding", label: "Outstanding", count: counts?.outstanding ?? null },
        { id: "overdue", label: "Overdue", count: counts?.overdue ?? null },
        { id: "paid", label: "Paid", count: counts?.paid ?? null },
        { id: "needs_action", label: "Needs action", count: counts?.needs_action ?? null },
        { id: "recurring", label: "Recurring", count: counts?.recurring ?? null },
        { id: "customers", label: "Customers", count: counts?.customers ?? null },
        { id: "catalog", label: "Items & services", count: counts?.catalog ?? null },
        { id: "price_lists", label: "Price lists", count: counts?.price_lists ?? null },
        { id: "templates", label: "Templates", count: counts?.templates ?? null },
        { id: "repairs", label: "Repairs", count: counts?.repairs ?? null },
        { id: "quotes", label: "Quotes" },
        { id: "statements", label: "Statements" },
        { id: "automation", label: "Automation" },
      ]}
    />
  );

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
            organization's time zone. Sending stays in your hands: mark an invoice as sent, or draft the email in the Outbox and send it from there.
          </p>
        }
        actions={
          <>
            <Select aria-label="Invoice list currency" value={currency} onChange={setCurrencyFilter} options={[...new Set([queriedWorkspace?.ledger.workspaceCurrency ?? "CAD", ...(queriedWorkspace?.invoices ?? []).map((row) => row.currency)])].map((value) => ({ value, label: value }))} />
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

      <StatStrip className="invoice-stats" ariaLabel="Invoice summary">
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
          label="Net received, last 30 days"
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
      </StatStrip>

      {workspace && workspace.ledger.foreignCurrency.count > 0 && (
        <Banner tone="warn" className="invoice-banner" title={`${pluralize(workspace.ledger.foreignCurrency.count, "invoice")} in ${workspace.ledger.foreignCurrency.currencies.join(", ")}`}>
          The books are kept in {workspace.ledger.workspaceCurrency}. Set an explicit invoice exchange rate and settlement rate to post foreign invoices and their exchange differences.{" "}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTab("needs_action")}>Show them</button>
        </Banner>
      )}
      {workspace && workspace.ledger.readyCount > 0 && (
        <Banner tone="info" className="invoice-banner" title={`${pluralize(workspace.ledger.readyCount, "invoice")} not in the books yet`}>
          Sent invoices from before the books were connected, or recorded while their accounts weren't mapped, can be posted now.{" "}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPostExistingOpen(true)}>Post existing invoices</button>
        </Banner>
      )}

      {isPhone ? (
        <div className="invoice-tabs-row">
          {invoiceTabs}
          {LIST_TABS.has(tab) && (
            <button
              type="button"
              className="btn btn--ghost btn--icon"
              aria-label="Search invoices"
              aria-expanded={phoneSearchShown}
              onClick={() => {
                const next = !phoneSearchShown || Boolean(search);
                setSearchOpen(next);
                if (next) window.setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
            >
              <Search size={15} />
            </button>
          )}
        </div>
      ) : invoiceTabs}

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
          canWrite={canWrite}
          onShowInvoices={showCustomer}
          onStatement={customer => setParam({ tab: "statements", statementCustomer: customer.key })}
          onNewInvoice={(customer) => openBuilder("new", {
            partyKind: customer.partyKind as BillToValue["partyKind"],
            memberId: customer.memberId,
            counterpartyId: customer.counterpartyId,
            billToName: customer.name,
            billToEmail: customer.email,
            billToAddress: workspace.invoices.find((row) => partyKey(row) === customer.key && row.billToAddress)?.billToAddress,
          })}
        />
      ) : tab === "quotes" ? (
        <QuotesPanel workspace={queriedWorkspace!} societyId={society._id} canWrite={canWrite} canExport={canExport} onOpenInvoice={id => setParam({ tab: null, invoice: id, builder: null })} />
      ) : tab === "statements" ? (
        <CustomerStatementsPanel key={`${params.get("statementCustomer") ?? ""}:${currency}`} workspace={queriedWorkspace!} societyId={society._id} canExport={canExport} initialCustomerKey={params.get("statementCustomer") ?? undefined} initialCurrency={currency} />
      ) : tab === "automation" ? (
        <BillingAutomationPanel societyId={society._id} canWrite={canWrite} />
      ) : tab === "templates" ? (
        <InvoiceTemplatesPanel workspace={workspace} societyId={society._id} canWrite={canWrite} logoUrl={(society as any).logoUrl ?? null} />
      ) : tab === "price_lists" ? (
        <PriceListsPanel workspace={workspace} societyId={society._id} canWrite={canWrite} />
      ) : tab === "repairs" ? (
        <RepairJobsPanel key={params.get("repair")} workspace={workspace} societyId={society._id} canWrite={canWrite} canExport={canExport} logoUrl={(society as any).logoUrl ?? null} focusId={params.get("repair")} onOpenInvoice={(id) => setParam({ invoice: id, builder: null })} />
      ) : tab === "catalog" ? (
        <CatalogPanel items={workspace.catalog} societyId={society._id} canWrite={canWrite} />
      ) : LIST_TABS.has(tab) ? (
        <div className="card invoice-card">
          <InvoiceViewControls societyId={society._id} value={listView} onChange={applyView} />
          {(!isPhone || phoneSearchShown || recentOnly || customerFilter || seriesFilter) && (
          <div className="invoice-toolbar">
            {(!isPhone || phoneSearchShown) && (
            <label className="invoice-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Search invoices</span>
              <input ref={searchInputRef} className="input" type="search" value={search} placeholder="Search number, customer, item" onChange={(e) => setSearch(e.target.value)} />
            </label>
            )}
            <div className="invoice-chips">
              {recentOnly && <FilterChip label="Cash activity in the last 30 days" onClear={() => setRecentOnly(false)} />}
              {customerFilter && <FilterChip label={customerFilter.name} onClear={() => setCustomerFilter(null)} />}
              {seriesFilter && (
                <FilterChip
                  label={`Series: ${seriesFilter.name}`}
                  onClear={() => setSeriesFilter(null)}
                />
              )}
            </div>
            <span className="muted invoice-toolbar__count">
              {pluralize(rows.length, "invoice")} · <Money currency={currency} cents={rows.reduce((sum, row) => sum + (row.status === "void" ? 0 : row.balanceCents), 0)} /> due
            </span>
          </div>
          )}

          {selectedRows.length > 0 && (
            <div className="invoice-bulkbar" role="region" aria-label="Bulk actions">
              <span><strong>{selectedRows.length}</strong> selected · <Money currency={currency} cents={selectedTotal} /> due</span>
              <div className="invoice-bulkbar__actions">
                <button type="button" className="btn btn--sm" disabled={busy || !canWrite} onClick={() => void bulkRemind()}>
                  <Bell size={12} aria-hidden="true" /> Send reminder
                </button>
                <button type="button" className="btn btn--sm" disabled={busy || !canWrite} onClick={() => void bulkMarkSent()}>
                  <Send size={12} aria-hidden="true" /> Mark sent
                </button>
                <button type="button" className="btn btn--sm" disabled={!canExport} onClick={() => void exportRows(selectedRows, "selected")}>
                  <Download size={12} aria-hidden="true" /> Export
                </button>
                <button type="button" className="btn btn--sm btn--danger" disabled={busy || !canWrite} onClick={() => void bulkVoid()}>
                  <Ban size={12} aria-hidden="true" /> Void
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="card__body">
              {search || recentOnly || customerFilter || seriesFilter ? (
                <EmptyState variant="filtered" onClearFilters={() => { setSearch(""); setRecentOnly(false); setCustomerFilter(null); setSeriesFilter(null); }} />
              ) : (
                <EmptyState
                  icon={<ReceiptText size={20} />}
                  title={EMPTY[tab].title}
                  description={EMPTY[tab].description}
                  variant={tab === "overdue" || tab === "outstanding" ? "caught-up" : "default"}
                  action={tab === "all" || tab === "drafts" ? <button type="button" className="btn btn--accent" disabled={!canWrite} onClick={() => openBuilder("new")}><Plus size={14} aria-hidden="true" /> New invoice</button> : undefined}
                />
              )}
            </div>
          ) : (
            <InvoiceListTable rows={rows} columns={listView.columns} sort={sort} selected={selected} openId={openId} onSort={key => setSort({ key, dir: sort.key === key ? sort.dir === "desc" ? "asc" : "desc" : key === "customer" || key === "number" ? "asc" : "desc" })} onToggle={toggle} onSelectAll={() => setSelected(allSelected ? new Set() : new Set(rows.map(row => row._id)))} onOpen={id => setParam({ invoice: id })} />
          )}
        </div>
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
          onOpenSeries={(seriesId) => { setFocusSeriesId(seriesId); setParam({ invoice: null, tab: "recurring" }); }}
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
