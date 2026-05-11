import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { Briefcase, HandHeart, Network, UserCog, UsersRound, X } from "lucide-react";

type OrgPerson = {
  type: "director" | "employee" | "volunteer";
  id: string;
  name: string;
  role: string;
  status?: string;
  href: string;
  note?: string;
};

export function OrgChartPage() {
  const society = useSociety();
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const employees = useQuery(api.employees.list, society ? { societyId: society._id } : "skip");
  const volunteers = useQuery(api.volunteers.list, society ? { societyId: society._id } : "skip");
  const assignments = useQuery(api.orgChartAssignments.list, society ? { societyId: society._id } : "skip");
  const upsertAssignment = useMutation(api.orgChartAssignments.upsert);
  const removeAssignment = useMutation(api.orgChartAssignments.remove);

  const currentDirectors = useMemo(
    () => ((directors ?? []) as any[]).filter(isCurrentDirector),
    [directors],
  );
  const activeEmployees = useMemo(
    () => ((employees ?? []) as any[]).filter((employee) => !employee.endDate),
    [employees],
  );
  const activeVolunteers = useMemo(
    () => ((volunteers ?? []) as any[]).filter((volunteer) => ["Active", "Applied", "NeedsReview"].includes(volunteer.status)),
    [volunteers],
  );
  const directorPeople: OrgPerson[] = currentDirectors.map((director) => ({
    type: "director",
    id: String(director._id),
    name: `${director.firstName} ${director.lastName}`.trim(),
    role: director.position || "Director",
    status: director.status,
    href: "/app/directors",
  }));
  const employeePeople: OrgPerson[] = activeEmployees.map((employee) => ({
    type: "employee",
    id: String(employee._id),
    name: `${employee.firstName} ${employee.lastName}`.trim(),
    role: employee.role || employee.employmentType,
    status: employee.employmentType,
    href: "/app/employees",
    note: employee.notes,
  }));
  const volunteerPeople: OrgPerson[] = activeVolunteers.map((volunteer) => ({
    type: "volunteer",
    id: String(volunteer._id),
    name: `${volunteer.firstName} ${volunteer.lastName}`.trim(),
    role: volunteer.roleWanted || "Volunteer",
    status: volunteer.status,
    href: "/app/volunteers",
    note: volunteer.notes,
  }));
  const allPeople = [...directorPeople, ...employeePeople, ...volunteerPeople];
  const assignmentBySubject = new Map(
    ((assignments ?? []) as any[]).map((assignment) => [`${assignment.subjectType}:${assignment.subjectId}`, assignment]),
  );
  const managerOptions = allPeople.map((person) => ({
    value: `${person.type}:${person.id}`,
    label: `${person.name || "Unnamed person"} - ${person.role || person.type}`,
    person,
  }));
  const saveManager = async (person: OrgPerson, value: string) => {
    if (!society) return;
    if (!value) {
      await removeAssignment({
        societyId: society._id,
        subjectType: person.type,
        subjectId: person.id,
      });
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

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page page--wide">
      <PageHeader
        title="Org chart"
        icon={<Network size={16} />}
        iconColor="pink"
        subtitle="A derived people map from current directors, active employees, and volunteer records."
      />

      <div className="org-chart">
        <div className="org-chart__root">
          <div className="org-card org-card--root">
            <UsersRound size={18} />
            <div>
              <strong>{society.name}</strong>
              <span>{currentDirectors.length} current director{currentDirectors.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>

        <div className="org-chart__lanes">
          <OrgLane
            title="Board"
            icon={<UserCog size={14} />}
            count={currentDirectors.length}
            empty="No active directors recorded."
          >
            {directorPeople.map((person) => (
              <OrgPersonCard
                key={person.id}
                person={person}
                assignment={assignmentBySubject.get(`${person.type}:${person.id}`)}
                managerOptions={managerOptions.filter((option) => option.value !== `${person.type}:${person.id}`)}
                onSaveManager={saveManager}
              />
            ))}
          </OrgLane>

          <OrgLane
            title="Employees"
            icon={<Briefcase size={14} />}
            count={activeEmployees.length}
            empty="No active employees recorded."
          >
            {employeePeople.map((person) => (
              <OrgPersonCard
                key={person.id}
                person={person}
                assignment={assignmentBySubject.get(`${person.type}:${person.id}`)}
                managerOptions={managerOptions.filter((option) => option.value !== `${person.type}:${person.id}`)}
                onSaveManager={saveManager}
              />
            ))}
          </OrgLane>

          <OrgLane
            title="Volunteers"
            icon={<HandHeart size={14} />}
            count={activeVolunteers.length}
            empty="No active volunteers recorded."
          >
            {volunteerPeople.map((person) => (
              <OrgPersonCard
                key={person.id}
                person={person}
                assignment={assignmentBySubject.get(`${person.type}:${person.id}`)}
                managerOptions={managerOptions.filter((option) => option.value !== `${person.type}:${person.id}`)}
                onSaveManager={saveManager}
              />
            ))}
          </OrgLane>
        </div>

        <div className="org-chart__note">
          <strong>Manager assignments</strong>
          <p>
            Assign a reports-to relationship on any active person. Assignments are stored separately from the source director, employee, and volunteer records.
          </p>
        </div>
      </div>
    </div>
  );
}

function OrgLane({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="org-lane">
      <div className="org-lane__head">
        <span>{icon}{title}</span>
        <Badge tone="neutral">{count}</Badge>
      </div>
      <div className="org-lane__body">
        {count ? children : <div className="org-lane__empty">{empty}</div>}
      </div>
    </section>
  );
}

function OrgPersonCard({
  person,
  assignment,
  managerOptions,
  onSaveManager,
}: {
  person: OrgPerson;
  assignment?: any;
  managerOptions: Array<{ value: string; label: string; person: OrgPerson }>;
  onSaveManager: (person: OrgPerson, value: string) => void | Promise<void>;
}) {
  const selected = assignment?.managerType && assignment?.managerId
    ? `${assignment.managerType}:${assignment.managerId}`
    : "";
  return (
    <div className="org-card" title={person.note || undefined}>
      <div className="org-card__main">
        <Link to={person.href}>
          <strong>{person.name.trim() || "Unnamed person"}</strong>
          <span>{person.role || "Unassigned role"}</span>
        </Link>
        <div className="org-card__manager">
          <select
            className="input"
            value={selected}
            aria-label={`Manager for ${person.name}`}
            onChange={(event) => onSaveManager(person, event.target.value)}
          >
            <option value="">No manager assigned</option>
            {managerOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {selected && (
            <button className="btn-action btn-action--icon" type="button" aria-label={`Clear manager for ${person.name}`} onClick={() => onSaveManager(person, "")}>
              <X size={12} />
            </button>
          )}
        </div>
        {assignment?.managerName && <span className="org-card__reports">Reports to {assignment.managerName}</span>}
      </div>
      {person.status && <Badge tone={person.status === "Active" ? "success" : "neutral"}>{person.status}</Badge>}
    </div>
  );
}

function isCurrentDirector(director: any) {
  const status = String(director?.status ?? "").toLowerCase();
  if (status && !["active", "current", "verified"].includes(status)) return false;
  const end = director?.termEnd || director?.resignedAt;
  return !end || String(end).slice(0, 10) >= new Date().toISOString().slice(0, 10);
}
