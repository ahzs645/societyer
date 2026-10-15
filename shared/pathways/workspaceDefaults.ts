import type { PipelineGraph, PipelineInputs, PipelineScalar } from "./pipeline";

/**
 * Pathway inputs that the workspace already knows.
 *
 * A saved pathway run asks for the proposed name, registered office, first
 * directors and similar facts. When the workspace already records them, the
 * run shows those values as defaults marked "From your workspace" with the
 * place they came from. A default is used only for an input the user has not
 * saved in the run; it follows the workspace until the user edits it, and is
 * copied into the run (with its source) when the run's inputs freeze.
 *
 * Pure: the portable pathway functions gather the facts from rows the viewer
 * may read in the run's own workspace (shared/functions/pathways.ts).
 */

export type PathwayWorkspaceSource = { kind: "workspace"; source: string; label: string; href: string };
export type PathwayInputSource = PathwayWorkspaceSource | { kind: "user" };
export type PathwayWorkspaceDefault = PathwayWorkspaceSource & { value: PipelineScalar };
export type PathwayWorkspaceDefaults = Record<string, PathwayWorkspaceDefault>;

type AddressRow = {
  type?: string; status?: string; effectiveTo?: string;
  street?: string; unit?: string; city?: string; provinceState?: string; postalCode?: string; country?: string;
};
type RoleHolderRow = {
  roleType?: string; status?: string; fullName?: string; firstName?: string; middleName?: string; lastName?: string;
  citizenshipResidency?: string; officerTitle?: string;
};
type SocietyDirectorRow = {
  firstName?: string; lastName?: string; status?: string; isBCResident?: boolean;
  residentCanadianStatus?: string; consentOnFile?: boolean;
};
type RightsClassRow = { className?: string; classType?: string; status?: string };

/** What the viewer may read; an absent list means "not readable", never "none recorded". */
export type PathwayWorkspaceFacts = {
  /** Society-style workspaces keep directors in the directors table; corporations use role holders. */
  society: boolean;
  profile?: { name?: string; numbered?: boolean; registeredOfficeAddress?: string; purposes?: string };
  addresses?: AddressRow[];
  recordsLocations?: { address?: string }[];
  roleHolders?: RoleHolderRow[];
  controllers?: RoleHolderRow[];
  societyDirectors?: SocietyDirectorRow[];
  rightsClasses?: RightsClassRow[];
  /** Free-text class notes answered during guided setup. */
  setupClassDetails?: string;
};

/** Inputs never hold more than the pipeline's scalar bound. */
const TEXT_MAX = 4000;
const PLACEHOLDER = /^needs review$/i;

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const bounded = (value: string) => (value.length > TEXT_MAX ? `${value.slice(0, TEXT_MAX - 1).trimEnd()}…` : value);

export const PATHWAY_SOURCES = {
  profile: { source: "profile", label: "Organization profile", href: "/app/society" },
  registeredOffice: { source: "registered-office", label: "Registered office address", href: "/app/society#registered-office" },
  recordsOffice: { source: "records-office", label: "Records office address", href: "/app/society#registered-office" },
  directorsRegister: { source: "role-holders", label: "Directors register", href: "/app/role-holders?role=director" },
  societyDirectors: { source: "directors", label: "Directors", href: "/app/directors" },
  shareRegister: { source: "share-classes", label: "Share register", href: "/app/rights-ledger" },
  setupAnswers: { source: "setup-answers", label: "Setup answers", href: "/app/organization-setup" },
  significantControl: { source: "significant-control", label: "Significant control register", href: "/app/significant-individuals" },
} as const;

function addressText(row: AddressRow): string {
  return [row.unit, row.street, row.city, row.provinceState, row.postalCode, row.country]
    .map(clean).filter((part) => part && !PLACEHOLDER.test(part)).join(", ");
}

/** A current address of the type first, then a proposed one (a company being prepared). */
function officeAddress(rows: AddressRow[] | undefined, type: string): string {
  const candidates = (rows ?? []).filter((row) => row.type === type && !clean(row.effectiveTo));
  for (const status of ["current", "proposed"]) {
    const found = candidates.find((row) => (row.status ?? "current") === status && addressText(row));
    if (found) return addressText(found);
  }
  return "";
}

function personName(row: RoleHolderRow): string {
  return clean(row.fullName) || [row.firstName, row.middleName, row.lastName].map(clean).filter(Boolean).join(" ");
}

/** Residency as the director rules read it (same mapping as the dashboard). */
function roleHolderResidency(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("a_canadian_citizen_ordinarily_resident") || value.startsWith("a_permanent_resident") || value === "a_canadian_citizen_that_meets_the_test_in_schedule_a") return "resident Canadian";
  if (value.startsWith("not_a_canadian_citizen") || value.startsWith("a_canadian_citizen_that_is_not_ordinarily_resident")) return "not a resident Canadian";
  return undefined;
}

const byName = <T>(rows: T[], name: (row: T) => string) => [...rows].sort((a, b) => name(a).localeCompare(name(b)));
const describe = (name: string, details: (string | undefined)[]) => {
  const parts = details.filter(Boolean);
  return parts.length ? `${name} (${parts.join(", ")})` : name;
};

function directorsFromRoleHolders(rows: RoleHolderRow[] | undefined): string {
  const directors = (rows ?? []).filter((row) => row.roleType === "director" && ["current", "proposed"].includes(row.status ?? "current") && personName(row));
  return byName(directors, personName)
    .map((row) => describe(personName(row), [row.status === "proposed" ? "proposed" : undefined, roleHolderResidency(row.citizenshipResidency)]))
    .join("; ");
}

