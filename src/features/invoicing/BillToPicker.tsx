import { useId, useMemo, useRef, useState } from "react";
import { Building2, Plus, User, UserRound, X } from "lucide-react";
import type { PartyOption } from "./types";

export type BillToValue = {
  partyKind: "member" | "organization" | "custom";
  memberId?: string;
  counterpartyId?: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
};

type Option =
  | { kind: "member"; party: PartyOption }
  | { kind: "organization"; party: PartyOption }
  | { kind: "custom"; name: string }
  | { kind: "create"; name: string };

type Props = {
  value: BillToValue;
  onChange: (value: BillToValue) => void;
  members: PartyOption[];
  organizations: PartyOption[];
  /** Members are offered only where the workspace has members (societies). */
  showMembers: boolean;
  /** Creates an organization customer and resolves to its id; omitted when the user can't. */
  onCreateOrganization?: (name: string) => Promise<string | undefined>;
  disabled?: boolean;
};

/**
 * Search members and organizations to bill, create a customer, or bill a
 * one-off name. The chosen party fills the email and address, which stay
 * editable for this invoice.
 */
export function BillToPicker({ value, onChange, members, organizations, showMembers, onCreateOrganization, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hasParty = Boolean(value.billToName);

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (party: PartyOption) => !q || party.name.toLowerCase().includes(q) || (party.email ?? "").toLowerCase().includes(q);
    const list: Option[] = [];
    if (showMembers) for (const party of members.filter((m) => m.status !== "Inactive").filter(match).slice(0, 6)) list.push({ kind: "member", party });
    for (const party of organizations.filter(match).slice(0, 6)) list.push({ kind: "organization", party });
    const typed = query.trim();
    const exact = [...members, ...organizations].some((party) => party.name.toLowerCase() === typed.toLowerCase());
    if (typed && !exact) {
      if (onCreateOrganization) list.push({ kind: "create", name: typed });
      list.push({ kind: "custom", name: typed });
    }
    return list;
  }, [query, members, organizations, showMembers, onCreateOrganization]);

  const choose = async (option: Option) => {
    if (option.kind === "member") {
      onChange({ partyKind: "member", memberId: option.party._id, billToName: option.party.name, billToEmail: option.party.email, billToAddress: option.party.address });
    } else if (option.kind === "organization") {
      onChange({ partyKind: "organization", counterpartyId: option.party._id, billToName: option.party.name, billToEmail: option.party.email, billToAddress: value.billToAddress });
    } else if (option.kind === "custom") {
      onChange({ partyKind: "custom", billToName: option.name, billToEmail: value.billToEmail, billToAddress: value.billToAddress });
    } else if (onCreateOrganization) {
      setCreating(true);
      try {
        const id = await onCreateOrganization(option.name);
        if (id) onChange({ partyKind: "organization", counterpartyId: id, billToName: option.name, billToEmail: value.billToEmail, billToAddress: value.billToAddress });
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
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      void choose(options[active]);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (hasParty) {
    const Icon = value.partyKind === "member" ? UserRound : value.partyKind === "organization" ? Building2 : User;
    return (
      <div className="billto">
        <div className="billto__chosen">
          <span className="billto__icon" aria-hidden="true"><Icon size={14} /></span>
          <span className="billto__name">{value.billToName}</span>
          <span className="billto__kind">{value.partyKind === "member" ? "Member" : value.partyKind === "organization" ? "Customer" : "One-off"}</span>
          {!disabled && (
            <button
              type="button"
              className="btn btn--ghost btn--sm btn--icon"
              aria-label={`Change who to bill (currently ${value.billToName})`}
              onClick={() => {
                onChange({ partyKind: "custom", billToName: "", billToEmail: undefined, billToAddress: undefined });
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="billto__fields">
          <label className="billto__field">
            <span className="field__label">Email</span>
            <input className="input" type="email" value={value.billToEmail ?? ""} disabled={disabled} placeholder="billing@example.org" onChange={(e) => onChange({ ...value, billToEmail: e.target.value })} />
          </label>
          <label className="billto__field billto__field--wide">
            <span className="field__label">Address</span>
            <textarea className="input textarea" rows={2} value={value.billToAddress ?? ""} disabled={disabled} placeholder="Street, city, province, postal code" onChange={(e) => onChange({ ...value, billToAddress: e.target.value })} />
          </label>
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
        aria-label="Bill to"
        placeholder={showMembers ? "Search members and customers, or type a name" : "Search customers, or type a name"}
        value={query}
        disabled={disabled || creating}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {open && options.length > 0 && (
        <ul className="billto__list" role="listbox" id={listId}>
          {options.map((option, index) => {
            const label = option.kind === "member" || option.kind === "organization" ? option.party.name : option.kind === "create" ? `Create customer “${option.name}”` : `Bill “${option.name}” once`;
            const sub = option.kind === "member" ? [option.party.membershipClass, option.party.email].filter(Boolean).join(" · ") : option.kind === "organization" ? option.party.email : option.kind === "create" ? "Saved for future invoices" : "Not saved as a customer";
            const Icon = option.kind === "member" ? UserRound : option.kind === "organization" ? Building2 : option.kind === "create" ? Plus : User;
            return (
              <li
                key={`${option.kind}-${index}`}
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
