import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/Modal";
import { SeedPrompt } from "./_helpers";
import { Button, Drawer, Field, SettingsShell } from "../components/ui";
import { AlertTriangle, Database, Link2, Plus, Sliders, Trash2 } from "lucide-react";
import { FIELD_TYPES as RECORD_FIELD_TYPES, RECORD_TABLE_OBJECTS } from "../../convex/recordTableMetadataDefinitions";
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

const FIELD_KINDS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Checkbox" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

const ENTITY_LABELS: Record<string, string> = {
  members: "Members",
  directors: "Directors",
  volunteers: "Volunteers",
  employees: "Employees",
};

/**
 * Custom field definitions. The record table handles search / filter /
 * sort / column visibility; inline edits route to
 * `customFields.updateDefinition`. `entityType` and `key` are flagged
 * read-only in the seed so they can't be changed after creation
 * (matching the drawer's own `disabled` attribute on those inputs).
 */
export function CustomFieldsPage() {
  const society = useSociety();
  const definitions = useQuery(
    api.customFields.listDefinitions,
    society ? { societyId: society._id } : "skip",
  );
  const createDef = useMutation(api.customFields.createDefinition);
  const updateDef = useMutation(api.customFields.updateDefinition);
  const deleteDef = useMutation(api.customFields.deleteDefinition);
  const toast = useToast();
  const confirm = useConfirm();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<any>(null);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("definitions");

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "customFieldDefinition",
    viewId: currentViewId,
  });

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    setDraft({
      entityType: "members",
      key: "",
      label: "",
      kind: "text",
      required: false,
      description: "",
    });
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.label?.trim()) {
      toast.error("Label is required");
      return;
    }
    const key = (draft.key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) {
      toast.error("Key is required (machine-readable identifier)");
      return;
    }
    try {
      if (draft._id) {
        await updateDef({
          id: draft._id,
          label: draft.label,
          kind: draft.kind,
          required: draft.required,
          description: draft.description,
          order: draft.order,
        });
      } else {
        await createDef({
          societyId: society._id,
          entityType: draft.entityType,
          key,
          label: draft.label,
          kind: draft.kind,
          required: draft.required,
          description: draft.description,
        });
      }
      toast.success("Saved");
      setDrawerOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
  };

  const doDelete = async (row: any) => {
    const ok = await confirm({
      title: `Delete "${row.label}"?`,
      message: "All stored values for this custom field will be removed across every person in this category.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await deleteDef({ id: row._id });
    toast.success("Deleted");
  };

  const records = (definitions ?? []) as any[];
  const linkAudit = useMemo(() => buildLinkAudit(records), [records]);
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  return (
    <div className="page custom-fields-page">
      <SettingsShell
        title="Custom fields"
        icon={<Sliders size={16} />}
        iconColor="purple"
        description="Add extra fields to any person category (members, directors, volunteers, employees). Saved values appear on each person's detail and can be pulled into PDF mapping."
        tabs={[
          { id: "definitions", label: "Definitions", icon: <Sliders size={14} /> },
          { id: "mapping", label: "Link map", icon: <Link2 size={14} /> },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={activeTab === "definitions" ? (
          <Button variant="accent" onClick={openNew}>
            <Plus size={12} /> New field
          </Button>
        ) : null}
      >
      {activeTab === "definitions" ? (
        <>
      <div className="custom-fields-mobile-list" aria-label="Custom field definitions">
        {definitions === undefined ? (
          <div className="record-table__loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="record-table__loading-row" />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="record-table__empty">
            <div className="record-table__empty-title">No custom fields</div>
            <div className="record-table__empty-desc">
              Add fields for members, directors, volunteers, or employees.
            </div>
          </div>
        ) : (
          records.map((row: any) => (
            <article
              key={row._id}
              className="custom-field-card"
              onClick={() => {
                setDraft({ ...row });
                setDrawerOpen(true);
              }}
            >
              <div className="custom-field-card__main">
                <div className="custom-field-card__title">{row.label}</div>
                <div className="custom-field-card__meta">
                  {ENTITY_LABELS[row.entityType] ?? row.entityType} · {fieldKindLabel(row.kind)}
                  {row.required ? " · Required" : ""}
                </div>
                {row.description && (
                  <div className="custom-field-card__description">{row.description}</div>
                )}
                <div className="custom-field-card__key">{row.key}</div>
              </div>
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete ${row.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  doDelete(row);
                }}
              >
                <Trash2 size={12} />
              </button>
            </article>
          ))
        )}
      </div>

      <div className="custom-fields-record-table">
      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="custom-field-definition" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="custom-fields"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(_, record) => {
            setDraft({ ...record });
            setDrawerOpen(true);
          }}
          onUpdate={async ({ recordId, fieldName, value }) => {
            // `entityType` and `key` are immutable after create — the
            // seed marks `key` read-only; entityType is filterable but
            // not meant to be edited inline (ignore if it slips through).
            if (fieldName === "entityType" || fieldName === "key") return;
            const patch: any = { id: recordId };
            if (fieldName === "label") patch.label = value;
            else if (fieldName === "kind") patch.kind = value;
            else if (fieldName === "required") patch.required = value;
            else if (fieldName === "description") patch.description = value;
            else if (fieldName === "order") patch.order = value;
            else return;
            await updateDef(patch);
          }}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Sliders size={14} />}
            label="Definitions"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || definitions === undefined}
            renderRowActions={(row) => (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Delete ${row.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  doDelete(row);
                }}
              >
                <Trash2 size={12} />
              </button>
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
      </div>
        </>
      ) : (
        <LinkAuditPanel audit={linkAudit} />
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={draft?._id ? "Edit custom field" : "New custom field"}
        footer={
          <>
            <button className="btn" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn btn--accent" onClick={save}>
              Save
            </button>
          </>
        }
      >
        {draft && (
          <div>
            <Field label="Category">
              <select
                className="input"
                value={draft.entityType}
                disabled={Boolean(draft._id)}
                onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
              >
                {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Label">
              <input
                className="input"
                value={draft.label ?? ""}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </Field>
            <Field label="Key">
              <input
                className="input mono"
                value={draft.key ?? ""}
                disabled={Boolean(draft._id)}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                placeholder="unbc_affiliate_role"
              />
              <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                Lowercase with underscores. Used as the stable reference from mapping wizards.
              </div>
            </Field>
            <Field label="Kind">
              <select
                className="input"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              >
                {FIELD_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                rows={2}
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Field>
            <label className="workflow-checkbox">
              <input
                type="checkbox"
                checked={Boolean(draft.required)}
                onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
              />
              <span>Required</span>
            </label>
          </div>
        )}
      </Drawer>
      </SettingsShell>
    </div>
  );
}

function fieldKindLabel(kind: string) {
  return FIELD_KINDS.find((item) => item.value === kind)?.label ?? kind;
}

type LinkAuditItem = {
  id: string;
  source: string;
  field: string;
  label: string;
  fieldType: string;
  target: string;
  reason: string;
  fix: string;
  priority: "high" | "medium" | "low";
};

type LinkAudit = {
  opportunities: LinkAuditItem[];
  alreadyLinked: LinkAuditItem[];
  customCandidates: LinkAuditItem[];
  targetCoverage: LinkTargetCoverageItem[];
};

type LinkTargetCoverageItem = {
  target: string;
  count: number;
  highPriorityCount: number;
};

const LINK_TARGET_HINTS = [
  { target: "Documents", pattern: /\b(doc|document|documents|receipt|source|attachment|bylaw|constitution|policy|minutes?)\b/i },
  { target: "Meetings", pattern: /\b(meeting|agm|sgm|minutes?)\b/i },
  { target: "Members", pattern: /\b(member|membership|grantor|proxy holder)\b/i },
  { target: "Directors", pattern: /\b(director|board|chair|secretary|treasurer|officer|signer)\b/i },
  { target: "Volunteers", pattern: /\b(volunteer|screening|orientation)\b/i },
  { target: "Employees", pattern: /\b(employee|staff|manager|supervisor)\b/i },
  { target: "Users", pattern: /\b(user|assignee|owner|custodian|reviewer|approver)\b/i },
  { target: "Grants", pattern: /\b(grant|funder|funding)\b/i },
  { target: "Filings", pattern: /\b(filing|registry|annual report)\b/i },
  { target: "Rights classes", pattern: /\b(class|rights class|membership class|share class)\b/i },
  { target: "Financial accounts", pattern: /\b(account|counterparty|vendor|customer|transaction)\b/i },
];

const SCHEMA_LINK_CANDIDATES: LinkAuditItem[] = [
  {
    id: "schema:meetings:attendeeIds",
    source: "Meetings",
    field: "attendeeIds",
    label: "Attendees",
    fieldType: "string[]",
    target: "Members / Directors / Users",
    reason: "Attendance stores string IDs while related people already exist as member, director, and user records.",
    fix: "Resolve attendee names/emails into meetingAttendanceRecords and render people as relation chips.",
    priority: "high",
  },
  {
    id: "schema:minutes:attendees",
    source: "Minutes",
    field: "attendees / absent / chairName",
    label: "Minute participants",
    fieldType: "text",
    target: "Members / Directors / Users",
    reason: "Minutes preserve names for participants and officers; these can be resolved to people records when matches exist.",
    fix: "Reuse the person-link resolver for minute participants, movers, seconders, chair, and absences.",
    priority: "high",
  },
  {
    id: "schema:tasks:assignee",
    source: "Tasks",
    field: "assignee",
    label: "Assignee",
    fieldType: "text",
    target: "Users / Directors / Members",
    reason: "Tasks already support responsibleUserIds, but the visible assignee field can still be plain text.",
    fix: "Prefer responsibleUserIds in the task table and add a relation-aware display for assigned people.",
    priority: "high",
  },
  {
    id: "schema:goals:ownerName",
    source: "Goals",
    field: "ownerName",
    label: "Owner",
    fieldType: "text",
    target: "Users / Directors",
    reason: "Goal ownership is stored as a name even when a matching person record may exist.",
    fix: "Add ownerUserId/ownerDirectorId or resolve ownerName into a ranked link candidate.",
    priority: "medium",
  },
  {
    id: "schema:audit:entityId",
    source: "Audit / Activity / Notes",
    field: "entityType + entityId",
    label: "Referenced record",
    fieldType: "polymorphic string",
    target: "Record lookup",
    reason: "Polymorphic references can resolve to record links when entityType names a known object.",
    fix: "Render entityType + entityId through a polymorphic record-link component.",
    priority: "high",
  },
  {
    id: "schema:sourceEvidence:targetId",
    source: "Source evidence",
    field: "targetTable + targetId",
    label: "Evidence target",
    fieldType: "polymorphic string",
    target: "Record lookup",
    reason: "Evidence points at records through table/id strings but is not surfaced as a generic relation.",
    fix: "Use sourceEvidence as the canonical backlink table and expose target/source document chips everywhere.",
    priority: "high",
  },
  {
    id: "schema:orgChart:subjectId",
    source: "Org chart",
    field: "subjectType + subjectId / managerId",
    label: "Reporting line",
    fieldType: "polymorphic string",
    target: "Directors / Employees / Volunteers",
    reason: "Reporting relationships store typed string references that can render as person links.",
    fix: "Render subject and manager references with typed person links instead of plain labels.",
    priority: "medium",
  },
  {
    id: "schema:meetingMaterials:accessGrants",
    source: "Meeting materials",
    field: "subjectType + subjectId",
    label: "Access grants",
    fieldType: "polymorphic string",
    target: "Members / Directors / Committees",
    reason: "Material access grants have a type discriminator and subject ID but no generic linked chip.",
    fix: "Route material access grants through the same polymorphic record-link display.",
    priority: "medium",
  },
  {
    id: "schema:finance:externalRefs",
    source: "Financial imports",
    field: "externalId / matchedId / counterpartyExternalId",
    label: "External references",
    fieldType: "external string",
    target: "Cached Wave resources",
    reason: "External finance identifiers can link to cached provider resources when the external ID matches.",
    fix: "Promote matched external IDs into relation candidates beside reconciliation suggestions.",
    priority: "medium",
  },
  {
    id: "schema:imports:documentCandidates",
    source: "Import sessions",
    field: "sourceExternalIds / target module",
    label: "Imported source documents",
    fieldType: "staged metadata",
    target: "Policies / Filings / Meetings / Grants",
    reason: "Import review detects likely destinations, but document-to-record linking is still mostly advisory.",
    fix: "Have import-session link insights return concrete candidate records and an apply action.",
    priority: "high",
  },
  {
    id: "schema:proxies:meetingAndMembers",
    source: "Proxies",
    field: "meetingId / grantorMemberId / proxyHolderMemberId",
    label: "Proxy links",
    fieldType: "Convex IDs",
    target: "Meetings / Members",
    reason: "Proxy rows already store meeting and member IDs, but the generic metadata mostly shows projected text.",
    fix: "Declare these fields as RELATION metadata and render them as navigable chips.",
    priority: "high",
  },
  {
    id: "schema:training:participantAndDocument",
    source: "PIPA training",
    field: "participantUserId / participantMemberId / documentId",
    label: "Training participant",
    fieldType: "Convex IDs",
    target: "Users / Members / Documents",
    reason: "Training completion records can point to both the person and evidence document.",
    fix: "Add relation fields for participant and evidence document in the training record view.",
    priority: "high",
  },
  {
    id: "schema:secrets:usersAndEvidence",
    source: "Secrets",
    field: "custodianUserId / authorizedUserIds / sourceDocumentIds",
    label: "Secret custody",
    fieldType: "Convex IDs",
    target: "Users / Documents",
    reason: "Vault items store custodians, authorized users, and source documents that should be inspectable as links.",
    fix: "Render custody and source arrays through relation-aware array chips.",
    priority: "high",
  },
  {
    id: "schema:publications:document",
    source: "Transparency",
    field: "documentId",
    label: "Published document",
    fieldType: "Convex ID",
    target: "Documents",
    reason: "Publications can be backed by an internal document record but also expose an external URL.",
    fix: "Show both the external URL and internal document relation where present.",
    priority: "medium",
  },
  {
    id: "schema:legalTemplates:documentsAndFields",
    source: "Legal operations",
    field: "templateDocumentId / requiredDataFieldIds",
    label: "Template dependencies",
    fieldType: "Convex IDs",
    target: "Documents / Data fields",
    reason: "Templates link to source documents and generated data fields, but this dependency graph is not visible generically.",
    fix: "Expose template document and data-field relations in record metadata.",
    priority: "high",
  },
];

const LINKED_FIELD_TYPES = new Set<string>([
  RECORD_FIELD_TYPES.RELATION,
  RECORD_FIELD_TYPES.LINK,
]);

const NON_LINKABLE_FIELD_TYPES = new Set<string>([
  RECORD_FIELD_TYPES.EMAIL,
  RECORD_FIELD_TYPES.PHONE,
]);

function LinkAuditPanel({ audit }: { audit: LinkAudit }) {
  return (
    <div className="link-audit">
      <div className="link-audit__summary" aria-label="Link audit summary">
        <LinkAuditStat icon={<AlertTriangle size={14} />} label="Link candidates" value={audit.opportunities.length} />
        <LinkAuditStat icon={<Database size={14} />} label="Custom candidates" value={audit.customCandidates.length} />
        <LinkAuditStat icon={<Link2 size={14} />} label="Already linked" value={audit.alreadyLinked.length} />
      </div>

      <section className="link-audit__section">
        <div className="link-audit__section-head">
          <h2>Target item types</h2>
          <span>{audit.targetCoverage.length}</span>
        </div>
        <div className="link-audit-targets" aria-label="Link target item types">
          {audit.targetCoverage.map((item) => (
            <div className="link-audit-target" key={item.target}>
              <span>{item.target}</span>
              <strong>{item.count}</strong>
              {item.highPriorityCount > 0 && <em>{item.highPriorityCount} high</em>}
            </div>
          ))}
        </div>
      </section>

      <section className="link-audit__section">
        <div className="link-audit__section-head">
          <h2>Suggested links</h2>
          <span>{audit.opportunities.length}</span>
        </div>
        <div className="link-audit__list">
          {audit.opportunities.length === 0 ? (
            <div className="record-table__empty">
              <div className="record-table__empty-title">No link candidates</div>
              <div className="record-table__empty-desc">Seed metadata and custom fields are already explicit enough.</div>
            </div>
          ) : (
            audit.opportunities.map((item) => <LinkAuditRow key={item.id} item={item} />)
          )}
        </div>
      </section>

      <section className="link-audit__section">
        <div className="link-audit__section-head">
          <h2>Custom field candidates</h2>
          <span>{audit.customCandidates.length}</span>
        </div>
        <div className="link-audit__list">
          {audit.customCandidates.length === 0 ? (
            <div className="record-table__empty">
              <div className="record-table__empty-title">No custom link candidates</div>
            </div>
          ) : (
            audit.customCandidates.map((item) => <LinkAuditRow key={item.id} item={item} />)
          )}
        </div>
      </section>

      <section className="link-audit__section">
        <div className="link-audit__section-head">
          <h2>Declared links</h2>
          <span>{audit.alreadyLinked.length}</span>
        </div>
        <div className="link-audit__list link-audit__list--compact">
          {audit.alreadyLinked.map((item) => <LinkAuditRow key={item.id} item={item} compact />)}
        </div>
      </section>
    </div>
  );
}

function LinkAuditStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="link-audit-stat">
      <span className="link-audit-stat__icon">{icon}</span>
      <span className="link-audit-stat__value">{value}</span>
      <span className="link-audit-stat__label">{label}</span>
    </div>
  );
}

function LinkAuditRow({ item, compact = false }: { item: LinkAuditItem; compact?: boolean }) {
  return (
    <article className={`link-audit-row${compact ? " link-audit-row--compact" : ""}`}>
      <div className="link-audit-row__main">
        <div className="link-audit-row__title">
          <span>{item.source}</span>
          <code>{item.field}</code>
        </div>
        {!compact && (
          <>
            <div className="link-audit-row__reason">{item.reason}</div>
            <div className="link-audit-row__fix">{item.fix}</div>
          </>
        )}
      </div>
      <div className="link-audit-row__meta">
        <span className={`link-audit-row__priority link-audit-row__priority--${item.priority}`}>{item.priority}</span>
        <span>{item.fieldType}</span>
        <span>{item.target}</span>
      </div>
    </article>
  );
}

function buildLinkAudit(customFields: any[]): LinkAudit {
  const alreadyLinked: LinkAuditItem[] = [];
  const seededCandidates: LinkAuditItem[] = [];
  const customCandidates: LinkAuditItem[] = [];

  for (const object of RECORD_TABLE_OBJECTS) {
    for (const field of object.fields) {
      const item = auditSeedField(object, field);
      if (!item) continue;
      if (LINKED_FIELD_TYPES.has(field.fieldType)) alreadyLinked.push(item);
      else seededCandidates.push(item);
    }
  }

  for (const field of customFields) {
    const item = auditCustomField(field);
    if (item) customCandidates.push(item);
  }

  return {
    opportunities: [...SCHEMA_LINK_CANDIDATES, ...seededCandidates, ...customCandidates].sort(sortAuditItems),
    alreadyLinked: alreadyLinked.sort((a, b) => a.source.localeCompare(b.source) || a.field.localeCompare(b.field)),
    customCandidates: customCandidates.sort(sortAuditItems),
    targetCoverage: buildTargetCoverage([...SCHEMA_LINK_CANDIDATES, ...seededCandidates, ...customCandidates]),
  };
}

function auditSeedField(object: (typeof RECORD_TABLE_OBJECTS)[number], field: (typeof RECORD_TABLE_OBJECTS)[number]["fields"][number]): LinkAuditItem | null {
  const text = `${field.name} ${field.label}`;
  const target = inferTarget(text);
  const hasIdShape = /(^|[A-Z_])(id|ids)$/i.test(field.name) || /(Id|Ids)$/.test(field.name);
  const alreadyLinked = LINKED_FIELD_TYPES.has(field.fieldType);
  if (alreadyLinked) {
    return {
      id: `linked:${object.namePlural}:${field.name}`,
      source: object.labelPlural,
      field: field.name,
      label: field.label,
      fieldType: field.fieldType,
      target: target ?? relationTarget(field.config) ?? "Configured target",
      reason: "Declared as a link or relation in record metadata.",
      fix: "No action needed for metadata; improve display if this still renders as a raw ID.",
      priority: "low",
    };
  }
  if (NON_LINKABLE_FIELD_TYPES.has(field.fieldType)) return null;
  if (!target && !hasIdShape) return null;
  if (field.name === "externalId" || field.name === "sourceExternalIds") return null;
  return {
    id: `seed:${object.namePlural}:${field.name}`,
    source: object.labelPlural,
    field: field.name,
    label: field.label,
    fieldType: field.fieldType,
    target: target ?? "Record lookup",
    reason: hasIdShape
      ? "The field stores an identifier shape but is rendered as plain data."
      : "The field name or label matches another record type but is not declared as a relation.",
    fix: hasIdShape
      ? "Declare this as RELATION metadata with a target object, or add a polymorphic record-link renderer."
      : "Add a relation field or surface ranked link suggestions beside this field.",
    priority: hasIdShape ? "high" : field.isReadOnly ? "medium" : "low",
  };
}

function auditCustomField(field: any): LinkAuditItem | null {
  const text = `${field.key ?? ""} ${field.label ?? ""} ${field.description ?? ""}`;
  const target = inferTarget(text);
  if (!target) return null;
  if (["email", "phone"].includes(field.kind)) return null;
  return {
    id: `custom:${field._id}`,
    source: ENTITY_LABELS[field.entityType] ?? field.entityType,
    field: field.key,
    label: field.label,
    fieldType: field.kind,
    target,
    reason: "The custom field reads like a reference but custom fields only store scalar values today.",
    fix: "Convert this custom field to a relation-capable field type or add a companion linked-record field.",
    priority: /id|document|member|director|user/i.test(text) ? "high" : "medium",
  };
}

function buildTargetCoverage(items: LinkAuditItem[]): LinkTargetCoverageItem[] {
  const coverage = new Map<string, LinkTargetCoverageItem>();
  for (const item of items) {
    for (const target of item.target.split("/").map((part) => part.trim()).filter(Boolean)) {
      const current = coverage.get(target) ?? { target, count: 0, highPriorityCount: 0 };
      current.count += 1;
      if (item.priority === "high") current.highPriorityCount += 1;
      coverage.set(target, current);
    }
  }
  return [...coverage.values()].sort(
    (a, b) => b.highPriorityCount - a.highPriorityCount || b.count - a.count || a.target.localeCompare(b.target),
  );
}

function inferTarget(text: string) {
  return LINK_TARGET_HINTS.find((hint) => hint.pattern.test(splitIdentifierText(text)))?.target;
}

function relationTarget(config: unknown) {
  if (!config || typeof config !== "object") return null;
  const value = (config as any).targetObjectNamePlural ?? (config as any).targetObjectMetadataId;
  return typeof value === "string" && value ? value : null;
}

function splitIdentifierText(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}

function sortAuditItems(a: LinkAuditItem, b: LinkAuditItem) {
  const weight = { high: 0, medium: 1, low: 2 };
  return weight[a.priority] - weight[b.priority] || a.source.localeCompare(b.source) || a.field.localeCompare(b.field);
}
