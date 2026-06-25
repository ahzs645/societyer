import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Users, Layers } from "lucide-react";
import { PageHeader, PageLoading } from "./_helpers";
import { useSocieties, setStoredSocietyId, useSociety } from "../hooks/useSociety";
import { organizationKind, organizationLabel } from "../../shared/organizationDomain";

/**
 * Portfolio — the multi-entity ("firm") view across every society AND corporation
 * in the workspace (the YCN entity-index idea). Lists entities grouped by kind
 * with a one-click switch into each. Universal registers (people directory,
 * service providers) already span entities; this is the index over them.
 */
const KIND_META: Record<string, { label: string; icon: typeof Building2; tone: string }> = {
  society: { label: "Societies", icon: Users, tone: "green" },
  corporation: { label: "Corporations", icon: Building2, tone: "blue" },
  organization: { label: "Other entities", icon: Layers, tone: "gray" },
};

export function PortfolioPage() {
  const societies = useSocieties() as Array<any> | undefined;
  const current = useSociety();
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    const out: Record<string, any[]> = { society: [], corporation: [], organization: [] };
    for (const s of societies ?? []) {
      const kind = organizationKind(s);
      (out[kind] ?? out.organization).push(s);
    }
    return out;
  }, [societies]);

  if (societies === undefined) return <PageLoading />;

  const total = societies.length;
  const open = (id: string) => {
    setStoredSocietyId(id as any);
    navigate("/app");
  };

  return (
    <div className="page">
      <PageHeader
        title="Portfolio"
        icon={<Layers size={16} />}
        iconColor="purple"
        subtitle={`All entities you manage — societies and corporations — in one place. ${total} entit${total === 1 ? "y" : "ies"}.`}
      />

      {total === 0 ? (
        <div className="card"><p>No entities yet. Create one from the workspace switcher.</p></div>
      ) : (
        (["society", "corporation", "organization"] as const).map((kind) => {
          const list = grouped[kind] ?? [];
          if (list.length === 0) return null;
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          return (
            <div className="card" key={kind} style={{ marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon size={16} /> {meta.label}{" "}
                <span style={{ color: "var(--text-tertiary)" }}>({list.length})</span>
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {list.map((s) => (
                  <div
                    key={s._id}
                    className="row"
                    style={{ gap: 8, justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}
                  >
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <strong>{organizationLabel(s)}</strong>
                      {s.incorporationNumber && (
                        <span style={{ color: "var(--text-tertiary)" }}>· {s.incorporationNumber}</span>
                      )}
                      {current && current._id === s._id && (
                        <span style={{ color: "var(--accent, green)" }}>· current</span>
                      )}
                    </span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {s.organizationStatus && (
                        <span style={{ color: "var(--text-tertiary)" }}>{s.organizationStatus}</span>
                      )}
                      <button className="btn" onClick={() => open(s._id)}>
                        {current && current._id === s._id ? "Open" : "Switch"}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default PortfolioPage;
