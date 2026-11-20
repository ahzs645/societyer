import { CORPORATION_DOCUMENT_PACKETS } from "../../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../../shared/societyDocumentPackets";
import { canonicalizeJurisdictionCode, homeJurisdictionCode, isSociety } from "../../shared/organizationDomain";
import { entityPreparationDecision } from "../../shared/entitySetup";
import { Badge, Banner, Field, Pill, SkeletonRows } from "../components/ui";
import { Select } from "../components/Select";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { useToast } from "../components/Toast";
import { useState } from "react";
import { useConvex, useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { FileText } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { setupViewStepLink } from "../lib/organizationSetupLinks";
import { incorporationPreparationForOrganization } from "../../shared/incorporationPreparation";
import { incorporationWorksheetText, incorporationWorksheetFileName } from "../../shared/incorporationWorksheet";
import { isCorporation } from "../../shared/organizationDomain";
import { triggerBlobDownload } from "../lib/zip";
import { todayDateOnly } from "../../shared/dateOnly";
import { humanizeKey } from "../../shared/documentProvenance";
import { pathwayForPacket } from "../../shared/pathways/registry";
import { MinuteBookReportsCard } from "../components/MinuteBookReportsCard";
import { isReportPacketKey } from "../../shared/corporationReportPackets";
import { nameApprovalPacketView } from "../../shared/nameRequests";
import { formatLongDate } from "../../shared/locale";

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
  /** Dates on which each transaction-scoped packet has a recorded transaction (newest first). */
  packetEventDates?: Record<string, string[]>;
};

