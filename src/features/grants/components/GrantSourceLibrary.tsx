import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "convex/react";
import { ExternalLink, FileText, Globe2, Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
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
        <div className="grid-auto grid-auto--lg">
          {(sourceLibrary === undefined ? [] : sourceRows).map((row: any) => (
            <article className="card" key={`${row.rowKind}:${row.libraryKey ?? row._id ?? row.url}`}>
              <div className="card__head" style={{ alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <h3 className="card__title" style={{ overflowWrap: "anywhere" }}>
                    {row.name}
                  </h3>
                  <div className="card__subtitle">
                    {row.rowKind === "library" ? "Societyer library" : "Workspace source"} · {row.sourceType}
                  </div>
                </div>
                <Badge tone={row.installed ? "success" : row.status === "active" ? "info" : "warn"}>{row.installed ? "Installed" : row.status}</Badge>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Badge tone={row.trustLevel === "official" ? "success" : "info"}>{row.trustLevel}</Badge>
                  <Badge tone="neutral">{row.scrapeCadence}</Badge>
                  <Badge tone="neutral">{row.profile?.profileKind ?? "no profile"}</Badge>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {row.jurisdiction ?? "No jurisdiction"} · {row.funderType ?? "unknown funder"}
                </div>
                {row.notes && (
                  <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.45 }}>
                    {row.notes}
                  </p>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {((row.topicTags ?? row.eligibilityTags ?? []) as string[]).slice(0, 4).map((tag) => (
                    <span className="chip" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
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
                        toast.success("Grant source added", row.name);
                      }}
                    >
                      <Plus size={12} /> Add source
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          {sourceLibrary === undefined && (
            <article className="card">
              <div className="card__body muted">Loading grant sources...</div>
            </article>
          )}
        </div>
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
  for (const item of value.split(",")) {
    const tag = item.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}
