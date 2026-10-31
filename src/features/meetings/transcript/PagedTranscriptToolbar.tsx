import { useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { TranscriptSpeaker } from "./timedTranscript";
import { loadPagedTranscript } from "../../../../shared/pagedTranscriptExport";
import { TranscriptExportMenu } from "./TranscriptExportMenu";

export function PagedTranscriptToolbar({ jobId, meetingId, minutes, sourceRevision, page, pageCount, segmentCount, onPage, speakers, onExported }: {
  jobId: string; meetingId: Id<"meetings">; minutes: unknown; sourceRevision?: string;
  page: number; pageCount: number; segmentCount: number; onPage: (index: number) => void;
  speakers: readonly TranscriptSpeaker[]; onExported: (message: string) => void;
}) {
  const convex = useConvex();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const results = useQuery(api.meetingTranscription.search, query ? { jobId, text: query } : "skip");
  return <div className="card" style={{ padding: 12, marginBottom: 12 }}>
    <p>{segmentCount.toLocaleString()} segments · Speaker counts and the timeline below show this page. Exports include all pages.</p>
    <div className="transcript-toolbar__actions">
      <button type="button" className="btn-action" disabled={!page} onClick={() => onPage(page - 1)}>Previous page</button>
      <span>Page {page + 1} of {pageCount}</span>
      <button type="button" className="btn-action" disabled={page + 1 >= pageCount} onClick={() => onPage(page + 1)}>Next page</button>
      <TranscriptExportMenu meetingId={meetingId} minutes={minutes} transcript={null} onExported={onExported}
        sourceKey={JSON.stringify([jobId, sourceRevision, pageCount, speakers])}
        loadTranscript={(signal, onProgress) => loadPagedTranscript({ pageCount, speakers, signal, onProgress,
          loadPage: (index) => convex.query(api.meetingTranscription.page, { jobId, page: index }),
        })} />
    </div>
    <form onSubmit={(event) => { event.preventDefault(); setQuery(text.trim()); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      <input className="form-input" aria-label="Search all transcript pages" placeholder="Search all transcript pages" value={text} maxLength={200}
        onChange={(event) => { setText(event.target.value); if (!event.target.value) setQuery(""); }} />
      <button type="submit" className="btn-action">Search all pages</button>
    </form>
    {results && <ul>{results.map((result: { page: number; excerpt: string }) => <li key={result.page}>
      <button type="button" className="btn-action" onClick={() => onPage(result.page)}>Page {result.page + 1}: {result.excerpt}</button>
    </li>)}{!results.length && <li>No matching pages.</li>}</ul>}
  </div>;
}
