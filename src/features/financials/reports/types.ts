import type { Id } from "../../../../convex/_generated/dataModel";
import type { AccountingBasis } from "../../../../shared/booksReports";

/** The parts of `api.accounting.booksSettings` the reports read. */
export type BooksSettingsView = {
  accountingBasis: AccountingBasis;
  fiscalStartMonth: number;
  firstEntryDate: string | null;
};

/** A row of `api.accounting.fundRestrictions`. */
export type FundOption = { _id: string; name: string };

/** A row of `api.accounting.chartAccounts`, as the ledger account picker uses it. */
export type ChartAccountOption = { _id: string; code?: string | null; name: string; accountType: string; currency?: string | null };

/** Shared context every report body needs from the page. */
export type ReportContext = {
  societyId: Id<"societies">;
  societyName: string;
  funds: FundOption[];
  fundNames: Map<string, string>;
  canExport: boolean;
};
