/**
 * "Quote in notes": the notes surface offers it to the transcript's selection
 * toolbar. Without a provider (the Transcript tab, read-only notes) the
 * toolbar shows Copy quote and Copy link only.
 */
import { createContext } from "react";
import { formatTranscriptTime } from "./activeIndex";

export type TranscriptQuotePick = {
  text: string;
  speaker: string;
  /** Who said which words, when the selection runs across speakers. */
  parts?: Array<{ speaker: string; text: string }>;
  start: number;
  end: number;
};

export const TranscriptQuoteContext = createContext<((quote: TranscriptQuotePick) => void) | null>(null);

/** `?tab=notes&view=transcript&t=start-end` (or `t=start`): the notes surface's Transcript view at that moment. */
export function notesTranscriptSearch(search: string, start: number, end?: number): string {
  const params = new URLSearchParams(search);
  params.delete("view");
  params.delete("t");
  params.set("tab", "notes");
  params.set("view", "transcript");
  params.set("t", end === undefined || end === start ? `${start}` : `${start}-${end}`);
  return `?${params.toString()}`;
}

/**
 * The same as an app path for the notes: no origin, so the link works from
 * the web app and the desktop app alike.
 */
export function notesTranscriptLink(start: number, end: number, location: { pathname: string; search: string }) {
  return `${location.pathname}${notesTranscriptSearch(location.search, start, end)}`;
}

/**
 * A blockquote for the notes: the words, then who said them and when, linked
 * back to that moment.
 *
 *   > “The honest truth is small pilots are where we learn the most.”
 *   >
 *   > — Priya Raman, [0:54](…?tab=notes&view=transcript&t=54-62)
 */
export function transcriptQuoteMarkdown(quote: TranscriptQuotePick, href: string): string {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "");
  const who = (value: string) => value.replace(/\s+/g, " ").trim() || "Unknown speaker";
  const time = `[${formatTranscriptTime(quote.start)}](${href})`;
  // Across speakers: each one's words, so nobody is credited with someone else's.
  if (quote.parts && new Set(quote.parts.map((part) => who(part.speaker))).size > 1) {
    const lines = quote.parts.map((part) => `> **${who(part.speaker)}:** “${clean(part.text)}”`);
    return `${lines.join("\n>\n")}\n>\n> — ${time}`;
  }
  return `> “${clean(quote.text)}”\n>\n> — ${who(quote.speaker)}, ${time}`;
}
