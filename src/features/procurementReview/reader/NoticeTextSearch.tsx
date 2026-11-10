import { useEffect, useState } from "react";
import { useReaderSource } from "./source";
import { useReaderNavigation } from "./routes";

/** Body search is explicit and bounded; ordinary list filters still cover the whole list. */
export function NoticeTextSearch({ kind }: { kind: string }) {
  const source = useReaderSource(), nav = useReaderNavigation();
  const [query, setQuery] = useState(""), [result, setResult] = useState<{ query: string; matches: { recordKey: string; title: string; snippet: string }[]; truncated: boolean } | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!source.searchText || query.trim().length < 2) { setResult(null); setError(""); return; }
    const controller = new AbortController(); setError("");
    const timer = setTimeout(() => { void source.searchText!(query.trim(), kind, controller.signal).then(value => { if (!controller.signal.aborted) setResult({ ...value, query }); }, failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Search unavailable."); }); }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, query, kind]);
  if (!source.searchText) return null;
  return <details className="card"><summary className="card__head">Search inside notice text</summary><div className="card__body col">
    <label>Words in {kind === "award" ? "award" : "opportunity"} notices<input className="input" type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
    <p className="small muted">Searches notice titles and descriptions in this publication. Downloaded document contents are excluded.</p>
    {error && <p role="alert">{error}</p>}
    {query.trim().length >= 2 && result?.query !== query && !error && <p role="status">Searching…</p>}
    {result?.query === query && <><p role="status">{result.matches.length} results{result.truncated ? " shown; more match. Use more specific words." : "."}</p><ul>{result.matches.map(match => <li key={match.recordKey}><button type="button" className="btn btn--ghost" onPointerEnter={() => source.prefetchRecord?.(match.recordKey)} onFocus={() => source.prefetchRecord?.(match.recordKey)} onClick={() => nav.openNotice(match.recordKey)}>{match.title || "Open matching notice"}</button><p className="small">{match.snippet}</p></li>)}</ul></>}
  </div></details>;
}
