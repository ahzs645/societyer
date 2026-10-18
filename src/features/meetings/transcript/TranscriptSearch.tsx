import { useEffect, useMemo, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import type { TranscriptSegment } from "./timedTranscript";
import type { TranscriptMatch } from "./TranscriptTurns";

export function useTranscriptSearch({
  root,
  segments,
  hasMedia,
  onSeek,
  setFollowing,
  scrollTo,
  query,
  setQuery,
}: {
  query: string;
  setQuery: (value: string) => void;
  root: RefObject<HTMLDivElement>;
  segments: readonly TranscriptSegment[];
  hasMedia: boolean;
  onSeek: (seconds: number) => void;
  setFollowing: (value: boolean) => void;
  scrollTo: (node: HTMLElement) => void;
}) {
  const [matchIndex, setMatchIndex] = useState(-1);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const found: TranscriptMatch[] = [];
    segments.forEach((segment, index) => {
      const haystack = segment.text.toLocaleLowerCase();
      let start = haystack.indexOf(needle);
      while (start >= 0) {
        found.push({ segment: index, start, end: start + needle.length });
        start = haystack.indexOf(needle, start + needle.length);
      }
    });
    return found;
  }, [query, segments]);
  useEffect(() => {
    setMatchIndex(-1);
    root.current
      ?.querySelectorAll("mark.is-current-match")
      .forEach((mark) => mark.classList.remove("is-current-match"));
  }, [matches, root]);
  const step = (delta: number) => {
    if (!matches.length) return;
    const next =
      matchIndex < 0
        ? delta > 0
          ? 0
          : matches.length - 1
        : (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    setFollowing(true);
    const match = matches[next];
    const segment = segments[match.segment];
    let wordOffset = 0;
    const word = segment.words?.find((entry) => {
      const start = segment.text.indexOf(entry.text, wordOffset);
      wordOffset = Math.max(wordOffset, start) + entry.text.length;
      return start >= 0 && wordOffset > match.start;
    });
    if (hasMedia) onSeek(word?.startSec ?? segment.startSec);
    const node = root.current?.querySelector<HTMLElement>(`[data-segment="${match.segment}"]`);
    root.current
      ?.querySelectorAll("mark.is-current-match")
      .forEach((mark) => mark.classList.remove("is-current-match"));
    node
      ?.querySelectorAll(`[data-match-start="${match.start}"]`)
      .forEach((mark) => mark.classList.add("is-current-match"));
    if (node) scrollTo(node);
  };
  return { query, setQuery, matchIndex, matches, step };
}

// "3 matches" until Next/Previous selects one, then "1 of 3", "2 of 3"…
function searchStatus(query: string, matchIndex: number, count: number): string {
  if (!query.trim()) return "";
  if (!count) return "No matches";
  if (matchIndex < 0) return count === 1 ? "1 match" : `${count} matches`;
  return `${matchIndex + 1} of ${count}`;
}

export function TranscriptSearch({
  query,
  setQuery,
  matchIndex,
  matches,
  step,
}: ReturnType<typeof useTranscriptSearch>) {
  return (
    <div className="transcript-search">
      <Search size={16} />
      <input
        aria-label="Search transcript"
        placeholder="Search transcript…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span role="status">{searchStatus(query, matchIndex, matches.length)}</span>
      <button
        type="button"
        className="btn-action"
        aria-label="Previous match"
        disabled={!matches.length}
        onClick={() => step(-1)}
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className="btn-action"
        aria-label="Next match"
        disabled={!matches.length}
        onClick={() => step(1)}
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );
}
