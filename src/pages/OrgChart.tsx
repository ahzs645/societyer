import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { Briefcase, HandHeart, Network, UserCog, UsersRound } from "lucide-react";

export function OrgChartPage() {
  const society = useSociety();
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const employees = useQuery(api.employees.list, society ? { societyId: society._id } : "skip");
  const volunteers = useQuery(api.volunteers.list, society ? { societyId: society._id } : "skip");

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
            {currentDirectors.map((director) => (
              <OrgPersonCard
                key={director._id}
                name={`${director.firstName} ${director.lastName}`}
                role={director.position || "Director"}
                status={director.status}
                href="/app/directors"
              />
            ))}
          </OrgLane>

          <OrgLane
            title="Employees"
            icon={<Briefcase size={14} />}
            count={activeEmployees.length}
            empty="No active employees recorded."
          >
            {activeEmployees.map((employee) => (
              <OrgPersonCard
                key={employee._id}
                name={`${employee.firstName} ${employee.lastName}`}
                role={employee.role || employee.employmentType}
                status={employee.employmentType}
                href="/app/employees"
                note={employee.notes}
              />
            ))}
          </OrgLane>

          <OrgLane
            title="Volunteers"
            icon={<HandHeart size={14} />}
            count={activeVolunteers.length}
            empty="No active volunteers recorded."
          >
            {activeVolunteers.map((volunteer) => (
              <OrgPersonCard
                key={volunteer._id}
                name={`${volunteer.firstName} ${volunteer.lastName}`}
                role={volunteer.roleWanted || "Volunteer"}
                status={volunteer.status}
                href="/app/volunteers"
                note={volunteer.notes}
              />
            ))}
          </OrgLane>
        </div>

        <div className="org-chart__note">
          <strong>Manager assignments</strong>
          <p>
            This chart is derived from existing records. The current employee and volunteer schemas do not include a dedicated manager or reports-to field, so formal reporting lines are not yet editable.
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
  name,
  role,
  status,
  href,
  note,
}: {
  name: string;
  role: string;
  status?: string;
  href: string;
  note?: string;
}) {
  return (
    <Link className="org-card" to={href} title={note || undefined}>
      <div>
        <strong>{name.trim() || "Unnamed person"}</strong>
        <span>{role || "Unassigned role"}</span>
      </div>
      {status && <Badge tone={status === "Active" ? "success" : "neutral"}>{status}</Badge>}
    </Link>
  );
}

function isCurrentDirector(director: any) {
  const status = String(director?.status ?? "").toLowerCase();
  if (status && !["active", "current", "verified"].includes(status)) return false;
  const end = director?.termEnd || director?.resignedAt;
  return !end || String(end).slice(0, 10) >= new Date().toISOString().slice(0, 10);
}
