import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useThemePreference } from "../hooks/useThemePreference";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { Link } from "react-router-dom";
import { Network, UsersRound, X } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";

type OrgPerson = {
  type: "director" | "employee" | "volunteer";
  id: string;
  name: string;
  role: string;
  status?: string;
  href: string;
  note?: string;
};

const TYPE_TONE: Record<string, { bg: string; border: string; label: string }> = {
  root: { bg: "var(--bg-subtle)", border: "var(--accent)", label: "Entity" },
  director: { bg: "color-mix(in srgb, var(--accent) 12%, var(--bg-panel))", border: "var(--accent)", label: "Director" },
  employee: { bg: "color-mix(in srgb, var(--success) 12%, var(--bg-panel))", border: "var(--success)", label: "Employee" },
  volunteer: { bg: "color-mix(in srgb, var(--warn) 14%, var(--bg-panel))", border: "var(--warn)", label: "Volunteer" },
};

function OrgNode({ data }: NodeProps) {
  const d = data as any;
  const tone = TYPE_TONE[d.type] ?? TYPE_TONE.root;
  return (
    <div
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderLeft: `4px solid ${tone.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 150,
        maxWidth: 220,
        boxShadow: d.selected ? "0 0 0 2px var(--accent)" : "var(--shadow-sm)",
        color: "var(--text-primary)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: d.type === "root" ? 0 : undefined }} />
      <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {tone.label}
      </div>
      <div style={{ fontWeight: 600, fontSize: "var(--fs-md)" }}>{d.label}</div>
      {d.role && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{d.role}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { orgPerson: OrgNode };

const ROW_GAP = 170;
const COL_GAP = 240;

function directorActiveOn(d: any, dateISO: string): boolean {
  const status = String(d?.status ?? "").toLowerCase();
  if (status && !["active", "current", "verified"].includes(status)) return false;
  const start = d?.termStart ? String(d.termStart).slice(0, 10) : "";
  const end = (d?.termEnd || d?.resignedAt) ? String(d.termEnd || d.resignedAt).slice(0, 10) : "";
  if (start && start > dateISO) return false;
  if (end && end < dateISO) return false;
  return true;
}

function employeeActiveOn(e: any, dateISO: string): boolean {
  const start = e?.startDate ? String(e.startDate).slice(0, 10) : "";
  const end = e?.endDate ? String(e.endDate).slice(0, 10) : "";
  if (start && start > dateISO) return false;
  if (end && end < dateISO) return false;
  return true;
}

function isCurrentDirector(d: any): boolean {
  return directorActiveOn(d, new Date().toISOString().slice(0, 10));
}

export function OrgChartPage() {
  const society = useSociety();
  // As-of date (YYYY-MM-DD); "" = live. Time-travel to a past org structure.
  const [asOf, setAsOf] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);

  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const employees = useQuery(api.employees.list, society ? { societyId: society._id } : "skip");
  const volunteers = useQuery(api.volunteers.list, society ? { societyId: society._id } : "skip");
  const liveAssignments = useQuery(api.orgChartAssignments.list, society ? { societyId: society._id } : "skip");
  const asOfAssignments = useQuery(
    api.orgChartAssignments.listAsOf,
    society && asOf ? { societyId: society._id, asOf } : "skip",
  );
  const upsertAssignment = useMutation(api.orgChartAssignments.upsert);
  const removeAssignment = useMutation(api.orgChartAssignments.remove);

  const dateForFilter = asOf || new Date().toISOString().slice(0, 10);

  const allPeople = useMemo<OrgPerson[]>(() => {
    const directorPeople: OrgPerson[] = ((directors ?? []) as any[])
      .filter((d) => (asOf ? directorActiveOn(d, dateForFilter) : isCurrentDirector(d)))
      .map((director) => ({
        type: "director",
        id: String(director._id),
        name: `${director.firstName} ${director.lastName}`.trim(),
        role: director.position || "Director",
        status: director.status,
        href: "/app/directors",
      }));
    const employeePeople: OrgPerson[] = ((employees ?? []) as any[])
      .filter((e) => (asOf ? employeeActiveOn(e, dateForFilter) : !e.endDate))
      .map((employee) => ({
        type: "employee",
        id: String(employee._id),
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        role: employee.role || employee.employmentType,
        status: employee.employmentType,
        href: "/app/employees",
        note: employee.notes,
      }));
    const volunteerPeople: OrgPerson[] = ((volunteers ?? []) as any[])
      .filter((v) => ["Active", "Applied", "NeedsReview"].includes(v.status))
      .map((volunteer) => ({
        type: "volunteer",
        id: String(volunteer._id),
        name: `${volunteer.firstName} ${volunteer.lastName}`.trim(),
        role: volunteer.roleWanted || "Volunteer",
        status: volunteer.status,
        href: "/app/volunteers",
        note: volunteer.notes,
      }));
    return [...directorPeople, ...employeePeople, ...volunteerPeople];
  }, [directors, employees, volunteers, asOf, dateForFilter]);

  const assignments = (asOf ? asOfAssignments : liveAssignments) ?? [];
  const assignmentBySubject = useMemo(
    () => new Map(((assignments ?? []) as any[]).map((a) => [`${a.subjectType}:${a.subjectId}`, a])),
    [assignments],
  );

  const managerOptions = useMemo(
    () =>
      allPeople.map((person) => ({
        value: `${person.type}:${person.id}`,
        label: `${person.name || "Unnamed"} — ${person.role || person.type}`,
        person,
      })),
    [allPeople],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // React Flow otherwise forces color-scheme: light on its subtree, which flips
  // the app's light-dark() theme vars (node backgrounds, Controls) back to light
  // even in dark mode. Match its colorMode to the resolved app theme.
  const { resolvedTheme } = useThemePreference();

  // Recompute the graph whenever the structure (people / assignments / date)
  // changes. Drag positions are kept by ReactFlow between recomputes of the
  // same structure since the dependency refs stay stable.
  useEffect(() => {
    const rootId = "root";
    const tiers: Record<string, number> = { director: 0, employee: 1, volunteer: 2 };
    const perTierCount: Record<string, number> = {};
    const builtNodes: Node[] = [
      {
        id: rootId,
        type: "orgPerson",
        position: { x: 0, y: -ROW_GAP },
        data: { label: society?.name ?? "Entity", role: "", type: "root" },
      },
    ];
    for (const person of allPeople) {
      const tier = tiers[person.type] ?? 1;
      const col = perTierCount[person.type] = (perTierCount[person.type] ?? 0) + 1;
      builtNodes.push({
        id: `${person.type}:${person.id}`,
        type: "orgPerson",
        position: { x: (col - 1) * COL_GAP, y: tier * ROW_GAP },
        data: { label: person.name || "Unnamed", role: person.role, type: person.type, href: person.href },
      });
    }
    const builtEdges: Edge[] = allPeople.map((person) => {
      const a = assignmentBySubject.get(`${person.type}:${person.id}`);
      const source = a?.managerId && a?.managerType ? `${a.managerType}:${a.managerId}` : rootId;
      return {
        id: `${source}->${person.type}:${person.id}`,
        source,
        target: `${person.type}:${person.id}`,
        type: "smoothstep",
        style: { stroke: "var(--border-strong)", strokeWidth: 1.5 },
      };
    });
    setNodes(builtNodes);
    setEdges(builtEdges);
  }, [allPeople, assignmentBySubject, society?.name, setNodes, setEdges]);

  const saveManager = async (person: OrgPerson, value: string) => {
    if (!society) return;
    if (!value) {
      await removeAssignment({ societyId: society._id, subjectType: person.type, subjectId: person.id });
      return;
    }
    const manager = managerOptions.find((option) => option.value === value)?.person;
    if (!manager) return;
    await upsertAssignment({
      societyId: society._id,
      subjectType: person.type,
      subjectId: person.id,
      subjectName: person.name || "Unnamed person",
      managerType: manager.type,
      managerId: manager.id,
      managerName: manager.name || "Unnamed person",
    });
  };

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const selectedPerson = allPeople.find((p) => `${p.type}:${p.id}` === selected) ?? null;
  const selectedAssignment = selected ? assignmentBySubject.get(selected) : undefined;
  const selectedManagerValue =
    selectedAssignment?.managerType && selectedAssignment?.managerId
      ? `${selectedAssignment.managerType}:${selectedAssignment.managerId}`
      : "";

  return (
    <div className="page page--wide">
      <PageHeader
        title="Org chart"
        icon={<Network size={16} />}
        iconColor="pink"
        subtitle="A live, draggable map of directors, employees, and volunteers and their reporting lines. Drag to rearrange, zoom to explore, and use “As of” to see a past structure."
        actions={
          <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Reconstruct the org chart at a past date">
            <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>As of</span>
            <DatePicker value={asOf} onChange={(value) => setAsOf(value)} style={{ width: 150 }} />
            {asOf && <button className="btn btn--ghost btn--sm" onClick={() => setAsOf("")}>Live</button>}
          </label>
        }
      />

      {asOf && (
        <div className="muted" style={{ marginBottom: 12 }}>
          Showing the structure as it stood on <strong>{asOf}</strong> (reporting lines from the saved history; people active on that date).
          Editing is disabled while time-travelling.
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        <div style={{ flex: 1, height: 620, border: "1px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
          <ReactFlow
            colorMode={resolvedTheme}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelected(node.id === "root" ? null : node.id)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        <aside style={{ width: 280, flexShrink: 0 }}>
          <div className="card">
            <div className="card__head"><h2 className="card__title">{selectedPerson ? "Reporting line" : "Select a person"}</h2></div>
            <div className="card__body col" style={{ gap: 12 }}>
              {!selectedPerson ? (
                <div className="muted">Click a node to set who they report to. The chart redraws automatically.</div>
              ) : (
                <>
                  <div>
                    <Link to={selectedPerson.href}><strong>{selectedPerson.name || "Unnamed person"}</strong></Link>
                    <div className="muted">{selectedPerson.role}</div>
                    {selectedPerson.status && (
                      <Badge tone={selectedPerson.status === "Active" ? "success" : "neutral"}>{selectedPerson.status}</Badge>
                    )}
                  </div>
                  <label style={{ display: "block" }}>
                    <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Reports to</span>
                    <Select
                      value={selectedManagerValue}
                      disabled={Boolean(asOf)}
                      onChange={(value) => saveManager(selectedPerson, value)}
                      options={[
                        { value: "", label: "No manager (reports to the entity)" },
                        ...managerOptions
                          .filter((o) => o.value !== `${selectedPerson.type}:${selectedPerson.id}`)
                          .map((o) => ({ value: o.value, label: o.label })),
                      ]}
                    />
                  </label>
                  {selectedManagerValue && !asOf && (
                    <button className="btn btn--ghost btn--sm" onClick={() => saveManager(selectedPerson, "")}>
                      <X size={12} /> Clear manager
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card__body col" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <UsersRound size={16} />
                <strong>{allPeople.length}</strong>
                <span className="muted">people on the chart</span>
              </div>
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                {TYPE_TONE.director.label}s, {TYPE_TONE.employee.label.toLowerCase()}s, and {TYPE_TONE.volunteer.label.toLowerCase()}s. Assignments are
                stored separately from the source records and versioned so the chart can be rewound.
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
