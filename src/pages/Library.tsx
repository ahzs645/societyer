import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, RelatedDocumentViews, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { BookOpen, Calendar, FileText, FolderOpen } from "lucide-react";
import { formatDate, pluralize } from "../lib/format";
import { documentCategoryLabel } from "../../shared/documentCategories";
import { formatMeetingDate } from "../../shared/meetingDates";

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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Library"
        icon={<BookOpen size={16} />}
        iconColor="purple"
        subtitle="Handbooks, policies, governance documents and meeting packets."
        actions={<Link className="btn-action" to="/app/documents"><FolderOpen size={12} /> All documents</Link>}
      />

      <RelatedDocumentViews current="/app/library" />

      {data?.counts && (
        <p className="muted library-summary">
          {pluralize(data.counts.referenceDocuments ?? 0, "reference document")} · {pluralize(data.counts.meetingPackets ?? 0, "meeting packet")} · {pluralize(data.counts.meetingMaterials ?? 0, "packet material")}
        </p>
      )}

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          {(data?.sections ?? []).map((section: any) => (
            <div className="card" key={section.section}>
              <div className="card__head">
                <h2 className="card__title">{SECTION_LABELS[section.section] ?? section.section}</h2>
                <Badge>{section.documents.length}</Badge>
              </div>
              <div className="card__body col" style={{ gap: 8 }}>
                {section.documents.map((document: any) => (
                  <LibraryDocumentRow key={document._id} document={document} />
                ))}
              </div>
            </div>
          ))}
          {data && (data.sections?.length ?? 0) === 0 && (
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
            </div>
            <div className="card__body col" style={{ gap: 10 }}>
              {(data?.meetingPackets ?? []).map((packet: any) => (
                <div className="panel library-packet" key={packet.meeting._id} style={{ padding: 12, borderRadius: 8 }}>
                  <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <Link to={`/app/meetings/${packet.meeting._id}`}><strong>{packet.meeting.title}</strong></Link>
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        <Calendar size={12} style={{ verticalAlign: -2 }} /> {formatMeetingDate(packet.meeting)}
                      </div>
                    </div>
                    <Badge tone="info">{pluralize(packet.materials.length, "document")}</Badge>
                  </div>
                  <div className="col" style={{ gap: 6, marginTop: 10 }}>
                    {packet.materials.slice(0, 4).map((material: any) => (
                      <Link key={material._id} className="row" style={{ gap: 6 }} to={`/app/documents/${material.document._id}`}>
                        <FileText size={12} />
                        <span>{material.label || material.document.title}</span>
                        {material.requiredForMeeting && <Badge tone="warn">Required</Badge>}
                        <Badge tone={materialTone(material)}>{materialLabel(material)}</Badge>
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
              {data && (data.meetingPackets?.length ?? 0) === 0 && (
                <div className="muted">No meeting material packets yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function materialLabel(material: any) {
  if (material.availabilityStatus === "withdrawn") return "Withdrawn";
  if (material.expiresAtISO && new Date(material.expiresAtISO).getTime() < Date.now()) return "Expired";
  if (material.availabilityStatus === "pending") return "Pending";
  if (material.syncStatus === "offline") return "Offline";
  if (material.syncStatus === "synced") return "Synced";
  return "Available";
}

function materialTone(material: any) {
  const label = materialLabel(material);
  if (label === "Available" || label === "Synced" || label === "Offline") return "success";
  if (label === "Pending") return "warn";
  if (label === "Expired" || label === "Withdrawn") return "danger";
  return "neutral";
}

function LibraryDocumentRow({ document }: { document: any }) {
  return (
    <Link to={`/app/documents/${document._id}`} className="row library-doc-row" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6, gap: 10, flexWrap: "nowrap" }}>
      <FileText size={14} style={{ flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{document.title}</strong>
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {documentCategoryLabel(document.category)} · {formatDate(document.createdAtISO)}
        </div>
      </div>
    </Link>
  );
}
