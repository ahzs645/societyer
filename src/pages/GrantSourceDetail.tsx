import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Globe2, Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";

export function GrantSourceDetailPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const { libraryKey } = useParams();
  const sourceLibrary = useQuery(
    api.grantSources.listWithLibrary,
    society ? { societyId: society._id } : "skip",
  );
  const addGrantSourceFromLibrary = useMutation(api.grantSources.addFromLibrary);

  if (society === undefined) return <div className="page">Loading...</div>;
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
        subtitle={`${source.jurisdiction ?? "No jurisdiction"} · ${source.funderType ?? "unknown funder"} · ${source.sourceType}`}
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
                className="btn-action btn-action--primary"
                onClick={async () => {
                  await addGrantSourceFromLibrary({
                    societyId: society._id,
                    libraryKey: source.libraryKey,
                    actingUserId,
                  });
                  toast.success("Grant source added", source.name);
                }}
              >
                <Plus size={12} /> Add source
              </button>
            )}
          </>
        }
      />

      <div className="grid-auto grid-auto--lg">
        <article className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Source record</h2>
              <div className="card__subtitle">Library key: {source.libraryKey}</div>
            </div>
            <Badge tone={source.installed ? "success" : "info"}>{source.installed ? "Installed" : source.status}</Badge>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone={source.trustLevel === "official" ? "success" : "info"}>{source.trustLevel}</Badge>
              <Badge tone="neutral">{source.scrapeCadence}</Badge>
              <Badge tone="neutral">{profile?.profileKind ?? "no profile"}</Badge>
            </div>
            {source.notes && <p style={{ margin: 0 }}>{source.notes}</p>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[...(source.eligibilityTags ?? []), ...(source.topicTags ?? [])].map((tag: string) => (
                <span className="chip" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </article>

        <article className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Extraction plan</h2>
              <div className="card__subtitle">List page first, then representative detail pages</div>
            </div>
            <Badge tone={extractionPlan?.status === "representative-detail-page-reviewed" ? "success" : "warn"}>
              {extractionPlan?.status ?? "pending"}
            </Badge>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            {extractionPlan?.listPageNotes && (
              <SourceDetailText label="List page notes" value={extractionPlan.listPageNotes} />
            )}
            {extractionPlan?.detailPageNotes && (
              <SourceDetailText label="Detail page notes" value={extractionPlan.detailPageNotes} />
            )}
            <div>
              <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>Reviewed detail pages</div>
              {detailPages.length ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {detailPages.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="muted">No representative grant detail page reviewed yet.</div>
              )}
            </div>
          </div>
        </article>

        <article className="card">
          <div className="card__head">
            <div>
              <h2 className="card__title">Profile mappings</h2>
              <div className="card__subtitle">How candidates should be read from this source</div>
            </div>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            <SourceDetailText label="List selector" value={profile?.listSelector ?? "Not mapped"} />
            <SourceDetailText label="Item selector" value={profile?.itemSelector ?? "Not mapped"} />
            <SourceDetailText label="Detail URL pattern" value={profile?.detailUrlPattern ?? "Not mapped"} />
            <SourceMappingList title="List fields" mappings={fieldMappings} empty="No list field mappings yet." />
            <SourceMappingList title="Detail fields" mappings={detailFieldMappings} empty="No detail field mappings yet." />
          </div>
        </article>
      </div>
    </div>
  );
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
            <code key={field}>{field}: {String(selector)}</code>
          ))}
        </div>
      ) : (
        <div className="muted">{empty}</div>
      )}
    </div>
  );
}

function SourceDetailText({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
