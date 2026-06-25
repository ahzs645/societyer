/**
 * YCN-register handlers for the static (offline/demo) Convex mirror, extracted
 * from src/lib/staticConvex.ts to keep that monolith smaller and to keep all the
 * YCN-derived register behavior in one place. staticConvex.ts delegates to these.
 *
 * Each handler returns YCN_NOT_HANDLED when the call isn't one of ours, so the
 * caller can fall through to the rest of the mirror.
 */
import { SOCIETY_ID } from "./staticConvexFixtures";
import { computeDividend, totalDeclaredByClass, totalDeclaredByCurrency } from "../../shared/dividends";
import { activeProvidersAsOf, SERVICE_PROVIDER_FUNCTIONS } from "../../shared/serviceProviders";
import { normalizeSearchName, matchByPrefix, findDuplicates } from "../../shared/peopleDirectory";
import { reviewsDue as computeReviewsDue } from "../../shared/significantIndividuals";
import { roleHoldersAsOf } from "../../shared/registerHistory";
import { nameTimeline, nameAsOf as computeNameAsOf, nameChangeNarrative } from "../../shared/nameHistory";
import { constatingTimeline, currentRegime as computeCurrentRegime, regimeNarrative } from "../../shared/constating";
import { jurisdictionsTracked, filingHistory, outstandingYears } from "../../shared/annualFilings";
import { activeCertificates, certificateChain, sharesOutstandingByClass } from "../../shared/shareCertificates";

export const YCN_NOT_HANDLED = Symbol("staticConvexYcn.notHandled");

type StoreLike = {
  listRows: (table: string, args?: any) => any[];
  getRow: (table: string, id?: any) => any;
  upsertRow: (table: string, row: any) => void;
} | null | undefined;

/** Read-side handlers for the YCN register query modules. */
export function ycnQueryResult(moduleName: string, exportName: string, args: any, store: StoreLike): any {
  if (moduleName === "registerHistory") {
    const roleHolderRows = (store?.listRows("roleHolders", args) ?? []) as any[];
    if (exportName === "directorsAsOf") return roleHoldersAsOf(roleHolderRows, String(args?.asOf ?? ""), "director");
    if (exportName === "roleHoldersAsOfDate") return roleHoldersAsOf(roleHolderRows, String(args?.asOf ?? ""), String(args?.roleType ?? ""));
    if (exportName === "significantIndividualsAsOf") return roleHolderRows.filter((row) => row.roleType === "controller");
    if (exportName === "addressesAsOf") {
      const addrs = (store?.listRows("organizationAddresses", args) ?? []) as any[];
      const filtered = args?.type ? addrs.filter((r) => r.type === args.type) : addrs;
      const asOf = String(args?.asOf ?? "");
      return filtered.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= asOf) && (!r.effectiveTo || r.effectiveTo > asOf));
    }
  }
  if (moduleName === "dividends") {
    const rows = (store?.listRows("dividends", args) ?? []) as any[];
    if (exportName === "list") return [...rows].sort((a, b) => String(a.declaredOn ?? "").localeCompare(String(b.declaredOn ?? "")));
    if (exportName === "summary") return { byClass: totalDeclaredByClass(rows), byCurrency: totalDeclaredByCurrency(rows) };
  }
  if (moduleName === "serviceProviders") {
    if (exportName === "functionsCatalog") return SERVICE_PROVIDER_FUNCTIONS;
    const rows = (store?.listRows("serviceProviders", args) ?? []) as any[];
    if (exportName === "list") return rows;
    if (exportName === "activeAsOf") return activeProvidersAsOf(rows, String(args?.asOf ?? ""));
  }
  if (moduleName === "peopleDirectory") {
    const rows = (store?.listRows("peopleDirectory", {}) ?? []) as any[];
    const people = rows.map((r) => ({ id: String(r._id), fullName: r.fullName, firstName: r.firstName, lastName: r.lastName, dob: r.dob, isIndividual: r.isIndividual }));
    if (exportName === "list") return [...rows].sort((a, b) => String(a.searchName ?? "").localeCompare(String(b.searchName ?? "")));
    if (exportName === "searchByPrefix") return matchByPrefix(people, String(args?.prefix ?? ""), args?.limit ?? 10);
    if (exportName === "duplicates") return findDuplicates(people);
  }
  if (moduleName === "significantIndividualSteps") {
    const rows = (store?.listRows("significantIndividualSteps", args) ?? []) as any[];
    if (exportName === "list") return [...rows].sort((a, b) => String(b.stepDate ?? "").localeCompare(String(a.stepDate ?? "")));
    if (exportName === "reviewsDue") return computeReviewsDue(rows as any[], String(args?.asOf ?? ""));
  }
  if (moduleName === "nameHistory") {
    const recs = (store?.listRows("societyNameHistory", args) ?? []) as any[];
    if (exportName === "list") return nameTimeline(recs);
    if (exportName === "asOf") return computeNameAsOf(recs, String(args?.asOf ?? ""));
    if (exportName === "narrative") return nameChangeNarrative(recs);
  }
  if (moduleName === "constating") {
    const events = (store?.listRows("constatingEvents", args) ?? []) as any[];
    if (exportName === "list") return constatingTimeline(events);
    if (exportName === "currentRegime") return computeCurrentRegime(events, String(args?.asOf ?? ""));
    if (exportName === "narrative") return regimeNarrative(events);
  }
  if (moduleName === "annualFilings") {
    const recs = (store?.listRows("annualFilingLedger", args) ?? []) as any[];
    if (exportName === "list") return recs;
    if (exportName === "jurisdictions") return jurisdictionsTracked(recs);
    if (exportName === "history") return filingHistory(recs, String(args?.jurisdiction ?? ""));
    if (exportName === "outstanding") return outstandingYears(recs, String(args?.jurisdiction ?? ""), String(args?.fromYear ?? ""), String(args?.toYear ?? ""));
  }
  if (moduleName === "shareCertificates") {
    const rows = (store?.listRows("shareCertificates", args) ?? []) as any[];
    if (exportName === "list") return rows;
    if (exportName === "register") return { active: activeCertificates(rows, String(args?.asOf ?? "")), outstandingByClass: sharesOutstandingByClass(rows, String(args?.asOf ?? "")) };
    if (exportName === "chain") return certificateChain(rows, String(args?.certificateNumber ?? ""));
  }
  if (moduleName === "entitySigners") {
    const rows = (store?.listRows("entitySigners", args) ?? []) as any[];
    if (exportName === "list" || exportName === "activeAsOfQuery") return [...rows].sort((a, b) => (a.signOrder ?? Infinity) - (b.signOrder ?? Infinity));
  }
  return YCN_NOT_HANDLED;
}

