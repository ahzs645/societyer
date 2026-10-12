/**
 * YCN certificate register → Societyer share ledger (pure logic).
 *
 * YCN keeps the central securities register as CERTIFICATES, not as a ledger.
 * Each `SHARE_TRANS` row is one certificate (or a holder-level delta row for a
 * subdivision or consolidation). A transfer, replacement or consolidation puts a
 * date in `CANCEL_DT_TM` on the old row and adds a new row, and `SHR_CERT_REPL`
 * on the old row is a FORWARD pointer to the certificate that replaced it (the
 * literal "Replacement" on a new row only says that the row is a replacement).
 *
 * The YCN rule for a register on day D is:
 *   holdings(D) = Σ SHR_NUM over rows issued on or before D and not cancelled
 *                 on or before D (an open row has no cancel date).
 *
 * Societyer keeps a double-entry ledger (shared/equityLedger.ts). This module
 * converts one entity's rows into ledger movements so that the ledger agrees
 * with the certificates at the end of every day on which something happened:
 *  - Allot → `issuance` to the holder, with the consideration;
 *  - Transfer → `transfer` FROM the holder whose certificate was cancelled TO the
 *    holder of the new certificate (the source is found from the forward
 *    pointers, or, when the register has none, from the holders whose
 *    certificates were cancelled that day);
 *  - Certificate (replacement) → no ledger movement; the certificate register
 *    records which certificate it replaces (a BACK pointer, the reverse of YCN);
 *  - Subdivision → `subdivision` adding shares to the holder;
 *  - Consolidation → `consolidation` taking shares FROM the holder (a positive
 *    quantity, never a negative one);
 *  - a certificate cancelled with nothing replacing it → `redemption` (YCN has
 *    no separate redeem row; the kind can be set to `cancellation` instead).
 *
 * `reconcileShareRegister` then checks, for every event day, that the ledger
 * holdings equal the active certificates per class and holder. The importer
 * stages the movements as posted only when that check passes with no errors.
 *
 * Framework-free. Named exports only. Holder and class keys are the YCN ids
 * (entity-local PERS_ID and class code), so a holder's change of name never
 * splits a holding.
 */

import { deriveCurrentHoldings, validateLedger, type RightsholdingTransferRecord } from "./equityLedger";

export type YcnIssueType =
  | "allot"
  | "transfer"
  | "certificate"
  | "subdivision"
  | "consolidation"
  | "redemption"
  | "cancellation"
  | "other";

/** One current SHARE_TRANS row, already decoded. Dates are ISO (date or date-time). */
export interface YcnShareRow {
  rowId: string;
  issuedOn: string;
  cancelledOn?: string;
  /** Entity-local person id (HLDR_ID); falls back to the recorded name when blank. */
  holderId: string;
  holderName?: string;
  classCode: string;
  /** Signed: consolidation delta rows are negative. */
  shares: number;
  certificate?: string;
  /** The YCN forward pointer (the certificate that replaced this one), minus the literal "Replacement". */
  replacedBy?: string;
  issueType: YcnIssueType;
  considerationCents?: number;
  considerationCurrency?: string;
  considerationType?: string;
}

export type LedgerMovementType = "issuance" | "transfer" | "subdivision" | "consolidation" | "redemption" | "cancellation";

export interface LedgerMovement {
  /** Stable key, used for the import's source ids. */
  key: string;
  transferType: LedgerMovementType;
  transferDate: string; // YYYY-MM-DD
  classCode: string;
  sourceHolderId?: string;
  destinationHolderId?: string;
  quantity: number;
  /** The YCN rows that evidence this movement. */
  rowIds: string[];
  certificates: string[];
  considerationType?: string;
  priceToOrganizationCents?: number;
  priceToOrganizationCurrency?: string;
  note?: string;
}

export interface ConvertedCertificate {
  rowId: string;
  certificateNumber: string;
  classCode: string;
  holderId: string;
  holderName?: string;
  shares: number;
  issuedOn: string;
  cancelledOn?: string;
  /** Back pointer: the certificate this one replaced (the largest, when several merged). */
  replacesCertificateNumber?: string;
  /** Every predecessor, for the review notes (several certificates can merge into one). */
  replacesCertificateNumbers: string[];
  /** How the certificate came about. */
  origin: "allotment" | "transfer" | "replacement" | "other";
}

