import { createElement } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Plus } from "lucide-react";
import { Menu, type MenuSection } from "../../../components/Menu";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { financeCreateSections } from "../../../lib/financeCreateItems";

/**
 * Mercury-style "Create" menu for the finance pages: create a journal entry,
 * invoice, bill, rule, tag or tag group; import a bank CSV or receipts; add a
 * ledger account, bank account, customer or vendor. Each item opens the
 * existing create screen (lib/financeCreateItems.ts); the same items are ⌘K
 * commands. Hidden for people without finance edit access.
 */
export function FinanceCreateMenu() {
  const navigate = useNavigate();
  const { canWrite } = useFinancePermissions();
  if (!canWrite) return null;
  const sections: MenuSection[] = financeCreateSections().map((group) => ({
    id: group.section,
    label: group.label,
    items: group.items.map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.hint,
      icon: createElement(item.icon, { size: 14 }),
      onSelect: () => navigate(item.to),
    })),
  }));
  return (
    <Menu
      label="Create"
      sheetTitle="Create"
      align="right"
      minWidth={220}
      sections={sections}
      trigger={
        <button type="button" className="btn-action">
          <Plus size={12} aria-hidden="true" /> Create <ChevronDown size={12} aria-hidden="true" />
        </button>
      }
    />
  );
}
