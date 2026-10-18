import { usePermissions } from "@/hooks/usePermissions";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Menu } from "../../../components/Menu";
import { useMutation } from "convex/react";
import { ExternalLink, FileText, Globe2, LayoutGrid, MoreHorizontal, Plus, Table2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable } from "@/platform/record-engine";
import { Badge, Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
import { useToast } from "../../../components/Toast";

type GrantSourceLibrarySectionProps = {
  societyId: any;
  sourceLibrary: any;
};

export function GrantSourceLibrarySection({
  societyId,
  sourceLibrary,
}: GrantSourceLibrarySectionProps) {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("grants:write");
  const toast = useToast();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [sourceDraft, setSourceDraft] = useState<any | null>(null);
  const addGrantSourceFromLibrary = useMutation(api.grantSources.addFromLibrary);
  const upsertGrantSource = useMutation(api.grantSources.upsert);

  const sourceRows = useMemo(
    () => [
      ...((sourceLibrary?.library ?? []) as any[]).map((source) => ({
        ...source,
        rowKind: "library",
      })),
      ...((sourceLibrary?.workspace ?? []) as any[])
        .filter((source) => !source.libraryKey)
        .map((source) => ({
          ...source,
          rowKind: "workspace",
          installed: true,
        })),
    ],
    [sourceLibrary],
  );

  // Flat records for the metadata-driven table: the composite cells (source +
  // origin, jurisdiction + funder) keep their look through renderCell while
  // sorting, filters, group-by, export and the sidebar read plain values.
  const sourceRecords = useMemo(
    () =>
      sourceRows.map((row: any) => ({
        ...row,
        _id: sourceRowKey(row),
        status: normalizeSourceStatus(row),
        scope: [row.jurisdiction, row.funderType ? formatSourceLabel(row.funderType) : ""].filter(Boolean).join(" · "),
        tags: getSourceTags(row),
        _searchText: [row.notes, getSourceTags(row).join(" ")].filter(Boolean).join(" "),
      })),
    [sourceRows],
  );

  const sourceActions = (row: any) => (
    <SourceActions
      row={row}
      societyId={societyId}
      addGrantSourceFromLibrary={addGrantSourceFromLibrary}
      onAdded={(name) => toast.success("Grant source added", name)}
    />
  );

  return (
    <>
      <section className="grant-source-library" aria-labelledby="grant-source-library-title">
        <div className="section-title" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe2 size={14} />
            <h2 id="grant-source-library-title" style={{ fontSize: 16, margin: 0 }}>
              Source library
            </h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted">{sourceLibrary === undefined ? "Loading sources..." : `${sourceRows.length} sources`}</span>
            <div className="segmented-control" aria-label="Source library view">
              <button
                className={viewMode === "cards" ? "segmented-control__item is-active" : "segmented-control__item"}
                onClick={() => setViewMode("cards")}
                type="button"
              >
                <LayoutGrid size={12} /> Cards
              </button>
              <button
                className={viewMode === "table" ? "segmented-control__item is-active" : "segmented-control__item"}
                onClick={() => setViewMode("table")}
                type="button"
              >
                <Table2 size={12} /> Table
              </button>
            </div>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() =>
                setSourceDraft({
                  name: "",
                  url: "",
                  sourceType: "custom",
                  jurisdiction: "",
                  funderType: "other",
                  scrapeCadence: "manual",
                  trustLevel: "unknown",
                  status: "active",
                  eligibilityTagsText: "",
                  topicTagsText: "",
                  notes: "",
                })
              } disabled={!canWrite}
            >
              <Plus size={12} /> Add source
            </button>
          </div>
        </div>
        {viewMode === "table" ? (
          <ObjectRecordTable
            societyId={societyId}
            nameSingular="grantSource"
            label="Source library"
            objectLabel="grant source"
            icon={<Globe2 size={14} />}
            records={sourceLibrary === undefined ? [] : sourceRecords}
            loading={sourceLibrary === undefined}
            onRecordClick={(_id, row) => {
              if (row.libraryKey) navigate(`/app/grants/sources/${row.libraryKey}`);
              else if (row.url) window.open(row.url, "_blank", "noopener,noreferrer");
            }}
            renderCell={({ record: row, field }) => {
              if (field.name === "name") return (
                <span className="grant-source-table-source">
                  <strong>{row.name}</strong>
                  <span>
                    {row.rowKind === "library" ? "Societyer library" : "Workspace source"} · {formatSourceLabel(row.sourceType)}
                  </span>
                </span>
              );
              if (field.name === "status") return (
                <Badge tone={row.installed ? "success" : row.status === "active" ? "info" : "warn"}>
                  {row.installed ? "Installed" : formatSourceLabel(row.status)}
                </Badge>
              );
              if (field.name === "scope") return (
                <div className="grant-source-table-source">
                  <strong>{row.jurisdiction ?? "No jurisdiction"}</strong>
                  <span>{formatSourceLabel(row.funderType ?? "unknown funder")}</span>
                </div>
              );
              if (field.name === "scrapeCadence") return formatSourceLabel(row.scrapeCadence ?? "manual");
              if (field.name === "tags") return row.tags.length ? (
                <span className="record-cell__text" title={row.tags.map(formatTagLabel).join(", ")}>
                  {row.tags.slice(0, 2).map(formatTagLabel).join(", ")}
                  {row.tags.length > 2 && <span className="muted"> +{row.tags.length - 2}</span>}
                </span>
              ) : <span className="muted">No tags</span>;
              return undefined;
            }}
            renderRowActions={sourceActions}
          />
        ) : (
          <div className="grid-auto grid-auto--lg">
            {(sourceLibrary === undefined ? [] : sourceRows).map((row: any) => (
              <GrantSourceCard key={sourceRowKey(row)} row={row} actions={sourceActions(row)} />
            ))}
            {sourceLibrary === undefined && (
              <article className="card">
                <div className="card__body muted">Loading grant sources...</div>
              </article>
            )}
          </div>
        )}
      </section>

      <GrantSourceDrawer
        societyId={societyId}
        sourceDraft={sourceDraft}
        setSourceDraft={setSourceDraft}
        upsertGrantSource={upsertGrantSource}
      />
    </>
  );
}

