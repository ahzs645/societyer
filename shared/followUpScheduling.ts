import { canonicalMeetingJson } from './meetingConcurrency';

/** Freeze the selected business without storing confidential wording in a meeting replay receipt. */
export function followUpMotionSelection(motions: readonly any[], indexes: readonly number[]) {
  return indexes.map(index => {
    const motion = motions[index];
    if (!motion || typeof motion.text !== 'string' || !motion.text.trim()) throw new Error('A selected source motion is no longer available. Reopen scheduling and review the selection.');
    return { index, id: motion.motionId ?? motion._id ?? null, text: motion.text, outcome: motion.outcome ?? null, sectionIndex: motion.sectionIndex ?? null };
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function followUpMotionFingerprint(selection: ReturnType<typeof followUpMotionSelection>): Promise<string> {
  return sha256Hex(JSON.stringify(selection));
}

/**
 * The replay receipt keeps only a digest of the scheduling request. A copy of
 * the arguments could hold working notes or other wording that the meeting's
 * own reader rules would withhold.
 */
export async function followUpRequestDigest(args: unknown): Promise<string> {
  return sha256Hex(canonicalMeetingJson(args));
}

/**
 * Internal replay bookkeeping, never returned to readers. `followUpRequestJson`
 * is legacy: it is no longer written, but rows that hold it must not expose it.
 */
export const FOLLOW_UP_RECEIPT_FIELDS = ['followUpRequestId', 'followUpActorId', 'followUpRequestDigest', 'followUpRequestJson'] as const;

export function withoutFollowUpReceipt<T>(row: T): T {
  if (!row || typeof row !== 'object' || !FOLLOW_UP_RECEIPT_FIELDS.some(field => field in (row as object))) return row;
  const copy = { ...(row as Record<string, unknown>) };
  for (const field of FOLLOW_UP_RECEIPT_FIELDS) delete copy[field];
  return copy as T;
}