export interface ShareConversionIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  rowIds?: string[];
  date?: string;
  classCode?: string;
}

export interface ReconciliationMismatch {
  date: string;
  classCode: string;
  holderId: string;
  certificates: number;
  ledger: number;
}

export interface ShareReconciliation {
  /** Every day on which a row was issued or cancelled. */
  dates: string[];
  /** class × holder × date comparisons made. */
  checkedPoints: number;
  mismatches: ReconciliationMismatch[];
  /** The ledger itself is valid (no negative holdings, sources available). */
  ledgerValid: boolean;
  ledgerError?: string;
  ok: boolean;
}

export interface ShareConversionResult {
  movements: LedgerMovement[];
  certificates: ConvertedCertificate[];
  reconciliation: ShareReconciliation;
  issues: ShareConversionIssue[];
  /** true when the reconciliation passed and no error-level issue was found. */
  clean: boolean;
}

export interface ShareConversionOptions {
  /** Ledger kind for a certificate cancelled with no successor. Default `redemption`. */
  cancellationKind?: "redemption" | "cancellation";
}

const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : undefined);

/** Map a YCN ISS_TYP label to the conversion vocabulary. */
export function ycnIssueType(raw: string | undefined): YcnIssueType {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.startsWith("allot") || text.startsWith("issu")) return "allot";
  if (text.startsWith("transfer")) return "transfer";
  if (text.startsWith("certif") || text.startsWith("replace")) return "certificate";
  if (text.startsWith("subdiv") || text.startsWith("split")) return "subdivision";
  if (text.startsWith("consol")) return "consolidation";
  if (text.startsWith("redeem") || text.startsWith("redemp") || text.startsWith("repurch") || text.startsWith("purchas")) return "redemption";
  if (text.startsWith("cancel")) return "cancellation";
  return "other";
}

function isActiveAtEndOf(row: YcnShareRow, d: string): boolean {
  const issued = day(row.issuedOn);
  const cancelled = day(row.cancelledOn);
  return issued != null && issued <= d && (cancelled == null || cancelled > d);
}

/** YCN holdings at the end of day `d`: class → holder → shares (zero balances omitted). */
export function certificateHoldingsAsOf(rows: YcnShareRow[], d: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!isActiveAtEndOf(row, d)) continue;
    const byHolder = out.get(row.classCode) ?? new Map<string, number>();
    byHolder.set(row.holderId, (byHolder.get(row.holderId) ?? 0) + row.shares);
    out.set(row.classCode, byHolder);
  }
  for (const byHolder of out.values()) for (const [holder, qty] of byHolder) if (qty === 0) byHolder.delete(holder);
  return out;
}

/** Plain ledger records for the movements (status posted), for shared/equityLedger.ts. */
export function movementsAsLedgerRecords(movements: LedgerMovement[]): RightsholdingTransferRecord[] {
  return movements.map((m) => ({
    societyId: "",
    transferType: m.transferType,
    status: "posted",
    transferDate: m.transferDate,
    rightsClassId: m.classCode,
    sourceHolderName: m.sourceHolderId,
    destinationHolderName: m.destinationHolderId,
    quantity: m.quantity,
    sourceDocumentIds: [],
    sourceExternalIds: [],
    createdAtISO: "",
    updatedAtISO: "",
  }));
}

/**
 * Ledger holdings at the end of day `d` (class → holder → shares), computed by
 * the real ledger rules. Equivalent to `holdingsAsOf(transfers, d)` in
 * shared/equityLedger.ts, written against the movement keys used here.
 */
export function ledgerHoldingsAsOf(movements: LedgerMovement[], d: string): Map<string, Map<string, number>> {
  const upTo = movements.filter((m) => m.transferDate <= d);
  const out = new Map<string, Map<string, number>>();
  for (const holding of deriveCurrentHoldings(movementsAsLedgerRecords(upTo))) {
    const holder = holding.holderKey.replace(/^name:/, "");
    const byHolder = out.get(holding.rightsClassId) ?? new Map<string, number>();
    byHolder.set(holder, holding.quantity);
    out.set(holding.rightsClassId, byHolder);
  }
  return out;
}

