/**
 * Receipt inbox: prefilling a receipt from its file name and suggesting the
 * bank transaction it belongs to. Shared by the portable handlers (which rank
 * candidates and run "match all high-confidence") and the inbox screen.
 *
 * There is no OCR. A file named like `2026-10-12_Coastal-Hydro_161.38.pdf`
 * prefills the date, merchant and amount; anything the name doesn't carry is
 * typed in by hand.
 *
 * Matching scores a candidate out of 100:
 *   amount   up to 60  exact first (60), then close: within 1% or $1 (40), within 5% (20)
 *   date     up to 25  linear inside the window (receipt date to transaction date)
 *   merchant up to 15  word overlap between the receipt merchant and the payee
 * A candidate needs a close amount and a date inside the window. "High
 * confidence" means an exact amount, a score of at least 80 and no other
 * candidate within 10 points of it, so one click can attach it safely.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */

export type ReceiptPrefill = {
  merchant?: string;
  amountCents?: number;
  date?: string;
};

const NOISE_WORDS = new Set(["receipt", "receipts", "invoice", "inv", "scan", "scanned", "img", "image", "photo", "copy", "final", "paid", "statement", "bill"]);
const EXTENSION = /\.(pdf|png|jpe?g|heic|heif|gif|webp|tiff?|txt|eml)$/i;

function validDate(y: number, m: number, d: number): string | undefined {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return undefined;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Amount token: "161.38", "$161.38", "1,234.56", "161,38" or "CAD161.38". Whole numbers need a $ sign. */
function amountFromToken(token: string): number | undefined {
  const match = token.match(/^(?:cad|\$|c\$)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:[.,](\d{2}))?$/i);
  if (!match) return undefined;
  const hasCurrency = /^(?:cad|\$|c\$)/i.test(token);
  if (match[2] === undefined && !hasCurrency) return undefined;
  const whole = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(whole)) return undefined;
  const cents = whole * 100 + Number(match[2] ?? 0);
  return cents > 0 && cents < 100_000_000 ? cents : undefined;
}

function titleCase(value: string): string {
  return value.replace(/\b([a-z])([a-z']*)/g, (_, first: string, rest: string) => first.toUpperCase() + rest);
}

/**
 * Date, merchant and amount from a receipt's file name. Recognises ISO dates
 * (2026-10-12, 2026.10.12, 2026_10_12) and compact ones (20261012); the
 * amount is the last money-shaped token; the merchant is what's left, with
 * hyphens read as spaces. Returns only the parts it found.
 */
export function parseReceiptFilename(fileName: string): ReceiptPrefill {
  let base = fileName.split(/[\\/]/).pop() ?? "";
  base = base.replace(EXTENSION, "").trim();
  if (!base) return {};
  const out: ReceiptPrefill = {};

  // Dates first, so their digits are not read as an amount.
  const iso = base.match(/(?:^|[^\d])((?:19|20)\d{2})[-._ ](\d{1,2})[-._ ](\d{1,2})(?=$|[^\d])/);
  const compact = iso ? null : base.match(/(?:^|[^\d])((?:19|20)\d{2})(\d{2})(\d{2})(?=$|[^\d])/);
  const dateMatch = iso ?? compact;
  if (dateMatch) {
    const date = validDate(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]));
    if (date) {
      out.date = date;
      base = base.replace(dateMatch[0].replace(/^[^\d]/, ""), " ");
    }
  }

  const tokens = base.split(/[_\s]+|\s-\s/).map((token) => token.trim()).filter(Boolean);
  let amountIndex = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const cents = amountFromToken(tokens[index]);
    if (cents !== undefined) {
      out.amountCents = cents;
      amountIndex = index;
      break;
    }
  }

  const words = tokens
    .filter((_, index) => index !== amountIndex)
    .join(" ")
    .replace(/[-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word && !NOISE_WORDS.has(word.toLowerCase()) && !/^\d+$/.test(word));
  if (words.length) {
    const merchant = words.join(" ");
    out.merchant = merchant === merchant.toLowerCase() ? titleCase(merchant) : merchant;
  }
  return out;
}

/* ------------------------------------------------------------- matching */

export const RECEIPT_DATE_WINDOW_DAYS = 10;
export const HIGH_CONFIDENCE_SCORE = 80;
const HIGH_CONFIDENCE_MARGIN = 10;

export type ReceiptForMatching = {
  merchant?: string | null;
  amountCents?: number | null;
  date?: string | null;
};

export type TransactionForMatching = {
  _id: string;
  date: string;
  amountCents: number;
  description?: string | null;
  counterparty?: string | null;
  receiptDocumentId?: string | null;
};

export type MatchConfidence = "high" | "medium" | "low";

export type ReceiptMatchScore = {
  score: number;
  amountKind: "exact" | "close" | "none";
  daysApart: number | null;
  merchantSimilarity: number;
  reasons: string[];
};

export type ReceiptCandidate = ReceiptMatchScore & {
  transactionId: string;
  confidence: MatchConfidence;
};

const STOP_WORDS = new Set(["the", "and", "of", "inc", "ltd", "co", "corp", "llc", "company", "society", "pos", "purchase", "payment", "visa", "debit"]);

function merchantWords(value: string | null | undefined): string[] {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * 0..1: how much of the shorter name's words appear in the other name (a word
 * counts when one is a prefix of the other, so "hydro" meets "hydroelectric").
 */
export function merchantSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = [...new Set(merchantWords(a))];
  const right = [...new Set(merchantWords(b))];
  if (!left.length || !right.length) return 0;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const hits = shorter.filter((word) => longer.some((other) => other === word || (word.length >= 4 && other.startsWith(word)) || (other.length >= 4 && word.startsWith(other)))).length;
  return hits / shorter.length;
}

