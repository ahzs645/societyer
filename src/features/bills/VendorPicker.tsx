import { useId, useMemo, useRef, useState } from "react";
import { Building2, Plus, X } from "lucide-react";
import type { BillVendor } from "./types";

/** What the picker needs of a vendor (a just-created one has only its name). */
export type PickerVendor = Pick<BillVendor, "_id" | "name"> & Partial<Pick<BillVendor, "email" | "defaultAccountId" | "defaultAccountLabel" | "defaultTerms">>;

type Option = { kind: "vendor"; vendor: PickerVendor } | { kind: "create"; name: string };

type Props = {
  vendorId: string;
  vendors: readonly PickerVendor[];
  onChange: (vendor: PickerVendor | null) => void;
  /** Creates a vendor and resolves to it; omitted when the person can't. */
  onCreate?: (name: string) => Promise<PickerVendor | undefined>;
  disabled?: boolean;
};

/** Search vendors or create one by name. Shares the bill-to picker's look from Invoices. */
export function VendorPicker({ vendorId, vendors, onChange, onCreate, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const chosen = vendors.find((vendor) => vendor._id === vendorId) ?? null;

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const list: Option[] = vendors
      .filter((vendor) => !q || vendor.name.toLowerCase().includes(q) || (vendor.email ?? "").toLowerCase().includes(q))
      .slice(0, 8)
      .map((vendor) => ({ kind: "vendor", vendor }));
    const typed = query.trim();
    if (typed && onCreate && !vendors.some((vendor) => vendor.name.toLowerCase() === typed.toLowerCase())) list.push({ kind: "create", name: typed });
    return list;
  }, [query, vendors, onCreate]);

  const choose = async (option: Option) => {
    if (option.kind === "vendor") onChange(option.vendor);
    else if (onCreate) {
      setCreating(true);
      try {
        const vendor = await onCreate(option.name);
        if (vendor) onChange(vendor);
      } finally {
        setCreating(false);
      }
    }
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      void choose(options[active]);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (chosen) {
    return (
      <div className="billto">
        <div className="billto__chosen">
          <span className="billto__icon" aria-hidden="true"><Building2 size={14} /></span>
          <span className="billto__name">{chosen.name}</span>
          {chosen.defaultAccountLabel && <span className="billto__kind">{chosen.defaultAccountLabel}</span>}
          {!disabled && (
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Change vendor (currently ${chosen.name})`}
              onClick={() => {
                onChange(null);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="billto billto--search">
      <input
        ref={inputRef}
        className="input"
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        aria-label="Vendor"
        placeholder="Search vendors, or type a new name"
        value={query}
        disabled={disabled || creating}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul className="billto__list" role="listbox" id={listId}>
          {options.map((option, index) => {
            const label = option.kind === "vendor" ? option.vendor.name : `Create vendor “${option.name}”`;
            const sub = option.kind === "vendor" ? [option.vendor.defaultAccountLabel, option.vendor.email].filter(Boolean).join(" · ") : "Saved to Vendors; add details later";
            const Icon = option.kind === "vendor" ? Building2 : Plus;
            return (
              <li
                key={option.kind === "vendor" ? option.vendor._id : "create"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`billto__option${index === active ? " is-active" : ""}`}
                onMouseDown={(event) => { event.preventDefault(); void choose(option); }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="billto__icon" aria-hidden="true"><Icon size={14} /></span>
                <span className="billto__option-text">
                  <span>{label}</span>
                  {sub && <span className="billto__option-sub">{sub}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
