import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { BookOpen, Calendar, FileText, FolderOpen } from "lucide-react";
import { formatDate, formatDateTime } from "../lib/format";

const SECTION_LABELS: Record<string, string> = {
  governance: "Governance",
  policy: "Policies",
  meeting_material: "Meeting materials",
  finance: "Finance",
  reference: "Reference",
};

export function LibraryPage() {
  const society = useSociety();
  const data = useQuery(api.library.overview, society ? { societyId: society._id } : "skip");

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Library"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="Board handbooks, policy references, governance documents, and meeting material packets."
        actions={<Link className="btn-action" to="/app/documents"><FolderOpen size={12} /> All documents</Link>}
      />

      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Reference docs</div>
          <div className="stat__value">{data?.counts.referenceDocuments ?? 0}</div>
          <div className="stat__sub">library, policy, governance</div>
        </div>
        <div className="stat">
          <div className="stat__label">Meeting packets</div>
          <div className="stat__value">{data?.counts.meetingPackets ?? 0}</div>
          <div className="stat__sub">grouped by meeting</div>
        </div>
        <div className="stat">
          <div className="stat__label">Packet materials</div>
          <div className="stat__value">{data?.counts.meetingMaterials ?? 0}</div>
          <div className="stat__sub">agenda-linked documents</div>
        </div>
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          {(data?.sections ?? []).map((section: any) => (
            <div className="card" key={section.section}>
              <div className="card__head">
                <h2 className="card__title">{SECTION_LABELS[section.section] ?? section.section}</h2>
                <span className="card__subtitle">{section.documents.length} document{section.documents.length === 1 ? "" : "s"}</span>
              </div>
              <div className="card__body col" style={{ gap: 8 }}>
                {section.documents.map((document: any) => (
                  <LibraryDocumentRow key={document._id} document={document} />
                ))}
              </div>
            </div>
          ))}
          {data && data.sections.length === 0 && (
            <EmptyState
              icon={<BookOpen size={18} />}
              title="No library documents yet"
              description="Add tags like library, reference, or board-handbook to documents, or attach documents to a meeting package."
              action={<Link className="btn btn--accent" to="/app/documents">Open documents</Link>}
            />
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Meeting packets</h2>
              <span className="card__subtitle">Board materials by meeting</span>
            </div>
            <div className="card__body col" style={{ gap: 10 }}>
              {(data?.meetingPackets ?? []).map((packet: any) => (
                <div className="panel" key={packet.meeting._id} style={{ padding: 12, borderRadius: 8 }}>
                  <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <Link to={`/app/meetings/${packet.meeting._id}`}><strong>{packet.meeting.title}</strong></Link>
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        <Calendar size={12} style={{ verticalAlign: -2 }} /> {formatDateTime(packet.meeting.scheduledAt)}
                      </div>
                    </div>
                    <Badge tone="info">{packet.materials.length} docs</Badge>
                  </div>
                  <div className="col" style={{ gap: 6, marginTop: 10 }}>
                    {packet.materials.slice(0, 4).map((material: any) => (
                      <Link key={material._id} className="row" style={{ gap: 6 }} to={`/app/documents/${material.document._id}`}>
                        <FileText size={12} />
                        <span>{material.label || material.document.title}</span>
                        {material.requiredForMeeting && <Badge tone="warn">Required</Badge>}
                      </Link>
                    ))}
                    {packet.materials.length > 4 && (
                      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        +{packet.materials.length - 4} more in the meeting hub
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {data && data.meetingPackets.length === 0 && (
                <div className="muted">No meeting material packets yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryDocumentRow({ document }: { document: any }) {
  return (
    <Link to={`/app/documents/${document._id}`} className="row" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6, gap: 10 }}>
      <FileText size={14} />
      <div style={{ flex: 1 }}>
        <strong>{document.title}</strong>
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {document.fileName ?? document.category} · {formatDate(document.createdAtISO)}
        </div>
      </div>
      <Badge tone={document.reviewStatus === "approved" ? "success" : document.reviewStatus === "needs_signature" ? "warn" : "neutral"}>
        {document.category}
      </Badge>
    </Link>
  );
}
