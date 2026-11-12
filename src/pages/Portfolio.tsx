import { usePermissions } from "@/hooks/usePermissions";
import { InfoPopover } from "../components/InfoPopover";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Layers, AlertTriangle, ListChecks } from "lucide-react";
import { PageHeader, PageLoading } from "./_helpers";
import { setStoredSocietyId, useSocietySelection } from "../hooks/useSociety";
import { WorkspaceLogo } from "../components/WorkspaceLogo";
import { Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { CORPORATION_DOCUMENT_PACKETS } from "../../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../../shared/societyDocumentPackets";
import { todayDateOnly } from "../../shared/dateOnly";
import { StatTile } from "../components/StatTile";
import type { Id } from "../../convex/_generated/dataModel";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  useFilteredRecords,
  useRecordTableState,
  useRecordTableStoreHandle,
} from "@/platform/record-engine";

type FirmEntity = {
  _id: string;
  name: string;
  kind: string;
  incorporationNumber: string | null;
  shortName?: string | null;
  formerNames?: string[];
  status: string | null;
  overdueDeadlines: number;
  upcomingDeadlines: number;
  openDeadlines: number;
  postIncorpTotal: number;
  postIncorpDone: number;
};

const PACKET_OPTIONS = [
  ...CORPORATION_DOCUMENT_PACKETS.map((p) => ({ key: p.key, label: p.packageName, kind: "corporation" as const })),
  ...SOCIETY_DOCUMENT_PACKETS.map((p) => ({ key: p.key, label: p.packageName, kind: "society" as const })),
];

const KIND_LABEL: Record<string, string> = { society: "Society", corporation: "Corporation", organization: "Entity" };

/**
 * Portfolio — the firm-wide ("manage all my corporations at once") command
 * centre. Rolls up each entity's open deadlines + post-incorporation progress
 * (convex/firm.overview), lets you switch into any entity, and batch-generates a
 * document packet across many entities at once (the YCN Multiple_Copy analogue).
 */
