/**
 * The list's documents cell: a paperclip with how many files Zoer downloaded
 * and published for the notice (nothing when there are none). Hovering or
 * focusing it names them, and separately the files the notice links to that
 * weren't downloaded; both are read only once the tooltip opens. Clicking it
 * opens the notice's Documents tab.
 */
import { useMemo } from "react";
import { Paperclip } from "lucide-react";
import { Tooltip } from "../../../components/Tooltip";
import { describeNotice } from "../lib/notice";
import { useReaderSource } from "./source";

/** Names a tooltip lists before "and N more". */
const SHOWN = 8;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const files = (count: number) => `${count} ${count === 1 ? "document" : "documents"}`;

export function DocumentsCell({ recordKey, documents, onOpen }: { recordKey: string; documents: number; onOpen: () => void }) {
  if (!documents) return null;
  return (
    <Tooltip content={<DocumentsTip recordKey={recordKey} documents={documents} />} delay={200}>
      <button
        type="button"
        className="procurement-reader__docs"
        aria-label={`${files(documents)}: open the notice's documents`}
        // The row opens the notice's overview; this opens its documents.
        onClick={(event) => { event.stopPropagation(); onOpen(); }}
      >
        <Paperclip size={13} aria-hidden="true" />
        <span>{documents}</span>
      </button>
    </Tooltip>
  );
}

/** Phone cards: the count alone (the whole card is one tap target). */
export function DocumentsCount({ documents }: { documents: number }) {
  if (!documents) return null;
  return (
    <span className="procurement-reader__docs procurement-reader__docs--count" aria-label={files(documents)}>
      <Paperclip size={12} aria-hidden="true" />{documents}
    </span>
  );
}

function parse(json: string): unknown {
  try { return JSON.parse(json); } catch { return {}; }
}

/** Mounted only while the tooltip shows. */
function DocumentsTip({ recordKey, documents }: { recordKey: string; documents: number }) {
  const source = useReaderSource();
  const stored = source.useDocuments(recordKey, null);
  const record = source.useRecord(recordKey);
  const attachments = useMemo(() => (record ? describeNotice(record.summary, parse(record.dataJson)).attachments : null), [record]);
  if (!stored || attachments === null) return <span role="status">{files(documents)} · loading names…</span>;
  const published = stored.page.filter((document) => document.available);
  const shown = published.slice(0, SHOWN);
  // Matched against every stored file, as the notice's Documents tab does; only known once all of them are read.
  const linked = stored.isDone ? attachments.filter((item) => !stored.page.some((document) => sameName(document.name, item.name))) : [];
  return (
    <span className="procurement-reader__docs-tip">
      <span className="procurement-reader__docs-tip-head">{files(documents)}</span>
      <ul>{shown.map((document) => <li key={document.documentKey}>{document.name}</li>)}</ul>
      {documents > shown.length && <span className="procurement-reader__docs-tip-more">and {documents - shown.length} more</span>}
      {linked.length > 0 && (
        <>
          <span className="procurement-reader__docs-tip-head">Linked from the notice, not downloaded</span>
          <ul>{linked.slice(0, SHOWN).map((item, index) => <li key={`${item.name}:${index}`}>{item.name}</li>)}</ul>
          {linked.length > SHOWN && <span className="procurement-reader__docs-tip-more">and {linked.length - SHOWN} more</span>}
        </>
      )}
    </span>
  );
}