function GrantSourceCard({ row, actions }: { row: any; actions: ReactNode }) {
  return (
    <article className="card grant-source-card">
      <div className="grant-source-card__head">
        <div className="grant-source-card__main">
          {/* Library sources are the norm; only a workspace's own source is labelled. */}
          {row.rowKind !== "library" && <div className="grant-source-card__eyebrow">Workspace source</div>}
          <h3 className="grant-source-card__title">{row.name}</h3>
        </div>
        {/* Phones show only the Installed and non-active states; "Active" is every library listing. */}
        <span className={`grant-source-card__status${row.installed || row.status !== "active" ? " is-notable" : ""}`}>
          <Badge tone={row.installed ? "success" : row.status === "active" ? "info" : "warn"}>
            {row.installed ? "Installed" : formatSourceLabel(row.status)}
          </Badge>
        </span>
      </div>
      <div className="grant-source-card__body">
        <div className="grant-source-card__meta">
          <span>{formatSourceLabel(row.sourceType)}</span>
          <span>{row.jurisdiction ?? "No jurisdiction"}</span>
          <span>{formatSourceLabel(row.funderType ?? "unknown funder")}</span>
        </div>
        <div className="grant-source-card__signals">
          <Badge tone={row.trustLevel === "official" ? "success" : "neutral"}>{formatSourceLabel(row.trustLevel ?? "unknown")}</Badge>
          <Badge tone="neutral">{formatSourceLabel(row.scrapeCadence ?? "manual")}</Badge>
        </div>
        <SourceTagList tags={getSourceTags(row)} limit={4} />
      </div>
      <div className="grant-source-card__footer">{actions}</div>
    </article>
  );
}

