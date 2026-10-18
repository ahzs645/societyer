import { useLocation, useNavigate } from "react-router-dom";
import { Tabs } from "../../../components/primitives";

type BooksArea = "accounting" | "reports" | "journal-entries" | "chart-of-accounts" | "books-settings";

const AREAS: Array<{ id: BooksArea; label: string; to: string }> = [
  { id: "accounting", label: "Workbench", to: "/app/financials/accounting" },
  { id: "reports", label: "Reports", to: "/app/financials/reports/balance-sheet" },
  { id: "journal-entries", label: "Journal entries", to: "/app/financials/journal-entries" },
  { id: "chart-of-accounts", label: "Chart of accounts", to: "/app/financials/chart-of-accounts" },
  { id: "books-settings", label: "Books settings", to: "/app/financials/books-settings" },
];

/**
 * One row of tabs across the books pages (the accounting workbench, reports,
 * journal entries, chart of accounts and Books settings), so each is a click
 * from the others.
 */
export function BooksNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = AREAS.find((area) => pathname.includes(`/financials/${area.id}`))?.id ?? "accounting";
  return (
    <nav className="books-nav" aria-label="Books">
      <Tabs<BooksArea> value={current} onChange={(id) => navigate(AREAS.find((area) => area.id === id)?.to ?? "/app/financials/accounting")} items={AREAS.map(({ id, label }) => ({ id, label }))} />
    </nav>
  );
}
