import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Badge } from "../components/ui";
import { Mail, Scale, ShieldCheck, ClipboardList, FileText } from "lucide-react";
import { formatDate } from "../lib/format";

export function PublicTransparencyPage() {
  const { slug } = useParams<{ slug?: string }>();
  const data = useQuery(api.transparency.publicCenter, { slug });

  if (data === undefined) {
    return <div className="page">Loading…</div>;
  }

  if (!data) {
    return (
      <div className="landing" style={{ minHeight: "100vh", padding: "4rem 0" }}>
        <div className="landing__container">
          <h1 className="landing__h1">No public society page found.</h1>
        </div>
      </div>
    );
  }

  const { society, directors, publications } = data;
  const statusLabels = [
    society.publicTransparencyEnabled ? ["Public page live", "success"] : ["Draft-only page", "warn"],
    society.publicShowBoard ? ["Board visible", "info"] : ["Board hidden", "warn"],
    society.publicShowBylaws ? ["Bylaws visible", "info"] : ["Bylaws hidden", "warn"],
    society.publicShowFinancials ? ["Financials visible", "info"] : ["Financials hidden", "warn"],
  ] as const;

  return (
    <div className="landing" style={{ minHeight: "100vh" }}>
      <section className="landing__hero" style={{ paddingTop: 72, paddingBottom: 48 }}>
        <div className="landing__container">
          <div className="landing__eyebrow">
            <ShieldCheck size={12} /> Public transparency center
          </div>
          <h1 className="landing__h1" style={{ marginBottom: 12 }}>{society.name}</h1>
          <p className="landing__lede">
            {society.publicSummary ?? society.purposes ?? "This society has not added a public summary yet."}
          </p>
          <div className="landing__hero-meta">
            {society.incorporationNumber && <span><Scale size={12} /> Incorporation #{society.incorporationNumber}</span>}
            {society.publicContactEmail && <span><Mail size={12} /> {society.publicContactEmail}</span>}
            <span>{publications.length} published item{publications.length === 1 ? "" : "s"}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            {statusLabels.map(([label, tone]) => (
              <Badge key={label} tone={tone as any}>{label}</Badge>
            ))}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", marginTop: 18 }}>
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
        </div>
      </section>

      <section className="landing__section">
        <div className="landing__container">
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <h2 className="card__title">At a glance</h2>
              <span className="card__subtitle">Public access, governance, and disclosure settings</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <span className="muted">Contact</span>
                <span>{society.publicContactEmail ? <a href={`mailto:${society.publicContactEmail}`}>{society.publicContactEmail}</a> : "Not published"}</span>
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <span className="muted">Board roster</span>
                <span>{society.publicShowBoard ? `${directors.length} active director${directors.length === 1 ? "" : "s"}` : "Hidden"}</span>
              </div>
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <span className="muted">Public records</span>
                <span>{publications.length} item{publications.length === 1 ? "" : "s"} published</span>
              </div>
            </div>
          </div>

          {society.publicShowBoard && directors.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card__head">
                <h2 className="card__title">Board of directors</h2>
                <span className="card__subtitle">{directors.length} active director{directors.length === 1 ? "" : "s"}</span>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 8 }}>
                {directors.map((director) => (
                  <div key={director._id} className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{director.name}</strong>
                    <Badge>{director.position}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Public documents and updates</h2>
              <span className="card__subtitle">Bylaws, annual reports, AGM materials, policies, and other published records.</span>
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
                    <Badge>{publication.category}</Badge>
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
                      <a className="btn-action btn-action--primary" href={publication.downloadUrl} target="_blank" rel="noreferrer">
                        Open file
                      </a>
                    )}
                    {publication.url && (
                      <a className="btn-action" href={publication.url} target="_blank" rel="noreferrer">
                        Open link
                      </a>
                    )}
                    {!publication.downloadUrl && !publication.url && (
                      <span className="muted">No file or public link attached yet.</span>
                    )}
                  </div>
                </article>
              ))}
              {publications.length === 0 && (
                <div className="muted" style={{ display: "grid", gap: 8 }}>
                  <div>No public items have been published yet.</div>
                  <div>
                    <ClipboardList size={12} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                    Once published, bylaws, annual reports, AGM notices, and policy records can appear here.
                  </div>
                  {society.publicContactEmail && (
                    <div>
                      <FileText size={12} style={{ verticalAlign: "text-bottom", marginRight: 4 }} />
                      For records requests, contact{" "}
                      <a href={`mailto:${society.publicContactEmail}`}>{society.publicContactEmail}</a>.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
