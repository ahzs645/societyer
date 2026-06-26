import { useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { PageLoading } from "./_helpers";
import { Building2, Download, FileText, ShieldCheck, Users } from "lucide-react";

/**
 * Public, token-gated stakeholder portal (e.g. an auditor's read-only room).
 * Rendered OUTSIDE the app shell at /portal/:token — no account required; the
 * token is the credential. Only the sections the token's scopes allow appear,
 * and downloads are present only when the grant enabled them.
 */
export function PartyPortalPage() {
  const { token } = useParams();
  const data = useQuery(api.partyPortals.center, token ? { token } : "skip") as any;

  if (data === undefined) return <PageLoading />;
  if (data === null) {
    return (
      <div style={{ maxWidth: 560, margin: "80px auto", padding: 24, textAlign: "center", color: "var(--text-primary)" }}>
        <h1 style={{ marginBottom: 8 }}>Portal unavailable</h1>
        <p className="muted">This link is invalid, has expired, or has been revoked. Contact the organization that shared it with you.</p>
      </div>
    );
  }

  const { portal, society, board, publications, documents } = data;
  const sectionStyle = { marginTop: 28 } as const;
  const headingStyle = { display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-lg)", marginBottom: 12 } as const;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px", color: "var(--text-primary)" }}>
      <header style={{ borderBottom: "1px solid var(--border)", paddingBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Building2 size={24} />
          <h1 style={{ margin: 0 }}>{society.name}</h1>
        </div>
        {society.incorporationNumber && (
          <div className="muted mono" style={{ marginTop: 4 }}>{society.incorporationNumber}</div>
        )}
        <div className="muted" style={{ marginTop: 8 }}>
          Private portal shared with <strong>{portal.label}</strong> · read-only
          {portal.allowDownload ? " · downloads enabled" : " · view-only (no downloads)"}
        </div>
        {society.publicSummary && <p style={{ marginTop: 12 }}>{society.publicSummary}</p>}
      </header>

      {portal.scopes.includes("board") && (
        <section style={sectionStyle}>
          <h2 style={headingStyle}><Users size={18} /> Board of directors</h2>
          {board.length === 0 ? (
            <p className="muted">No active directors on record.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Name</th><th>Position</th></tr></thead>
              <tbody>
                {board.map((d: any, i: number) => (
                  <tr key={i}><td><strong>{d.name}</strong></td><td>{d.position}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {portal.scopes.includes("publications") && (
        <section style={sectionStyle}>
          <h2 style={headingStyle}><ShieldCheck size={18} /> Publications</h2>
          {publications.length === 0 ? (
            <p className="muted">No published items.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Title</th><th>Category</th><th>Published</th><th /></tr></thead>
              <tbody>
                {publications.map((p: any) => (
                  <tr key={p._id}>
                    <td><strong>{p.title}</strong>{p.summary && <div className="muted">{p.summary}</div>}</td>
                    <td>{p.category}</td>
                    <td className="mono">{(p.publishedAtISO ?? "").slice(0, 10)}</td>
                    <td>{p.downloadUrl ? <a className="btn btn--sm" href={p.downloadUrl}><Download size={12} /> Download</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {portal.scopes.includes("documents") && (
        <section style={sectionStyle}>
          <h2 style={headingStyle}><FileText size={18} /> Documents</h2>
          {documents.length === 0 ? (
            <p className="muted">No documents shared.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Title</th><th>Category</th><th /></tr></thead>
              <tbody>
                {documents.map((d: any) => (
                  <tr key={d._id}>
                    <td><strong>{d.title}</strong>{d.fileName && <div className="muted mono">{d.fileName}</div>}</td>
                    <td>{d.category}</td>
                    <td>{d.downloadUrl ? <a className="btn btn--sm" href={d.downloadUrl}><Download size={12} /> Download</a> : <span className="muted">view-only</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <footer className="muted" style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: "var(--fs-sm)" }}>
        Provided via Societyer · a private, read-only portal. Information reflects the latest records and updates automatically.
      </footer>
    </div>
  );
}

export default PartyPortalPage;