function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/** How well one bank transaction fits a receipt, or null when it can't be the receipt's payment. */
export function scoreReceiptMatch(
  receipt: ReceiptForMatching,
  txn: TransactionForMatching,
  windowDays = RECEIPT_DATE_WINDOW_DAYS,
): ReceiptMatchScore | null {
  // Receipts are for money out; a line that already has a receipt is taken.
  if (txn.amountCents >= 0 || txn.receiptDocumentId) return null;
  const reasons: string[] = [];
  const paid = Math.abs(txn.amountCents);
  let score = 0;
  let amountKind: ReceiptMatchScore["amountKind"] = "none";
  const amount = receipt.amountCents ?? null;
  if (amount !== null && amount > 0) {
    const gap = Math.abs(paid - amount);
    if (gap === 0) {
      amountKind = "exact";
      score += 60;
      reasons.push("Same amount");
    } else if (gap <= Math.max(100, Math.round(amount * 0.01))) {
      amountKind = "close";
      score += 40;
      reasons.push("Amount within $1 or 1%");
    } else if (gap <= Math.round(amount * 0.05)) {
      amountKind = "close";
      score += 20;
      reasons.push("Amount within 5%");
    } else {
      return null;
    }
  }

  let daysApart: number | null = null;
  const receiptDay = receipt.date ? dayNumber(receipt.date) : null;
  const txnDay = dayNumber(txn.date);
  if (receiptDay !== null && txnDay !== null) {
    daysApart = Math.abs(txnDay - receiptDay);
    if (daysApart > windowDays) return null;
    score += Math.round(25 * (1 - daysApart / (windowDays + 1)));
    reasons.push(daysApart === 0 ? "Same day" : `${daysApart} day${daysApart === 1 ? "" : "s"} apart`);
  }

  const similarity = Math.max(merchantSimilarity(receipt.merchant, txn.counterparty), merchantSimilarity(receipt.merchant, txn.description));
  if (similarity > 0) {
    score += Math.round(15 * similarity);
    reasons.push(similarity >= 0.99 ? "Merchant matches" : "Merchant is similar");
  }

  // With neither an amount nor a date, a name alone is too weak to suggest.
  if (amountKind === "none" && daysApart === null && similarity < 0.99) return null;
  if (amountKind === "none" && similarity === 0) return null;
  return { score: Math.min(100, score), amountKind, daysApart, merchantSimilarity: similarity, reasons };
}

/** The best candidates for a receipt, strongest first, with a confidence for each. */
export function rankReceiptCandidates(
  receipt: ReceiptForMatching,
  transactions: readonly TransactionForMatching[],
  limit = 3,
): ReceiptCandidate[] {
  const scored = transactions
    .map((txn) => ({ txn, match: scoreReceiptMatch(receipt, txn) }))
    .filter((entry): entry is { txn: TransactionForMatching; match: ReceiptMatchScore } => entry.match !== null)
    .sort((a, b) => b.match.score - a.match.score || (a.match.daysApart ?? 99) - (b.match.daysApart ?? 99) || b.txn.date.localeCompare(a.txn.date));
  return scored.slice(0, limit).map(({ txn, match }, index) => {
    const runnerUp = index === 0 ? scored[1]?.match.score ?? -Infinity : Infinity;
    const clearLead = match.score - runnerUp >= HIGH_CONFIDENCE_MARGIN;
    const confidence: MatchConfidence =
      index === 0 && match.amountKind === "exact" && match.score >= HIGH_CONFIDENCE_SCORE && clearLead
        ? "high"
        : match.score >= 55
          ? "medium"
          : "low";
    return { ...match, transactionId: txn._id, confidence };
  });
}

export type InboxItemForBulkMatch = { _id: string } & ReceiptForMatching;

/**
 * "Match all high-confidence": each item's top candidate when it is high
 * confidence, skipping any transaction two receipts both point at.
 */
export function highConfidencePairs(
  items: readonly InboxItemForBulkMatch[],
  transactions: readonly TransactionForMatching[],
): Array<{ itemId: string; transactionId: string; score: number }> {
  const proposals = items
    .map((item) => {
      const top = rankReceiptCandidates(item, transactions, 2)[0];
      return top && top.confidence === "high" ? { itemId: item._id, transactionId: top.transactionId, score: top.score } : null;
    })
    .filter((entry): entry is { itemId: string; transactionId: string; score: number } => entry !== null);
  const claims = new Map<string, number>();
  for (const proposal of proposals) claims.set(proposal.transactionId, (claims.get(proposal.transactionId) ?? 0) + 1);
  return proposals.filter((proposal) => claims.get(proposal.transactionId) === 1);
}
