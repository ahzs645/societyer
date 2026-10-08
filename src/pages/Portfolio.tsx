import { usePermissions } from "@/hooks/usePermissions";
import { InfoPopover } from "../components/InfoPopover";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Layers, AlertTriangle, ListChecks } from "lucide-react";
import { PageHeader, PageLoading } from "./_helpers";
import { setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { Badge } from "../components/ui";
import { useToast } from "../components/Toast";
import { CORPORATION_DOCUMENT_PACKETS } from "../../shared/corporationDocumentPackets";
import { SOCIETY_DOCUMENT_PACKETS } from "../../shared/societyDocumentPackets";
import { todayDateOnly } from "../../shared/dateOnly";

type FirmEntity = {
  _id: string;
  name: string;
  kind: string;
  incorporationNumber: string | null;
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
export function PortfolioPage() {
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("society:write");
  const data = useQuery(api.firm.overview, {}) as
    | { today: string; entities: FirmEntity[]; totals: any }
    | undefined;
  const current = useSociety();
  const batchGenerate = useMutation(api.firm.batchGeneratePacket);
  const toast = useToast();
  const navigate = useNavigate();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [packetKey, setPacketKey] = useState("");
  const [busy, setBusy] = useState(false);

  const entities = data?.entities ?? [];
  const selectedIds = useMemo(() => entities.filter((e) => selected[e._id]).map((e) => e._id), [entities, selected]);

  if (data === undefined) return <PageLoading />;

  const totals = data.totals ?? {};
  const open = (id: string) => { setStoredSocietyId(id as any); navigate("/app"); };
  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const packetKind = PACKET_OPTIONS.find((p) => p.key === packetKey)?.kind;
  const selectKind = (kind: string) => {
    const next: Record<string, boolean> = {};
    for (const e of entities) if (e.kind === kind) next[e._id] = true;
    setSelected(next);
  };

  const runBatch = async () => {
    if (!packetKey || selectedIds.length === 0) return;
    setBusy(true);
    try {
      const result: any = await batchGenerate({
        societyIds: selectedIds as any,
        packetKey,
        effectiveDate: todayDateOnly(),
      });
      const msg = `${result.generated} generated${result.failed ? `, ${result.failed} failed (wrong entity type or unseeded)` : ""}.`;
      if (result.failed && !result.generated) toast.error("Batch generation failed", msg);
      else toast.success("Batch generation complete", msg);
    } catch (err: any) {
      toast.error("Batch generation failed", err?.message ?? String(err));
    } finally {
      setBusy(false);
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
        <div className="stat">
          <span className="stat__label">Entities</span>
          <span className="stat__value">{totals.entities ?? 0}</span>
          <span className="stat__sub">{plural(totals.societies ?? 0, "society", "societies")} · {plural(totals.corporations ?? 0, "corporation", "corporations")}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Overdue</span>
          <span className="stat__value" style={{ color: (totals.overdueDeadlines ?? 0) > 0 ? "var(--danger)" : undefined }}>{totals.overdueDeadlines ?? 0}</span>
          <span className="stat__sub portfolio-stats__sub">deadlines, all entities</span>
        </div>
        <div className="stat">
          <span className="stat__label">Upcoming</span>
          <span className="stat__value">{totals.upcomingDeadlines ?? 0}</span>
          <span className="stat__sub portfolio-stats__sub">deadlines, all entities</span>
        </div>
      </div>

      {entities.length === 0 ? (
        <div className="card"><p>No entities yet. Create one from the workspace switcher.</p></div>
      ) : (
        <>
          {/* Batch generate (Multiple_Copy) */}
          <div className="portfolio-batch" role="group" aria-label="Batch generate a document">
            <span className="portfolio-batch__label">
              <ListChecks size={14} aria-hidden="true" /> Batch generate
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
              <button className="btn btn--ghost btn--sm" onClick={() => selectKind(packetKind)}>
                Select all {packetKind}s
              </button>
            )}
            <button className="btn btn--accent btn--sm" disabled={!canWrite || (busy || !packetKey || selectedIds.length === 0)} onClick={runBatch}>
              {busy ? "Generating…" : selectedIds.length ? `Generate for ${selectedIds.length}` : "Generate"}
            </button>
          </div>

          {/* Entity table */}
          <div className="table-wrap">
            <table className="table portfolio-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Entity</th>
                  <th className="portfolio-table__wide">Type</th>
                  <th>Deadlines</th>
                  <th className="portfolio-table__wide">Post-incorporation</th>
                  <th className="portfolio-table__wide" />
                </tr>
              </thead>
              <tbody>
                {entities.map((e) => (
                  <tr key={e._id}>
                    <td><input type="checkbox" aria-label={`Select ${e.name}`} checked={!!selected[e._id]} onChange={() => toggle(e._id)} /></td>
                    <td>
                      <button type="button" className="portfolio-table__name" onClick={() => open(e._id)}>{e.name}</button>
                      {current && current._id === e._id && <span className="portfolio-current-tag" style={{ color: "var(--accent, green)" }}> · current</span>}
                      <div className="muted">
                        <span className="portfolio-table__narrow">{KIND_LABEL[e.kind] ?? e.kind} · </span>
                        {e.incorporationNumber || (e.status ?? "")}
                      </div>
                    </td>
                    <td className="portfolio-table__wide">{KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td className="portfolio-table__deadlines">
                      {e.overdueDeadlines > 0 && (
                        <Badge tone="danger"><AlertTriangle size={11} style={{ verticalAlign: "middle" }} /> {e.overdueDeadlines} overdue</Badge>
                      )}
                      {e.upcomingDeadlines > 0 && <Badge tone="warn">{e.upcomingDeadlines} upcoming</Badge>}
                      {e.openDeadlines === 0 && <span className="muted">none open</span>}
                    </td>
                    <td className="portfolio-table__wide">
                      {e.postIncorpTotal > 0
                        ? <Badge tone={e.postIncorpDone >= e.postIncorpTotal ? "success" : "neutral"}>{e.postIncorpDone}/{e.postIncorpTotal} steps</Badge>
                        : <span className="muted">—</span>}
                    </td>
                    <td className="portfolio-table__wide" style={{ textAlign: "right" }}>
                      <button className="btn btn--sm" onClick={() => open(e._id)}>
                        {current && current._id === e._id ? "Open" : "Switch"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export default PortfolioPage;
