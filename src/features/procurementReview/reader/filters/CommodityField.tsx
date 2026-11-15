/**
 * A commodity code field: the chosen UNSPSC code and its title ("72000000 ·
 * Building and Facility Construction and Maintenance Services"), opening a
 * dialog to pick one from the hierarchy. Nobody knows UNSPSC's 90k codes by
 * heart, so the field isn't typed into. The BC Bid filters use it with the
 * loaded notices' counts; the award analysis's Filters dialog with the
 * awards' (`counting`).
 *
 * The dialog and its code list are loaded the first time it opens, never
 * with the list. The URL keeps the plain eight-digit code, so older links
 * still work.
 */
import { lazy, Suspense, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Field } from "../../../../components/ui";
import { UNSPSC_LEVELS, isUnspscCode, unspscLevel } from "../../../../../shared/unspsc";
import type { ListRow } from "../source";
import { useCommodityTitle } from "../commodity/titles";
import type { CommodityCounting } from "./CommodityPicker";

const CommodityPicker = lazy(() => import("./CommodityPicker"));

export function CommodityField({
  value,
  onChange,
  invalid = false,
  rows,
  counting,
  hint = "A segment, family or class includes everything under it.",
}: {
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  /** The loaded notices, for their counts (BC Bid) and the titles they give codes. */
  rows: readonly ListRow[];
  /** Keep it stable between renders: the picker counts again whenever it changes. */
  counting: CommodityCounting;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const valid = isUnspscCode(value);
  const title = useCommodityTitle(valid ? value : "", rows);
  const level = valid ? UNSPSC_LEVELS[unspscLevel(value)].toLowerCase() : "";
  return (
    <Field
      label="Commodity code (UNSPSC)"
      hint={invalid ? undefined : hint}
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
            counting={counting}
            onClose={() => setOpen(false)}
            onChoose={(code) => {
              onChange(code);
              setOpen(false);
            }}
          />
        </Suspense>
      )}
    </Field>
  );
}
