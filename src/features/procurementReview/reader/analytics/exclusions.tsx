/**
 * Leaving buyers, suppliers or procurement types out of the award analysis:
 * the one that skews every figure (one huge contract, an internal transfer,
 * this organisation itself). The list lives in the analysis filters
 * (`exclude`, market.ts), so the server's analysis, the in-browser one and
 * every drill-down leave out the same awards. Here are the pieces the
 * Filters dialog, the "Excluding 3 organisations" chip and the row actions
 * share.
 */
import { X } from "lucide-react";
import { Modal } from "../../../../components/Modal";
import { Select } from "../../../../components/Select";
import { MAX_EXCLUSIONS, counted, partyKey, type Exclusion, type ExclusionField } from "../../lib/market";

export const EXCLUSION_KINDS: Record<ExclusionField, string> = { buyer: "Buyer", supplier: "Supplier", type: "Procurement type" };

const same = (a: Exclusion, b: Exclusion) => a.field === b.field && partyKey(a.name) === partyKey(b.name);
export const isExcludedParty = (list: Exclusion[] | undefined, item: Exclusion) => !!list?.some((other) => same(other, item));
/** The list with one more, unless it's already there or the list is full. */
export const withExclusion = (list: Exclusion[] | undefined, item: Exclusion): Exclusion[] =>
  isExcludedParty(list, item) || (list?.length ?? 0) >= MAX_EXCLUSIONS ? list ?? [] : [...(list ?? []), item];
export const withoutExclusion = (list: Exclusion[] | undefined, item: Exclusion): Exclusion[] => (list ?? []).filter((other) => !same(other, item));

/** "3 organisations", "2 organisations and 1 type": buyers and suppliers are both organisations. */
export function describeExclusions(list: Exclusion[]): string {
  const parties = list.filter((item) => item.field !== "type").length;
  const types = list.length - parties;
  return [parties ? counted(parties, "organisation") : "", types ? counted(types, "type") : ""].filter(Boolean).join(" and ");
}

/** The exclusions, each with a way to bring it back into the analysis. */
export function ExclusionList({ list, onRemove }: { list: Exclusion[]; onRemove: (item: Exclusion) => void }) {
  if (!list.length) return <p className="muted procurement-analytics__caption">Nothing is left out.</p>;
  return (
    <ul className="procurement-analytics__exclusions" aria-label="Left out of the analysis">
      {list.map((item) => (
        <li key={`${item.field}:${item.name}`}>
          <span className="procurement-analytics__exclusion-name">
            {item.name} <span className="muted">· {EXCLUSION_KINDS[item.field]}</span>
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onRemove(item)} aria-label={`Include ${item.name} again`}>
            <X size={12} aria-hidden="true" /> Include again
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A search over every buyer, supplier and type the filters know, to add one to the list. */
export function ExclusionPicker({ list, choices, onAdd }: {
  list: Exclusion[];
  choices: { buyers: string[]; suppliers: string[]; types: string[] };
  onAdd: (item: Exclusion) => void;
}) {
  const full = list.length >= MAX_EXCLUSIONS;
  const options = (["buyer", "supplier", "type"] as const).flatMap((field) =>
    choices[field === "buyer" ? "buyers" : field === "supplier" ? "suppliers" : "types"]
      .filter((name) => !isExcludedParty(list, { field, name }))
      .map((name) => ({ value: JSON.stringify([field, name]), label: name, hint: EXCLUSION_KINDS[field] })),
  );
  return (
    <Select<string>
      value=""
      onChange={(value) => {
        const [field, name] = JSON.parse(value) as [ExclusionField, string];
        onAdd({ field, name });
      }}
      options={options}
      searchable
      disabled={full}
      placeholder={full ? `At most ${MAX_EXCLUSIONS} can be left out` : "Search buyers, suppliers and types"}
      sheetTitle="Leave out of the analysis"
      aria-label="Leave a buyer, supplier or type out of the analysis"
    />
  );
}

/** What the "Excluding 3 organisations" chip opens: the list, changed as soon as one comes back. */
export function ExclusionsDialog({ list, onChange, close }: { list: Exclusion[]; onChange: (next: Exclusion[]) => void; close: () => void }) {
  return (
    <Modal
      open
      onClose={close}
      size="sm"
      title="Left out of the analysis"
      footer={<>
        {list.length > 0 && <button type="button" className="btn btn--ghost procurement-analytics__reset" onClick={() => { onChange([]); close(); }}>Include all again</button>}
        <button type="button" className="btn" onClick={close}>Done</button>
      </>}
    >
      <p className="muted procurement-analytics__caption">
        Their awards are left out of every figure and list here. A buyer is left out under any of its names, however buyers are grouped.
      </p>
      <ExclusionList list={list} onRemove={(item) => onChange(withoutExclusion(list, item))} />
    </Modal>
  );
}
