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
        effectiveDate: new Date().toISOString().slice(0, 10),
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
        subtitle={`Every entity you manage, with what's due and what's outstanding — and batch actions across them.`}
      />

      {/* Firm summary */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card"><span className="stat-card__label">Entities</span><span className="stat-card__value">{totals.entities ?? 0}</span></div>
        <div className="stat-card"><span className="stat-card__label">Corporations</span><span className="stat-card__value">{totals.corporations ?? 0}</span></div>
        <div className="stat-card"><span className="stat-card__label">Societies</span><span className="stat-card__value">{totals.societies ?? 0}</span></div>
        <div className="stat-card"><span className="stat-card__label">Overdue (firm-wide)</span><span className="stat-card__value">{totals.overdueDeadlines ?? 0}</span></div>
        <div className="stat-card"><span className="stat-card__label">Upcoming (firm-wide)</span><span className="stat-card__value">{totals.upcomingDeadlines ?? 0}</span></div>
      </div>

      {entities.length === 0 ? (
        <div className="card"><p>No entities yet. Create one from the workspace switcher.</p></div>
      ) : (
        <>
          {/* Batch generate (Multiple_Copy) */}
          <div className="card" style={{ marginBottom: 16, padding: 14 }}>
            <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
              <ListChecks size={16} /> Batch generate a document across entities
            </h3>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="muted" style={{ fontSize: 13 }}>Document packet</span>
                <select className="input" value={packetKey} onChange={(e) => setPacketKey(e.target.value)}>
                  <option value="">Select a packet…</option>
                  <optgroup label="Corporation packets">
                    {PACKET_OPTIONS.filter((p) => p.kind === "corporation").map((p) => <option key={`c-${p.key}`} value={p.key}>{p.label}</option>)}
                  </optgroup>
                  <optgroup label="Society packets">
                    {PACKET_OPTIONS.filter((p) => p.kind === "society").map((p) => <option key={`s-${p.key}`} value={p.key}>{p.label}</option>)}
                  </optgroup>
                </select>
              </label>
              {packetKind && (
                <button className="btn btn--ghost btn--sm" onClick={() => selectKind(packetKind)}>
                  Select all {packetKind}s
                </button>
              )}
              <button className="btn btn--accent" disabled={busy || !packetKey || selectedIds.length === 0} onClick={runBatch}>
                {busy ? "Generating…" : `Generate for ${selectedIds.length} selected`}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Tick entities in the table below. A packet only applies to its entity kind; mismatched entities are skipped and reported.
            </p>
          </div>

          {/* Entity table */}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 28 }} />
                  <th>Entity</th>
                  <th>Type</th>
                  <th>Deadlines</th>
                  <th>Post-incorporation</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entities.map((e) => (
                  <tr key={e._id}>
                    <td><input type="checkbox" checked={!!selected[e._id]} onChange={() => toggle(e._id)} /></td>
                    <td>
                      <strong>{e.name}</strong>
                      {current && current._id === e._id && <span style={{ color: "var(--accent, green)" }}> · current</span>}
                      <div className="muted">{e.incorporationNumber || (e.status ?? "")}</div>
                    </td>
                    <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                    <td>
                      {e.overdueDeadlines > 0 && (
                        <Badge tone="danger"><AlertTriangle size={11} style={{ verticalAlign: "middle" }} /> {e.overdueDeadlines} overdue</Badge>
                      )}
                      {e.upcomingDeadlines > 0 && <Badge tone="warn">{e.upcomingDeadlines} upcoming</Badge>}
                      {e.openDeadlines === 0 && <span className="muted">none open</span>}
                    </td>
                    <td>
                      {e.postIncorpTotal > 0
                        ? <Badge tone={e.postIncorpDone >= e.postIncorpTotal ? "success" : "neutral"}>{e.postIncorpDone}/{e.postIncorpTotal} steps</Badge>
                        : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
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

export default PortfolioPage;
