import { useMemo, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "./_helpers";
import { Select } from "../components/Select";
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
function label(key: string) { return key.replaceAll("_", " ").replace(/^./, (s) => s.toUpperCase()); }
function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : String(value); }

export function ResearchLibraryPage() {
  const [collection, setCollection] = useState<Collection>("templates");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const entries = (collection === "implementation" ? implementation.items : research[collection]) as Entry[];
  const areas = useMemo(() => [...new Set(entries.map((entry) => String(entry.research_area)))].sort(), [entries]);
  const filtered = entries.filter((entry) => (!area || entry.research_area === area)
    && (!search.trim() || JSON.stringify(entry).toLowerCase().includes(search.trim().toLowerCase())));

  return <div className="page">
    <PageHeader title="Research library" icon={<BookOpen size={16} />} subtitle="Source evidence, official form references, and questions for your registry, administrator, or legal reviewer."
      actions={<Link className="btn-action" to="/app/compliance-obligations">Open obligations</Link>} />
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card__body">
        <p style={{ marginTop: 0 }}>Research checked October 3, 2026 (Vancouver). These records describe the supplied review; they do not establish that a form is accepted, a connection has been tested, or a legal rule has been approved for your entity.</p>
        <p className="muted">Official forms, preparation worksheets, application drafts, executed originals, and certified registry outputs have different purposes. Follow each entry’s filing, retention, and reuse requirements. Ontario’s full governance review and several provider setup questions remain open.</p>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ minWidth: 220 }}>Collection
            <Select value={collection} options={collections} onChange={(value) => { setCollection(value as Collection); setArea(""); }} />
          </label>
          <label style={{ minWidth: 220 }}>Area
            <Select value={area} options={[{ value: "", label: "All areas" }, ...areas.map((value) => ({ value, label: label(value) }))]} onChange={setArea} />
          </label>
          <label style={{ flex: 1, minWidth: 220 }}>Search evidence
            <input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, provisions, and requirements" />
          </label>
        </div>
      </div>
    </section>
    <p className="muted" aria-live="polite">{filtered.length} of {entries.length} records</p>
    {filtered.length === 0 && <div className="card"><div className="card__body">No records match these filters.</div></div>}
    {filtered.map((entry) => {
      const title = display(entry.name ?? entry.topic ?? entry.title ?? entry.question ?? entry.item ?? entry.id);
      const url = safeSource(entry.url);
      return <section className="card" key={String(entry.id)} style={{ marginBottom: 12 }}>
        <div className="card__head">
          <div><h2 className="card__title">{title}</h2><span className="card__subtitle">{String(entry.id)} · {label(String(entry.research_area))}</span></div>
          {url && <a className="btn-action" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Open source</a>}
        </div>
        <div className="card__body">
          <dl style={{ margin: 0, display: "grid", gap: 10 }}>
            {Object.entries(entry).filter(([key, value]) => !["id", "research_area", "name", "topic", "title", "question", "item", "url", "short_quote"].includes(key) && value != null && value !== "" && (!Array.isArray(value) || value.length > 0)).map(([key, value]) =>
              <div key={key}><dt style={{ fontWeight: 600 }}>{label(key)}</dt><dd style={{ margin: "3px 0 0", overflowWrap: "anywhere" }}>{display(value)}</dd></div>)}
          </dl>
        </div>
      </section>;
    })}
  </div>;
}
