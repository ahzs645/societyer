import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../../../hooks/useSociety";
import { usePermissions } from "../../../hooks/usePermissions";
import { useFinancePermissions } from "../../../hooks/useFinancePermissions";
import { PageHeader, SeedPrompt } from "../../../pages/_helpers";
import { Banner, Field } from "../../../components/ui";
import { DatePicker } from "../../../components/DatePicker";
import { InfoPopover } from "../../../components/InfoPopover";
import { Segmented } from "../../../components/primitives";
import { formatMonthDay } from "../../../components/MonthDayPicker";
import { useToast } from "../../../components/Toast";
import { useConfirm } from "../../../components/Modal";
import { formatDate } from "../../../lib/format";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { BooksNav } from "../components/BooksNav";
import { CloseDateSection } from "../settings/CloseDateSection";
import { booksErrorMessage, canMoveCloseDate, useBooksSettings, type BooksSettingsView } from "../settings/booksSettings";

type Basis = "accrual" | "cash";
type Draft = { booksStartDate: string; accountingBasis: Basis; closeDate: string };

const BASIS_ITEMS: { id: Basis; label: string }[] = [
  { id: "accrual", label: "Accrual" },
  { id: "cash", label: "Cash" },
];

function savedDraft(settings: BooksSettingsView): Draft {
  return {
    booksStartDate: settings.booksStartDate ?? "",
    accountingBasis: settings.accountingBasis === "cash" ? "cash" : "accrual",
    closeDate: settings.closeDate ?? "",
  };
}

/**
 * Books settings: the books start date, the default accounting basis for
 * reports, and the close date that locks every journal write on or before it.
 * Fiscal periods stay on the accounting workbench; this page explains how the
 * two relate and links there.
 */
