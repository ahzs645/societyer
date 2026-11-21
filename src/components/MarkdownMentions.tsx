/**
 * @mentions for the rich text editor. Typing "@" and part of a name opens a
 * list of people; picking one inserts "@Name" as an ordinary Markdown link to
 * their profile, `[@Name](/app/people-directory/<id>)`, so the text stays
 * readable anywhere the Markdown goes. Mentions only link; nobody is notified.
 *
 * Pages that already have the people directory loaded offer it through
 * MentionPeopleContext (or an editor's `mentionPeople` prop); editors without
 * a list don't open the menu.
 */
import { createContext, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { EditorState } from "@milkdown/kit/prose/state";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

export type MentionPerson = { id: string; name: string; detail?: string };

export const MentionPeopleContext = createContext<readonly MentionPerson[] | undefined>(undefined);

/** The "@query" being typed: from the "@" to the caret. */
export type MentionQuery = { from: number; to: number; query: string };

export const mentionHref = (id: string) => `/app/people-directory/${encodeURIComponent(id)}`;

const MAX_RESULTS = 8;

/** "@" at a word start, then up to three words of a name, ending at the caret. */
const QUERY = /(?:^|[\s(["'“‘])@([\p{L}\p{N}'’.-]*(?: [\p{L}\p{N}'’.-]*){0,2})$/u;

export function mentionQueryAt(state: EditorState): MentionQuery | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $pos = selection.$from;
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 60), $pos.parentOffset, undefined, "￼");
  const match = QUERY.exec(before);
  if (!match) return null;
  const query = match[1];
  const from = $pos.pos - query.length - 1;
  // Not inside a link or inline code (an email address, a mention already made).
  const marks = state.schema.marks;
  for (const mark of [marks.link, marks.inlineCode]) {
    if (mark && state.doc.rangeHasMark(from, $pos.pos, mark)) return null;
  }
  return { from, to: $pos.pos, query };
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Names starting with the query first, then names with a word starting with it, then any match. */
export function matchPeople(people: readonly MentionPerson[], query: string) {
  const q = fold(query.trim());
  if (!q) return people.slice(0, MAX_RESULTS);
  const ranked: Array<[number, MentionPerson]> = [];
  for (const person of people) {
    const name = fold(person.name);
    const rank = name.startsWith(q) ? 0 : name.split(/[\s-]+/).some((word) => word.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
    if (rank >= 0) ranked.push([rank, person]);
  }
  return ranked.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, MAX_RESULTS).map(([, person]) => person);
}

/** Replaces the "@query" with a linked "@Name" and a plain space after it. */
export function insertMention(view: EditorView, at: MentionQuery, person: MentionPerson) {
  const { state } = view;
  const linkType = state.schema.marks.link;
  if (!linkType) return;
  const text = `@${person.name}`;
  const tr = state.tr.insertText(text, at.from, at.to);
  tr.addMark(at.from, at.from + text.length, linkType.create({ href: mentionHref(person.id) }));
  tr.insert(at.from + text.length, state.schema.text(" "));
  tr.setSelection(TextSelection.create(tr.doc, at.from + text.length + 1));
  tr.setStoredMarks([]);
  view.dispatch(tr);
  view.focus();
}

export function MentionMenu({ view, at, people, active, listId, onPick, onHover }: {
  view: EditorView;
  at: MentionQuery;
  people: readonly MentionPerson[];
  active: number;
  listId: string;
  onPick: (person: MentionPerson) => void;
  onHover: (index: number) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  // Under the "@", or above it when the window has no room below.
  useLayoutEffect(() => {
    const place = () => {
      const node = menu.current;
      if (!node || view.isDestroyed) return;
      const caret = view.coordsAtPos(at.from);
      const height = node.offsetHeight;
      const width = node.offsetWidth;
      const below = caret.bottom + 6;
      const top = below + height > window.innerHeight - 8 && caret.top - 6 - height > 8 ? caret.top - 6 - height : below;
      const left = Math.max(8, Math.min(caret.left, window.innerWidth - width - 8));
      setStyle({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [view, at.from, people.length]);
  useLayoutEffect(() => {
    menu.current?.querySelector(`#${CSS.escape(`${listId}-${active}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  return createPortal(
    <div ref={menu} className="markdown-mention" style={style}>
      <ul id={listId} role="listbox" aria-label="People">
        {people.map((person, index) => (
          <li
            key={person.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? "is-active" : undefined}
            // Keep the caret in the text; the click picks.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(person)}
          >
            <span className="markdown-mention__name">{person.name}</span>
            {person.detail && <span className="markdown-mention__detail">{person.detail}</span>}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