/** Write-side handlers for the non-CRUD-verb YCN mutations. */
export function ycnMutationResult(
  name: string,
  args: any,
  store: StoreLike,
  staticLocalId: (moduleName: string, exportName?: string) => string,
  societyFallback: any,
): any {
  if (name === "society:updateComplianceSettings") {
    const existing = store?.getRow("societies", args?.societyId) ?? societyFallback;
    const { societyId: _sid, ...settings } = args ?? {};
    void _sid;
    store?.upsertRow("societies", { ...existing, ...settings, _id: args?.societyId ?? existing._id, updatedAtISO: new Date().toISOString() });
    return args?.societyId ?? existing._id;
  }
  if (name === "peopleDirectory:addToSociety") {
    const person = store?.getRow("peopleDirectory", args?.directoryPersonId) ?? {};
    const id = staticLocalId("roleHolders", "create");
    store?.upsertRow("roleHolders", {
      _id: id,
      societyId: args?.societyId ?? SOCIETY_ID,
      roleType: args?.roleType,
      status: "current",
      fullName: person.fullName,
      firstName: person.firstName,
      lastName: person.lastName,
      dateOfBirth: person.dob,
      directoryPersonId: args?.directoryPersonId,
      startDate: args?.startDate,
      createdAtISO: args?.nowISO ?? new Date().toISOString(),
      updatedAtISO: args?.nowISO ?? new Date().toISOString(),
    });
    return id;
  }
  if (name === "society:cloneSociety") {
    const source = store?.getRow("societies", args?.sourceSocietyId) ?? {};
    const newId = staticLocalId("societies", "create");
    const { _id: _sid2, _creationTime: _sct, ...fields } = source as Record<string, unknown>;
    void _sid2; void _sct;
    store?.upsertRow("societies", { ...fields, _id: newId, name: args?.newName, incorporationNumber: undefined, updatedAtISO: new Date().toISOString() });
    let copied = 0;
    for (const table of ["roleHolders", "organizationAddresses", "organizationRegistrations", "rightsClasses", "serviceProviders", "societyNameHistory", "constatingEvents", "shareCertificates", "annualFilingLedger", "entitySigners"]) {
      for (const row of store?.listRows(table, { societyId: args?.sourceSocietyId }) ?? []) {
        const { _id: rid, _creationTime: rct, ...rest } = row as Record<string, unknown>;
        void rid; void rct;
        store?.upsertRow(table, { ...rest, _id: staticLocalId(table, "create"), societyId: newId });
        copied += 1;
      }
    }
    return { societyId: newId, copiedRows: copied };
  }
  return YCN_NOT_HANDLED;
}

/**
 * Inject derived fields the real Convex handlers compute, so the generic CRUD
 * persist stores them offline too (searchName, totalCents). Mutates `args`.
 */
export function applyYcnDerivedFields(name: string, args: any): void {
  if (name === "peopleDirectory:upsert" && args) {
    (args as any).searchName = normalizeSearchName(String((args as any).fullName ?? ""));
  }
  if (name === "dividends:create" && args && (args as any).totalCents == null) {
    (args as any).totalCents = computeDividend({
      declaredOn: String((args as any).declaredOn ?? ""),
      shareClass: String((args as any).shareClass ?? ""),
      perShareCents: Number((args as any).perShareCents ?? 0),
      sharesOutstanding: Number((args as any).sharesOutstanding ?? 0),
      currency: String((args as any).currency ?? ""),
    }).totalCents;
  }
}
