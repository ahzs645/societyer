/**
 * The list's search also looks inside notice text where the source can
 * (`searchText`, the catalog service): the table matches its columns in
 * memory, and this asks the source which notices' descriptions hold the words.
 * Those notices then count as matches too (NoticeTable adds the words to their
 * search text), so there is one search box rather than a second one for text.
 */
import { useEffect, useState } from "react";
import { useReaderSource } from "./source";

/** Shorter terms match too much text to be worth a request; the columns still match them. */
const MIN_LENGTH = 2;

export type NoticeTextMatches = {
  /** The search these matches answer. */
  query: string;
  keys: ReadonlySet<string>;
  /** More notices hold the words than the source returned. */
  truncated: boolean;
  error: string;
};

const NONE: NoticeTextMatches = { query: "", keys: new Set(), truncated: false, error: "" };

/** Notices whose text holds `search`, once the source has answered for that term. */
export function useNoticeTextMatches(kind: string, search: string): NoticeTextMatches {
  const { searchText } = useReaderSource();
  const query = search.trim();
  const [result, setResult] = useState<NoticeTextMatches>(NONE);
  useEffect(() => {
    if (!searchText || query.length < MIN_LENGTH) return;
    const controller = new AbortController();
    searchText(query, kind, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted)
          setResult({ query, keys: new Set(value.matches.map((match) => match.recordKey)), truncated: value.truncated, error: "" });
      },
      (failure: unknown) => {
        if (!controller.signal.aborted)
          setResult({ query, keys: new Set(), truncated: false, error: failure instanceof Error ? failure.message : "Search unavailable." });
      },
    );
    return () => controller.abort();
  }, [searchText, query, kind]);
  return searchText && query.length >= MIN_LENGTH && result.query === query ? result : NONE;
}
