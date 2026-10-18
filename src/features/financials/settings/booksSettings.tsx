import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { booksSettingsPortable } from "../../../../shared/functions/accounting";

/** What `accounting.booksSettings` returns (the Convex wrapper is typed `any`). */
export type BooksSettingsView = Awaited<ReturnType<typeof booksSettingsPortable>>;

/** Books settings for a society; undefined while loading or skipped. */
export function useBooksSettings(societyId: Id<"societies"> | undefined): BooksSettingsView | undefined {
  return useQuery(api.accounting.booksSettings, societyId ? { societyId } : "skip") as BooksSettingsView | undefined;
}

/** Owners and admins move the close date (the server enforces the same). */
export function canMoveCloseDate(role: string | null): boolean {
  return role === "Owner" || role === "Admin";
}

/** A thrown Convex error as one readable line (drops the "[CONVEX M(...)] Uncaught Error:" prefix). */
export function booksErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const data = (error as Error & { data?: unknown }).data;
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  return error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] || undefined;
}

/**
 * How a fiscal period close relates to the books close date. Shared by Books
 * settings and the workbench's Fiscal periods card; `short` drops the detail.
 */
export function CloseDateExplainer({ short = false, children }: { short?: boolean; children?: ReactNode }) {
  if (short) {
    return (
      <>
        <p><strong>Closing a period is a soft close.</strong> Directors can still post an approved closed-period adjustment into it.</p>
        <p><strong>The books close date is a hard lock.</strong> Nothing dated on or before it can be posted, edited or voided until an admin moves the date. A period inside the close date can't be reopened.</p>
        {children}
      </>
    );
  }
  return (
    <>
      <p>
        <strong>Closing a fiscal period is a soft close.</strong> The period stops taking ordinary entries, but directors can still post an
        approved closed-period adjustment into it.
      </p>
      <p>
        <strong>The close date is a hard lock.</strong> It applies to every way an entry reaches the journal: manual entries, posting bank
        transactions, allocations, opening balances and expense claims. Nothing dated on or before it can be posted, edited or voided.
      </p>
      <p>
        Closing a period can also move the close date to the period's end. A period inside the close date can't be reopened until an admin moves
        the date back.
      </p>
      {children}
    </>
  );
}
