/**
 * The commodity code field of the BC Bid filters: the chosen UNSPSC code and
 * its title ("72000000 · Building and Facility Construction and Maintenance
 * Services"), opening a dialog to pick one from the hierarchy. Nobody knows
 * UNSPSC's 90k codes by heart, so the field isn't typed into.
 *
 * The dialog and its code list are loaded the first time it opens, never
 * with the list. The URL keeps the plain eight-digit code, so older links
 * still work.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Field } from "../../../../components/ui";
import type { BcBidSourceFilters } from "../../../../../shared/bcBidSourceFilters";
import type { ListRow } from "../source";

const CommodityPicker = lazy(() => import("./CommodityPicker"));

/** Titles the picker has shown, kept for the page's life so a chosen code stays titled when the editor reopens. */
const knownTitles = new Map<string, string>();
const LEVELS = ["segment", "family", "class", "commodity"];

/** The title the loaded notices give a code (the demo's rows carry them). */
function titleInRows(rows: readonly ListRow[], code: string): string {
  for (const row of rows) {
    const json = row.analyticsJson;
    if (!json?.includes(`"${code}"`) || !json.includes("commodityClassifications")) continue;
    // `"code":"72000000","title":"…"` as stored, either in a classification or one of its ancestors.
    const match = new RegExp(`"code":"${code}","title":"((?:[^"\\\\]|\\\\.)*)"`).exec(json);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return "";
      }
    }
  }
  return "";
}

export function CommodityField({
  value,
  onChange,
  invalid,
  rows,
  filters,
}: {
  value: string;
  onChange: (code: string) => void;
  invalid: boolean;
  rows: readonly ListRow[];
  /** The draft's other BC Bid filters; the picker's counts follow them. */
  filters: BcBidSourceFilters;
}) {
  const [open, setOpen] = useState(false);
  const valid = /^\d{8}$/.test(value);
  const rowTitle = useMemo(() => (valid ? titleInRows(rows, value) : ""), [valid, value, rows]);
  const title = knownTitles.get(value) || rowTitle;
  const level = valid ? LEVELS[value.endsWith("000000") ? 0 : value.endsWith("0000") ? 1 : value.endsWith("00") ? 2 : 3] : "";
  return (
    <Field
      label="Commodity code (UNSPSC)"
      hint={invalid ? undefined : "A segment, family or class includes everything under it."}
      error={invalid ? "Pick a code from the list." : undefined}
    >
      <div className="procurement-commodity-field">
        <button
          type="button"
          className={`select-trigger${open ? " is-open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <span className="select-trigger__label">
            {value ? (
              <span className="procurement-commodity-field__value">
                <span className="procurement-commodity-field__code">{value}</span>
                <span className="procurement-commodity-field__title">{title ? ` · ${title}` : level ? ` · ${level}` : ""}</span>
              </span>
            ) : (
              <span className="select-trigger__placeholder">Any</span>
            )}
          </span>
          <ChevronDown size={14} className="select-trigger__chev" />
        </button>
        {value && (
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm procurement-commodity-field__clear"
            aria-label="Clear the commodity code"
            onClick={() => onChange("")}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && (
        <Suspense fallback={null}>
          <CommodityPicker
            value={value}
            rows={rows}
            filters={filters}
            onClose={() => setOpen(false)}
            onChoose={(code, chosenTitle) => {
              if (code && chosenTitle) knownTitles.set(code, chosenTitle);
              onChange(code);
              setOpen(false);
            }}
            onTitle={(code, known) => knownTitles.set(code, known)}
          />
        </Suspense>
      )}
    </Field>
  );
}