function SourceActions({
  row,
  societyId,
  addGrantSourceFromLibrary,
  onAdded,
}: {
  row: any;
  societyId: any;
  addGrantSourceFromLibrary: any;
  onAdded: (name: string) => void;
}) {
  const { loaded, can } = usePermissions();
  const navigate = useNavigate();
  const canWrite = loaded && can("grants:write");
  const canAdd = row.rowKind === "library" && !row.installed;
  const addSource = async () => {
    await addGrantSourceFromLibrary({
      societyId,
      libraryKey: row.libraryKey,
    });
    onAdded(row.name);
  };
  // One primary action per source; the rest sit in a "⋯" menu.
  const moreItems = [
    ...(canAdd && row.libraryKey ? [{ id: "details", label: "Details", icon: <FileText size={14} />, onSelect: () => navigate(`/app/grants/sources/${row.libraryKey}`) }] : []),
    ...(row.url && (canAdd || row.libraryKey) ? [{ id: "open", label: "Open website", icon: <ExternalLink size={14} />, onSelect: () => window.open(row.url, "_blank", "noopener,noreferrer") }] : []),
  ];
  return (
    <div className="grant-source-actions">
      {canAdd ? (
        <button className="btn btn--ghost btn--sm" onClick={() => void addSource()} disabled={!canWrite}>
          <Plus size={12} /> Add source
        </button>
      ) : row.libraryKey ? (
        <Link className="btn btn--ghost btn--sm" to={`/app/grants/sources/${row.libraryKey}`}>
          <FileText size={12} /> Details
        </Link>
      ) : row.url ? (
        <a className="btn btn--ghost btn--sm" href={row.url} target="_blank" rel="noreferrer">
          <ExternalLink size={12} /> Open
        </a>
      ) : null}
      {moreItems.length > 0 && (
        <Menu
          align="right"
          trigger={
            <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`More actions for ${row.name}`} title="More actions">
              <MoreHorizontal size={14} />
            </button>
          }
          sections={[{ id: "source-actions", items: moreItems }]}
        />
      )}
    </div>
  );
}

function SourceTagList({ tags, limit = 4 }: { tags: string[]; limit?: number }) {
  const visibleTags = tags.slice(0, limit);
  const hiddenCount = Math.max(0, tags.length - visibleTags.length);
  if (tags.length === 0) return <div className="muted grant-source-tags">No tags</div>;
  return (
    <div className="grant-source-tags">
      {visibleTags.map((tag) => (
        <span className="chip grant-source-tag" key={tag} title={tag}>
          {formatTagLabel(tag)}
        </span>
      ))}
      {hiddenCount > 0 && <span className="chip chip--transparent grant-source-tag">+{hiddenCount}</span>}
    </div>
  );
}

