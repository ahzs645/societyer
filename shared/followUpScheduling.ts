/** Freeze the selected business without storing confidential wording in a meeting replay receipt. */
export function followUpMotionSelection(motions: readonly any[], indexes: readonly number[]) {
  return indexes.map(index => {
    const motion = motions[index];
    if (!motion || typeof motion.text !== 'string' || !motion.text.trim()) throw new Error('A selected source motion is no longer available. Reopen scheduling and review the selection.');
    return { index, id: motion.motionId ?? motion._id ?? null, text: motion.text, outcome: motion.outcome ?? null, sectionIndex: motion.sectionIndex ?? null };
  });
}
export async function followUpMotionFingerprint(selection: ReturnType<typeof followUpMotionSelection>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(selection)));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