const ORDER: Record<LedgerMovementType, number> = { issuance: 0, subdivision: 1, transfer: 2, consolidation: 3, redemption: 4, cancellation: 4 };

/** Chronological, and within a day: issuances, subdivisions, transfers, then reductions. */
export function sortMovements(movements: LedgerMovement[]): LedgerMovement[] {
  return [...movements].sort((a, b) =>
    a.transferDate.localeCompare(b.transferDate) || ORDER[a.transferType] - ORDER[b.transferType] || a.key.localeCompare(b.key));
}

/** Compare ledger and certificate holdings at the end of every event day. */
export function reconcileShareRegister(rows: YcnShareRow[], movements: LedgerMovement[]): ShareReconciliation {
  const dates = eventDays(rows);
  const mismatches: ReconciliationMismatch[] = [];
  let checkedPoints = 0;
  for (const d of dates) {
    const certs = certificateHoldingsAsOf(rows, d);
    const ledger = ledgerHoldingsAsOf(movements, d);
    const classes = new Set([...certs.keys(), ...ledger.keys()]);
    for (const classCode of classes) {
      const c = certs.get(classCode) ?? new Map();
      const l = ledger.get(classCode) ?? new Map();
      for (const holderId of new Set([...c.keys(), ...l.keys()])) {
        checkedPoints += 1;
        const certificates = c.get(holderId) ?? 0;
        const ledgerQty = l.get(holderId) ?? 0;
        if (certificates !== ledgerQty) mismatches.push({ date: d, classCode, holderId, certificates, ledger: ledgerQty });
      }
    }
  }
  let ledgerValid = true;
  let ledgerError: string | undefined;
  try {
    validateLedger(movementsAsLedgerRecords(sortMovements(movements)));
  } catch (error) {
    ledgerValid = false;
    ledgerError = error instanceof Error ? error.message : String(error);
  }
  return { dates, checkedPoints, mismatches, ledgerValid, ledgerError, ok: ledgerValid && mismatches.length === 0 };
}

function eventDays(rows: YcnShareRow[]): string[] {
  const days = new Set<string>();
  for (const row of rows) {
    const issued = day(row.issuedOn);
    const cancelled = day(row.cancelledOn);
    if (issued) days.add(issued);
    if (cancelled) days.add(cancelled);
  }
  return [...days].sort();
}

const certKey = (classCode: string, certificate: string) => `${classCode}\u0000${certificate}`;

/**
 * Convert one entity's current SHARE_TRANS rows into ledger movements and a
 * certificate register, then reconcile the two.
 */
