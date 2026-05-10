import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { ExternalLink, FileText, Globe2, LayoutGrid, Plus, Table2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { DataTable } from "../../../components/DataTable";
import type { Column } from "../../../components/DataTable";
import type { FilterField } from "../../../components/FilterBar";
import { Badge, Drawer, Field } from "../../../components/ui";
import { useToast } from "../../../components/Toast";

type GrantSourceLibrarySectionProps = {
  societyId: any;
  actingUserId?: any;
  sourceLibrary: any;
};

export function GrantSourceLibrarySection({
  societyId,
  actingUserId,
  sourceLibrary,
}: GrantSourceLibrarySectionProps) {
  const toast = useToast();
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

  const sourceTypeOptions = useMemo(() => uniqueOptions(sourceRows.map((row: any) => formatSourceLabel(row.sourceType))), [sourceRows]);
  const statusOptions = useMemo(() => uniqueOptions(sourceRows.map((row: any) => formatSourceLabel(row.installed ? "installed" : row.status))), [sourceRows]);
  const trustOptions = useMemo(() => uniqueOptions(sourceRows.map((row: any) => formatSourceLabel(row.trustLevel))), [sourceRows]);
  const cadenceOptions = useMemo(() => uniqueOptions(sourceRows.map((row: any) => formatSourceLabel(row.scrapeCadence))), [sourceRows]);
  const funderOptions = useMemo(() => uniqueOptions(sourceRows.map((row: any) => formatSourceLabel(row.funderType))), [sourceRows]);

  const sourceFilterFields = useMemo<FilterField<any>[]>(() => [
    {
      id: "status",
      label: "Status",
      options: statusOptions,
      match: (row, query) => formatSourceLabel(normalizeSourceStatus(row)).toLowerCase() === query.toLowerCase(),
    },
    {
      id: "sourceType",
      label: "Source type",
      options: sourceTypeOptions,
      match: (row, query) => formatSourceLabel(row.sourceType).toLowerCase() === query.toLowerCase(),
    },
    {
      id: "trustLevel",
      label: "Trust level",
      options: trustOptions,
      match: (row, query) => formatSourceLabel(row.trustLevel).toLowerCase() === query.toLowerCase(),
    },
    {
      id: "cadence",
      label: "Cadence",
      options: cadenceOptions,
      match: (row, query) => formatSourceLabel(row.scrapeCadence).toLowerCase() === query.toLowerCase(),
    },
    {
      id: "funderType",
      label: "Funder type",
      options: funderOptions,
      match: (row, query) => formatSourceLabel(row.funderType).toLowerCase() === query.toLowerCase(),
    },
    {
      id: "jurisdiction",
      label: "Jurisdiction",
      match: (row, query) => String(row.jurisdiction ?? "").toLowerCase().includes(query.toLowerCase()),
    },
    {
      id: "tags",
      label: "Tags",
      match: (row, query) => getSourceTags(row).some((tag) => tag.toLowerCase().includes(query.toLowerCase())),
    },
  ], [cadenceOptions, funderOptions, sourceTypeOptions, statusOptions, trustOptions]);

  const sourceColumns = useMemo<Column<any>[]>(() => [
    {
      id: "name",
      header: "Source",
      accessor: (row) => row.name,
      sortable: true,
      width: 260,
      render: (row) => (
        <div className="grant-source-table-source">
          <strong>{row.name}</strong>
          <span>
            {row.rowKind === "library" ? "Societyer library" : "Workspace source"} · {formatSourceLabel(row.sourceType)}
          </span>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: (row) => normalizeSourceStatus(row),
      sortable: true,
      render: (row) => (
        <Badge tone={row.installed ? "success" : row.status === "active" ? "info" : "warn"}>
          {row.installed ? "Installed" : formatSourceLabel(row.status)}
        </Badge>
      ),
    },
    {
      id: "scope",
      header: "Scope",
      accessor: (row) => `${row.jurisdiction ?? ""} ${row.funderType ?? ""}`,
      sortable: true,
      width: 320,
      render: (row) => (
        <div className="grant-source-table-source">
          <strong>{row.jurisdiction ?? "No jurisdiction"}</strong>
          <span>{formatSourceLabel(row.funderType ?? "unknown funder")}</span>
        </div>
      ),
    },
    {
      id: "cadence",
      header: "Cadence",
      accessor: (row) => row.scrapeCadence ?? "",
      sortable: true,
      render: (row) => formatSourceLabel(row.scrapeCadence ?? "manual"),
    },
    {
      id: "tags",
      header: "Tags",
      accessor: (row) => getSourceTags(row).join(" "),
      render: (row) => <SourceTagList tags={getSourceTags(row)} limit={3} />,
      width: 220,
    },
  ], []);

  const sourceActions = (row: any) => (
    <SourceActions
      row={row}
      societyId={societyId}
      actingUserId={actingUserId}
      addGrantSourceFromLibrary={addGrantSourceFromLibrary}
      onAdded={(name) => toast.success("Grant source added", name)}
    />
  );

  return (
    <>
      <section aria-labelledby="grant-source-library-title">
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
              }
            >
              <Plus size={12} /> Add source
            </button>
          </div>
        </div>
        {viewMode === "table" ? (
          <DataTable
            label="Source library"
            icon={<Globe2 size={14} />}
            data={sourceLibrary === undefined ? [] : sourceRows}
            loading={sourceLibrary === undefined}
            columns={sourceColumns}
            filterFields={sourceFilterFields}
            rowKey={(row) => `${row.rowKind}:${row.libraryKey ?? row._id ?? row.url}`}
            searchPlaceholder="Search sources, jurisdictions, funders, or tags..."
            searchExtraFields={[
              (row) => row.notes,
              (row) => getSourceTags(row).join(" "),
            ]}
            defaultSort={{ columnId: "name", dir: "asc" }}
            pagination
            initialPageSize={25}
            viewsKey="grant-source-library"
            renderRowActions={sourceActions}
          />
        ) : (
          <div className="grid-auto grid-auto--lg">
            {(sourceLibrary === undefined ? [] : sourceRows).map((row: any) => (
              <GrantSourceCard key={`${row.rowKind}:${row.libraryKey ?? row._id ?? row.url}`} row={row} actions={sourceActions(row)} />
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
        actingUserId={actingUserId}
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
          <div className="grant-source-card__eyebrow">
            {row.rowKind === "library" ? "Societyer library" : "Workspace source"}
          </div>
          <h3 className="grant-source-card__title">{row.name}</h3>
        </div>
        <Badge tone={row.installed ? "success" : row.status === "active" ? "info" : "warn"}>
          {row.installed ? "Installed" : formatSourceLabel(row.status)}
        </Badge>
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
  actingUserId,
  addGrantSourceFromLibrary,
  onAdded,
}: {
  row: any;
  societyId: any;
  actingUserId?: any;
  addGrantSourceFromLibrary: any;
  onAdded: (name: string) => void;
}) {
  return (
    <div className="grant-source-actions">
      <a className="btn btn--ghost btn--sm" href={row.url} target="_blank" rel="noreferrer">
        <ExternalLink size={12} /> Open
      </a>
      {row.libraryKey && (
        <Link className="btn btn--ghost btn--sm" to={`/app/grants/sources/${row.libraryKey}`}>
          <FileText size={12} /> Details
        </Link>
      )}
      {row.rowKind === "library" && !row.installed && (
        <button
          className="btn btn--ghost btn--sm"
          onClick={async () => {
            await addGrantSourceFromLibrary({
              societyId,
              libraryKey: row.libraryKey,
              actingUserId,
            });
            onAdded(row.name);
          }}
        >
          <Plus size={12} /> Add source
        </button>
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
  actingUserId,
  societyId,
  sourceDraft,
  setSourceDraft,
  upsertGrantSource,
}: {
  actingUserId?: any;
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
                actingUserId,
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
              <select className="input" value={sourceDraft.sourceType} onChange={(event) => setSourceDraft({ ...sourceDraft, sourceType: event.target.value })}>
                <option value="funder_site">Funder site</option>
                <option value="government_portal">Government portal</option>
                <option value="rss">RSS</option>
                <option value="pdf">PDF</option>
                <option value="airtable">Airtable</option>
                <option value="spreadsheet">Spreadsheet</option>
                <option value="authenticated_portal">Authenticated portal</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="Jurisdiction">
              <input className="input" value={sourceDraft.jurisdiction} onChange={(event) => setSourceDraft({ ...sourceDraft, jurisdiction: event.target.value })} placeholder="Canada, BC, municipal" />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Scrape cadence">
              <select className="input" value={sourceDraft.scrapeCadence} onChange={(event) => setSourceDraft({ ...sourceDraft, scrapeCadence: event.target.value })}>
                <option value="manual">Manual</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
            <Field label="Trust level">
              <select className="input" value={sourceDraft.trustLevel} onChange={(event) => setSourceDraft({ ...sourceDraft, trustLevel: event.target.value })}>
                <option value="official">Official</option>
                <option value="partner">Partner</option>
                <option value="aggregator">Aggregator</option>
                <option value="unknown">Unknown</option>
              </select>
            </Field>
          </div>
          <Field label="Eligibility tags">
            <input className="input" value={sourceDraft.eligibilityTagsText} onChange={(event) => setSourceDraft({ ...sourceDraft, eligibilityTagsText: event.target.value })} placeholder="research, health, canada" />
          </Field>
          <Field label="Topic tags">
            <input className="input" value={sourceDraft.topicTagsText} onChange={(event) => setSourceDraft({ ...sourceDraft, topicTagsText: event.target.value })} placeholder="cihr, community, youth" />
          </Field>
          <Field label="Notes">
            <textarea className="textarea" rows={4} value={sourceDraft.notes} onChange={(event) => setSourceDraft({ ...sourceDraft, notes: event.target.value })} />
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

function uniqueOptions(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}
