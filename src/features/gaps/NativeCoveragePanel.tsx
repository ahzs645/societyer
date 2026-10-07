import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { IntakeRunCoverage } from "../intake/IntakeRunCoverage";

const AREA_LABELS: Record<string, string> = {
  meetings: "Meetings and minutes",
  motions: "Motions",
  people: "People, roles and attendance",
  committees: "Committees",
  governance: "Policies, bylaws and filings",
  finance: "Finance",
  insurance: "Insurance",
  grants: "Grants",
  communications: "Communications",
  programs: "Programs, goals and commitments",
  assets: "Assets",
  agreements: "Agreements",
  documents: "Documents",
  other: "Other",
};

/**
 * Native coverage = native records ÷ (native records + unresolved system gaps)
 * per area. A rough headline: it counts records, not individual facts.
 */
export function NativeCoveragePanel({ societyId }: { societyId: string }) {
  const data = useQuery(api.representationGaps.coverage, { societyId }) as any;
  if (!data) return <div className="muted">Loading coverage…</div>;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="stat-grid">
        <div className="stat">
          <div className="stat__label">Native coverage (all areas)</div>
          <div className="stat__value">{data.overall === null ? "—" : `${data.overall}%`}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Unresolved system gaps</div>
          <div className="stat__value">{data.areas.reduce((sum: number, area: any) => sum + area.gaps.open + area.gaps.keptAsText, 0)}</div>
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Native records are rows a person can see, filter and edit. Unresolved gaps are open, schema-change-requested or kept-as-text details from the sources.
        Coverage = native ÷ (native + unresolved gaps). Areas you cannot read show "—".
      </p>
      <div className="coverage-table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Area</th>
              <th>Native records</th>
              <th>Open gaps</th>
              <th>Kept as text</th>
              <th>Resolved</th>
              <th style={{ minWidth: 140 }}>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {data.areas.map((area: any) => (
              <tr key={area.area}>
                <td>
                  <strong>{AREA_LABELS[area.area] ?? area.area}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {area.native.length ? area.native.map((item: any) => `${item.label} ${item.count ?? "—"}`).join(" · ") : "No native object yet"}
                  </div>
                </td>
                <td>{area.nativeTotal}{area.partial ? "*" : ""}</td>
                <td>{area.gaps.open}</td>
                <td>{area.gaps.keptAsText}</td>
                <td>{area.gaps.resolved}</td>
                <td>
                  {area.coverage === null ? "—" : (
                    <div className="row" style={{ gap: 8 }}>
                      <div className="coverage-bar" role="img" aria-label={`${area.coverage}% native`}>
                        <div className="coverage-bar__fill" style={{ width: `${Math.min(100, area.coverage)}%` }} />
                      </div>
                      <span>{area.coverage}%</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.areas.some((area: any) => area.partial) && <div className="muted" style={{ fontSize: 12 }}>* Some record families in this area are not visible to your role.</div>}
      <IntakeRunCoverage societyId={societyId} />
    </div>
  );
}