const ENTITIES_TABLE = staticRecordTable({
  id: "portfolio:entities",
  nameSingular: "portfolioEntity",
  namePlural: "portfolioEntities",
  labelSingular: "Entity",
  labelPlural: "Entities",
  labelIdentifierFieldName: "name",
  viewName: "All entities",
  density: "comfortable",
  fields: [
    { name: "name", label: "Entity", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    {
      name: "kind",
      label: "Type",
      fieldType: FIELD_TYPES.SELECT,
      size: 130,
      config: { options: [{ value: "society", label: KIND_LABEL.society, color: "purple" }, { value: "corporation", label: KIND_LABEL.corporation, color: "blue" }, { value: "organization", label: KIND_LABEL.organization, color: "gray" }] },
    },
    { name: "incorporationNumber", label: "Registry number", fieldType: FIELD_TYPES.TEXT, size: 150, config: { groupable: false } },
    { name: "status", label: "Registry status", fieldType: FIELD_TYPES.TEXT, size: 140, isVisible: false },
    { name: "openDeadlines", label: "Deadlines", fieldType: FIELD_TYPES.NUMBER, size: 200 },
    { name: "overdueDeadlines", label: "Overdue", fieldType: FIELD_TYPES.NUMBER, size: 100, isVisible: false },
    { name: "upcomingDeadlines", label: "Upcoming", fieldType: FIELD_TYPES.NUMBER, size: 100, isVisible: false },
    { name: "postIncorporation", label: "Post-incorporation", fieldType: FIELD_TYPES.NUMBER, size: 160, config: { suffix: "%" } },
    { name: "shortName", label: "Short name", fieldType: FIELD_TYPES.TEXT, size: 140, isVisible: false, config: { groupable: false } },
    { name: "formerNames", label: "Former names", fieldType: FIELD_TYPES.TEXT, size: 200, isVisible: false, config: { groupable: false } },
  ],
});

/** An entity as the table lists it; searching finds short and former names too. */
type EntityRecord = {
  _id: string;
  name: string;
  kind: string;
  incorporationNumber: string;
  status: string;
  openDeadlines: number;
  overdueDeadlines: number;
  upcomingDeadlines: number;
  /** Post-incorporation steps done, as a percent; null when there are none. */
  postIncorporation: number | null;
  shortName: string;
  formerNames: string;
  entity: FirmEntity;
};

function entityRecord(entity: FirmEntity): EntityRecord {
  return {
    _id: entity._id,
    name: entity.name,
    kind: entity.kind,
    incorporationNumber: entity.incorporationNumber ?? "",
    status: entity.status ?? "",
    openDeadlines: entity.openDeadlines,
    overdueDeadlines: entity.overdueDeadlines,
    upcomingDeadlines: entity.upcomingDeadlines,
    postIncorporation: entity.postIncorpTotal > 0 ? Math.round((entity.postIncorpDone / entity.postIncorpTotal) * 100) : null,
    shortName: entity.shortName ?? "",
    formerNames: (entity.formerNames ?? []).join(", "),
    entity,
  };
}

/**
 * Batch generate (the YCN Multiple_Copy analogue), in the table's toolbar so
 * it works on the rows ticked there: pick a packet, then generate it for each
 * ticked entity still shown.
 */
function PortfolioBatchGenerate({ canWrite, onGenerate }: { canWrite: boolean; onGenerate: (societyIds: string[], packetKey: string) => Promise<void> }) {
  const selected = useRecordTableState((state) => state.selectedRecordIds);
  const visible = useFilteredRecords() as EntityRecord[];
  const handle = useRecordTableStoreHandle();
  const [packetKey, setPacketKey] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedIds = visible.filter((record) => selected.has(String(record._id))).map((record) => String(record._id));
  const packetKind = PACKET_OPTIONS.find((p) => p.key === packetKey)?.kind;
  const selectKind = (kind: string) => handle.get().setSelectedRecordIds(new Set(visible.filter((record) => record.kind === kind).map((record) => String(record._id))));
  const generate = async () => {
    if (!packetKey || selectedIds.length === 0) return;
    setBusy(true);
    try {
      await onGenerate(selectedIds, packetKey);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="portfolio-batch" role="group" aria-label="Batch generate a document">
      <span className="portfolio-batch__label">
        <ListChecks size={14} aria-hidden="true" /> <span className="portfolio-batch__title">Batch generate</span>
        <InfoPopover label="About batch generate">
          <p>Tick entities in the table, pick a packet, then generate. A packet only applies to its entity kind; mismatched entities are skipped and reported.</p>
        </InfoPopover>
      </span>
      <select className="input portfolio-batch__packet" aria-label="Document packet" value={packetKey} onChange={(e) => setPacketKey(e.target.value)}>
        <option value="">Choose a packet…</option>
        <optgroup label="Corporation packets">
          {PACKET_OPTIONS.filter((p) => p.kind === "corporation").map((p) => <option key={`c-${p.key}`} value={p.key}>{p.label}</option>)}
        </optgroup>
        <optgroup label="Society packets">
          {PACKET_OPTIONS.filter((p) => p.kind === "society").map((p) => <option key={`s-${p.key}`} value={p.key}>{p.label}</option>)}
        </optgroup>
      </select>
      {packetKind && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => selectKind(packetKind)}>
          Select all {packetKind}s
        </button>
      )}
      <button type="button" className="btn btn--accent btn--sm" disabled={!canWrite || (busy || !packetKey || selectedIds.length === 0)} onClick={() => void generate()}>
        {busy ? "Generating…" : selectedIds.length ? `Generate for ${selectedIds.length}` : "Generate"}
      </button>
    </div>
  );
}