function GrantSourceDrawer({
  societyId,
  sourceDraft,
  setSourceDraft,
  upsertGrantSource,
}: {
  societyId: any;
  sourceDraft: any | null;
  setSourceDraft: (draft: any | null) => void;
  upsertGrantSource: any;
}) {
  const toast = useToast();

  return (
    <Drawer
      open={!!sourceDraft}
      onClose={() => setSourceDraft(null)}
      title="Grant source"
      footer={
        <>
          <button className="btn" onClick={() => setSourceDraft(null)}>Cancel</button>
          <button
            className="btn btn--accent"
            onClick={async () => {
              if (!sourceDraft || !sourceDraft.name?.trim() || !sourceDraft.url?.trim()) {
                toast.error("Source name and URL are required");
                return;
              }
              await upsertGrantSource({
                societyId,
                patch: {
                  name: sourceDraft.name.trim(),
                  url: sourceDraft.url.trim(),
                  sourceType: sourceDraft.sourceType || "custom",
                  jurisdiction: sourceDraft.jurisdiction || undefined,
                  funderType: sourceDraft.funderType || undefined,
                  scrapeCadence: sourceDraft.scrapeCadence || "manual",
                  trustLevel: sourceDraft.trustLevel || "unknown",
                  status: sourceDraft.status || "active",
                  eligibilityTags: splitTags(sourceDraft.eligibilityTagsText),
                  topicTags: splitTags(sourceDraft.topicTagsText),
                  notes: sourceDraft.notes || undefined,
                },
              });
              toast.success("Grant source saved");
              setSourceDraft(null);
            }}
          >
            Save source
          </button>
        </>
      }
    >
      {sourceDraft && (
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Source name">
            <input className="input" value={sourceDraft.name} onChange={(event) => setSourceDraft({ ...sourceDraft, name: event.target.value })} />
          </Field>
          <Field label="URL">
            <input className="input" value={sourceDraft.url} onChange={(event) => setSourceDraft({ ...sourceDraft, url: event.target.value })} />
          </Field>
          <div className="grid-2">
            <Field label="Source type">
              <Select value={sourceDraft.sourceType} onChange={(value) => setSourceDraft({ ...sourceDraft, sourceType: value })}
                options={[
                  { value: "funder_site", label: "Funder site" },
                  { value: "government_portal", label: "Government portal" },
                  { value: "rss", label: "RSS" },
                  { value: "pdf", label: "PDF" },
                  { value: "airtable", label: "Airtable" },
                  { value: "spreadsheet", label: "Spreadsheet" },
                  { value: "authenticated_portal", label: "Authenticated portal" },
                  { value: "custom", label: "Custom" },
                ]} />
            </Field>
            <Field label="Jurisdiction">
              <input className="input" value={sourceDraft.jurisdiction} onChange={(event) => setSourceDraft({ ...sourceDraft, jurisdiction: event.target.value })} placeholder="Canada, BC, municipal" />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Scrape cadence">
              <Select value={sourceDraft.scrapeCadence} onChange={(value) => setSourceDraft({ ...sourceDraft, scrapeCadence: value })}
                options={[
                  { value: "manual", label: "Manual" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]} />
            </Field>
            <Field label="Trust level">
              <Select value={sourceDraft.trustLevel} onChange={(value) => setSourceDraft({ ...sourceDraft, trustLevel: value })}
                options={[
                  { value: "official", label: "Official" },
                  { value: "partner", label: "Partner" },
                  { value: "aggregator", label: "Aggregator" },
                  { value: "unknown", label: "Unknown" },
                ]} />
            </Field>
          </div>
          <Field label="Eligibility tags">
            <input className="input" value={sourceDraft.eligibilityTagsText} onChange={(event) => setSourceDraft({ ...sourceDraft, eligibilityTagsText: event.target.value })} placeholder="research, health, canada" />
          </Field>
          <Field label="Topic tags">
            <input className="input" value={sourceDraft.topicTagsText} onChange={(event) => setSourceDraft({ ...sourceDraft, topicTagsText: event.target.value })} placeholder="cihr, community, youth" />
          </Field>
          <Field label="Notes">
            <MarkdownEditor rows={4} value={sourceDraft.notes} onChange={(markdown) => setSourceDraft({ ...sourceDraft, notes: markdown })} />
          </Field>
        </div>
      )}
    </Drawer>
  );
}

function splitTags(value: unknown) {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value.split(/[,;\n]+/)) {
    const tag = item.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function getSourceTags(row: any): string[] {
  const tags = [...(row.topicTags ?? []), ...(row.eligibilityTags ?? [])]
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

function sourceRowKey(row: any): string {
  return `${row.rowKind}:${row.libraryKey ?? row._id ?? row.url}`;
}

function normalizeSourceStatus(row: any): string {
  return row.installed ? "installed" : String(row.status ?? "unknown");
}

function formatSourceLabel(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTagLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
