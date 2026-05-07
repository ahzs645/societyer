import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Globe, Plus, Save, Trash2, Copy } from "lucide-react";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

const PUBLICATION_PRESETS = [
  { category: "AnnualReport", title: "Annual report", summary: "Publish the filed annual report package or registry confirmation." },
  { category: "FinancialSummary", title: "Financial summary", summary: "Publish approved financial statements, reviewer notes, or a plain-language annual summary." },
  { category: "Policy", title: "Public policy", summary: "Publish privacy, conflict, records inspection, code of conduct, or grant policies." },
  { category: "Notice", title: "AGM notice", summary: "Publish an AGM notice, member inspection instructions, or other public notice." },
  { category: "Grant", title: "Grant disclosure", summary: "Publish grant recipients, funding priorities, eligibility rules, or application instructions." },
];

/**
 * Public transparency page. The top card keeps the existing public-
 * settings summary + edit flow; the publications list is now a
 * metadata-driven record table. Inline edits route to
 * `upsertPublication` which already handles the publish-guardrails
 * (status=Published requires reviewStatus=Approved).
 */
export function TransparencyPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const documents = useQuery(
    api.documents.list,
    society ? { societyId: society._id } : "skip",
  );
  const publications = useQuery(
    api.transparency.listPublications,
    society ? { societyId: society._id } : "skip",
  );
  const upsertSociety = useMutation(api.society.upsert);
  const upsertPublication = useMutation(api.transparency.upsertPublication);
  const removePublication = useMutation(api.transparency.removePublication);
  const toast = useToast();
  const confirm = useConfirm();
  const publicHref = useMemo(
    () => (society?.publicSlug ? `/public/${society.publicSlug}` : "/public"),
    [society?.publicSlug],
  );
  const [settingsDraft, setSettingsDraft] = useState<any | null>(null);
  const [publicationDraft, setPublicationDraft] = useState<any | null>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "publication",
    viewId: currentViewId,
  });

  const absolutePublicHref = useMemo(() => {
    if (typeof window === "undefined") return publicHref;
    return `${window.location.origin}${publicHref}`;
  }, [publicHref]);
  const publishedCount = (publications ?? []).filter((row: any) => row.status === "Published").length;
  const draftCount = (publications ?? []).filter((row: any) => row.status === "Draft").length;

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const records = (publications ?? []) as any[];
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const publicPageLive = Boolean(society.publicTransparencyEnabled && society.publicSlug);
  const builderChecks = [
    { label: "Public URL", complete: Boolean(society.publicSlug), detail: society.publicSlug ? publicHref : "Add a slug" },
    { label: "Page enabled", complete: Boolean(society.publicTransparencyEnabled), detail: society.publicTransparencyEnabled ? "Live when published" : "Draft only" },
    { label: "Contact", complete: Boolean(society.publicContactEmail), detail: society.publicContactEmail ?? "Add a public email" },
    { label: "Directors", complete: Boolean(society.publicShowBoard), detail: society.publicShowBoard ? "Board roster visible" : "Hidden" },
    { label: "Published records", complete: publishedCount > 0, detail: `${publishedCount} published` },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Public transparency"
        icon={<Globe size={16} />}
        iconColor="blue"
        subtitle="Publish board info, bylaws, annual reports, AGM materials, and contact details without exposing the private workspace."
        actions={
          <>
            {publicPageLive ? (
              <>
                <Link className="btn-action" to={publicHref} target="_blank" rel="noreferrer">
                  <Globe size={12} /> View public page
                </Link>
                <button
                  className="btn-action"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(absolutePublicHref);
                      toast.success("Public link copied");
                    } catch {
                      toast.error("Could not copy the link in this browser");
                    }
                  }}
                >
                  <Copy size={12} /> Copy link
                </button>
              </>
            ) : (
              <button className="btn-action" type="button" disabled title="Enable the public page before sharing this link.">
                <Globe size={12} /> Public page disabled
              </button>
            )}
            <button
              className="btn-action"
              onClick={() => setSettingsDraft({
                id: society._id,
                name: society.name,
                incorporationNumber: society.incorporationNumber,
                incorporationDate: society.incorporationDate,
                fiscalYearEnd: society.fiscalYearEnd,
                isCharity: society.isCharity,
                isMemberFunded: society.isMemberFunded,
                registeredOfficeAddress: society.registeredOfficeAddress,
                mailingAddress: society.mailingAddress,
                purposes: society.purposes,
                privacyOfficerName: society.privacyOfficerName,
                privacyOfficerEmail: society.privacyOfficerEmail,
                boardCadence: society.boardCadence,
                boardCadenceDayOfWeek: society.boardCadenceDayOfWeek,
                boardCadenceTime: society.boardCadenceTime,
                boardCadenceNotes: society.boardCadenceNotes,
                publicSlug: society.publicSlug ?? society.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                publicSummary: society.publicSummary ?? society.purposes ?? "",
                publicContactEmail: society.publicContactEmail ?? society.privacyOfficerEmail ?? "",
                publicTransparencyEnabled: society.publicTransparencyEnabled ?? true,
                publicShowBoard: society.publicShowBoard ?? true,
                publicShowBylaws: society.publicShowBylaws ?? true,
                publicShowFinancials: society.publicShowFinancials ?? true,
                publicVolunteerIntakeEnabled: society.publicVolunteerIntakeEnabled ?? false,
                publicGrantIntakeEnabled: society.publicGrantIntakeEnabled ?? false,
                demoMode: society.demoMode,
              })}
            >
              <Save size={12} /> Edit settings
            </button>
            <button
              className="btn-action btn-action--primary"
              onClick={() =>
                setPublicationDraft({
                  societyId: society._id,
                  title: "",
                  summary: "",
                  category: "AnnualReport",
                  documentId: "",
                  url: "",
                  status: "Draft",
                  reviewStatus: "Draft",
                  publishedAtISO: "",
                })
              }
            >
              <Plus size={12} /> New draft
            </button>
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Current public settings</h2>
          <span className="card__subtitle">{publicHref}</span>
        </div>
        <div className="card__body">
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <Badge tone={society.publicTransparencyEnabled ? "success" : "warn"}>{society.publicTransparencyEnabled ? "Public page enabled" : "Draft only"}</Badge>
            <Badge>{society.publicSlug ?? "no slug set"}</Badge>
            <Badge tone={society.publicShowBoard ? "success" : "warn"}>{society.publicShowBoard ? "Board visible" : "Board hidden"}</Badge>
            <Badge tone={society.publicShowBylaws ? "success" : "warn"}>{society.publicShowBylaws ? "Bylaws visible" : "Bylaws hidden"}</Badge>
            <Badge tone={society.publicShowFinancials ? "success" : "warn"}>{society.publicShowFinancials ? "Financials visible" : "Financials hidden"}</Badge>
            <Badge tone={society.publicVolunteerIntakeEnabled ? "success" : "warn"}>{society.publicVolunteerIntakeEnabled ? "Volunteer intake on" : "Volunteer intake off"}</Badge>
            <Badge tone={society.publicGrantIntakeEnabled ? "success" : "warn"}>{society.publicGrantIntakeEnabled ? "Grant intake on" : "Grant intake off"}</Badge>
          </div>
          <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
            {society.publicSummary ?? "No public summary yet."}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <span className="muted mono">{absolutePublicHref}</span>
            <span className="muted">·</span>
            <span>{publishedCount} published</span>
            <span className="muted">·</span>
            <span>{draftCount} draft</span>
          </div>
        </div>
      </div>

      <div className="transparency-builder">
        <div className="transparency-builder__panel">
          <div className="card__head">
            <h2 className="card__title">Public transparency builder</h2>
            <span className="card__subtitle">Choose what the public page should disclose, then publish only reviewed records.</span>
          </div>
          <div className="transparency-builder__checks">
            {builderChecks.map((check) => (
              <div className={`transparency-builder__check${check.complete ? " is-complete" : ""}`} key={check.label}>
                <span>{check.complete ? "Ready" : "Needed"}</span>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="transparency-builder__panel">
          <div className="card__head">
            <h2 className="card__title">Disclosure presets</h2>
            <span className="card__subtitle">Directors are controlled by settings; documents publish as reviewed records.</span>
          </div>
          <div className="transparency-builder__presets">
            {PUBLICATION_PRESETS.map((preset) => (
              <button
                type="button"
                className="transparency-builder__preset"
                key={preset.category}
                onClick={() =>
                  setPublicationDraft({
                    societyId: society._id,
                    title: preset.title,
                    summary: preset.summary,
                    category: preset.category,
                    documentId: "",
                    url: "",
                    status: "Draft",
                    reviewStatus: "Draft",
                    publishedAtISO: "",
                  })
                }
              >
                <strong>{preset.title}</strong>
                <span>{preset.summary}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="publication" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="publications"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onUpdate={async ({ recordId, fieldName, value }) => {
            // Route everything back through upsertPublication so the
            // publish-guardrails stay intact. We copy the existing row
            // from the local `publications` list and override just the
            // edited field, since upsertPublication wants the full set
            // of values.
            const existing = (publications ?? []).find(
              (row: any) => row._id === recordId,
            ) as any;
            if (!existing) return;
            const merged = {
              ...existing,
              [fieldName]: value,
            };
            if (merged.status === "Published") {
              merged.reviewStatus = "Approved";
              merged.approvedByUserId = merged.approvedByUserId ?? actingUserId;
              merged.approvedAtISO = merged.approvedAtISO ?? new Date().toISOString();
              merged.publishedAtISO = merged.publishedAtISO || new Date().toISOString().slice(0, 10);
            }
            await upsertPublication({
              id: recordId as Id<"publications">,
              societyId: society._id,
              title: merged.title,
              summary: merged.summary || undefined,
              category: merged.category,
              documentId: merged.documentId || undefined,
              url: merged.url || undefined,
              publishedAtISO: merged.publishedAtISO || undefined,
              status: merged.status,
              reviewStatus: merged.reviewStatus,
              approvedByUserId: merged.approvedByUserId,
              approvedAtISO: merged.approvedAtISO,
              featured: merged.featured,
              actingUserId,
            });
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Globe size={14} />}
            label="Published items"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || publications === undefined}
            renderRowActions={(row) => (
              <>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() =>
                    setPublicationDraft({
                      ...row,
                      id: row._id,
                      documentId: row.documentId ?? "",
                      url: row.url ?? "",
                      summary: row.summary ?? "",
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Delete publication ${row.title}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Remove publication",
                      message: `"${row.title}" will be removed from the internal publication list and the public page if it is live.`,
                      confirmLabel: "Remove",
                      tone: "danger",
                    });
                    if (!ok) return;
                    await removePublication({ id: row._id, actingUserId });
                    toast.success("Publication removed");
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

      <Drawer
        open={!!settingsDraft}
        onClose={() => setSettingsDraft(null)}
        title="Public transparency settings"
        footer={
          <>
            <button className="btn" onClick={() => setSettingsDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                await upsertSociety({
                  ...settingsDraft,
                  publicSlug: normalizePublicSlug(settingsDraft.publicSlug) || undefined,
                  publicSummary: settingsDraft.publicSummary || undefined,
                  publicContactEmail: settingsDraft.publicContactEmail || undefined,
                });
                toast.success("Public settings saved");
                setSettingsDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {settingsDraft && (
          <div>
            <Field label="Public slug"><input className="input" value={settingsDraft.publicSlug ?? ""} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicSlug: e.target.value })} /></Field>
            <Field label="Public summary"><textarea className="textarea" rows={6} value={settingsDraft.publicSummary ?? ""} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicSummary: e.target.value })} /></Field>
            <Field label="Public contact email"><input className="input" value={settingsDraft.publicContactEmail ?? ""} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicContactEmail: e.target.value })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={settingsDraft.publicTransparencyEnabled} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicTransparencyEnabled: e.target.checked })} /> Enable public page</label>
            <label className="checkbox"><input type="checkbox" checked={settingsDraft.publicShowBoard} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicShowBoard: e.target.checked })} /> Show board roster</label>
            <label className="checkbox"><input type="checkbox" checked={settingsDraft.publicShowBylaws} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicShowBylaws: e.target.checked })} /> Show bylaws and governance records</label>
            <label className="checkbox"><input type="checkbox" checked={settingsDraft.publicShowFinancials} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicShowFinancials: e.target.checked })} /> Show financial publications</label>
            <label className="checkbox"><input type="checkbox" checked={settingsDraft.publicVolunteerIntakeEnabled} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicVolunteerIntakeEnabled: e.target.checked })} /> Allow public volunteer applications</label>
            <label className="checkbox"><input type="checkbox" checked={settingsDraft.publicGrantIntakeEnabled} onChange={(e) => setSettingsDraft({ ...settingsDraft, publicGrantIntakeEnabled: e.target.checked })} /> Allow public grant applications</label>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!publicationDraft}
        onClose={() => setPublicationDraft(null)}
        title={publicationDraft?.id ? "Edit publication" : "Publish item"}
        footer={
          <>
            <button className="btn" onClick={() => setPublicationDraft(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              onClick={async () => {
                if (publicationDraft.status === "Published") {
                  if (!publicationDraft.title?.trim()) {
                    toast.error("Add a title before publishing");
                    return;
                  }
                  if (!publicationDraft.documentId && !publicationDraft.url) {
                    toast.error("Attach a document or public URL before publishing");
                    return;
                  }
                  const ok = await confirm({
                    title: "Publish this item?",
                    message: `This will make "${publicationDraft.title}" visible on the public transparency page. Review the title, category, date, and attached evidence before continuing.`,
                    confirmLabel: "Publish",
                  });
                  if (!ok) return;
                }
                await upsertPublication({
                  ...publicationDraft,
                  societyId: society._id,
                  summary: publicationDraft.summary || undefined,
                  documentId: publicationDraft.documentId || undefined,
                  url: publicationDraft.url || undefined,
                  publishedAtISO:
                    publicationDraft.status === "Published"
                      ? publicationDraft.publishedAtISO || new Date().toISOString().slice(0, 10)
                      : publicationDraft.publishedAtISO || undefined,
                  reviewStatus:
                    publicationDraft.status === "Published"
                      ? "Approved"
                      : publicationDraft.reviewStatus || "Draft",
                  approvedByUserId: publicationDraft.status === "Published" ? actingUserId : undefined,
                  approvedAtISO: publicationDraft.status === "Published" ? new Date().toISOString() : undefined,
                  actingUserId,
                });
                toast.success("Publication saved");
                setPublicationDraft(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {publicationDraft && (
          <div>
            <Field label="Title"><input className="input" value={publicationDraft.title} onChange={(e) => setPublicationDraft({ ...publicationDraft, title: e.target.value })} /></Field>
            <Field label="Category">
              <select className="input" value={publicationDraft.category} onChange={(e) => setPublicationDraft({ ...publicationDraft, category: e.target.value })}>
                <option>AnnualReport</option>
                <option>Bylaws</option>
                <option>AGM</option>
                <option>FinancialSummary</option>
                <option>Grant</option>
                <option>InspectionInstructions</option>
                <option>Policy</option>
                <option>Notice</option>
                <option>Resource</option>
                <option>Custom</option>
              </select>
            </Field>
            <Field label="Document">
              <select className="input" value={publicationDraft.documentId ?? ""} onChange={(e) => setPublicationDraft({ ...publicationDraft, documentId: e.target.value })}>
                <option value="">None</option>
                {(documents ?? []).map((document) => <option key={document._id} value={document._id}>{document.title}</option>)}
              </select>
            </Field>
            <Field label="External URL"><input className="input" value={publicationDraft.url ?? ""} onChange={(e) => setPublicationDraft({ ...publicationDraft, url: e.target.value })} /></Field>
            <Field label="Published on"><input className="input" type="date" value={publicationDraft.publishedAtISO ?? ""} onChange={(e) => setPublicationDraft({ ...publicationDraft, publishedAtISO: e.target.value })} /></Field>
            <Field label="Status">
              <select className="input" value={publicationDraft.status} onChange={(e) => setPublicationDraft({ ...publicationDraft, status: e.target.value })}>
                <option>Draft</option>
                <option>Published</option>
                <option>Archived</option>
              </select>
            </Field>
            <Field label="Summary"><textarea className="textarea" rows={5} value={publicationDraft.summary ?? ""} onChange={(e) => setPublicationDraft({ ...publicationDraft, summary: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function normalizePublicSlug(value?: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