function directorsFromSocietyTable(rows: SocietyDirectorRow[] | undefined): string {
  const name = (row: SocietyDirectorRow) => [row.firstName, row.lastName].map(clean).filter(Boolean).join(" ");
  const directors = (rows ?? []).filter((row) => (row.status ?? "Active") === "Active" && name(row));
  return byName(directors, name)
    .map((row) => describe(name(row), [
      row.isBCResident ? "BC resident" : undefined,
      row.residentCanadianStatus === "yes" ? "resident Canadian" : row.residentCanadianStatus === "no" ? "not a resident Canadian" : undefined,
      row.consentOnFile ? "consent on file" : undefined,
    ]))
    .join("; ");
}

function shareClasses(rows: RightsClassRow[] | undefined): string {
  const classes = (rows ?? []).filter((row) => ["share", "voting", "non_voting"].includes(clean(row.classType)) && row.status !== "inactive" && clean(row.className));
  return classes.map((row) => describe(clean(row.className), [row.status === "proposed" ? "proposed" : undefined])).join("; ");
}

function controllers(rows: RoleHolderRow[] | undefined): string {
  const people = (rows ?? []).filter((row) => row.roleType === "controller" && ["current", "proposed"].includes(row.status ?? "current") && personName(row));
  return byName(people, personName).map((row) => describe(personName(row), [row.status === "proposed" ? "proposed" : undefined])).join("; ");
}

function textDefault(value: string, source: Omit<PathwayWorkspaceSource, "kind">): PathwayWorkspaceDefault | undefined {
  const text = clean(value);
  return text ? { kind: "workspace", ...source, value: bounded(text) } : undefined;
}

/** Defaults for the run's declared inputs, from facts the viewer may read. */
export function pathwayWorkspaceDefaults(graph: PipelineGraph, facts: PathwayWorkspaceFacts): PathwayWorkspaceDefaults {
  const profile = facts.profile ?? {};
  const candidates: Record<string, PathwayWorkspaceDefault | undefined> = {
    proposedName: textDefault(profile.name ?? "", PATHWAY_SOURCES.profile),
    // The numbered-name choice is the profile's `numbered` flag; unset means "not chosen yet".
    namedCompany: typeof profile.numbered === "boolean" ? { kind: "workspace", ...PATHWAY_SOURCES.profile, value: !profile.numbered } : undefined,
    registeredOffice: textDefault(officeAddress(facts.addresses, "registered_office"), PATHWAY_SOURCES.registeredOffice)
      ?? textDefault(profile.registeredOfficeAddress ?? "", PATHWAY_SOURCES.registeredOffice),
    recordsOffice: textDefault(officeAddress(facts.addresses, "records_office"), PATHWAY_SOURCES.recordsOffice)
      ?? textDefault(clean((facts.recordsLocations ?? []).find((row) => clean(row.address))?.address), PATHWAY_SOURCES.recordsOffice),
    directors: facts.society
      ? textDefault(directorsFromSocietyTable(facts.societyDirectors), PATHWAY_SOURCES.societyDirectors)
      : textDefault(directorsFromRoleHolders(facts.roleHolders), PATHWAY_SOURCES.directorsRegister),
    shareStructure: textDefault(shareClasses(facts.rightsClasses), PATHWAY_SOURCES.shareRegister)
      ?? textDefault(facts.setupClassDetails ?? "", PATHWAY_SOURCES.setupAnswers),
    purposes: textDefault(profile.purposes ?? "", PATHWAY_SOURCES.profile),
    significantControl: textDefault(controllers(facts.controllers), PATHWAY_SOURCES.significantControl),
  };
  const defaults: PathwayWorkspaceDefaults = {};
  for (const field of graph.inputFields ?? []) {
    const candidate = Object.prototype.hasOwnProperty.call(candidates, field.key) ? candidates[field.key] : undefined;
    if (!candidate) continue;
    const fits = field.type === "boolean" ? typeof candidate.value === "boolean" : field.type === "text" ? typeof candidate.value === "string" : false;
    if (fits) defaults[field.key] = candidate;
  }
  return defaults;
}

/**
 * The inputs a run uses: what the user saved in the run wins (even an empty
 * value), otherwise the workspace default. Sources say which is which.
 */
export function effectivePathwayInputs(graph: PipelineGraph, saved: PipelineInputs, defaults: PathwayWorkspaceDefaults): { inputs: PipelineInputs; sources: Record<string, PathwayInputSource> } {
  const inputs: PipelineInputs = {};
  const sources: Record<string, PathwayInputSource> = {};
  for (const field of graph.inputFields ?? []) {
    if (Object.prototype.hasOwnProperty.call(saved, field.key)) {
      inputs[field.key] = saved[field.key];
      sources[field.key] = { kind: "user" };
    } else if (defaults[field.key]) {
      const { value, ...source } = defaults[field.key];
      inputs[field.key] = value;
      sources[field.key] = source;
    }
  }
  return { inputs, sources };
}

/** Stored sources from a frozen run; unknown shapes are dropped, never trusted as links. */
export function readPathwayInputSources(value: unknown): Record<string, PathwayInputSource> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const known = new Map<string, Omit<PathwayWorkspaceSource, "kind">>(Object.values(PATHWAY_SOURCES).map((entry) => [entry.source, entry]));
  const output: Record<string, PathwayInputSource> = {};
  for (const [key, entry] of Object.entries(parsed as Record<string, any>)) {
    if (["__proto__", "constructor", "prototype"].includes(key) || !entry || typeof entry !== "object") continue;
    if (entry.kind === "user") output[key] = { kind: "user" };
    else if (entry.kind === "workspace" && known.has(entry.source)) output[key] = { kind: "workspace", ...known.get(entry.source)! };
  }
  return output;
}
