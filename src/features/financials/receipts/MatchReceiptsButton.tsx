import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Inbox } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { ReceiptInboxData } from "./types";

/**
 * "Match receipts" on the Transactions tab: opens the receipt inbox, with the
 * number of receipts waiting to be matched.
 */
export function MatchReceiptsButton({ societyId }: { societyId: string }) {
  const inbox = useQuery(api.receiptInbox.list, { societyId }) as ReceiptInboxData | undefined;
  const waiting = inbox?.counts.unmatched ?? 0;
  return (
    <div className="match-receipts-entry">
      <Link className="btn btn--sm" to="/app/financials/receipts">
        <Inbox size={12} aria-hidden="true" /> Match receipts
        {waiting > 0 && <span className="match-receipts-entry__count" aria-label={`${waiting} waiting`}>{waiting}</span>}
      </Link>
    </div>
  );
}