const ALL_PACKETS = [...CORPORATION_DOCUMENT_PACKETS, ...SOCIETY_DOCUMENT_PACKETS];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
  const convex = useConvex();
  const generate = useMutation(api.legalOperations.generateDocumentFromCatalog);
  const seedCatalog = useMutation(api.legalOperations.seedDocumentPacketsForEntity);
  const permissions = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();
  const [seeding, setSeeding] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [eventDateByKey, setEventDateByKey] = useState<Record<string, string>>({});

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const preparation = entityPreparationDecision(society);
  const canWrite = permissions.loaded && permissions.can("documents:write");
  const allowedPacketKeys = new Set(ALL_PACKETS.filter((packet) => {
    try {
      pathwayForPacket(society, packet);
      return true;
    } catch {
      return false;
    }
  }).map((packet) => packet.key));

  const onSeedCatalog = async () => {
    if (seeding || !allowedPacketKeys.size || !canWrite) return;
    setSeeding(true);
    try {
      await seedCatalog({ societyId: society._id });
      toast.success("Document catalog initialized");
    } catch (error) {
      toast.error("Could not initialize document catalog", errorMessage(error));
    } finally {
      setSeeding(false);
    }
  };

  // The worksheet names the approved name the way the federal articles packet does, when a request is approved.
  const downloadWorksheet = async (guide: NonNullable<ReturnType<typeof incorporationPreparationForOrganization>>) => {
    let nameSearches: Parameters<typeof nameApprovalPacketView>[0] = [];
    try {
      const formation = (await convex.query(api.legalOperations.formationMaintenance, { societyId: society._id })) as { nameSearches?: typeof nameSearches } | null;
      nameSearches = formation?.nameSearches ?? [];
    } catch {
      // Without the name requests the worksheet falls back to the workspace name.
    }
    const nameApproval = nameApprovalPacketView(nameSearches, society.name, (day) => formatLongDate(day));
    triggerBlobDownload(
      new Blob([incorporationWorksheetText(guide, society, { nameApproval })], { type: "text/plain;charset=utf-8" }),
      incorporationWorksheetFileName(guide, society),
    );
  };

  // A transaction-scoped packet renders only the transaction of its date, so
  // offer the dates on which that kind of transaction is recorded.
  const eventDatesFor = (key: string | null) => (key ? data?.packetEventDates?.[key] ?? [] : []);
  const selectedEventDate = (key: string | null) => {
    const dates = eventDatesFor(key);
    if (!key || !dates.length) return todayDateOnly();
    const chosen = eventDateByKey[key];
    return chosen && dates.includes(chosen) ? chosen : dates[0];
  };

  const onGenerate = async (t: CatalogTemplate) => {
    const key = packetKeyOf(t);
    if (!key || !society) return;
    setBusyKey(t._id);
    setGenerationError(null);
    try {
      await generate({ societyId: society._id, packetKey: key, effectiveDate: selectedEventDate(key) });
      setDoneKey(t._id);
      setTimeout(() => setDoneKey(null), 4000);
    } catch (error) {
      toast.error("Could not prepare draft", errorMessage(error));
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
    // Report-style outputs are generated from the "Minute book reports" card,
    // which asks for the as-of date.
    if (isReportPacketKey(packetKeyOf(t))) continue;
    const tag = t.documentTag || "other";
    const list = groups.get(tag);
    if (list) list.push(t);
    else groups.set(tag, [t]);
  }
  const groupEntries = Array.from(groups.entries()).sort((a, b) =>
    humanizeTag(a[0]).localeCompare(humanizeTag(b[0])),
  );

  const prepareTitle = (t: CatalogTemplate, canPrepare: boolean) => {
    if (!permissions.can("documents:write")) return "Document editing permission is required";
    if (!canPrepare) return preparation.message;
    return packetKeyOf(t) ? "Prepare an editable draft" : "No packet key on this template";
  };

  const renderTemplate = (t: CatalogTemplate) => {
    const key = packetKeyOf(t);
    const packet = ALL_PACKETS.find((candidate) => candidate.key === key);
    const home = canonicalizeJurisdictionCode(homeJurisdictionCode(society));
    const allowed = Boolean(key && allowedPacketKeys.has(key));
    return (
      <CatalogTemplateItem
        key={t._id}
        template={t}
        packet={packet}
        compatibleJurisdiction={!packet || packet.jurisdictions.some((code) => canonicalizeJurisdictionCode(code) === home)}
        compatibleEntity={!packet || (key?.startsWith("society-") ? isSociety(society) : !isSociety(society))}
        preparable={canWrite && Boolean(key) && allowed && packetApplies(t)}
        prepareTitle={prepareTitle(t, allowed)}
        busy={busyKey === t._id}
        done={doneKey === t._id}
        eventDates={eventDatesFor(key)}
        selectedDate={selectedEventDate(key)}
        onSelectDate={(date) => {
          if (key) setEventDateByKey((current) => ({ ...current, [key]: date }));
        }}
        onGenerate={() => onGenerate(t)}
      />
    );
  };

  return (
    <div className="page">
      <PageHeader
        title="Document catalog"
        icon={<FileText size={16} />}
        iconColor="blue"
        subtitle="Prepare editable drafts from this entity’s template and precedent catalog."
        info={<>
          {preparation.allowed && <p>{preparation.message}</p>}
          <p>These are application-authored working drafts. A signature, filing receipt and certified registry document are separate evidence stages. Official government forms and model layouts remain linked originals unless their reuse rights are confirmed.</p>
          <p>The templates prepare governance records and working drafts. They do not file an incorporation application or supply a complete set of incorporation articles, bylaws, or an incorporation agreement.</p>
          {preparationGuide?.id === "bc_company" && <p>Corporate packets are generic drafts. Review them against your BC company's articles and the Business Corporations Act before use.</p>}
        </>}
        actions={
          <MoreActionsMenu
            items={[
              { id: "track", label: "Track preparation and evidence", onSelect: () => navigate("/app/post-incorporation") },
              { id: "research", label: "Research and source review", onSelect: () => navigate("/app/research-library") },
              ...(preparationGuide ? [{
                id: "worksheet",
                label: "Download preparation worksheet",
                onSelect: () => void downloadWorksheet(preparationGuide),
              }] : []),
            ]}
          />
        }
      />

      {!preparation.allowed && (
        <Banner tone="warn">
          Incorporation route review required. {preparation.message}
          {allowedPacketKeys.size > 0 ? " Individually reviewed preparation drafts are available below." : ""}
        </Banner>
      )}
      {generationError && (
        <Banner tone="danger" title="Could not prepare the draft" onDismiss={() => setGenerationError(null)}>
          {generationError}
        </Banner>
      )}

      {isCorporation(society) && (
        <MinuteBookReportsCard
          society={society}
          allowedPacketKeys={allowedPacketKeys}
          canWrite={canWrite}
          role={permissions.role}
        />
      )}

      {templates === undefined ? (
        <div className="card">
          <div className="card__body">
            <SkeletonRows rows={4} columns={3} />
          </div>
        </div>
      ) : templates.length === 0 ? (
        <div className="card">
          <div className="card__body doc-catalog-empty">
            <span className="muted">No templates yet. Your existing files are in <Link className="doc-catalog-link" to="/app/documents">Documents</Link>.</span>
            {allowedPacketKeys.size > 0 && canWrite && (
              <button className="btn-action btn-action--primary" disabled={seeding} onClick={onSeedCatalog}>
                {seeding ? "Initializing…" : "Initialize document catalog"}
              </button>
            )}
          </div>
        </div>
      ) : (
        groupEntries.map(([tag, items]) => (
          <section className="card" key={tag} aria-labelledby={`doc-catalog-${tag}`}>
            <div className="card__head">
              <h2 className="card__title" id={`doc-catalog-${tag}`}>{humanizeTag(tag)}</h2>
              <Badge>{items.length}</Badge>
            </div>
            <ul className="doc-catalog-items">{items.map(renderTemplate)}</ul>
          </section>
        ))
      )}

      {precedents.length > 0 && (
        <section className="card" aria-labelledby="doc-catalog-precedents">
          <div className="card__head">
            <h2 className="card__title" id="doc-catalog-precedents">Packages &amp; precedents</h2>
            <Badge>{precedents.length}</Badge>
          </div>
          <ul className="card__body doc-catalog-precedents">
            {precedents.map((p) => (
              <li key={p._id}>
                <strong>{p.packageName}</strong>
                {p.shortDescription && <span className="doc-catalog-precedents__desc"> — {p.shortDescription}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {["preparing", "submitted"].includes(society.formationStatus ?? "") && (
        <Banner className="setup-filing-link" title="Filing the incorporation">
          What to prepare and the official filing link are in the filing step of setup. <Link className="setup-inline-link" to={setupViewStepLink("file")}>Open the filing step</Link>
        </Banner>
      )}
    </div>
  );
}

type CatalogPacket = (typeof ALL_PACKETS)[number];

/** One template in its document-type card: how to prepare it, and what it needs before use. */
function CatalogTemplateItem({
  template: t,
  packet,
  compatibleJurisdiction,
  compatibleEntity,
  preparable,
  prepareTitle,
  busy,
  done,
  eventDates,
  selectedDate,
  onSelectDate,
  onGenerate,
}: {
  template: CatalogTemplate;
  packet: CatalogPacket | undefined;
  compatibleJurisdiction: boolean;
  compatibleEntity: boolean;
  /** The person can prepare this template for this entity (permission, packet key and pathway). */
  preparable: boolean;
  prepareTitle: string;
  busy: boolean;
  done: boolean;
  /** Dates of the recorded transactions a transaction-scoped packet can draft. */
  eventDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onGenerate: () => void;
}) {
  const desc = firstLine(t.notes);
  const signatureRequired = packet?.signatureRequired ?? t.signatureRequired;
  const transactionScoped = Boolean(packet && "transactionScoped" in packet && packet.transactionScoped);
  return (
    <li className="doc-catalog-item">
      <div className="doc-catalog-item__head">
        <strong className="doc-catalog-item__name">{packet?.preparationOnly ? packet.templateName : t.name}</strong>
        {signatureRequired
          ? <Badge tone="warn">Signature required</Badge>
          : <Badge tone="neutral">No signature required</Badge>}
        <span className="doc-catalog-item__action">
          {done ? (
            <>
              <Badge tone="success">Draft staged</Badge>
              <Link to="/app/template-engine">Open Template Engine</Link>
            </>
          ) : (
            <button className="btn btn--accent" disabled={busy || !preparable} onClick={onGenerate} title={prepareTitle}>
              {busy ? "Preparing…" : "Prepare draft"}
            </button>
          )}
        </span>
      </div>
      {transactionScoped && (
        eventDates.length > 0 ? (
          <div className="doc-catalog-item__date">
            <Field label="Transaction date">
              <Select
                aria-label="Transaction date"
                value={selectedDate}
                onChange={onSelectDate}
                options={eventDates.map((date) => ({ value: date, label: date }))}
              />
            </Field>
          </div>
        ) : (
          <p className="muted doc-catalog-item__note">
            No transaction of this kind is recorded yet. The draft uses today's date and contains prompts to complete.
          </p>
        )
      )}
      {packet?.preparationOnly && (
        <p className="muted doc-catalog-item__note">
          Original preparation worksheet — unresolved drafting prompts require tailored legal review before execution or registry submission.
        </p>
      )}
      {(!compatibleJurisdiction || !compatibleEntity) && (
        <div className="doc-catalog-item__flags">
          {!compatibleJurisdiction && <Badge tone="warn">Different home jurisdiction</Badge>}
          {!compatibleEntity && <Badge tone="warn">Different entity type</Badge>}
        </div>
      )}
      {packet?.sourceUrls && (
        <div className="doc-catalog-item__sources">
          {packet.sourceUrls.map((url, index) => (
            <a key={url} className="doc-catalog-link" href={url} target="_blank" rel="noreferrer">Official source {index + 1}</a>
          ))}
        </div>
      )}
      {desc && <p className="doc-catalog-item__desc">{desc}</p>}
      {t.terms && <p className="muted doc-catalog-item__note">Before use: {t.terms}</p>}
      {t.requiredDataFields.length > 0 && (
        <div className="doc-catalog-item__fields">
          <span className="muted doc-catalog-item__label">Required data fields</span>
          <div className="doc-catalog-item__chips">
            {t.requiredDataFields.map((field) => <Pill key={field} size="sm">{humanizeKey(field)}</Pill>)}
          </div>
        </div>
      )}
      {t.requiredSigners.length > 0 && (
        <p className="muted doc-catalog-item__note">Required signers: {t.requiredSigners.map(humanizeTag).join(", ")}</p>
      )}
    </li>
  );
}

export default DocumentCatalogPage;
