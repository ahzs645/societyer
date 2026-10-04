import { CORPORATION_DOCUMENT_PACKETS } from "../../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../../shared/societyDocumentPackets";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isSociety } from "../../shared/organizationDomain";
import { entityPreparationDecision } from "../../shared/entitySetup";
import { Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, RelatedDocumentViews, SeedPrompt } from "./_helpers";
import { IncorporationPreparation } from "../components/IncorporationPreparation";
import { incorporationPreparationForOrganization } from "../../shared/incorporationPreparation";
import { incorporationWorksheetText, incorporationWorksheetFileName } from "../../shared/incorporationWorksheet";
import { isCorporation } from "../../shared/organizationDomain";
import { triggerBlobDownload } from "../lib/zip";

/** Recover the packet key from a seeded template's marker (societyer:<kind>-packet-template:<key>). */
function packetKeyOf(t: { sourceExternalIds?: string[]; notes?: string }): string | null {
  const marker = (t.sourceExternalIds ?? []).find((m) => m.includes("-packet-template:"));
  if (marker) return marker.split(":").pop() ?? null;
  const m = (t.notes ?? "").match(/Packet key:\s*([^\s\n]+)/);
  return m ? m[1] : null;
}

/**
 * Document catalog — the list of draft documents the current entity can
 * generate, sourced from its seeded legalTemplates/precedents. Entities
 * auto-seed their packet catalog on creation, so both societies and
 * corporations have their own catalog here. Templates prepare editable drafts; the authoritative registry originals and
 * evidence stages are tracked separately.
 */

type CatalogTemplate = {
  _id: string;
  name: string;
  documentTag: string;
  signatureRequired: boolean;
  requiredSigners: string[];
  requiredDataFields: string[];
  optionalDataFields?: string[];
  reviewDataFields?: string[];
  timeline?: string;
  deliverable?: string;
  terms?: string;
  notes?: string;
  sourceExternalIds?: string[];
  jurisdictions?: string[];
  entityTypes?: string[];
};

type CatalogPrecedent = {
  _id: string;
  packageName: string;
  partType?: string;
  shortDescription?: string;
  timeline?: string;
  templateNames: string[];
};

type CatalogData = {
  templates: CatalogTemplate[];
  precedents: CatalogPrecedent[];
};

