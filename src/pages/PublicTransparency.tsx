import { publicationCategoryLabel } from "../lib/publicationCategories";
import { Link, useParams } from "react-router-dom";
import { PageLoading } from "./_helpers";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Badge } from "../components/ui";
import { ShieldCheck, FileText } from "lucide-react";
import { formatDate } from "../lib/format";
import { publicationUrl } from "../lib/publicationUrl";
import { isLocalDataRuntime } from "../lib/staticRuntime";

export function PublicTransparencyPage() {
  const { slug } = useParams<{ slug?: string }>();
  const data = useQuery(api.transparency.publicCenter, { slug });

  if (data === undefined) {
    return <PageLoading />;
  }

  if (!data || !data.society) {
    return (
      <div className="landing" style={{ minHeight: "100vh", padding: "4rem 0" }}>
        <div className="landing__container">
          <h1 className="landing__h1">No public society page found.</h1>
        </div>
      </div>
    );
  }

  const { society, directors, publications } = data;
  const showBoard = Boolean(society.publicShowBoard && directors.length > 0);

  return (
    <div className="landing public-center" style={{ minHeight: "100vh", overflowWrap: "anywhere" }}>
      <section className="landing__hero public-center__hero">
        <div className="landing__container">
          <div className="public-center__eyebrow-row">
            <div className="landing__eyebrow">
              <ShieldCheck size={12} /> Public transparency center
            </div>
            {/* Publishing settings are for the society's admins, not visitors;
              * the local preview just says it is one. */}
            {isLocalDataRuntime() && <Badge tone="success">Local public-page preview</Badge>}
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>{society.name}</h1>
          <p className="landing__lede">
            {society.publicSummary ?? society.purposes ?? "This society has not added a public summary yet."}
          </p>
          {(society.volunteerApplyPath || society.grantApplyPath) && (
            <div className="public-center__cta">
              {society.volunteerApplyPath && (
                <Link className="btn-action btn-action--primary" to={society.volunteerApplyPath}>
                  Volunteer with us
                </Link>
              )}
              {society.grantApplyPath && (
                <Link className="btn-action" to={society.grantApplyPath}>
                  Apply for funding
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="landing__section public-center__body">
        <div className="landing__container">
          <div className={`card public-center__about${showBoard ? " has-board" : ""}`}>
            <div className="public-center__facts">
              <h2 className="card__title">At a glance</h2>
              <dl>
                <div>
                  <dt>Contact</dt>
                  <dd>{society.publicContactEmail ? <a href={`mailto:${society.publicContactEmail}`}>{society.publicContactEmail}</a> : "Not published"}</dd>
                </div>
                {society.incorporationNumber && (
                  <div>
                    <dt>Incorporation</dt>
                    <dd className="mono">{society.incorporationNumber}</dd>
                  </div>
                )}
                <div>
                  <dt>Board</dt>
                  <dd>
                    {society.publicShowBoard
                      ? `${directors.length} active director${directors.length === 1 ? "" : "s"}`
                      : society.publicContactEmail
                        ? "Available by records request"
                        : "Contact society"}
                  </dd>
                </div>
                <div>
                  <dt>Public records</dt>
                  <dd>{publications.length} item{publications.length === 1 ? "" : "s"} published</dd>
                </div>
              </dl>
            </div>
            {showBoard && (
              <div className="public-center__board">
                <h2 className="card__title">Board of directors</h2>
                <ul>
                  {directors.map((director) => (
                    <li key={director._id}>
                      <strong>{director.name}</strong>
                      <span>{director.position}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Public documents and updates</h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              {publications.map((publication) => (
                <article
                  key={publication._id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 16,
                    background: "var(--bg-elevated)",
                  }}
                >
                  <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <Badge>{publicationCategoryLabel(publication.category)}</Badge>
                    <span className="muted mono" style={{ fontSize: 12 }}>
                      {publication.publishedAtISO ? formatDate(publication.publishedAtISO) : "Draft"}
                    </span>
                  </div>
                  <h3 style={{ margin: "0 0 6px" }}>{publication.title}</h3>
                  <div className="muted" style={{ marginBottom: 10 }}>
                    {publication.summary ?? publication.documentTitle ?? "Published society record"}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {publication.downloadUrl && (
                      <a
                        className="btn-action btn-action--primary"
                        href={publication.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open file for ${publication.title}`}
                      >
                        Open file
                      </a>
                    )}
                    {publicationUrl(publication.url) && (
                      <a
                        className="btn-action"
                        href={publicationUrl(publication.url)!}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open link for ${publication.title}`}
                      >
                        Open link
                      </a>
                    )}
                    {!publication.downloadUrl && !publicationUrl(publication.url) && (
                      <span className="muted">No file or public link attached yet.</span>
                    )}
                  </div>
                </article>
              ))}
              {publications.length === 0 && (
                <div className="public-center__empty">
                  <span className="public-center__empty-icon" aria-hidden="true"><FileText size={18} /></span>
                  <div>
                    <strong>Nothing published yet</strong>
                    <p>Bylaws, annual reports, AGM notices and policies appear here once the society publishes them.</p>
                    {society.publicContactEmail && (
                      <p>
                        For a records request, email{" "}
                        <a href={`mailto:${society.publicContactEmail}`}>{society.publicContactEmail}</a>.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
