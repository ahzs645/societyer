import type { MatchConfidence } from "../../../../shared/receiptMatching";

export type InboxTransaction = {
  _id: string;
  date: string;
  description: string;
  counterparty?: string;
  amountCents: number;
  currency?: string;
  accountName?: string;
};

export type InboxCandidate = {
  transactionId: string;
  score: number;
  confidence: MatchConfidence;
  amountKind: "exact" | "close" | "none";
  daysApart: number | null;
  reasons: string[];
  transaction: InboxTransaction;
};

export type InboxItem = {
  _id: string;
  documentId: string;
  document: { _id: string; title: string; fileName?: string } | null;
  fileName: string;
  merchant?: string;
  amountCents?: number;
  currency?: string;
  date?: string;
  status: "unmatched" | "matched" | "discarded";
  uploadedByName?: string;
  createdAtISO: string;
  matchedAtISO?: string;
  matchedByName?: string;
  matchedTransaction: InboxTransaction | null;
  matchedClaim: { _id: string; title: string; status: string } | null;
  candidates: InboxCandidate[];
};

export type ReceiptInboxData = {
  rows: InboxItem[];
  counts: { unmatched: number; matched: number; discarded: number };
  highConfidenceCount: number;
};