/** Turn a snake/kebab/lower tag like "board_resolution" into "Board resolution". */
function humanizeTag(tag: string): string {
  const cleaned = String(tag || "other").replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Other";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** First non-empty line of a template's summary/notes, for a one-line description. */
function firstLine(notes?: string): string | null {
  if (!notes) return null;
  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function DocumentCatalogPage() {
  const society = useSociety();
  const data = useQuery(
    api.legalOperations.templateEngine,
    society ? { societyId: society._id } : "skip",
  ) as CatalogData | undefined;
  const generate = useMutation(api.legalOperations.generateDocumentFromCatalog);
  const seedCatalog = useMutation(api.legalOperations.seedDocumentPacketsForEntity);
  const permissions = usePermissions();
  const toast = useToast();
  const [seeding, setSeeding] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const preparation = entityPreparationDecision(society);

  const onSeedCatalog = async () => {
    if (seeding || !preparation.allowed || !permissions.can("documents:write")) return;
    setSeeding(true);
    try {
      await seedCatalog({ societyId: society._id });
      toast.success("Document catalog initialized");
    } catch (error: any) {
      toast.error("Could not initialize document catalog", error?.message ?? String(error));
    } finally {
      setSeeding(false);
    }
  };

  const onGenerate = async (t: CatalogTemplate) => {
    const key = packetKeyOf(t);
    if (!key || !society) return;
    setBusyKey(t._id);
    setGenerationError(null);
    try {
      await generate({ societyId: society._id, packetKey: key, effectiveDate: new Date().toISOString().slice(0, 10) });
      setDoneKey(t._id);
      setTimeout(() => setDoneKey(null), 4000);
    } catch (error: any) {
      toast.error("Could not prepare draft", error?.message ?? String(error));
      setGenerationError(error instanceof Error ? error.message : "The draft could not be generated.");
    } finally {
      setBusyKey(null);
    }
  };

  const templates = data?.templates;
  const precedents = data?.precedents ?? [];
  const preparationGuide = incorporationPreparationForOrganization(society);
  const packetApplies = (template: CatalogTemplate) => {
    const key = packetKeyOf(template);
    return Boolean(key) && isCorporation(society) !== Boolean(key?.startsWith("society-"));
  };

  // Group templates by documentTag, preserving the query's alphabetical order
  // within each group.
  const groups = new Map<string, CatalogTemplate[]>();
  for (const t of templates ?? []) {
    const tag = t.documentTag || "other";
    const list = groups.get(tag);
    if (list) list.push(t);
    else groups.set(tag, [t]);
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) =>
    humanizeTag(a[0]).localeCompare(humanizeTag(b[0])),
  );

  return (
    <div className="page">
      <PageHeader
        title="Document catalog"
        icon={<FileText size={16} />}
        iconColor="blue"
        subtitle="Prepare editable drafts from this entity’s template and precedent catalog."
      />

      <RelatedDocumentViews current="/app/document-catalog" />
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <Badge tone={preparation.allowed ? "info" : "warn"}>{preparation.allowed ? "Draft preparation" : "Route review required"}</Badge>
        <p style={{ margin: "8px 0" }}>{preparation.message}</p>
        <p className="muted" style={{ margin: 0 }}>These are application-authored working drafts. A signature, filing receipt and certified registry document are separate evidence stages. Official government forms and model layouts remain linked originals unless their reuse rights are confirmed.</p>
        <Link to="/app/post-incorporation">Track preparation and evidence</Link>{" · "}<Link to="/app/research-library">Research and source review</Link>
      </div>

      <IncorporationPreparation organization={society} />
      {preparationGuide && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Incorporation preparation worksheet</h3>
          <p>Download an editable text worksheet for the selected legal track, with information to gather and links to official sources. Complete the incorporation application in the official registry service.</p>
          <button className="btn" onClick={() => triggerBlobDownload(
            new Blob([incorporationWorksheetText(preparationGuide, society)], { type: "text/plain;charset=utf-8" }),
            incorporationWorksheetFileName(preparationGuide, society),
          )}>Download preparation worksheet</button>
        </div>
      )}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Internal document drafts</h3>
        <p>These templates prepare governance records and working drafts. They do not file an incorporation application or supply a complete set of incorporation articles, bylaws, or an incorporation agreement.</p>
        {preparationGuide?.id === "bc_company" && <p>Corporate packets are generic drafts. Review them against your BC company's articles and the Business Corporations Act before use.</p>}
      </div>
      {generationError && <p role="alert">{generationError}</p>}

      {templates === undefined ? (
        <div className="card">
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--text-tertiary)" }}>
            No document catalog seeded yet for this entity. This catalog is a structured,
            generate-ready view of templates and precedents — it doesn't hold the entity's
            actual documents. Those already exist and can be viewed on{" "}
            <Link to="/app/documents">Documents</Link>.
          </p>
          {preparation.allowed && permissions.loaded && permissions.can("documents:write") && (
            <button className="btn" disabled={seeding} onClick={onSeedCatalog}>
              {seeding ? "Initializing…" : "Initialize document catalog"}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groupEntries.map(([tag, items]) => (
            <div className="card" key={tag}>
              <h3 style={{ margin: "0 0 12px" }}>
                {humanizeTag(tag)}{" "}
                <span style={{ color: "var(--text-tertiary)" }}>({items.length})</span>
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {items.map((t) => {
                  const desc = firstLine(t.notes);
                  const key = packetKeyOf(t);
                  const packet = [...CORPORATION_DOCUMENT_PACKETS, ...SOCIETY_DOCUMENT_PACKETS].find((candidate) => candidate.key === key);
                  const compatibleJurisdiction = !packet || packet.jurisdictions.some((code) => canonicalizeJurisdictionCode(code) === canonicalizeJurisdictionCode(homeJurisdictionCode(society)));
                  const compatibleEntity = !packet || (key?.startsWith("society-") ? isSociety(society) : !isSociety(society));
                  const canPrepare = preparation.allowed && compatibleJurisdiction && compatibleEntity;
                  return (
                    <div
                      key={t._id}
                      style={{
                        borderTop: "1px solid var(--border)",
                        paddingTop: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <strong>{t.name}</strong>
                        <span
                          style={{
                            fontSize: 12,
                            color: t.signatureRequired
                              ? "var(--orange-11)"
                              : "var(--text-tertiary)",
                          }}
                        >
                          {t.signatureRequired
                            ? "Signature required"
                            : "No signature required"}
                        </span>
                        <span style={{ marginLeft: "auto" }}>
                          {doneKey === t._id ? (
                            <span style={{ color: "var(--green-11)", fontSize: 13 }}>
                              Draft staged ✓ — <Link to="/app/template-engine">Open Template Engine</Link>
                            </span>
                          ) : (
                            <button
                              className="btn btn--accent"
                              disabled={busyKey === t._id || !permissions.loaded || !permissions.can("documents:write") || !packetKeyOf(t) || !canPrepare || !packetApplies(t)}
                              onClick={() => onGenerate(t)}
                              title={!permissions.can("documents:write") ? "Document editing permission is required" : !preparation.allowed ? preparation.message : !compatibleJurisdiction || !compatibleEntity ? "Choose a template for this entity and home jurisdiction" : packetKeyOf(t) ? "Prepare an editable draft" : "No packet key on this template"}
                            >
                              {busyKey === t._id ? "Preparing…" : "Prepare draft"}
                            </button>
                          )}
                        </span>
                      </div>
                      {packet?.preparationOnly && <p className="muted" style={{ margin: "6px 0" }}>Original preparation worksheet — unresolved drafting prompts require tailored legal review before execution or registry submission.</p>}
                      {!compatibleJurisdiction && <Badge tone="warn">Different home jurisdiction</Badge>}
                      {!compatibleEntity && <Badge tone="warn">Different entity type</Badge>}
                      {packet?.sourceUrls && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>{packet.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Official source {index + 1}</a>)}</div>}
                      {desc && (
                        <p
                          style={{
                            margin: "6px 0 0",
                            color: "var(--text-secondary)",
                            fontSize: 13,
                          }}
                        >
                          {desc}
                        </p>
                      )}
                      {t.terms && <p style={{ marginTop: 8, fontSize: 12, color: "var(--text-tertiary)" }}>Before use: {t.terms}</p>}
                      {t.requiredDataFields.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-tertiary)",
                              marginBottom: 4,
                            }}
                          >
                            Required data fields
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {t.requiredDataFields.map((field) => (
                              <span
                                key={field}
                                style={{
                                  fontSize: 12,
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  background: "var(--bg-subtle)",
                                  border: "1px solid var(--border)",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {field}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.requiredSigners.length > 0 && (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 12,
                            color: "var(--text-tertiary)",
                          }}
                        >
                          Required signers: {t.requiredSigners.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {precedents.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>
            Packages &amp; precedents{" "}
            <span style={{ color: "var(--text-tertiary)" }}>({precedents.length})</span>
          </h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {precedents.map((p) => (
              <li key={p._id} style={{ marginBottom: 6 }}>
                <strong>{p.packageName}</strong>
                {p.shortDescription && (
                  <span style={{ color: "var(--text-secondary)" }}>
                    {" "}
                    — {p.shortDescription}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default DocumentCatalogPage;
