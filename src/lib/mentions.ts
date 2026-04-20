export type MentionSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; id: string; label: string };

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;

/** Parse a string with `@[Name](id)` tokens into segments for rendering. */
export function parseMentions(input: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  MENTION_RE.lastIndex = 0;
  for (let m = MENTION_RE.exec(input); m; m = MENTION_RE.exec(input)) {
    if (m.index > lastIndex) {
      segments.push({ kind: "text", value: input.slice(lastIndex, m.index) });
    }
    segments.push({ kind: "mention", label: m[1], id: m[2] });
    lastIndex = MENTION_RE.lastIndex;
  }
  if (lastIndex < input.length) {
    segments.push({ kind: "text", value: input.slice(lastIndex) });
  }
  return segments;
}

/** Locate the active `@token` the caret is typing, if any. */
export function detectMentionTrigger(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const upToCaret = value.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  // `@` must start a line or follow whitespace
  if (at > 0) {
    const prev = upToCaret[at - 1];
    if (!/\s/.test(prev)) return null;
  }
  const between = upToCaret.slice(at + 1);
  if (/\s/.test(between)) return null;
  if (between.length > 40) return null;
  return { start: at, query: between };
}

/** Replace the `@token` being typed with a mention token + trailing space. */
export function insertMention(
  value: string,
  caret: number,
  trigger: { start: number; query: string },
  option: { id: string; label: string },
): { value: string; caret: number } {
  const before = value.slice(0, trigger.start);
  const after = value.slice(caret);
  const token = `@[${option.label}](${option.id}) `;
  const nextValue = before + token + after;
  return { value: nextValue, caret: before.length + token.length };
}