export function convertYcnShareRegister(rows: YcnShareRow[], options: ShareConversionOptions = {}): ShareConversionResult {
  const cancellationKind = options.cancellationKind ?? "redemption";
  const issues: ShareConversionIssue[] = [];
  const usable: YcnShareRow[] = [];

  for (const row of rows) {
    const issued = day(row.issuedOn);
    const cancelled = day(row.cancelledOn);
    if (!issued) {
      issues.push({ severity: "error", code: "missing_issue_date", message: `Share row ${row.rowId} has no issue date.`, rowIds: [row.rowId], classCode: row.classCode });
      continue;
    }
    if (!Number.isFinite(row.shares) || row.shares === 0) {
      issues.push({ severity: "error", code: "missing_quantity", message: `Share row ${row.rowId} has no share count.`, rowIds: [row.rowId], classCode: row.classCode });
      continue;
    }
    if (!row.holderId) {
      issues.push({ severity: "error", code: "missing_holder", message: `Share row ${row.rowId} has no holder.`, rowIds: [row.rowId], classCode: row.classCode });
      continue;
    }
    if (cancelled && cancelled < issued) {
      issues.push({
        severity: "error",
        code: "cancelled_before_issued",
        message: `Share row ${row.rowId}${row.certificate ? ` (certificate ${row.certificate})` : ""} is cancelled on ${cancelled}, before it was issued on ${issued}. The register can't be trusted until the dates are fixed.`,
        rowIds: [row.rowId], date: issued, classCode: row.classCode,
      });
    }
    const isDelta = row.issueType === "subdivision" || row.issueType === "consolidation";
    if (row.shares < 0 && !isDelta) {
      issues.push({ severity: "error", code: "negative_certificate", message: `Share row ${row.rowId} has a negative share count but is not a consolidation.`, rowIds: [row.rowId], classCode: row.classCode });
    }
    usable.push(row);
  }

  // Duplicate certificate numbers within a class.
  const seenCerts = new Map<string, string>();
  for (const row of usable) {
    if (!row.certificate) continue;
    const key = certKey(row.classCode, row.certificate);
    const prior = seenCerts.get(key);
    if (prior) {
      issues.push({ severity: "warning", code: "duplicate_certificate", message: `Certificate ${row.certificate} (${row.classCode}) appears on rows ${prior} and ${row.rowId}.`, rowIds: [prior, row.rowId], classCode: row.classCode });
    } else {
      seenCerts.set(key, row.rowId);
    }
  }

  const movements: LedgerMovement[] = [];
  const classes = [...new Set(usable.map((row) => row.classCode))].sort();
  for (const classCode of classes) {
    const classRows = usable.filter((row) => row.classCode === classCode);
    const days = eventDays(classRows);
    let previous: string | undefined;
    for (const d of days) {
      const before = previous ? certificateHoldingsAsOf(classRows, previous).get(classCode) ?? new Map() : new Map<string, number>();
      const after = certificateHoldingsAsOf(classRows, d).get(classCode) ?? new Map<string, number>();
      const explained = new Map<string, number>();
      const add = (holder: string, qty: number) => explained.set(holder, (explained.get(holder) ?? 0) + qty);
      const issuedToday = classRows.filter((row) => day(row.issuedOn) === d).sort((a, b) => a.rowId.localeCompare(b.rowId, undefined, { numeric: true }));

      for (const row of issuedToday) {
        if (row.issueType === "allot" && row.shares > 0) {
          movements.push({
            key: `issue:${row.rowId}`, transferType: "issuance", transferDate: d, classCode,
            destinationHolderId: row.holderId, quantity: row.shares, rowIds: [row.rowId],
            certificates: row.certificate ? [row.certificate] : [],
            considerationType: row.considerationType,
            priceToOrganizationCents: row.considerationCents,
            priceToOrganizationCurrency: row.considerationCurrency,
          });
          add(row.holderId, row.shares);
        } else if (row.issueType === "subdivision" || row.issueType === "consolidation") {
          const increase = row.shares > 0;
          movements.push({
            key: `${row.issueType}:${row.rowId}`,
            transferType: increase ? "subdivision" : "consolidation",
            transferDate: d, classCode,
            ...(increase ? { destinationHolderId: row.holderId } : { sourceHolderId: row.holderId }),
            quantity: Math.abs(row.shares), rowIds: [row.rowId], certificates: row.replacedBy ? [row.replacedBy] : [],
          });
          add(row.holderId, row.shares);
        } else if ((row.issueType === "redemption" || row.issueType === "cancellation") && row.shares < 0) {
          movements.push({
            key: `${row.issueType}:${row.rowId}`, transferType: row.issueType, transferDate: d, classCode,
            sourceHolderId: row.holderId, quantity: Math.abs(row.shares), rowIds: [row.rowId], certificates: [],
          });
          add(row.holderId, row.shares);
        }
      }

      // What the certificates still have to explain: transfers (and redemptions).
      const residual = new Map<string, number>();
      for (const holder of new Set([...before.keys(), ...after.keys(), ...explained.keys()])) {
        const r = (after.get(holder) ?? 0) - (before.get(holder) ?? 0) - (explained.get(holder) ?? 0);
        if (r !== 0) residual.set(holder, r);
      }
      const take = (holder: string, qty: number) => {
        const next = (residual.get(holder) ?? 0) + qty;
        if (next === 0) residual.delete(holder); else residual.set(holder, next);
      };
      const cancelledToday = classRows.filter((row) => day(row.cancelledOn) === d && day(row.issuedOn) !== d);

      // 1. Explicit links: a predecessor whose forward pointer names the new certificate.
      for (const row of issuedToday.filter((r) => r.issueType === "transfer" && r.certificate)) {
        const predecessors = classRows.filter((p) => p.replacedBy === row.certificate && day(p.cancelledOn) === d && p.holderId !== row.holderId);
        for (const p of predecessors) {
          const out = -(residual.get(p.holderId) ?? 0);
          const inn = residual.get(row.holderId) ?? 0;
          const qty = Math.min(p.shares, out, inn);
          if (qty <= 0) continue;
          movements.push({
            key: `transfer:${p.rowId}:${row.rowId}`, transferType: "transfer", transferDate: d, classCode,
            sourceHolderId: p.holderId, destinationHolderId: row.holderId, quantity: qty,
            rowIds: [p.rowId, row.rowId], certificates: [p.certificate, row.certificate].filter(Boolean) as string[],
          });
          take(p.holderId, qty);
          take(row.holderId, -qty);
        }
      }

      // 2. No pointer: pair the holders who lost shares with those who gained them.
      const sources = () => [...residual.entries()].filter(([, q]) => q < 0).map(([h]) => h).sort();
      const destinations = () => [...residual.entries()].filter(([, q]) => q > 0).map(([h]) => h).sort();
      if (sources().length > 1 && destinations().length > 1) {
        issues.push({
          severity: "warning", code: "ambiguous_transfer_pairing", date: d, classCode,
          message: `On ${d} several holders of ${classCode} gave up shares and several received them, and the certificates don't say who transferred to whom. The pairing was inferred; confirm it.`,
          rowIds: [...issuedToday, ...cancelledToday].map((r) => r.rowId),
        });
      }
      for (const destination of destinations()) {
        for (const source of sources()) {
          const qty = Math.min(-(residual.get(source) ?? 0), residual.get(destination) ?? 0);
          if (qty <= 0) continue;
          const evidence = [
            ...cancelledToday.filter((r) => r.holderId === source),
            ...issuedToday.filter((r) => r.holderId === destination && r.issueType !== "allot"),
          ];
          movements.push({
            key: `transfer:${d}:${classCode}:${source}:${destination}`, transferType: "transfer", transferDate: d, classCode,
            sourceHolderId: source, destinationHolderId: destination, quantity: qty,
            rowIds: evidence.map((r) => r.rowId),
            certificates: evidence.map((r) => r.certificate).filter(Boolean) as string[],
          });
          take(source, qty);
          take(destination, -qty);
          if ((residual.get(destination) ?? 0) <= 0) break;
        }
      }

      // 3. Shares that left with no successor: a redemption (or cancellation).
      for (const source of sources()) {
        const qty = -(residual.get(source) ?? 0);
        const evidence = cancelledToday.filter((r) => r.holderId === source);
        movements.push({
          key: `${cancellationKind}:${d}:${classCode}:${source}`, transferType: cancellationKind, transferDate: d, classCode,
          sourceHolderId: source, quantity: qty, rowIds: evidence.map((r) => r.rowId),
          certificates: evidence.map((r) => r.certificate).filter(Boolean) as string[],
          note: "YCN records only that the certificate was cancelled with nothing replacing it. Confirm whether this was a redemption, a purchase, or another cancellation.",
        });
        issues.push({
          severity: "warning", code: "cancellation_without_successor", date: d, classCode, rowIds: evidence.map((r) => r.rowId),
          message: `On ${d}, ${qty} ${classCode} share(s) held by ${source} were cancelled with no replacing certificate; recorded as a ${cancellationKind}. Confirm the kind.`,
        });
        take(source, qty);
      }

      // 4. Shares that appeared with no allotment or source: the register is inconsistent.
      for (const destination of destinations()) {
        issues.push({
          severity: "error", code: "unexplained_increase", date: d, classCode,
          rowIds: issuedToday.filter((r) => r.holderId === destination).map((r) => r.rowId),
          message: `On ${d}, ${destination} gained ${residual.get(destination)} ${classCode} share(s) with no allotment, subdivision or transferring holder.`,
        });
      }
      previous = d;
    }
  }

  const certificates = buildCertificates(usable, movements, issues);
  const sorted = sortMovements(movements);
  const reconciliation = reconcileShareRegister(usable, sorted);
  if (!reconciliation.ledgerValid) {
    issues.push({ severity: "error", code: "ledger_invalid", message: `The converted ledger is not valid: ${reconciliation.ledgerError}` });
  }
  for (const m of reconciliation.mismatches) {
    issues.push({
      severity: "error", code: "reconciliation_mismatch", date: m.date, classCode: m.classCode,
      message: `On ${m.date}, ${m.holderId} holds ${m.certificates} ${m.classCode} share(s) by certificate but ${m.ledger} by ledger.`,
    });
  }
  const clean = reconciliation.ok && !issues.some((issue) => issue.severity === "error");
  return { movements: sorted, certificates, reconciliation, issues, clean };
}

