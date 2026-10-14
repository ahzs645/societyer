import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, EmptyState, Field, InspectorNote, SkeletonRows } from "../components/ui";
import { Money } from "../components/Money";
import { DEFAULT_CURRENCY, formatMoney } from "../lib/money";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { Checkbox } from "../components/Controls";
import { Plus, Coins, Trash2 } from "lucide-react";
import { useToast } from "../components/Toast";
import {
  CLASS_BY_CLASS_TAX_CAUTION,
  MIN_SOLVENCY_BASIS_LENGTH,
  dividendDeclarationProblems,
  normalizePerShareAmount,
  type DividendRuleScope,
} from "../../shared/dividends";
import { todayDateOnly } from "../../shared/dateOnly";
import { isCorporation } from "../../shared/organizationDomain";
import { formatDate } from "../lib/format";
import { NotRequiredNote } from "./SignificantIndividuals";

type DividendRow = {
  _id: string;
  declaredOn: string;
  shareClass: string;
  perShareCents: number;
  perShareAmount?: string;
  sharesOutstanding: number;
  sharesSource?: "ledger" | "manual";
  currency: string;
  totalCents: number;
  recordDate?: string;
  paymentDate?: string;
  status?: "draft" | "declared" | "paid" | "cancelled";
  solvencyConfirmedAt?: string;
  solvencyBasis?: string;
  excludedClassIds?: string[];
  entitlements?: Array<{ holderKey: string; holderName: string; shares: number; amount: string; amountCents: number }>;
  notes?: string;
};

type DividendOptions = {
  scope: DividendRuleScope;
  classes: Array<{ _id: string; className: string; classType?: string; status?: string; dividendEntitlement?: string }>;
  resolutions: Array<{ _id: string; title: string; circulatedAtISO?: string }>;
};

const STATUS_LABEL: Record<string, string> = { draft: "Draft", declared: "Declared", paid: "Paid", cancelled: "Cancelled", recorded: "Recorded" };
const STATUS_TONE: Record<string, "neutral" | "success" | "warn" | "info"> = { draft: "warn", declared: "success", paid: "info", cancelled: "neutral", recorded: "neutral" };

/** The solvency rule shown to the user, worded for the organization's Act. */
function solvencyRuleText(scope: DividendRuleScope | undefined): string {
  return scope === "bc_company"
    ? "Business Corporations Act s. 70 (2): a BC company may not declare or pay a dividend in money or property if there are reasonable grounds for believing it is insolvent, or that paying the dividend would make it insolvent. Directors who vote for or consent to a dividend paid contrary to s. 70 (2) can be personally liable to restore it (s. 154 (1) (c))."
    : "Corporate statutes restrict dividends when the corporation is, or would after payment be, unable to meet the statute's solvency test. Check the test in the governing statute and record the directors' basis.";
}

/**
 * Dividend declarations register (corporations track). A declaration names a
 * share class and record date; shares outstanding and each holder's
 * entitlement come from the share ledger as at the record date. A declaration
 * is saved as a draft until the directors' solvency confirmation is recorded.
 */
