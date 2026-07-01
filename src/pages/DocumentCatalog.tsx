import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { FileText } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, RelatedDocumentViews, SeedPrompt } from "./_helpers";

/** Recover the packet key from a seeded template's marker (societyer:<kind>-packet-template:<key>). */
function packetKeyOf(t: { sourceExternalIds?: string[]; notes?: string }): string | null {
  const marker = (t.sourceExternalIds ?? []).find((m) => m.includes("-packet-template:"));
  if (marker) return marker.split(":").pop() ?? null;
  const m = (t.notes ?? "").match(/Packet key:\s*([^\s\n]+)/);
  return m ? m[1] : null;
}

/**
 * Document catalog — the read-only list of documents the current entity can
 * generate, sourced from its seeded legalTemplates/precedents. Entities
 * auto-seed their packet catalog on creation, so both societies and
 * corporations have their own catalog here. This page is a catalog *viewer*:
 * it never generates documents or mutates anything (generation is a separate
 * corp-specific flow).
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
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const onGenerate = async (t: CatalogTemplate) => {
    const key = packetKeyOf(t);
    if (!key || !society) return;
    setBusyKey(t._id);
    try {
      await generate({ societyId: society._id, packetKey: key, effectiveDate: new Date().toISOString().slice(0, 10) });
      setDoneKey(t._id);
      setTimeout(() => setDoneKey(null), 4000);
    } finally {
      setBusyKey(null);
    }
  };

  const templates = data?.templates;
  const precedents = data?.precedents ?? [];

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
        subtitle="The documents available to generate for this entity — its seeded template and precedent catalog. Read-only viewer."
      />

      <RelatedDocumentViews current="/app/document-catalog" />

      {templates === undefined ? (
        <div className="card">
          <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--text-tertiary)" }}>
            No document catalog seeded yet for this entity.
          </p>
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
                              Generated ✓ — see Documents
                            </span>
                          ) : (
                            <button
                              className="btn btn--accent"
                              disabled={busyKey === t._id || !packetKeyOf(t)}
                              onClick={() => onGenerate(t)}
                              title={packetKeyOf(t) ? "Generate a draft document" : "No packet key on this template"}
                            >
                              {busyKey === t._id ? "Generating…" : "Generate"}
                            </button>
                          )}
                        </span>
                      </div>
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
