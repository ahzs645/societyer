import { useId } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { DatePicker } from "../../../components/DatePicker";
import { InfoPopover } from "../../../components/InfoPopover";
import { formatDate, formatDateTime } from "../../../lib/format";
import { CloseDateExplainer, type BooksSettingsView } from "./booksSettings";

/**
 * The close date part of Books settings: a date picker for admins (read-only
 * for everyone else), who set it and when, and a one-click "lock through"
 * suggestion when the last closed fiscal period ends after the close date.
 */
export function CloseDateSection({
  settings,
  value,
  onChange,
  onLockThrough,
  isAdmin,
  disabled,
  today,
}: {
  settings: BooksSettingsView;
  /** The draft close date ("" when unset). */
  value: string;
  onChange: (value: string) => void;
  /** Saves the close date straight away (after the page's confirmation). */
  onLockThrough: (date: string) => void;
  isAdmin: boolean;
  disabled: boolean;
  today: string;
}) {
  const closeDateId = useId();
  const lastClosed = settings.lastClosedPeriod;
  const suggestion = isAdmin && !disabled && lastClosed && lastClosed.endDate <= today && (!settings.closeDate || lastClosed.endDate > settings.closeDate)
    ? lastClosed
    : null;

  return (
    <>
      <div className="field">
        <div className="books-settings__label">
          <label className="field__label" htmlFor={closeDateId}>Close date</label>
          <InfoPopover label="How the close date relates to fiscal periods">
            <CloseDateExplainer>
              <p>Manage periods under <Link to="/app/financials/accounting#fiscal-periods">Fiscal periods</Link> on the workbench.</p>
            </CloseDateExplainer>
          </InfoPopover>
        </div>
        {isAdmin ? (
          <div className="books-settings__close-row">
            <DatePicker id={closeDateId} value={value} onChange={onChange} max={today} clearable={false} disabled={disabled} placeholder="Not set" />
            <button type="button" className="btn-action" onClick={() => onChange("")} disabled={disabled || !value}>
              Clear
            </button>
          </div>
        ) : (
          <p className="books-settings__readonly" id={closeDateId}>
            {settings.closeDate ? <><Lock size={12} aria-hidden="true" /> Locked through {formatDate(settings.closeDate)}</> : "Not set"}
          </p>
        )}
        <p className="settings-section__hint">
          {isAdmin
            ? "Entries dated on or before this date can't be posted, edited or voided. Leave it empty to keep the books open."
            : "Only an admin can move the close date."}
        </p>
      </div>
      {settings.closeDate && (
        <p className="settings-section__hint">
          Set{settings.closeDateSetByName ? ` by ${settings.closeDateSetByName}` : ""}{settings.closeDateSetAtISO ? ` on ${formatDateTime(settings.closeDateSetAtISO)}` : ""}.
        </p>
      )}
      {suggestion && (
        <p className="settings-section__hint">
          {suggestion.periodLabel} is closed but the books are not locked through it.{" "}
          <button type="button" className="link-button" onClick={() => onLockThrough(suggestion.endDate)}>
            Lock through {formatDate(suggestion.endDate)} (end of {suggestion.periodLabel})
          </button>
        </p>
      )}
      <p className="settings-section__hint">
        {settings.closedPeriodCount > 0
          ? `${settings.closedPeriodCount} fiscal ${settings.closedPeriodCount === 1 ? "period is" : "periods are"} closed. `
          : "No fiscal periods are closed yet. "}
        <Link to="/app/financials/accounting#fiscal-periods">Manage fiscal periods</Link>
      </p>
    </>
  );
}
