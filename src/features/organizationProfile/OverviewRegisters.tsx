import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../../hooks/usePermissions";
import { calendarDateKey } from "../../lib/calendarDates";
import { formatDate } from "../../lib/format";
import { optionLabel } from "../../lib/orgHubOptions";
import { legalGovernanceProfile, requiredResidentCanadianDirectors } from "../../../shared/legalGovernanceProfiles";
import { isCorporation, isFederalCbca, isPreparingIncorporation } from "../../../shared/organizationDomain";
import { isBcJurisdiction, isExtraProvincialRegistration } from "./detailRows";
import { anniversaryInYear, bcExtraProvincialReportWindow, cbcaAnnualReturnWindow } from "./deadlines";
import type { OrganizationDetail, OrganizationRecord } from "./types";

/**
 * The Overview's reads from other registers: directors, significant
 * individuals, share classes and the compliance engine's deadlines. Each is
 * read only with the permission its query requires, and only while the
 * Overview is on screen.
 */
type DirectorRow = { status?: string; residentCanadianStatus?: string };
type SignificantIndividualRow = { status?: string };
export type RightsClassRow = { _id: string; className?: string; classType?: string; status?: string; maxAuthorized?: number };
type DerivedDeadlineRow = { key: string; title: string; dueDate: string; cycleYear?: number; status?: string };

export type OverviewRegisters = {
  directors: DirectorRow[] | undefined;
  significantIndividuals: SignificantIndividualRow[] | undefined;
  shareClasses: RightsClassRow[] | undefined;
  deadlines: DerivedDeadlineRow[] | undefined;
  directorsReadable: boolean;
  /** Deadlines and significant individuals both need settings:read. */
  settingsReadable: boolean;
};

export function useOverviewRegisters(society: OrganizationRecord): OverviewRegisters {
  const { loaded, can } = usePermissions();
  const corporation = isCorporation(society);
  const today = calendarDateKey(new Date());
  const directorsReadable = loaded && can("directors:read");
  const settingsReadable = loaded && can("settings:read");
  const ledgerReadable = loaded && can("documents:read");
  const directors = useQuery(api.directors.list, directorsReadable ? { societyId: society._id } : "skip") as DirectorRow[] | undefined;
  const significantIndividuals = useQuery(
    api.registerHistory.significantIndividualsAsOf,
    corporation && settingsReadable ? { societyId: society._id, asOf: today } : "skip",
  ) as SignificantIndividualRow[] | undefined;
  const ledger = useQuery(api.legalOperations.rightsLedger, corporation && ledgerReadable ? { societyId: society._id } : "skip") as { classes?: RightsClassRow[] } | undefined;
  const deadlines = useQuery(api.corporationSettings.complianceDeadlines, settingsReadable ? { societyId: society._id, fromISO: today } : "skip") as DerivedDeadlineRow[] | undefined;
  return {
    directors,
    significantIndividuals,
    shareClasses: ledger?.classes,
    deadlines,
    directorsReadable,
    settingsReadable,
  };
}

type ComingUpItem = { id: string; title: string; when: string; note?: string };

function windowText(opens: string | null, due: string) {
  return opens ? `${formatDate(opens)} – ${formatDate(due)}` : `Due ${formatDate(due)}`;
}

/** The home annual return, the annual meeting and each extra-provincial annual filing. */
function comingUpItems(society: OrganizationRecord, detail: OrganizationDetail | undefined, deadlines: DerivedDeadlineRow[] | undefined, deadlinesReadable: boolean): ComingUpItem[] {
  const today = calendarDateKey(new Date());
  const items: ComingUpItem[] = [];
  const anchor = society.anniversaryDate || society.incorporationDate;
  const anniversaryAnchored = legalGovernanceProfile(society)?.annualReturn.anchor === "anniversary";
  const annualReturn = deadlines?.find((deadline) => deadline.key === "annual-report");
  if (annualReturn) {
    const opens = anniversaryAnchored && annualReturn.cycleYear ? anniversaryInYear(anchor, annualReturn.cycleYear) : null;
    items.push({ id: "annual-return", title: annualReturn.title, when: windowText(opens, annualReturn.dueDate), note: annualReturn.status === "overdue" ? "Overdue" : undefined });
  } else if (!deadlinesReadable && isFederalCbca(society) && !isPreparingIncorporation(society)) {
    // Without the compliance engine, the CBCA rule still gives the window.
    const window = cbcaAnnualReturnWindow(anchor, today);
    if (window) items.push({ id: "annual-return", title: "Federal annual return", when: windowText(window.opens, window.due) });
  }
  const meeting = deadlines?.find((deadline) => deadline.key === "agm");
  if (meeting) items.push({ id: "annual-meeting", title: meeting.title, when: meeting.status === "planned" ? `Planned ${formatDate(meeting.dueDate)}` : `Due ${formatDate(meeting.dueDate)}` });
  for (const row of detail?.registrations ?? []) {
    if (!isExtraProvincialRegistration(row) || row.status === "inactive") continue;
    const name = isBcJurisdiction(row.jurisdiction) ? "BC" : optionLabel("entityJurisdictions", row.jurisdiction);
    if (row.annualReturnDueDate && row.annualReturnDueDate >= today) {
      items.push({ id: `registration:${row._id}`, title: `${name} annual report`, when: `Due ${formatDate(row.annualReturnDueDate)}` });
      continue;
    }
    if (!isBcJurisdiction(row.jurisdiction)) continue;
    const window = bcExtraProvincialReportWindow(row.registrationDate, today, row.lastAnnualReturnFiledDate);
    if (window) items.push({ id: `registration:${row._id}`, title: "BC annual report", when: windowText(window.opens, window.due), note: "Within 2 months after the BC registration anniversary" });
  }
  return items;
}

