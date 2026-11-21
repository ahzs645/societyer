/**
 * Typed web and email addresses become links once they're finished: with a
 * space after them, or Enter. Uses linkifyjs to tell an address from a word
 * that only looks like one. Pasted text, code and existing links are left
 * alone, and Undo takes the link back off.
 */
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import type { ResolvedPos } from "@milkdown/kit/prose/model";
import { find } from "linkifyjs";

const key = new PluginKey("societyer-linkify");

/** The last word of a textblock's text before `$pos`, if a space or the block's end closes it. */
function finishedWord(state: EditorState, $pos: ResolvedPos) {
  const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, "￼");
  if (/\s$/.test(before)) {
    const match = /(\S+)\s$/.exec(before);
    return match ? { word: match[1], start: $pos.start() + before.length - 1 - match[1].length } : null;
  }
  // Enter: the caret starts a new block; look at the end of the text block
  // before it (in a list that's the previous item's paragraph).
  if ($pos.parentOffset !== 0 || $pos.depth === 0) return null;
  const previous = Selection.findFrom(state.doc.resolve($pos.before()), -1, true);
  if (!previous) return null;
  const $end = previous.$head;
  if (!$end.parent.isTextblock || $end.parentOffset !== $end.parent.content.size) return null;
  const text = $end.parent.textBetween(0, $end.parentOffset, undefined, "￼");
  const match = /(\S+)$/.exec(text);
  return match ? { word: match[1], start: $end.start() + text.length - match[1].length } : null;
}

export function linkifyPlugin() {
  return new Plugin({
    key,
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      // Pastes and undo/redo keep exactly what they bring.
      if (transactions.some((tr) => tr.getMeta("paste") || tr.getMeta("uiEvent") === "paste" || tr.getMeta("history$") || tr.getMeta("addToHistory") === false)) return null;
      const linkType = state.schema.marks.link;
      if (!linkType || !state.selection.empty) return null;
      const $pos = state.selection.$from;
      if ($pos.parent.type.spec.code) return null;
      const finished = finishedWord(state, $pos);
      if (!finished) return null;
      const codeType = state.schema.marks.inlineCode;
      let tr: Transaction | null = null;
      // Bare domains get https://, like the link popover.
      for (const found of find(finished.word, { defaultProtocol: "https" })) {
        if (found.type !== "url" && found.type !== "email") continue;
        const from = finished.start + found.start;
        const to = finished.start + found.end;
        if (state.doc.rangeHasMark(from, to, linkType) || (codeType && state.doc.rangeHasMark(from, to, codeType))) continue;
        tr = (tr ?? state.tr).addMark(from, to, linkType.create({ href: found.href }));
      }
      return tr;
    },
  });
}
