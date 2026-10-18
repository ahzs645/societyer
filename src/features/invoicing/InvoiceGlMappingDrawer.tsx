import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../convex/_generated/dataModel";
import { Drawer, Field } from "../../components/ui";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { normalizeRevenueCategory } from "../../../shared/invoiceLedger";
import type { InvoiceWorkspace, LedgerAccountOption } from "./types";

type Props = { open: boolean; onClose: () => void; workspace: InvoiceWorkspace; societyId: string; canWrite: boolean };

const options = (accounts: LedgerAccountOption[]) => accounts.map((account) => ({ value: account._id, label: account.label }));

/**
 * "Edit GL account mapping": where invoices land in the books. Revenue goes
 * to the catalog item's account, else its category's, else the default; the
 * receivable, sales tax and undeposited-payment accounts fall back to the
 * chart's own (created on first use). Changes apply to postings from now on.
 */
export function InvoiceGlMappingDrawer({ open, onClose, workspace, societyId, canWrite }: Props) {
  const save = useMutation(api.invoices.saveAccountMapping);
  const toast = useToast();
  const { settings, ledger, catalog } = workspace;
  const [receivable, setReceivable] = useState(settings.receivableAccountId ?? "");
  const [taxPayable, setTaxPayable] = useState(settings.taxPayableAccountId ?? "");
  const [defaultRevenue, setDefaultRevenue] = useState(settings.defaultRevenueAccountId ?? "");
  const [deposit, setDeposit] = useState(settings.depositAccountId ?? "");
  const [categories, setCategories] = useState<Record<string, string>>(() =>
    Object.fromEntries((settings.categoryAccounts ?? []).map((row) => [normalizeRevenueCategory(row.category), row.accountId])),
  );
  const [items, setItems] = useState<Record<string, string>>(() => Object.fromEntries(catalog.map((item) => [item._id, item.accountingAccountId ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revenue = useMemo(() => options(ledger.accounts.revenue), [ledger.accounts.revenue]);
  const labelOf = (id: string | undefined) => ledger.accounts.revenue.find((account) => account._id === id)?.label;
  const defaultLabel = labelOf(defaultRevenue);
  const fallbackFor = (category: string | undefined) => {
    const viaCategory = category ? labelOf(categories[normalizeRevenueCategory(category)]) : undefined;
    if (viaCategory) return `Category: ${viaCategory}`;
    return defaultLabel ? `Default: ${defaultLabel}` : "Not mapped";
  };
  const fallbackLabel = (fallback: { label: string } | null, name: string) => (fallback ? `${fallback.label} (default)` : `${name} (created on first use)`);
  const sortedCatalog = [...catalog].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = (value: string) => (value ? (value as Id<"financialAccounts">) : undefined);
      await save({
        societyId: societyId as Id<"societies">,
        receivableAccountId: account(receivable),
        taxPayableAccountId: account(taxPayable),
        defaultRevenueAccountId: account(defaultRevenue),
        depositAccountId: account(deposit),
        categoryAccounts: ledger.categories.map((category) => ({ category, accountId: account(categories[normalizeRevenueCategory(category)] ?? "") })),
        itemAccounts: catalog
          .filter((item) => (item.accountingAccountId ?? "") !== (items[item._id] ?? ""))
          .map((item) => ({ catalogItemId: item._id as Id<"invoiceCatalogItems">, accountId: account(items[item._id] ?? "") })),
      });
      toast.success("GL account mapping saved", ledger.readyCount ? "Use Post existing invoices to put earlier invoices in the books." : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the mapping.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="wide"
      title="Edit GL account mapping"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canWrite || busy} onClick={() => void submit()}>Save mapping</button>
        </>
      }
    >
      <p className="muted invoice-glmap__intro">
        Sending an invoice debits Accounts receivable and credits each line's revenue account and the sales tax collected. A line uses its
        item's account, then its category's, then the default. Changes apply to what is posted from now on; entries already in the books stay as they are.
      </p>
      {error && <p className="field__error" role="alert">{error}</p>}

      <section className="invoice-glmap__section" aria-labelledby="glmap-defaults">
        <h3 id="glmap-defaults" className="invoice-drawer__heading">Accounts</h3>
        <div className="invoice-glmap__grid">
          <Field label="Default revenue account" hint="For lines whose item and category aren't mapped.">
            <Select value={defaultRevenue} onChange={setDefaultRevenue} options={revenue} placeholder="Not set" clearable clearLabel="Not set" searchable />
          </Field>
          <Field label="Accounts receivable">
            <Select value={receivable} onChange={setReceivable} options={options(ledger.accounts.receivable)} placeholder={fallbackLabel(ledger.defaults.receivable, "Accounts receivable")} clearable clearLabel="Use the default" searchable />
          </Field>
          <Field label="Sales tax collected" hint="GST, HST and PST charged on invoices.">
            <Select value={taxPayable} onChange={setTaxPayable} options={options(ledger.accounts.taxPayable)} placeholder={fallbackLabel(ledger.defaults.taxPayable, "GST/HST payable")} clearable clearLabel="Use the default" searchable />
          </Field>
          <Field label="Payments not linked to a deposit" hint="Where a payment sits until it's linked to the bank deposit.">
            <Select value={deposit} onChange={setDeposit} options={options(ledger.accounts.deposit)} placeholder={fallbackLabel(ledger.defaults.deposit, "Undeposited funds")} clearable clearLabel="Use the default" searchable />
          </Field>
        </div>
      </section>

      <section className="invoice-glmap__section" aria-labelledby="glmap-categories">
        <h3 id="glmap-categories" className="invoice-drawer__heading">Revenue by category</h3>
        <ul className="invoice-glmap__list">
          {ledger.categories.map((category) => {
            const key = normalizeRevenueCategory(category);
            return (
              <li key={key} className="invoice-glmap__row">
                <span className="invoice-glmap__name">{category}</span>
                <Select
                  value={categories[key] ?? ""}
                  onChange={(value) => setCategories((current) => ({ ...current, [key]: value }))}
                  options={revenue}
                  placeholder={defaultLabel ? `Default: ${defaultLabel}` : "Not mapped"}
                  clearable
                  clearLabel="Use the default"
                  searchable
                  aria-label={`Revenue account for ${category}`}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {sortedCatalog.length > 0 && (
        <section className="invoice-glmap__section" aria-labelledby="glmap-items">
          <h3 id="glmap-items" className="invoice-drawer__heading">Revenue by item</h3>
          <ul className="invoice-glmap__list">
            {sortedCatalog.map((item) => (
              <li key={item._id} className="invoice-glmap__row">
                <span className="invoice-glmap__name">
                  {item.name}
                  <span className="muted invoice-glmap__sub">{[item.category, item.active ? null : "Inactive"].filter(Boolean).join(" · ")}</span>
                </span>
                <Select
                  value={items[item._id] ?? ""}
                  onChange={(value) => setItems((current) => ({ ...current, [item._id]: value }))}
                  options={revenue}
                  placeholder={fallbackFor(item.category)}
                  clearable
                  clearLabel="Use the category or default"
                  searchable
                  aria-label={`Revenue account for ${item.name}`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </Drawer>
  );
}
