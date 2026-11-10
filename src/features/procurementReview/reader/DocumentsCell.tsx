/**
 * The list's documents cell: a paperclip with how many files Zoer downloaded
 * and published for the notice (nothing when there are none). Hovering or
 * focusing it names them, and separately the files the notice links to that
 * weren't downloaded; both are read only once the tooltip opens, and the
 * hosted reader reads just the names (convex/procurementReview.ts documentTip). Clicking it
 * opens the notice's Documents tab.
 */
import { useMemo } from "react";
import { Paperclip } from "lucide-react";
import { Tooltip } from "../../../components/Tooltip";
import { documentTipNames, type DocumentTipNames } from "../lib/notice";
import { useReaderSource, type ReaderSource } from "./source";

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

/** Mounted only while the tooltip shows. The hosted reader asks for the names alone; the offline snapshot reads its local files. */
function DocumentsTip({ recordKey, documents }: { recordKey: string; documents: number }) {
  const source = useReaderSource();
  return source.useDocumentTip
    ? <ServerDocumentsTip recordKey={recordKey} documents={documents} useTip={source.useDocumentTip} />
    : <SnapshotDocumentsTip recordKey={recordKey} documents={documents} />;
}

function ServerDocumentsTip({ recordKey, documents, useTip }: { recordKey: string; documents: number; useTip: NonNullable<ReaderSource["useDocumentTip"]> }) {
  const tip = useTip(recordKey);
  if (tip === undefined) return <span role="status">{files(documents)} · loading names…</span>;
  return <TipNames documents={documents} names={tip ?? { files: [], linked: [], linkedTotal: 0 }} />;
}

function SnapshotDocumentsTip({ recordKey, documents }: { recordKey: string; documents: number }) {
  const source = useReaderSource();
  const stored = source.useDocuments(recordKey, null);
  const record = source.useRecord(recordKey);
  const names = useMemo(
    () => (stored && record !== undefined ? documentTipNames(stored.page, record ? parse(record.dataJson) : {}, stored.isDone) : null),
    [stored, record],
  );
  if (!names) return <span role="status">{files(documents)} · loading names…</span>;
  return <TipNames documents={documents} names={names} />;
}

function TipNames({ documents, names }: { documents: number; names: DocumentTipNames }) {
  return (
    <span className="procurement-reader__docs-tip">
      <span className="procurement-reader__docs-tip-head">{files(documents)}</span>
      <ul>{names.files.map((name, index) => <li key={`${name}:${index}`}>{name}</li>)}</ul>
      {documents > names.files.length && <span className="procurement-reader__docs-tip-more">and {documents - names.files.length} more</span>}
      {names.linkedTotal > 0 && (
        <>
          <span className="procurement-reader__docs-tip-head">Linked from the notice, not downloaded</span>
          <ul>{names.linked.map((name, index) => <li key={`${name}:${index}`}>{name}</li>)}</ul>
          {names.linkedTotal > names.linked.length && <span className="procurement-reader__docs-tip-more">and {names.linkedTotal - names.linked.length} more</span>}
        </>
      )}
    </span>
  );
}
