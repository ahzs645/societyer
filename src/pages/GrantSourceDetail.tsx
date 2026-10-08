import { usePermissions } from "@/hooks/usePermissions";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ArrowLeft, ExternalLink, Globe2, Plus, FilePlus2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";

export function GrantSourceDetailPage() {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("grants:write");
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const { libraryKey } = useParams();
  const sourceLibrary = useQuery(
    api.grantSources.listWithLibrary,
    society ? { societyId: society._id } : "skip",
  );
  const addGrantSourceFromLibrary = useMutation(api.grantSources.addFromLibrary);
  const upsertGrant = useMutation(api.grants.upsertGrant);
  const navigate = useNavigate();

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const source = ((sourceLibrary?.library ?? []) as any[]).find((row) => row.libraryKey === libraryKey);
  const profile = source?.profile;
  const extractionPlan = source?.extractionPlan;
  const detailPages = (extractionPlan?.detailPagesReviewed ?? []) as string[];
  const fieldMappings = Object.entries((profile?.fieldMappings ?? {}) as Record<string, string>);
  const detailFieldMappings = Object.entries((profile?.detailFieldMappings ?? {}) as Record<string, string>);

  if (sourceLibrary === undefined) return <div className="page">Loading source...</div>;
  if (!source) {
    return (
      <div className="page">
        <PageHeader
          title="Grant source"
          icon={<Globe2 size={16} />}
          iconColor="green"
          subtitle="This source is not in the library."
          actions={
            <Link className="btn-action" to="/app/grants">
              <ArrowLeft size={12} /> Back to grants
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title={source.name}
        icon={<Globe2 size={16} />}
        iconColor="green"
        subtitle={[source.jurisdiction, source.funderType ? humanizeSlug(source.funderType) : null, source.sourceType ? humanizeSlug(source.sourceType) : null].filter(Boolean).join(" · ")}
        actions={
          <>
            <Link className="btn-action" to="/app/grants">
              <ArrowLeft size={12} /> Back to grants
            </Link>
            <a className="btn-action" href={source.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} /> Official source
            </a>
            {!source.installed && (
              <button
                className="btn-action"
                onClick={async () => {
                  await addGrantSourceFromLibrary({
                    societyId: society._id,
                    libraryKey: source.libraryKey,
                  });
                  toast.success("Grant source added", source.name);
                }} disabled={!canWrite}
              >
                <Plus size={12} /> Add source
              </button>
            )}
            <button
              className="btn-action btn-action--primary"
              disabled={!canWrite}
              onClick={async () => {
                if (!canWrite) return;
                const grantId = await upsertGrant({
                  societyId: society._id,
                  title: `${source.name} application`,
                  funder: source.name,
                  status: "Prospecting",
                  opportunityType: source.sourceType,
                  opportunityUrl: source.url,
                  sourceExternalIds: [`grantSource:${source.libraryKey}`],
                  sourceNotes: source.notes || undefined,
                  publicDescription: source.notes || undefined,
                } as any);
                toast.success("Application started", source.name);
                navigate(`/app/grants/${grantId}/edit`);
              }}
            >
              <FilePlus2 size={12} /> Add to pipeline
            </button>
          </>
        }
      />

      <div className="grid-auto grid-auto--lg">
        <article className="card">
          <div className="card__head">
            <h2 className="card__title">About this source</h2>
            <Badge tone={source.installed ? "success" : "info"}>{source.installed ? "Installed" : humanizeSlug(source.status)}</Badge>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {source.trustLevel && <Badge tone={source.trustLevel === "official" ? "success" : "info"}>{humanizeSlug(source.trustLevel)}</Badge>}
              {source.scrapeCadence && <Badge tone="neutral">Checked {humanizeSlug(source.scrapeCadence).toLowerCase()}</Badge>}
            </div>
            {source.notes && <ClampedText text={humanizeSlugsInText(source.notes)} />}
            <SourceTopicChips tags={[...(source.eligibilityTags ?? []), ...(source.topicTags ?? [])]} />
          </div>
        </article>

        <article className="card">
          <div className="card__head grant-source-detail__plan-head">
            <div>
              <h2 className="card__title">Extraction plan</h2>
              <div className="card__subtitle">List page first, then representative detail pages</div>
            </div>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            <div>
              <Badge tone={extractionPlan?.status === "representative-detail-page-reviewed" ? "success" : "warn"}>
                {humanizeSlug(extractionPlan?.status ?? "pending")}
              </Badge>
            </div>
            {extractionPlan?.listPageNotes && (
              <SourceDetailText label="List page notes" value={humanizeSlugsInText(extractionPlan.listPageNotes)} />
            )}
            {extractionPlan?.detailPageNotes && (
              <SourceDetailText label="Detail page notes" value={humanizeSlugsInText(extractionPlan.detailPageNotes)} />
            )}
            <div>
              <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>Reviewed detail pages</div>
              {detailPages.length ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {detailPages.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                      {url}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="muted">None reviewed yet.</div>
              )}
            </div>
          </div>
        </article>
      </div>

      {/* Scraper internals stay available for whoever maintains the source, collapsed by default. */}
      <details className="card grant-source-detail__technical">
        <summary className="card__head">
          <h2 className="card__title">Technical details</h2>
          <span className="card__subtitle">How candidates are read from this source</span>
        </summary>
        <div className="card__body" style={{ display: "grid", gap: 12 }}>
          <SourceDetailText label="Library key" value={source.libraryKey} mono />
          <SourceDetailText label="Profile" value={profile?.profileKind ? humanizeSlug(profile.profileKind) : "No profile"} />
          <SourceDetailText label="List selector" value={profile?.listSelector ?? "Not mapped"} mono />
          <SourceDetailText label="Item selector" value={profile?.itemSelector ?? "Not mapped"} mono />
          <SourceDetailText label="Detail URL pattern" value={profile?.detailUrlPattern ?? "Not mapped"} mono />
          <SourceMappingList title="List fields" mappings={fieldMappings} empty="No list field mappings yet." />
          <SourceMappingList title="Detail fields" mappings={detailFieldMappings} empty="No detail field mappings yet." />
        </div>
      </details>
    </div>
  );
}

const TOPIC_CHIP_LIMIT = 6;

function SourceTopicChips({ tags }: { tags: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const unique = Array.from(new Set(tags.filter(Boolean)));
  if (!unique.length) return null;
  const visible = expanded ? unique : unique.slice(0, TOPIC_CHIP_LIMIT);
  const hidden = unique.length - visible.length;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {visible.map((tag) => (
        <span className="chip" key={tag}>{humanizeSlug(tag).toLowerCase()}</span>
      ))}
      {hidden > 0 && (
        <button type="button" className="chip chip--transparent" onClick={() => setExpanded(true)} aria-label={`Show ${hidden} more topics`}>
          +{hidden}
        </button>
      )}
    </div>
  );
}

function ClampedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 180;
  return (
    <div>
      <p className={long && !expanded ? "grant-source-detail__clamp" : undefined} style={{ margin: 0 }}>{text}</p>
      {long && (
        <button type="button" className="btn btn--ghost btn--sm" style={{ paddingLeft: 0 }} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** "government_portal" / "list-and-detail-profile-started" → "Government portal". */
function humanizeSlug(value: unknown) {
  const words = String(value ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "";
}

/** Plain-language copy for notes that mention internal slugs like "manual_mapping". */
function humanizeSlugsInText(text: string) {
  return text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (slug) => slug.replace(/_/g, " "));
}

function SourceMappingList({
  empty,
  mappings,
  title,
}: {
  empty: string;
  mappings: [string, unknown][];
  title: string;
}) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>{title}</div>
      {mappings.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          {mappings.map(([field, selector]) => (
            <code key={field} style={{ overflowWrap: "anywhere" }}>{field}: {String(selector)}</code>
          ))}
        </div>
      ) : (
        <div className="muted">{empty}</div>
      )}
    </div>
  );
}

function SourceDetailText({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>{label}</div>
      <div className={mono ? "mono" : undefined} style={{ overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}