export function DividendsPage() {
  const { canWrite } = useFinancePermissions();
  const society = useSociety();
  const items = useQuery(api.dividends.list, society ? { societyId: society._id } : "skip") as DividendRow[] | undefined;
  const summary = useQuery(
    api.dividends.summary,
    society ? { societyId: society._id } : "skip",
  ) as { byClass: Record<string, number>; byCurrency: Record<string, number> } | undefined;
  const options = useQuery(api.dividends.options, society ? { societyId: society._id } : "skip") as DividendOptions | undefined;
  const create = useMutation(api.dividends.create);
  const setStatus = useMutation(api.dividends.setStatus);
  const remove = useMutation(api.dividends.remove);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [declaring, setDeclaring] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toast = useToast();

  const perShareAmount = form ? normalizePerShareAmount(String(form.perShareAmount ?? "")) : null;
  const manualShares = form && String(form.sharesOutstanding ?? "").trim() !== "" ? Number(form.sharesOutstanding) : undefined;
  const previewArgs = society && form && perShareAmount && (form.rightsClassId || form.shareClass?.trim())
    ? {
        societyId: society._id,
        declaredOn: form.declaredOn,
        ...(form.rightsClassId ? { rightsClassId: form.rightsClassId } : { shareClass: form.shareClass.trim() }),
        perShareAmount,
        ...(manualShares !== undefined && Number.isFinite(manualShares) ? { sharesOutstanding: manualShares } : {}),
        currency: String(form.currency ?? "").trim().toUpperCase(),
        ...(form.recordDate ? { recordDate: form.recordDate } : {}),
        ...(form.paymentDate ? { paymentDate: form.paymentDate } : {}),
        ...(form.excludedClassIds?.length ? { excludedClassIds: form.excludedClassIds } : {}),
      }
    : null;
  const preview = useQuery(api.dividends.preview, open && previewArgs ? previewArgs : "skip") as
    | ({ ok: true; sharesOutstanding: number; sharesSource: "ledger" | "manual"; totalAmount: string; totalCents: number; warnings: string[];
        snapshot: { entitlements: Array<{ holderKey: string; holderName: string; shares: number; amount: string }> } | null })
    | { ok: false; error: string }
    | undefined;

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const scope = options?.scope;
  const classes = options?.classes ?? [];
  const className = (id?: string) => classes.find((c) => c._id === id)?.className ?? "";
  const money = (cents: number, currency = DEFAULT_CURRENCY) => {
    try { return formatMoney(cents, { currency }); } catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
  };

  const openNew = () => {
    setForm({
      declaredOn: todayDateOnly(),
      rightsClassId: "",
      shareClass: "",
      perShareAmount: "",
      sharesOutstanding: "",
      currency: "CAD",
      recordDate: "",
      paymentDate: "",
      excludedClassIds: [],
      status: "draft",
      solvencyConfirmed: false,
      solvencyConfirmedAt: todayDateOnly(),
      solvencyBasis: "",
      declaredByResolutionId: "",
      notes: "",
    });
    setOpen(true);
  };

  const classByClass = Boolean(form?.excludedClassIds?.length);
  const formStatus = form?.status === "declared" ? "declared" : "draft";
  const formProblems = form
    ? dividendDeclarationProblems({
        status: formStatus,
        declaredOn: form.declaredOn,
        recordDate: form.recordDate || undefined,
        paymentDate: form.paymentDate || undefined,
        rightsClassId: form.rightsClassId || undefined,
        excludedClassIds: form.excludedClassIds,
        solvencyConfirmedAt: form.solvencyConfirmed ? form.solvencyConfirmedAt : undefined,
        solvencyBasis: form.solvencyConfirmed ? form.solvencyBasis : undefined,
      }, scope ?? "other_corporation")
    : [];

  const save = async () => {
    if (saving || !form) return;
    const currency = String(form.currency ?? "").trim().toUpperCase();
    if (!form.rightsClassId && !String(form.shareClass ?? "").trim()) {
      toast.error("Choose the share class the dividend is declared on.");
      return;
    }
    if (!perShareAmount) {
      toast.error("Enter the per-share amount as a decimal number, such as 0.25.");
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      toast.error("Enter a three-letter currency code, such as CAD or USD.");
      return;
    }
    if (formProblems.length) {
      toast.error("Check the dividend declaration", formProblems.join(" "));
      return;
    }
    setSaving(true);
    try {
      await create({
        societyId: society._id,
        declaredOn: form.declaredOn,
        ...(form.rightsClassId ? { rightsClassId: form.rightsClassId } : { shareClass: form.shareClass.trim() }),
        perShareAmount,
        ...(manualShares !== undefined && Number.isFinite(manualShares) ? { sharesOutstanding: manualShares } : {}),
        currency,
        ...(form.recordDate ? { recordDate: form.recordDate } : {}),
        ...(form.paymentDate ? { paymentDate: form.paymentDate } : {}),
        ...(form.excludedClassIds?.length ? { excludedClassIds: form.excludedClassIds } : {}),
        status: formStatus,
        ...(form.solvencyConfirmed ? { solvencyConfirmedAt: form.solvencyConfirmedAt, solvencyBasis: form.solvencyBasis.trim() } : {}),
        ...(form.declaredByResolutionId ? { declaredByResolutionId: form.declaredByResolutionId } : {}),
        notes: form.notes || undefined,
        nowISO: new Date().toISOString(),
      });
      setOpen(false);
      toast.success(formStatus === "declared" ? "Dividend declaration saved" : "Draft dividend saved");
    } catch (error: any) {
      toast.error("Could not save the dividend declaration", error?.message ?? "Try again.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (row: DividendRow, status: "declared" | "paid" | "cancelled", extra: Record<string, unknown> = {}) => {
    try {
      await setStatus({ id: row._id, status, ...extra, nowISO: new Date().toISOString() });
      toast.success(`Dividend marked ${STATUS_LABEL[status].toLowerCase()}`);
      return true;
    } catch (error: any) {
      toast.error("Could not update the dividend", error?.message ?? "Try again.");
      return false;
    }
  };

  const rows = items;
  const byClass = summary?.byClass ?? {};
  const otherClasses = classes.filter((c) => c._id !== form?.rightsClassId);

  return (
    <div className="page">
      <PageHeader
        title="Dividend declarations"
        icon={<Coins size={16} />}
        iconColor="yellow"
        subtitle="Declared dividends by share class."
        info={<p>Each declaration records the class, record date, payment date, per-share amount and who is entitled at the record date. A declaration stays a draft until the directors' solvency confirmation is recorded.</p>}
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
            <Plus size={12} /> New declaration
          </button>
        }
      />

      {!isCorporation(society) && (
        <NotRequiredNote>
          {society.name} is not a company with shares, so it does not declare dividends. Records kept here are optional.
        </NotRequiredNote>
      )}

      {Object.keys(byClass).length > 0 && (
        <p className="muted">
          Declared totals by class:{" "}
          {Object.entries(byClass)
            .map(([cls, cents]) => `${cls} ${money(cents)}`)
            .join(" · ")}
        </p>
      )}

      <div className="card">
        {rows === undefined ? (
          <SkeletonRows rows={3} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState size="sm" title="No dividend declarations yet" description="Record a declaration with its record date, per-share amount and the board's solvency confirmation." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Declared on</th>
                  <th>Share class</th>
                  <th>Record date</th>
                  <th>Payment date</th>
                  <th className="num">Per share</th>
                  <th className="num">Shares</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // Rows saved before statuses existed keep a neutral "Recorded" label.
                  const status = r.status ?? "recorded";
                  return (
                    <tr key={r._id}>
                      <td>{formatDate(r.declaredOn)}</td>
                      <td>
                        {r.shareClass}
                        {!!r.excludedClassIds?.length && (
                          <div className="muted">Not declared: {r.excludedClassIds.map(className).filter(Boolean).join(", ") || `${r.excludedClassIds.length} class(es)`}</div>
                        )}
                      </td>
                      <td>{r.recordDate ? formatDate(r.recordDate) : "—"}</td>
                      <td>{r.paymentDate ? formatDate(r.paymentDate) : "—"}</td>
                      <td className="num">{r.currency} {r.perShareAmount}</td>
                      <td className="num">
                        {r.sharesOutstanding.toLocaleString()}
                        <div className="muted">{r.sharesSource === "ledger" ? "From the ledger" : r.sharesSource === "manual" ? "Entered by hand" : ""}</div>
                      </td>
                      <td className="num"><Money cents={r.totalCents} currency={r.currency} /></td>
                      <td>
                        <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>
                        {!r.solvencyConfirmedAt && r.status !== "draft" && r.status !== "cancelled" && <div className="muted">No solvency confirmation recorded</div>}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {!!r.entitlements?.length && (
                            <button className="btn btn--ghost btn--sm" onClick={() => setExpanded(expanded === r._id ? null : r._id)}>
                              {expanded === r._id ? "Hide holders" : "Holders"}
                            </button>
                          )}
                          {r.status === "draft" && (
                            <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => setDeclaring({
                              row: r,
                              solvencyConfirmedAt: r.solvencyConfirmedAt ?? todayDateOnly(),
                              solvencyBasis: r.solvencyBasis ?? "",
                              declaredByResolutionId: "",
                            })}>
                              Mark declared
                            </button>
                          )}
                          {r.status === "declared" && (
                            <button className="btn btn--ghost btn--sm" disabled={!canWrite || !r.paymentDate} title={r.paymentDate ? undefined : "Record a payment date first."} onClick={() => void changeStatus(r, "paid")}>
                              Mark paid
                            </button>
                          )}
                          {(r.status === "draft" || r.status === "declared") && (
                            <button className="btn btn--ghost btn--sm" disabled={!canWrite} onClick={() => void changeStatus(r, "cancelled")}>
                              Cancel
                            </button>
                          )}
                          <button
                            className="btn btn--ghost btn--sm btn--icon"
                            aria-label={`Delete dividend declared ${formatDate(r.declaredOn)}`}
                            onClick={() => remove({ id: r._id })} disabled={!canWrite}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {expanded === r._id && (
                          <table className="table" style={{ marginTop: 8 }}>
                            <thead><tr><th>Holder at record date</th><th className="num">Shares</th><th className="num">Amount</th></tr></thead>
                            <tbody>
                              {(r.entitlements ?? []).map((e) => (
                                <tr key={e.holderKey}><td>{e.holderName}</td><td className="num">{e.shares.toLocaleString()}</td><td className="num">{r.currency} {e.amount}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New dividend declaration"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save} disabled={!canWrite || saving}>
              {saving ? "Saving…" : formStatus === "declared" ? "Save as declared" : "Save draft"}
            </button>
          </>
        }
      >
        {form && (
          <div>
            {isCorporation(society) && (
              <InspectorNote tone="info" title="Solvency">
                {solvencyRuleText(scope)}
              </InspectorNote>
            )}
            <Field label="Share class">
              {classes.length > 0 ? (
                <Select
                  value={form.rightsClassId}
                  onChange={(value) => setForm({ ...form, rightsClassId: value, excludedClassIds: (form.excludedClassIds ?? []).filter((id: string) => id !== value) })}
                  options={[{ value: "", label: "Choose a class" }, ...classes.map((c) => ({ value: c._id, label: c.className }))]}
                />
              ) : (
                <input
                  className="input"
                  value={form.shareClass}
                  placeholder="No share classes are recorded; type the class name"
                  onChange={(e) => setForm({ ...form, shareClass: e.target.value })}
                />
              )}
            </Field>
            {form.rightsClassId && otherClasses.length > 0 && (
              <Field label="Classes not declared on this occasion" hint="Tick each class the directors deliberately leave out (a class-by-class dividend).">
                <div className="col" style={{ gap: 4 }}>
                  {otherClasses.map((c) => (
                    <Checkbox
                      key={c._id}
                      label={c.className}
                      checked={(form.excludedClassIds ?? []).includes(c._id)}
                      onChange={(checked) => setForm({
                        ...form,
                        excludedClassIds: checked
                          ? [...(form.excludedClassIds ?? []), c._id]
                          : (form.excludedClassIds ?? []).filter((id: string) => id !== c._id),
                      })}
                    />
                  ))}
                </div>
              </Field>
            )}
            {classByClass && (
              <InspectorNote tone="warn" title="Tax advice needed">
                {CLASS_BY_CLASS_TAX_CAUTION}
              </InspectorNote>
            )}
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Declared on">
                <DatePicker value={form.declaredOn} onChange={(value) => setForm({ ...form, declaredOn: value })} />
              </Field>
              <Field label="Record date" hint="Shareholders on the register at the end of this day are entitled.">
                <DatePicker value={form.recordDate} onChange={(value) => setForm({ ...form, recordDate: value })} />
              </Field>
              <Field label="Payment date">
                <DatePicker value={form.paymentDate} onChange={(value) => setForm({ ...form, paymentDate: value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Per-share amount" hint="In currency units, exactly as declared, such as 0.0125.">
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.perShareAmount}
                  onChange={(e) => setForm({ ...form, perShareAmount: e.target.value })}
                />
              </Field>
              <Field label="Currency">
                <input
                  className="input"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                />
              </Field>
            </div>
            {(!form.rightsClassId || !form.recordDate || (preview?.ok && preview.sharesSource === "manual") || (preview && !preview.ok && /enter the shares outstanding/i.test(preview.error))) && (
              <Field label="Shares outstanding (only when the ledger has no holdings)">
                <input
                  className="input"
                  type="number"
                  value={form.sharesOutstanding}
                  onChange={(e) => setForm({ ...form, sharesOutstanding: e.target.value })}
                />
              </Field>
            )}

            {preview && !preview.ok && <InspectorNote tone="warn" title="Not ready">{preview.error}</InspectorNote>}
            {preview?.ok && (
              <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <strong>
                  {preview.sharesOutstanding.toLocaleString()} shares {preview.sharesSource === "ledger" ? "at the record date (from the share ledger)" : "(entered by hand)"} · total {form.currency.toUpperCase()} {preview.totalAmount}
                </strong>
                {preview.snapshot && preview.snapshot.entitlements.length > 0 && (
                  <table className="table" style={{ marginTop: 8 }}>
                    <thead><tr><th>Holder</th><th className="num">Shares</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {preview.snapshot.entitlements.map((e) => (
                        <tr key={e.holderKey}><td>{e.holderName}</td><td className="num">{e.shares.toLocaleString()}</td><td className="num">{e.amount}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {preview.warnings.map((warning) => <p key={warning} className="muted" style={{ margin: "6px 0 0" }}>{warning}</p>)}
              </div>
            )}

            <Field label="Status">
              <Select
                value={formStatus}
                onChange={(value) => setForm({ ...form, status: value })}
                options={[{ value: "draft", label: "Draft (not yet declared)" }, { value: "declared", label: "Declared by the directors" }]}
              />
            </Field>
            <Checkbox
              label="The directors have considered solvency and confirmed the dividend may be declared and paid"
              checked={Boolean(form.solvencyConfirmed)}
              onChange={(checked) => setForm({ ...form, solvencyConfirmed: checked })}
            />
            {form.solvencyConfirmed && (
              <>
                <Field label="Solvency confirmed on">
                  <DatePicker value={form.solvencyConfirmedAt} onChange={(value) => setForm({ ...form, solvencyConfirmedAt: value })} />
                </Field>
                <Field label="Basis for the confirmation" hint={`What the directors relied on, such as current financial statements or a cash-flow forecast (at least ${MIN_SOLVENCY_BASIS_LENGTH} characters).`}>
                  <textarea className="input" value={form.solvencyBasis} onChange={(e) => setForm({ ...form, solvencyBasis: e.target.value })} />
                </Field>
              </>
            )}
            {(options?.resolutions?.length ?? 0) > 0 && (
              <Field label="Declared by resolution">
                <Select
                  value={form.declaredByResolutionId}
                  onChange={(value) => setForm({ ...form, declaredByResolutionId: value })}
                  options={[{ value: "", label: "No resolution linked" }, ...(options?.resolutions ?? []).map((r) => ({ value: r._id, label: r.title || "Untitled resolution" }))]}
                />
              </Field>
            )}
            <Field label="Notes">
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
            {formProblems.length > 0 && (
              <InspectorNote tone="danger" title="Before saving">{formProblems.join(" ")}</InspectorNote>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(declaring)}
        onClose={() => setDeclaring(null)}
        title="Mark dividend declared"
        footer={
          <>
            <button className="btn" onClick={() => setDeclaring(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!canWrite || String(declaring?.solvencyBasis ?? "").trim().length < MIN_SOLVENCY_BASIS_LENGTH || !declaring?.solvencyConfirmedAt}
              onClick={async () => {
                if (!declaring) return;
                const ok = await changeStatus(declaring.row, "declared", {
                  solvencyConfirmedAt: declaring.solvencyConfirmedAt,
                  solvencyBasis: declaring.solvencyBasis.trim(),
                  ...(declaring.declaredByResolutionId ? { declaredByResolutionId: declaring.declaredByResolutionId } : {}),
                });
                if (ok) setDeclaring(null);
              }}
            >
              Mark declared
            </button>
          </>
        }
      >
        {declaring && (
          <div>
            {isCorporation(society) && <InspectorNote tone="info" title="Solvency">{solvencyRuleText(scope)}</InspectorNote>}
            <Field label="Solvency confirmed on">
              <DatePicker value={declaring.solvencyConfirmedAt} onChange={(value) => setDeclaring({ ...declaring, solvencyConfirmedAt: value })} />
            </Field>
            <Field label="Basis for the confirmation" hint={`At least ${MIN_SOLVENCY_BASIS_LENGTH} characters.`}>
              <textarea className="input" value={declaring.solvencyBasis} onChange={(e) => setDeclaring({ ...declaring, solvencyBasis: e.target.value })} />
            </Field>
            {(options?.resolutions?.length ?? 0) > 0 && (
              <Field label="Declared by resolution">
                <Select
                  value={declaring.declaredByResolutionId}
                  onChange={(value) => setDeclaring({ ...declaring, declaredByResolutionId: value })}
                  options={[{ value: "", label: "No resolution linked" }, ...(options?.resolutions ?? []).map((r) => ({ value: r._id, label: r.title || "Untitled resolution" }))]}
                />
              </Field>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default DividendsPage;