export function PortfolioPage() {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("society:write");
  const data = useQuery(api.firm.overview, {}) as
    | { today: string; entities: FirmEntity[]; totals: any }
    | undefined;
  const { society: current, societies } = useSocietySelection();
  const identities = useMemo(() => new Map(societies?.map(organization => [String(organization._id), organization]) ?? []), [societies]);
  const batchGenerate = useMutation(api.firm.batchGeneratePacket);
  const toast = useToast();
  const navigate = useNavigate();

  const entities = data?.entities;
  const records = useMemo<EntityRecord[]>(() => (entities ?? []).map(entityRecord), [entities]);

  if (data === undefined) return <PageLoading />;

  const totals = data.totals ?? {};
  const open = (id: string) => { setStoredSocietyId(id as Id<"societies">); navigate("/app"); };

  const runBatch = async (societyIds: string[], packetKey: string) => {
    try {
      const result = (await batchGenerate({
        societyIds: societyIds as Id<"societies">[],
        packetKey,
        effectiveDate: todayDateOnly(),
      })) as { generated: number; failed: number };
      const msg = `${result.generated} generated${result.failed ? `, ${result.failed} failed (wrong entity type or unseeded)` : ""}.`;
      if (result.failed && !result.generated) toast.error("Batch generation failed", msg);
      else toast.success("Batch generation complete", msg);
    } catch (err: unknown) {
      toast.error("Batch generation failed", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Portfolio"
        icon={<Layers size={16} />}
        iconColor="purple"
        subtitle="Every entity you manage and what's due across them."
      />

      {/* Firm summary */}
      <div className="stat-grid portfolio-stats">
        <StatTile
          label="Entities"
          value={totals.entities ?? 0}
          sub={`${plural(totals.societies ?? 0, "society", "societies")} · ${plural(totals.corporations ?? 0, "corporation", "corporations")}`}
        />
        <StatTile
          label="Overdue"
          value={totals.overdueDeadlines ?? 0}
          tone={(totals.overdueDeadlines ?? 0) > 0 ? "danger" : undefined}
          sub={<span className="portfolio-stats__sub">deadlines, all entities</span>}
        />
        <StatTile
          label="Upcoming"
          value={totals.upcomingDeadlines ?? 0}
          sub={<span className="portfolio-stats__sub">deadlines, all entities</span>}
        />
      </div>

      {records.length === 0 ? (
        <div className="card"><p>No entities yet. Create one from the workspace switcher.</p></div>
      ) : (
        <RecordListTable<EntityRecord>
          table={ENTITIES_TABLE}
          tableId="portfolio-entities"
          label="Entities"
          icon={<Layers size={14} />}
          records={records}
          selectable
          highlightedRecordId={current?._id ?? null}
          onOpen={(record) => open(record._id)}
          toolbarActions={<PortfolioBatchGenerate canWrite={canWrite} onGenerate={runBatch} />}
          renderCell={({ record, field }) => {
            const entity = record.entity;
            if (field.name === "name")
              return (
                <span className="portfolio-table__name workspace-portfolio-identity">
                  <WorkspaceLogo organization={identities.get(entity._id) ?? entity} />
                  <span>{entity.name}</span>
                  {current && current._id === entity._id && <span className="portfolio-current-tag"> · current</span>}
                </span>
              );
            if (field.name === "openDeadlines")
              return (
                <span className="portfolio-table__deadlines">
                  {entity.overdueDeadlines > 0 && (
                    <Badge tone="danger"><AlertTriangle size={11} style={{ verticalAlign: "middle" }} /> {entity.overdueDeadlines} overdue</Badge>
                  )}
                  {entity.upcomingDeadlines > 0 && <Badge tone="warn">{entity.upcomingDeadlines} upcoming</Badge>}
                  {entity.openDeadlines === 0 && <span className="muted">none open</span>}
                </span>
              );
            if (field.name === "postIncorporation")
              return entity.postIncorpTotal > 0
                ? <Badge tone={entity.postIncorpDone >= entity.postIncorpTotal ? "success" : "neutral"}>{entity.postIncorpDone}/{entity.postIncorpTotal} steps</Badge>
                : <span className="muted">—</span>;
            return undefined;
          }}
          renderRowActions={(record) => (
            <button type="button" className="btn btn--sm" onClick={() => open(record._id)}>
              {current && current._id === record._id ? "Open" : "Switch"}
            </button>
          )}
          renderPhoneCard={(record, { open: openCard, field, selecting }) => (
            <RecordTablePhoneCard
              title={record.name}
              badge={record.entity.overdueDeadlines > 0 ? <Badge tone="danger">{record.entity.overdueDeadlines} overdue</Badge> : undefined}
              meta={[field("kind"), record.incorporationNumber || record.status]}
              detail={[current && current._id === record._id ? "current" : "", record.formerNames ? `formerly ${record.formerNames}` : ""]}
              onOpen={openCard}
              selecting={selecting}
            />
          )}
          emptyState={<RecordTableEmpty title="No entities yet" />}
        />
      )}
    </div>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export default PortfolioPage;
