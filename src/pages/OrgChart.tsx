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
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { useThemePreference } from "../hooks/useThemePreference";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { Link } from "react-router-dom";
import { GitBranch, ListTree, Network, X } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { todayDateOnly } from "../../shared/dateOnly";
import { useIsMobile } from "../lib/useIsMobile";
import { InfoPopover } from "../components/InfoPopover";
import {
  buildOrgTree,
  descendantKeys,
  findNode,
  layoutOrgTree,
  NODE_WIDTH,
  personKey,
  type OrgPerson,
  type OrgTreeNode,
} from "../lib/orgChartLayout";


const TYPE_TONE: Record<string, { color: string; label: string }> = {
  root: { color: "var(--text-primary)", label: "Organization" },
  group: { color: "var(--text-tertiary)", label: "" },
  director: { color: "var(--accent)", label: "Director" },
  employee: { color: "var(--success)", label: "Employee" },
  volunteer: { color: "var(--warn)", label: "Volunteer" },
};

function OrgNode({ data }: NodeProps) {
  const d = data as {
    kind: OrgTreeNode["kind"] | "team";
    label: string;
    role?: string;
    count?: number;
    selected?: boolean | string | null;
    members?: OrgPerson[];
    onSelect?: (key: string | null) => void;
  };
  if (d.kind === "team") {
    return (
      <div className="org-node org-node--team" style={{ width: NODE_WIDTH }}>
        <Handle type="target" position={Position.Top} className="org-node__handle" />
        <div className="org-node__group">
          <span>{d.label}</span>
          <span className="org-node__count">{d.members?.length}</span>
        </div>
        <ul className="org-node__members">
          {d.members?.map((member) => {
            const key = personKey(member);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`org-node__member org-node__member--${member.type}${d.selected === key ? " is-selected" : ""}`}
                  onClick={(event) => { event.stopPropagation(); d.onSelect?.(d.selected === key ? null : key); }}
                >
                  <span className="org-node__name">{member.name || "Unnamed"}</span>
                  {member.role && <span className="org-node__role">{member.role}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <Handle type="source" position={Position.Bottom} className="org-node__handle" />
      </div>
    );
  }
  const tone = TYPE_TONE[d.kind] ?? TYPE_TONE.root;
  return (
    <div
      className={`org-node org-node--${d.kind}${d.selected ? " is-selected" : ""}`}
      style={{ width: NODE_WIDTH, ["--org-tone" as string]: tone.color }}
    >
      <Handle type="target" position={Position.Top} className="org-node__handle" />
      {d.kind === "group" ? (
        <div className="org-node__group">
          <span>{d.label}</span>
          {d.count != null && <span className="org-node__count">{d.count}</span>}
        </div>
      ) : (
        <>
          <div className="org-node__name">{d.label}</div>
          {d.role && <div className="org-node__role">{d.role}</div>}
        </>
      )}
      <Handle type="source" position={Position.Bottom} className="org-node__handle" />
    </div>
  );
}

const nodeTypes = { orgPerson: OrgNode };

// Did this director hold office on the given date? Pure term-interval check:
// present-day `status` must NOT gate a historical query, or a since-resigned
// director wrongly vanishes from the chart for the dates they actually served.
function directorActiveOn(d: any, dateISO: string): boolean {
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

// Volunteers carry no tenure interval, so a past date can only be approximated:
// include those who had joined by then (approved/applied on or before the date).
// Departures can't be reconstructed from the data, so this over-includes rather
// than inventing an end date.
function volunteerActiveOn(v: any, dateISO: string): boolean {
  const start = String(v?.approvedAtISO ?? v?.applicationReceivedAtISO ?? "").slice(0, 10);
  return !start || start <= dateISO;
}

function isCurrentDirector(d: any): boolean {
  const status = String(d?.status ?? "").toLowerCase();
  if (status && !["active", "current", "verified"].includes(status)) return false;
  return directorActiveOn(d, todayDateOnly());
}

export function OrgChartPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canReadAssignments = can("settings:read");
  const canEditAssignments = can("settings:write");
  // As-of date (YYYY-MM-DD); "" = live. Time-travel to a past org structure.
  const [asOf, setAsOf] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  // Phones get the outline by default: a canvas of tiny boxes is hard to read
  // and pan with a thumb. Either view is one tap away.
  const isMobile = useIsMobile();
  const [modeChoice, setMode] = useState<"chart" | "list" | null>(null);
  const mode = modeChoice ?? (isMobile ? "list" : "chart");

  const directors = useQuery(api.directors.list, society && can("directors:read") ? { societyId: society._id } : "skip");
  const employees = useQuery(api.employees.list, society && can("employees:read") ? { societyId: society._id } : "skip");
  const volunteers = useQuery(api.volunteers.list, society && can("volunteers:read") ? { societyId: society._id } : "skip");
  const liveAssignments = useQuery(api.orgChartAssignments.list, society && canReadAssignments ? { societyId: society._id } : "skip");
  const asOfAssignments = useQuery(
    api.orgChartAssignments.listAsOf,
    society && canReadAssignments && asOf ? { societyId: society._id, asOf } : "skip",
  );
  const upsertAssignment = useMutation(api.orgChartAssignments.upsert);
  const removeAssignment = useMutation(api.orgChartAssignments.remove);

  const dateForFilter = asOf || todayDateOnly();

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
      }));
    const volunteerPeople: OrgPerson[] = ((volunteers ?? []) as any[])
      .filter((v) =>
        asOf ? volunteerActiveOn(v, dateForFilter) : ["Active", "Applied", "NeedsReview"].includes(v.status),
      )
      .map((volunteer) => ({
        type: "volunteer",
        id: String(volunteer._id),
        name: `${volunteer.firstName} ${volunteer.lastName}`.trim(),
        role: volunteer.roleWanted || "Volunteer",
        status: volunteer.status,
        href: "/app/volunteers",
      }));
    return [...directorPeople, ...employeePeople, ...volunteerPeople];
  }, [directors, employees, volunteers, asOf, dateForFilter]);

  const assignments = useMemo(() => (asOf ? asOfAssignments : liveAssignments) ?? [], [asOf, asOfAssignments, liveAssignments]);
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

  const tree = useMemo(
    () =>
      buildOrgTree(society?.name ?? "Organization", allPeople, (key) => {
        const a = assignmentBySubject.get(key);
        return a?.managerId && a?.managerType ? `${a.managerType}:${a.managerId}` : undefined;
      }),
    [society?.name, allPeople, assignmentBySubject],
  );
  // Fit the viewport again whenever the structure changes (React Flow's
  // fitView only runs on mount, which happens before the records arrive).
  const structureKey = useMemo(() => layoutOrgTree(tree).map((entry) => `${entry.node.key}@${entry.parentKey ?? ""}`).join("|"), [tree]);

  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  // The instance belongs to the mounted canvas; drop it when the outline replaces it.
  useEffect(() => {
    if (mode !== "chart") setFlow(null);
  }, [mode]);
  useEffect(() => {
    if (!flow || mode !== "chart") return;
    // Wait a frame so the new nodes are measured before fitting.
    const frame = requestAnimationFrame(() => void flow.fitView({ padding: 0.15, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [flow, structureKey, mode]);

  useEffect(() => {
    const positioned = layoutOrgTree(tree);
    setNodes(positioned.map(({ node, x, y }) => ({
      id: node.key,
      type: "orgPerson",
      position: { x, y },
      selectable: node.kind !== "root" && node.kind !== "group" && node.kind !== "team",
      data: node.kind === "team"
        ? { kind: "team", label: node.label, members: node.members, selected, onSelect: setSelected }
        : { kind: node.kind, label: node.label, role: node.role, count: node.count, selected: node.key === selected },
    })));
    setEdges(positioned.filter((entry) => entry.parentKey).map(({ node, parentKey }) => ({
      id: `${parentKey}->${node.key}`,
      source: parentKey!,
      target: node.key,
      type: "smoothstep",
      style: { stroke: "var(--border-strong)", strokeWidth: 1.25 },
    })));
  }, [tree, selected, setNodes, setEdges]);

  const saveManager = async (person: OrgPerson, value: string) => {
    if (!society || !canEditAssignments || asOf) return;
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

  const selectedPerson = allPeople.find((p) => personKey(p) === selected) ?? null;
  const selectedAssignment = selected ? assignmentBySubject.get(selected) : undefined;
  const selectedManagerValue =
    selectedAssignment?.managerType && selectedAssignment?.managerId
      ? `${selectedAssignment.managerType}:${selectedAssignment.managerId}`
      : "";
  // A person can't report to someone who already reports to them.
  const blockedManagers = selected ? descendantKeys(findNode(tree, selected) ?? tree) : new Set<string>();
  const counts = {
    director: allPeople.filter((p) => p.type === "director").length,
    employee: allPeople.filter((p) => p.type === "employee").length,
    volunteer: allPeople.filter((p) => p.type === "volunteer").length,
  };
  const partial = !can("directors:read") || !can("employees:read") || !can("volunteers:read") || !canReadAssignments;

  return (
    <div className="page page--wide">
      <PageHeader
        title="Org chart"
        icon={<Network size={16} />}
        iconColor="pink"
        subtitle="Who reports to whom across the board, staff and volunteers."
        info={
          <>
            <p>Select a person to set who they report to. Anyone without a reporting line sits under their group.</p>
            <p>Reporting lines are stored separately from the people records and versioned, so “As of” can show a past structure.</p>
            {partial && <p>Only the people and reporting lines your role can read are shown.</p>}
          </>
        }
      />

      <div className="org-chart-toolbar">
        <div className="segmented" role="group" aria-label="Org chart view">
          <button type="button" className={`segmented__btn${mode === "chart" ? " is-active" : ""}`} aria-pressed={mode === "chart"} onClick={() => setMode("chart")}>
            <GitBranch size={12} /> Chart
          </button>
          <button type="button" className={`segmented__btn${mode === "list" ? " is-active" : ""}`} aria-pressed={mode === "list"} onClick={() => setMode("list")}>
            <ListTree size={12} /> Outline
          </button>
        </div>
        <span className="org-chart-toolbar__legend" aria-label="People on the chart">
          <span className="org-legend org-legend--director">{counts.director} {counts.director === 1 ? "director" : "directors"}</span>
          <span className="org-legend org-legend--employee">{counts.employee} staff</span>
          <span className="org-legend org-legend--volunteer">{counts.volunteer} {counts.volunteer === 1 ? "volunteer" : "volunteers"}</span>
        </span>
        <label className="org-chart-toolbar__asof" title="Reconstruct the org chart at a past date">
          <span>As of</span>
          <DatePicker value={asOf} onChange={(value) => setAsOf(value)} style={{ width: 150 }} />
          {asOf && <button className="btn btn--ghost btn--sm" onClick={() => setAsOf("")}>Live</button>}
        </label>
      </div>
      {asOf && (
        <p className="org-chart-note">
          The structure on <strong>{asOf}</strong>: people active that day and the reporting lines saved then. Editing is off while viewing the past.
        </p>
      )}

      <div className="org-chart-layout">
        {mode === "chart" ? (
          <div className="org-chart-layout__canvas">
            <ReactFlow
              onInit={setFlow}
              colorMode={resolvedTheme}
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => {
                const kind = (node.data as { kind?: string }).kind;
                if (kind === "root" || kind === "group" || kind === "team") return;
                setSelected(node.id);
              }}
              onPaneClick={() => setSelected(null)}
              nodesConnectable={false}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        ) : (
          <div className="card org-outline">
            <OrgOutline node={tree} selected={selected} onSelect={setSelected} />
          </div>
        )}

        <aside className="org-chart-layout__aside">
          <div className="card">
            <div className="card__head"><h2 className="card__title">{selectedPerson ? "Reporting line" : "Reporting lines"}</h2></div>
            <div className="card__body col" style={{ gap: 12 }}>
              {!selectedPerson ? (
                <div className="muted">Select a person to set who they report to.</div>
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
                      disabled={Boolean(asOf) || !canEditAssignments}
                      onChange={(value) => saveManager(selectedPerson, value)}
                      searchable
                      options={[
                        { value: "", label: `No one (${GROUP_HOME[selectedPerson.type]})` },
                        ...managerOptions
                          .filter((o) => o.value !== personKey(selectedPerson) && !blockedManagers.has(o.value))
                          .map((o) => ({ value: o.value, label: o.label })),
                      ]}
                    />
                  </label>
                  {!canEditAssignments && <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>Changing reporting lines needs settings access.</p>}
                  {selectedManagerValue && !asOf && canEditAssignments && (
                    <button className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => saveManager(selectedPerson, "")}>
                      <X size={12} /> Clear reporting line
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const GROUP_HOME: Record<OrgPerson["type"], string> = {
  director: "sits with the board",
  employee: "sits with staff",
  volunteer: "sits with volunteers",
};

function OrgOutline({ node, selected, onSelect }: { node: OrgTreeNode; selected: string | null; onSelect: (key: string | null) => void }) {
  return (
    <ul className="org-outline__list" role="tree" aria-label="Organization outline">
      <OrgOutlineItem node={node} selected={selected} onSelect={onSelect} depth={0} />
    </ul>
  );
}

function OrgOutlineItem({ node, selected, onSelect, depth }: { node: OrgTreeNode; selected: string | null; onSelect: (key: string | null) => void; depth: number }) {
  const isPerson = node.kind !== "root" && node.kind !== "group";
  return (
    <li role="treeitem" aria-expanded={node.children.length ? true : undefined} aria-selected={isPerson ? selected === node.key : undefined}>
      {isPerson ? (
        <button
          type="button"
          className={`org-outline__row org-outline__row--${node.kind}${selected === node.key ? " is-selected" : ""}`}
          onClick={() => onSelect(selected === node.key ? null : node.key)}
        >
          <span className="org-outline__dot" aria-hidden="true" />
          <span className="org-outline__name">{node.label}</span>
          {node.role && <span className="org-outline__role">{node.role}</span>}
        </button>
      ) : (
        <div className={`org-outline__row org-outline__row--${node.kind}`}>
          <span className="org-outline__name">{node.label}</span>
          {node.kind === "group" && <span className="org-outline__count">{node.children.length}</span>}
        </div>
      )}
      {node.children.length > 0 && (
        <ul className="org-outline__list" role="group">
          {node.children.map((child) => (
            <OrgOutlineItem key={child.key} node={child} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
