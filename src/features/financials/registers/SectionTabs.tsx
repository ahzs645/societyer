import { Tabs } from "../../../components/primitives";
import { SECTION_TABS, type SectionTab } from "./registerModel";

/**
 * Statement-section tabs (All, Assets, Liabilities, Net assets, Revenue,
 * Expenses) with a count on each, shared by the books registers.
 */
export function SectionTabs({ value, onChange, counts, ariaLabel }: {
  value: SectionTab;
  onChange: (tab: SectionTab) => void;
  counts: Record<SectionTab, number> | null;
  ariaLabel: string;
}) {
  return (
    <Tabs<SectionTab>
      value={value}
      onChange={onChange}
      tabRoles
      ariaLabel={ariaLabel}
      items={SECTION_TABS.map(({ id, label }) => ({ id, label, count: counts ? counts[id] : null }))}
    />
  );
}