export function ComingUpCard({ society, detail, deadlines, deadlinesReadable }: {
  society: OrganizationRecord;
  detail: OrganizationDetail | undefined;
  deadlines: DerivedDeadlineRow[] | undefined;
  deadlinesReadable: boolean;
}) {
  const items = comingUpItems(society, detail, deadlines, deadlinesReadable);
  const loading = detail === undefined || (deadlinesReadable && deadlines === undefined);
  return (
    <section className="card" aria-labelledby="org-coming-up">
      <div className="card__head">
        <h2 className="card__title" id="org-coming-up">Coming up</h2>
        <Link className="btn btn--ghost btn--sm org-profile-card-link" to="/app/deadlines">All deadlines</Link>
      </div>
      <div className="card__body">
        {items.length === 0
          ? <p className="muted org-profile-empty">{loading ? "Loading deadlines…" : isPreparingIncorporation(society) ? "Registry deadlines start from the incorporation date." : "No registry deadlines to show yet."}</p>
          : (
            <dl className="org-profile-kv">
              {items.map((item) => (
                <div key={item.id}>
                  <dt>{item.title}</dt>
                  <dd>{item.when}{item.note && <span className="muted"> · {item.note}</span>}</dd>
                </div>
              ))}
            </dl>
          )}
      </div>
    </section>
  );
}

export function shareClassLabel(row: RightsClassRow) {
  const name = row.className?.trim() || "Unnamed class";
  return row.maxAuthorized === undefined ? `${name}, unlimited` : `${name}, up to ${row.maxAuthorized.toLocaleString()}`;
}

/** "min 1, max 10" from the articles; either limit alone when only one is recorded. */
export function directorLimitsText(min: number | undefined, max: number | undefined) {
  return [min !== undefined ? `min ${min}` : "", max !== undefined ? `max ${max}` : ""].filter(Boolean).join(", ");
}

export function PeopleAndSharesCard({ society, registers }: { society: OrganizationRecord; registers: OverviewRegisters }) {
  const corporation = isCorporation(society);
  const active = registers.directors?.filter((director) => director.status === "Active");
  const canadianQuota = legalGovernanceProfile(society)?.directors.residency === "canadian_25_percent";
  const residents = active?.filter((director) => director.residentCanadianStatus === "yes").length ?? 0;
  const individuals = registers.significantIndividuals?.filter((row) => row.status === "current");
  const classes = registers.shareClasses?.filter((row) => row.status !== "inactive");
  const limits = directorLimitsText(society.articlesMinDirectors, society.articlesMaxDirectors);
  return (
    <section className="card" aria-labelledby="org-people-shares">
      <div className="card__head"><h2 className="card__title" id="org-people-shares">People and shares</h2></div>
      <div className="card__body">
        <dl className="org-profile-kv">
          <div>
            <dt><Link to="/app/directors">Directors</Link></dt>
            <dd>{!registers.directorsReadable ? <span className="muted">No access</span>
              : active === undefined ? <span className="muted">Loading…</span>
              : `${active.length}${limits ? ` (${limits})` : ""}${canadianQuota && active.length ? ` · ${residents} resident Canadian${residents === 1 ? "" : "s"} (${requiredResidentCanadianDirectors(active.length)} needed)` : ""}`}</dd>
          </div>
          {corporation && (
            <div>
              <dt><Link to="/app/significant-individuals">Significant control</Link></dt>
              <dd>{individuals === undefined ? <span className="muted">{registers.settingsReadable ? "Loading…" : "No access"}</span> : `${individuals.length} individual${individuals.length === 1 ? "" : "s"}`}</dd>
            </div>
          )}
          {corporation && (
            <div>
              <dt><Link to="/app/rights-ledger">Share classes</Link></dt>
              <dd>{classes === undefined ? <span className="muted">Not available</span> : classes.length ? classes.map(shareClassLabel).join("; ") : <span className="muted">None set up</span>}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
