import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { Globe, Plus, Save, Trash2, Copy } from "lucide-react";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { formatDate } from "../lib/format";

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
  const absolutePublicHref = useMemo(() => {
    if (typeof window === "undefined") return publicHref;
    return `${window.location.origin}${publicHref}`;
  }, [publicHref]);
  const publishedCount = (publications ?? []).filter((row: any) => row.status === "Published").length;
  const draftCount = (publications ?? []).filter((row: any) => row.status === "Draft").length;

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Public transparency"
        icon={<Globe size={16} />}
        iconColor="blue"
        subtitle="Publish board info, bylaws, annual reports, AGM materials, and contact details without exposing the private workspace."
        actions={
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

      <DataTable
        label="Published items"
        icon={<Globe size={14} />}
        data={(publications ?? []) as any[]}
        rowKey={(row) => String(row._id)}
        searchPlaceholder="Search publications…"
        defaultSort={{ columnId: "publishedAtISO", dir: "desc" }}
        columns={[
          { id: "title", header: "Title", sortable: true, accessor: (row) => row.title, render: (row) => <strong>{row.title}</strong> },
          { id: "category", header: "Category", sortable: true, accessor: (row) => row.category, render: (row) => <Badge>{row.category}</Badge> },
          { id: "status", header: "Status", sortable: true, accessor: (row) => row.status, render: (row) => <Badge tone={row.status === "Published" ? "success" : row.status === "Archived" ? "danger" : "warn"}>{row.status}</Badge> },
          { id: "publishedAtISO", header: "Published", sortable: true, accessor: (row) => row.publishedAtISO ?? "", render: (row) => <span className="mono">{row.publishedAtISO ? formatDate(row.publishedAtISO) : "—"}</span> },
          { id: "summary", header: "Summary", accessor: (row) => row.summary ?? "", render: (row) => <span className="muted">{row.summary ?? "—"}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setPublicationDraft({ ...row, id: row._id, documentId: row.documentId ?? "", url: row.url ?? "", summary: row.summary ?? "" })}>
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
                  publicSlug: settingsDraft.publicSlug || undefined,
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
