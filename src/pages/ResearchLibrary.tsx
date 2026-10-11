import { useMemo, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "./_helpers";
import { Select } from "../components/Select";
import { formatDate } from "../lib/format";
import research from "../lib/research/societyerResearch.json";
import implementation from "../lib/research/implementationStatus.json";

type Entry = Record<string, unknown>;
type Collection = "templates" | "rules" | "findings" | "open_questions" | "sources" | "implementation";
const collections: { value: Collection; label: string }[] = [
  { value: "templates", label: "Forms and templates" },
  { value: "rules", label: "Legal rule evidence" },
  { value: "findings", label: "Research findings" },
  { value: "open_questions", label: "Questions to confirm" },
  { value: "sources", label: "Source register" },
  { value: "implementation", label: "Implementation status" },
];

function safeSource(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch { /* Unresolved references stay as text. */ }
}
const ACRONYMS: Record<string, string> = { bc: "BC", cra: "CRA", agm: "AGM", url: "URL", id: "ID", ids: "IDs" };
function label(key: string) {
  return key.split("_").map((word, index) => ACRONYMS[word] ?? (index === 0 ? word.replace(/^./, (s) => s.toUpperCase()) : word)).join(" ");
}
/** Research text cites ISO days ("current to 2026-09-22"); show them as the app's dates. */
function humanDates(text: string) {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => formatDate(iso));
}
function display(value: unknown) { return humanDates(Array.isArray(value) ? value.join(", ") : String(value)); }

export function ResearchLibraryPage() {
  const [collection, setCollection] = useState<Collection>("templates");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const entries = (collection === "implementation" ? implementation.items : research[collection]) as Entry[];
  const areas = useMemo(() => [...new Set(entries.map((entry) => String(entry.research_area)))].sort(), [entries]);
  const filtered = entries.filter((entry) => (!area || entry.research_area === area)
    && (!search.trim() || JSON.stringify(entry).toLowerCase().includes(search.trim().toLowerCase())));

  const filteredView = Boolean(area || search.trim());

  return <div className="page">
    <PageHeader title="Research library" icon={<BookOpen size={16} />} subtitle="Source evidence, form references, and questions to confirm."
      info={<>
        <p>Research checked October 3, 2026 (Vancouver). These records describe the supplied review; they do not establish that a form is accepted, a connection has been tested, or a legal rule has been approved for your entity.</p>
        <p>Official forms, preparation worksheets, application drafts, executed originals, and certified registry outputs have different purposes. Follow each entry’s filing, retention, and reuse requirements. Ontario’s full governance review and several provider setup questions remain open.</p>
        <p>Use these as questions for your registry, administrator, or legal reviewer.</p>
      </>}
      actions={<Link className="btn-action" to="/app/compliance-obligations">Open obligations</Link>} />
    <div className="research-filters">
      <Select aria-label="Collection" value={collection} options={collections} onChange={(value) => { setCollection(value as Collection); setArea(""); }} />
      <Select aria-label="Area" value={area} options={[{ value: "", label: "All areas" }, ...areas.map((value) => ({ value, label: label(value) }))]} onChange={setArea} />
      <input className="input research-filters__search" type="search" aria-label="Search evidence" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" />
    </div>
    <p className="muted research-count" aria-live="polite">{filteredView ? `${filtered.length} of ${entries.length} records` : `${entries.length} records`}</p>
    {filtered.length === 0 && <div className="card"><div className="card__body">No records match these filters.</div></div>}
    {filtered.length > 0 && <div className="card research-list">
      {filtered.map((entry) => {
        const title = display(entry.name ?? entry.topic ?? entry.title ?? entry.question ?? entry.item ?? entry.id);
        const url = safeSource(entry.url);
        return <article className="research-entry" key={String(entry.id)}>
          <div className="research-entry__head">
            <div>
              <h2 className="research-entry__title">{title}</h2>
              <div className="muted research-entry__meta">{label(String(entry.research_area))} · {String(entry.id)}</div>
            </div>
            {url && <a className="btn-action" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Open source</a>}
          </div>
          <dl className="review-kv">
            {Object.entries(entry).filter(([key, value]) => !["id", "research_area", "name", "topic", "title", "question", "item", "url", "short_quote"].includes(key) && value != null && value !== "" && (!Array.isArray(value) || value.length > 0)).map(([key, value]) =>
              <div className="review-kv__row" key={key}><dt>{label(key)}</dt><dd>{display(value)}</dd></div>)}
          </dl>
        </article>;
      })}
    </div>}
  </div>;
}
