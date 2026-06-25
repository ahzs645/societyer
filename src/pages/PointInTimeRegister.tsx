import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { History } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";

/**
 * Point-in-Time Register — reconstructs who held each role on a chosen date,
 * using the roleHolders startDate/endDate intervals (logic:
 * shared/registerHistory.ts via convex/registerHistory.ts). Answers the
 * statutory minute-book question "who were the directors on date X?".
 *
 * Read-only: no mutations, so it does not touch the static-mirror write gate.
 */
const ROLES: Array<{ roleType: string; label: string }> = [
  { roleType: "director", label: "Directors" },
  { roleType: "officer", label: "Officers" },
  { roleType: "member", label: "Members" },
];

function RoleColumn({
  societyId,
  asOf,
  roleType,
  label,
}: {
  societyId: string;
  asOf: string;
  roleType: string;
  label: string;
}) {
  const rows = useQuery(api.registerHistory.roleHoldersAsOfDate, {
    societyId,
    asOf,
    roleType,
  }) as Array<{ _id?: string; fullName?: string; startDate?: string }> | undefined;

  return (
    <div className="card" style={{ flex: 1, minWidth: 220 }}>
      <h3 style={{ margin: "0 0 8px" }}>
        {label} <span style={{ color: "var(--text-tertiary)" }}>({rows?.length ?? 0})</span>
      </h3>
      {rows === undefined ? (
        <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)" }}>None in office on this date.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {rows.map((r) => (
            <li key={r._id ?? r.fullName}>
              {r.fullName}
              {r.startDate ? (
                <span style={{ color: "var(--text-tertiary)" }}> · since {r.startDate}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PointInTimeRegisterPage() {
  const society = useSociety();
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Point-in-time register"
        icon={<History size={16} />}
        iconColor="blue"
        subtitle="Reconstruct who held each role on any past date from the role-holder term history — the statutory 'who were the directors on date X?' view."
        actions={
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>As of</span>
            <input
              type="date"
              className="input"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
        }
      />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {ROLES.map((role) => (
          <RoleColumn
            key={role.roleType}
            societyId={society._id}
            asOf={asOf}
            roleType={role.roleType}
            label={role.label}
          />
        ))}
      </div>
    </div>
  );
}

export default PointInTimeRegisterPage;