export function BooksSettingsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const { role } = usePermissions();
  const isAdmin = canMoveCloseDate(role);
  const settings = useBooksSettings(society?._id);
  const update = useMutation(api.accounting.updateBooksSettings);
  const toast = useToast();
  const confirm = useConfirm();
  const [edits, setEdits] = useState<Partial<Draft>>({});
  const [saving, setSaving] = useState(false);
  const basisLabelId = useId();

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const saved = settings ? savedDraft(settings) : null;
  const draft: Draft | null = saved ? { ...saved, ...edits } : null;
  const changed = (key: keyof Draft) => Boolean(saved && draft && draft[key] !== saved[key]);
  const dirty = changed("booksStartDate") || changed("accountingBasis") || changed("closeDate");
  const today = todayDateOnly();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setEdits((current) => ({ ...current, [key]: value }));

  /** Ask before moving the close date: locking says what it blocks, clearing says what it opens. */
  const confirmCloseDate = (next: string, previous: string) =>
    next
      ? confirm({
          title: `Lock the books through ${formatDate(next)}?`,
          message: "Entries dated on or before it can't be posted, edited or voided until an admin moves this date.",
          confirmLabel: "Lock the books",
          tone: "warn",
        })
      : confirm({
          title: "Remove the close date?",
          message: `Entries dated on or before ${formatDate(previous)} can be posted, edited and voided again. Closed fiscal periods stay closed.`,
          confirmLabel: "Remove close date",
          tone: "warn",
        });

  const save = async (patch: Partial<Draft>) => {
    if (!saved) return;
    if (patch.closeDate !== undefined && !(await confirmCloseDate(patch.closeDate, saved.closeDate))) return;
    setSaving(true);
    try {
      await update({
        societyId: society._id,
        ...(patch.booksStartDate !== undefined ? { booksStartDate: patch.booksStartDate || null } : {}),
        ...(patch.accountingBasis !== undefined ? { accountingBasis: patch.accountingBasis } : {}),
        ...(patch.closeDate !== undefined ? { closeDate: patch.closeDate || null } : {}),
      });
      setEdits((current) => {
        const next = { ...current };
        for (const key of Object.keys(patch) as Array<keyof Draft>) delete next[key];
        return next;
      });
      toast.success(patch.closeDate !== undefined && Object.keys(patch).length === 1
        ? patch.closeDate ? `Books locked through ${formatDate(patch.closeDate)}` : "Close date removed"
        : "Books settings saved");
    } catch (error) {
      toast.error("Books settings not saved", booksErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const saveChanges = () => {
    if (!draft) return;
    const patch: Partial<Draft> = {};
    if (changed("booksStartDate")) patch.booksStartDate = draft.booksStartDate;
    if (changed("accountingBasis")) patch.accountingBasis = draft.accountingBasis;
    if (changed("closeDate")) patch.closeDate = draft.closeDate;
    void save(patch);
  };

  const earlyEntries = Boolean(draft?.booksStartDate && settings?.firstEntryDate && settings.firstEntryDate < draft.booksStartDate);

  return (
    <div className="page page--wide books-settings">
      <PageHeader
        title="Books settings"
        subtitle="Where the books start, the basis reports use, and the date the books are locked through."
      />
      <BooksNav />

      {!draft || !settings ? (
        <section className="card settings-section books-settings__card" aria-busy="true">
          <p className="settings-section__hint">Loading books settings…</p>
        </section>
      ) : (
        <section className="card settings-section books-settings__card" aria-labelledby="books-settings-title">
          <h2 className="settings-section__title" id="books-settings-title">Books</h2>

          <Field
            label="Books start date"
            hint="The first day your books cover. It is the default opening-balance date and the earliest date reports offer."
          >
            <DatePicker value={draft.booksStartDate} onChange={(value) => set("booksStartDate", value)} disabled={!canWrite || saving} placeholder="Not set" />
          </Field>
          {earlyEntries && settings.firstEntryDate && (
            <Banner tone="warn">
              Posted entries go back to {formatDate(settings.firstEntryDate)}, before this start date. Move the start date earlier, or check those entries.
            </Banner>
          )}

          <div className="field">
            <div className="books-settings__label">
              <span className="field__label" id={basisLabelId}>Accounting basis</span>
              <InfoPopover label="About the accounting basis">
                <p><strong>Accrual</strong> recognises revenue and expenses when they are invoiced or billed.</p>
                <p><strong>Cash</strong> recognises them when the money moves.</p>
                <p>
                  Reports default to this basis and can be switched for a single report. Under the cash basis, invoice and bill accruals are left
                  out and recognised when they are paid.
                </p>
              </InfoPopover>
            </div>
            <div role="group" aria-labelledby={basisLabelId} className={!canWrite || saving ? "books-settings__locked" : undefined} aria-disabled={!canWrite || saving || undefined}>
              <Segmented value={draft.accountingBasis} onChange={(value) => canWrite && !saving && set("accountingBasis", value)} items={BASIS_ITEMS} />
            </div>
          </div>

          <div className="settings-section__fact">
            <span className="settings-section__fact-label">Fiscal year end</span>
            <span>{settings.fiscalYearEnd ? formatMonthDay(settings.fiscalYearEnd) : "Not set"}</span>
            {!settings.fiscalYearEnd && <Link to="/app/society" className="settings-section__fact-link">Set it in organization details</Link>}
          </div>

          <hr className="books-settings__divider" />

          <CloseDateSection
            settings={settings}
            value={draft.closeDate}
            onChange={(value) => set("closeDate", value)}
            onLockThrough={(date) => void save({ closeDate: date })}
            isAdmin={isAdmin}
            disabled={!canWrite || saving}
            today={today}
          />

          <div className="books-settings__actions">
            {dirty && (
              <button type="button" className="btn" onClick={() => setEdits({})} disabled={saving}>
                Discard changes
              </button>
            )}
            <button type="button" className="btn btn--accent" onClick={saveChanges} disabled={!canWrite || saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