/** Certificate register with back pointers (the reverse of YCN's forward pointer). */
function buildCertificates(rows: YcnShareRow[], movements: LedgerMovement[], issues: ShareConversionIssue[]): ConvertedCertificate[] {
  const out: ConvertedCertificate[] = [];
  for (const row of rows) {
    if (!row.certificate) continue;
    const d = day(row.issuedOn)!;
    const sameClass = rows.filter((p) => p.classCode === row.classCode && p !== row);
    // Explicit forward pointers to this certificate (certificates only; delta rows are not certificates).
    let predecessors = sameClass.filter((p) => p.certificate && p.replacedBy === row.certificate);
    if (!predecessors.length && row.issueType !== "allot") {
      // No pointer recorded: the certificates cancelled that day that this one took over —
      // the holder's own (a replacement or balance certificate) and those of anyone who
      // transferred to this holder that day.
      const transferors = new Set(movements
        .filter((m) => m.transferType === "transfer" && m.transferDate === d && m.classCode === row.classCode && m.destinationHolderId === row.holderId)
        .map((m) => m.sourceHolderId));
      predecessors = sameClass.filter((p) => p.certificate && !p.replacedBy && day(p.cancelledOn) === d && day(p.issuedOn) !== d
        && (p.holderId === row.holderId || transferors.has(p.holderId)));
    }
    const ordered = [...predecessors].sort((a, b) => b.shares - a.shares || String(a.certificate).localeCompare(String(b.certificate), undefined, { numeric: true }));
    const origin: ConvertedCertificate["origin"] = row.issueType === "allot" ? "allotment"
      : row.issueType === "transfer" ? "transfer"
        : row.issueType === "certificate" ? "replacement" : "other";
    if (origin === "replacement") {
      // A replacement carries the old certificates' shares plus that day's split/consolidation delta.
      const deltas = sameClass.filter((p) => !p.certificate && p.holderId === row.holderId && day(p.issuedOn) === d
        && (p.issueType === "subdivision" || p.issueType === "consolidation"));
      const expected = predecessors.reduce((sum, p) => sum + p.shares, 0) + deltas.reduce((sum, p) => sum + p.shares, 0);
      if (predecessors.length && expected !== row.shares) {
        issues.push({
          severity: "warning", code: "replacement_quantity", date: d, classCode: row.classCode, rowIds: [row.rowId, ...predecessors.map((p) => p.rowId)],
          message: `Replacement certificate ${row.certificate} is for ${row.shares} share(s) but the certificates it replaces (with that day's split or consolidation) add up to ${expected}.`,
        });
      }
      if (!predecessors.length) {
        issues.push({
          severity: "warning", code: "replacement_without_predecessor", date: d, classCode: row.classCode, rowIds: [row.rowId],
          message: `Replacement certificate ${row.certificate} doesn't name the certificate it replaces, and none of the holder's certificates was cancelled that day.`,
        });
      }
    }
    out.push({
      rowId: row.rowId,
      certificateNumber: row.certificate,
      classCode: row.classCode,
      holderId: row.holderId,
      holderName: row.holderName,
      shares: row.shares,
      issuedOn: d,
      cancelledOn: day(row.cancelledOn),
      replacesCertificateNumber: ordered[0]?.certificate,
      replacesCertificateNumbers: ordered.map((p) => p.certificate!),
      origin,
    });
  }
  return out;
}
