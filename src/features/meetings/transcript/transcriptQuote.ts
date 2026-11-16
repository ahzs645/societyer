/**
 * "Quote in notes": the notes surface offers it to the transcript's selection
 * toolbar. Without a provider (the Transcript tab, read-only notes) the
 * toolbar shows Copy quote and Copy link only.
 */
import { createContext } from "react";
import { appRouteAbsoluteHref, type AppRouteHrefOptions } from "../../../lib/appRouteHref";
import { formatTranscriptTime } from "./activeIndex";

export type TranscriptQuotePick = { text: string; speaker: string; start: number; end: number };

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

/** The same, as an absolute link for notes and exports. */
export function notesTranscriptLink(start: number, end: number, location: { pathname: string; search: string }, options: AppRouteHrefOptions = {}) {
  return appRouteAbsoluteHref(`${location.pathname}${notesTranscriptSearch(location.search, start, end)}`, options);
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
  const text = quote.text.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "");
  const speaker = quote.speaker.replace(/\s+/g, " ").trim() || "Unknown speaker";
  return `> “${text}”\n>\n> — ${speaker}, [${formatTranscriptTime(quote.start)}](${href})`;
}
