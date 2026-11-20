import { Link } from "react-router-dom";
import { FileUp } from "lucide-react";
import { Badge, type ToneVariant } from "../../components/ui";
import { formatDate } from "../../lib/format";
import { optionLabel } from "../../lib/orgHubOptions";
import { documentCategoryLabel } from "../../../shared/documentCategories";
import { REGISTRY_IMPORT_TAG } from "./registryFacts";
import { isBcJurisdiction } from "./detailRows";
import type { OrganizationDetail, OrganizationRecord, ProfileDocument } from "./types";

/** Certificates and articles always belong to the package; filings, receipts and emails only when the profile links them or an import added them. */
const PACKAGE_CATEGORIES = new Set(["CertificateOfIncorporation", "ArticlesOfIncorporation"]);
const LINKED_CATEGORIES = new Set(["Filing", "Receipt", "Correspondence"]);

type PackageRow = { document: ProfileDocument; status: string; tone: ToneVariant };

/** "BC", or the jurisdiction's name without the internal-code note, for a short status pill. */
function shortJurisdiction(jurisdiction: string | undefined) {
  if (isBcJurisdiction(jurisdiction)) return "BC";
  return optionLabel("entityJurisdictions", jurisdiction).replace(/ \(Societyer code\)$/, "");
}

/** The registry package: each document with what the profile uses it for. */
export function registryPackageRows(society: OrganizationRecord, detail: OrganizationDetail | undefined, documents: readonly ProfileDocument[]): PackageRow[] {
  const uses = new Map<string, { status: string; tone: ToneVariant }>();
  const linkUse = (id: string | undefined, status: string, tone: ToneVariant = "success") => {
    if (id && !uses.has(id)) uses.set(id, { status, tone });
  };
  linkUse(society.certificateEvidenceDocumentId, "Verifies the incorporation");
  linkUse(society.articlesSourceDocumentId, "Source of the articles");
  for (const row of detail?.registrations ?? []) {
    const place = row.registrationType === "home" ? "Home registration" : `${shortJurisdiction(row.jurisdiction)} registration`;
    linkUse(row.certificateDocumentId, `${place} certificate`);
    for (const id of row.sourceDocumentIds ?? []) linkUse(id, `${place} source`, "info");
  }
  return documents
    .filter((document) => !document.archivedAtISO)
    .filter((document) => PACKAGE_CATEGORIES.has(document.category ?? "") || uses.has(document._id)
      || (LINKED_CATEGORIES.has(document.category ?? "") && (document.tags ?? []).includes(REGISTRY_IMPORT_TAG)))
    .sort((a, b) => String(a.createdAtISO ?? "").localeCompare(String(b.createdAtISO ?? "")))
    .map((document) => ({ document, ...(uses.get(document._id) ?? { status: "On file", tone: "neutral" as const }) }));
}

export function RegistryPackageCard({ society, detail, documents, canEdit, onImport }: {
  society: OrganizationRecord;
  detail: OrganizationDetail | undefined;
  documents: readonly ProfileDocument[] | undefined;
  canEdit: boolean;
  onImport: () => void;
}) {
  const rows = documents ? registryPackageRows(society, detail, documents) : undefined;
  return (
    <section className="card" id="registry-package" aria-labelledby="org-registry-package">
      <div className="card__head">
        <h2 className="card__title" id="org-registry-package">Registry package</h2>
        {canEdit && (
          <button className="btn btn--sm org-profile-card-link" type="button" onClick={onImport}>
            <FileUp size={12} /> Import from registry documents
          </button>
        )}
      </div>
      <div className="card__body">
        {rows === undefined ? <p className="muted org-profile-empty">Loading documents…</p>
          : rows.length === 0 ? (
            <p className="muted org-profile-empty">
              No registry documents yet. Import the certificate package, information sheet, BC registration and the registry emails to fill the profile from them.
            </p>
          ) : (
            <div className="table-wrap society-doc-table-wrap">
              <table className="table society-doc-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ document, status, tone }) => (
                    <tr className="gov-doc-row org-package-row" key={document._id}>
                      <td>
                        <Link to={`/app/documents/${document._id}`}><strong>{document.title?.trim() || document.fileName || "Untitled document"}</strong></Link>
                        <div className="muted org-profile-doc-meta">
                          {[document.category ? documentCategoryLabel(document.category) : "", document.createdAtISO ? `Added ${formatDate(document.createdAtISO.slice(0, 10))}` : ""].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td><Badge tone={tone}>{status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className="muted org-profile-card-note">Every director can open these documents, so the information sheet and the ISC filing are best kept elsewhere.</p>
      </div>
    </section>
  );
}
