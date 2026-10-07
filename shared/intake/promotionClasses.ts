/** Promotion of reviewed extractions of every class beyond minutes (agendas,
 * packages, AGM material, policies, bylaws, consents, rosters, filings,
 * statements, budgets, insurance, grants, agreements, correspondence and
 * invoices). The reviewed record (accepted/edited values only, see review.ts)
 * goes through the same class staging the pipeline uses for its bundle
 * (bundleClasses.ts), so a promoted policy, director or insurance policy has
 * exactly the shape a bulk import would give it. Pure: used by the portable
 * `intake:promoteExtraction` mutation, the review screen's preview and gates. */
import type { IntakeExtractionResult, IntakeFileRecord, IntakeRunResult } from "./bundle";
import { AFFECTED_TABLE, classBundleRecords } from "./bundleClasses";
import { agendaEvidencedMeetings } from "./classStages";
import { normalizePersonKey } from "./names";
import { applyReviews, latestDecisions, patternOf, reviewFieldsForRecord, type AppliedReviews, type ReviewRow } from "./review";
import { sourceDocumentPayload, type PromotionInput } from "./promotion";

/** Classes whose reviewed records can be promoted (minutes use promotion.ts). */
export const CLASS_PROMOTION: Record<string, { noun: string; creates: string }> = {
  agenda: { noun: "agenda", creates: "the meeting's agenda (or a held meeting with its minutes missing)" },
  meetingPackage: { noun: "meeting package", creates: "the meeting's agenda and consent items (or a held meeting with its minutes missing)" },
  agmMaterial: { noun: "AGM material", creates: "the AGM's agenda, notice and nominations (or a held AGM with its minutes missing)" },
  policy: { noun: "policy", creates: "a Draft policy (terms of reference also set the committee's quorum)" },
  bylaws: { noun: "bylaws", creates: "a Draft bylaws version and a Draft bylaw rule set" },
  directorConsent: { noun: "consent to act", creates: "a director with consent on file" },
  proxy: { noun: "proxy", creates: "a proxy or a standing seat observation" },
  roster: { noun: "roster", creates: "directors with their terms and represented organizations" },
  registryFiling: { noun: "registry filing", creates: "a filing and the directors it lists" },
  financialStatement: { noun: "financial statement", creates: "a financial statement with its lines" },
  budget: { noun: "budget", creates: "a budget snapshot with its lines" },
  insurance: { noun: "insurance document", creates: "an insurance policy (Lapsed or Needs review, never Active)" },
  grant: { noun: "grant", creates: "a grant with its reporting requirements" },
  agreement: { noun: "agreement", creates: "a draft agreement with its parties, term, value, deliverables and reports (their dates become deadlines)" },
  correspondence: { noun: "correspondence", creates: "restricted source evidence for each decision or commitment" },
  invoice: { noun: "invoice", creates: "a restricted transaction candidate" },
};

/** Import record kind → native table its id belongs to. */
export const RECORD_KIND_TABLE: Record<string, string> = {
  policy: "policies", bylawRuleSet: "bylawRuleSets", committee: "committees", director: "directors", organizationSeat: "organizationSeats", proxy: "proxies",
  financialStatementImport: "financialStatementImports", budgetSnapshot: "budgetSnapshots", insurancePolicy: "insurancePolicies", grant: "grants", deadline: "deadlines",
  filing: "filings", sourceEvidence: "sourceEvidence", transactionCandidate: "transactionCandidates", meetingMaterial: "meetingMaterials", agreement: "agreements",
};

/** Bundle collection → import record kind. */
const COLLECTION_KIND: Record<string, string> = {
  policies: "policy", bylawRuleSets: "bylawRuleSet", committees: "committee", directors: "director", organizationSeats: "organizationSeat", proxies: "proxy",
  financialStatementImports: "financialStatementImport", budgetSnapshots: "budgetSnapshot", insurancePolicies: "insurancePolicy", grants: "grant", deadlines: "deadline",
  filings: "filing", sourceEvidence: "sourceEvidence", transactionCandidates: "transactionCandidate", meetingMaterials: "meetingMaterial", agreements: "agreement",
};

export type ClassPromotionContext = {
  /** "Today" for lapsed/historical decisions (insurance terms, deadlines). */
  asOfISO: string;
  organizationName?: string;
  /** A native meeting already on the agenda's date and body: the agenda becomes its material instead of a new meeting. */
  existingMeeting?: { meetingId: string; date: string; title: string };
  /** The motion that adopted this policy/bylaw version (found among the run's minutes). */
  policyAdoption?: { from: string; to: string; detail: string; meetingDate: string; bodyKey: string; motionIndex: number };
  /** Directors already in the register (by directorMatchKey): their new terms are added, no duplicate director is created. */
  existingDirectorKeys?: ReadonlySet<string>;
};

export type ClassPromotionBuild = {
  bundle: Record<string, unknown>;
  applied: AppliedReviews;
  warnings: string[];
  /** Rows per native collection that the bundle stages. */
  collections: Record<string, number>;
  /** Representation gaps (facts with no native home) to record with the promotion. */
  gaps: Array<Record<string, unknown>>;
  /** Directors already in the register: terms to append instead of a new director. */
  existingDirectors: Array<Record<string, any>>;
  /** Agenda/package of a meeting that already exists natively: becomes a material of that meeting. */
  material?: { meetingId: string; label: string; agendaLabel: string; agendaItems: Array<Record<string, unknown>> };
  sourceExternalIds: string[];
};

const AGENDA_LIKE = new Set(["agenda", "meetingPackage", "agmMaterial"]);

/** First and last name only ("Jordan M Avery" = "Jordan Avery", "Maria Elena Santos" = "Maria Santos"):
 * registry filings print middle names that rosters and minutes leave out. */
export function directorMatchKey(name: string): string {
  const tokens = normalizePersonKey(name).split(" ").filter(Boolean);
  return tokens.length > 2 ? `${tokens[0]} ${tokens[tokens.length - 1]}` : tokens.join(" ");
}

function toRunFile(file: PromotionInput["files"][number], docClass: string): IntakeFileRecord {
  return {
    fileKey: file.fileKey, name: file.name, path: file.path ?? file.name, ...(file.sha256 ? { sha256: file.sha256 } : {}), ...(file.mimeType ? { mimeType: file.mimeType } : {}),
    ...(file.sizeBytes !== undefined ? { sizeBytes: file.sizeBytes } : {}), acquisitionStatus: "local", disposition: "extract",
    ...(file.sensitivity ? { sensitivity: file.sensitivity as IntakeFileRecord["sensitivity"] } : {}),
    classification: { docClass: (file.docClass ?? docClass) as any, confidence: 1, recordStatus: (file.recordStatus ?? "unknown") as any, restricted: file.sensitivity === "restricted", rationale: ["reviewed"] },
  };
}

/** Classification attributes (what kind of document, entry, column or status a value is) rather
 * than facts. They decide how accepted facts are staged (a committee member is not a director, a
 * prior-year column is not this year's amount), so they stay unless the reviewer rejected or edited
 * them; they get no provenance row of their own. */
const STRUCTURAL = /(?:^|\.)(?:kind|representativeType|column|section|statementType|documentType|proposedStatus|currency|recordStatus|grantStage|direction|asOfDate|external|depth|consent)$/;

function keepStructure(applied: any, original: any, decisions: Map<string, ReviewRow>, path = ""): void {
  if (!applied || typeof applied !== "object" || !original || typeof original !== "object" || Array.isArray(applied)) return;
  for (const [key, value] of Object.entries(applied)) {
    const childPath = path ? `${path}.${key}` : key;
    const source = original[key];
    if (Array.isArray(value) && Array.isArray(source)) {
      // applyReviews may drop items; match the kept ones to their originals by their quotes.
      const used = new Set<number>();
      value.forEach((item: any) => {
        const index = source.findIndex((candidate: any, candidateIndex: number) => !used.has(candidateIndex) && sameItem(candidate, item));
        if (index < 0) return;
        used.add(index);
        keepStructure(item, source[index], decisions, `${childPath}[${index}]`);
      });
    } else if (value && typeof value === "object" && "status" in (value as any) && "locators" in (value as any)) {
      if (STRUCTURAL.test(childPath.replace(/\[\d+\]/g, "")) && !decisions.has(childPath) && source && source.status !== "not_stated") applied[key] = source;
    } else keepStructure(value, source, decisions, childPath);
  }
}

function sameItem(a: any, b: any): boolean {
  const quote = (item: any) => Object.values(item ?? {}).map((field: any) => field?.locators?.[0]?.quote).filter(Boolean).join("|");
  return quote(a) !== "" && quote(a) === quote(b);
}

/** Build the import bundle for one reviewed non-minutes extraction. */
export function buildClassPromotionBundle(input: PromotionInput & { context: ClassPromotionContext }): ClassPromotionBuild {
  const { extraction, context } = input;
  const docClass = extraction.docClass;
  if (docClass === "meetingMinutes") throw new Error("Minutes are promoted as meetings.");
  if (!CLASS_PROMOTION[docClass]) throw new Error(`There is no native record type for ${docClass} documents yet; mark their facts as system gaps instead.`);
  const decisions = latestDecisions(input.reviews);
  const applied = applyReviews(extraction.record, decisions);
  keepStructure(applied.record, extraction.record, decisions);
  const warnings: string[] = [];
  const unreviewed = reviewFieldsForRecord(extraction.record, docClass).filter((field) => !decisions.has(field.path)).length;
  if (unreviewed) warnings.push(`${unreviewed} unreviewed field${unreviewed === 1 ? " is" : "s are"} not promoted.`);
  const reviewed: IntakeExtractionResult = {
    fileId: extraction.fileKey, fileKey: extraction.fileKey, docClass: docClass as any, schemaVersion: extraction.schemaVersion ?? `${docClass}/1`,
    engine: (["deterministic", "llm", "human"].includes(extraction.engine) ? extraction.engine : "human") as IntakeExtractionResult["engine"],
    ...(extraction.model ? { model: extraction.model } : { model: extraction.engine }), record: applied.record, unsupported: [], references: [],
  } as IntakeExtractionResult;
  const files = input.files.map((file) => toRunFile(file, docClass));
  const agendaLike = AGENDA_LIKE.has(docClass);
  const evidencedMeetings = agendaLike && !context.existingMeeting ? agendaEvidencedMeetings([reviewed], files, []) : [];
  const run: IntakeRunResult = {
    runId: "promotion", name: input.runName, sourceKind: "upload", sourceRoot: "", startedAtISO: context.asOfISO, engine: { minutes: extraction.engine },
    files, clusters: [], extractions: [reviewed],
    reconciliation: { meetings: [], links: [], gaps: [], actionChains: [], evidencedMeetings, ...(context.policyAdoption ? { policyAdoptions: [{ kind: "policy-adopted-by", ...context.policyAdoption, from: extraction.fileKey } as any] } : {}) },
    ...(context.organizationName ? { organizationName: context.organizationName } : {}),
    processingLog: [],
  };
  const classes = classBundleRecords(run, { minutesPayloads: [] });
  const collections: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, rows] of Object.entries(classes.collections)) if (rows.length) collections[key] = rows;

  // Directors already in the register get their observed terms appended instead of a duplicate row.
  const existingDirectors: Array<Record<string, any>> = [];
  if (collections.directors && context.existingDirectorKeys?.size) {
    collections.directors = collections.directors.filter((row) => {
      if (!context.existingDirectorKeys!.has(directorMatchKey(String(row.fullName ?? "")))) return true;
      existingDirectors.push(row);
      return false;
    });
    if (!collections.directors.length) delete collections.directors;
  }

  let material: ClassPromotionBuild["material"];
  if (agendaLike && context.existingMeeting) {
    const record: any = applied.record;
    const value = (field: any) => (field && field.status !== "not_stated" ? field.value : undefined);
    const items = (record.items ?? []).map((item: any) => ({ title: value(item.title), ...(value(item.number) ? { itemNumber: String(value(item.number)) } : {}), ...(value(item.presenter) ? { presenter: String(value(item.presenter)) } : {}) })).filter((item: any) => item.title);
    material = {
      meetingId: context.existingMeeting.meetingId,
      label: String(value(record.title) ?? input.files[0]?.name ?? "Agenda").slice(0, 200),
      agendaLabel: docClass === "meetingPackage" ? "Meeting package" : docClass === "agmMaterial" ? "AGM material" : "Agenda",
      agendaItems: items,
    };
  } else if (agendaLike && !collections.meetingMinutes?.length) {
    throw new Error("Accept the meeting date (an exact day) and the body before promoting an agenda.");
  }

  // Facts with no native field: the extractor's unsupported details and the class stage's gaps.
  const observed = (() => {
    const record: any = applied.record;
    for (const key of ["date", "meetingDate", "periodEnd", "effectiveDate", "adoptedDate", "filedDate", "termStart", "effective"]) {
      const iso = record?.[key]?.value?.iso;
      if (typeof iso === "string" && /^\d{4}(?:-\d{2}){0,2}$/.test(iso)) return iso;
    }
    return undefined;
  })();
  const gaps: Array<Record<string, unknown>> = [
    ...(extraction.unsupported ?? []).filter((detail: any) => detail?.infoType !== "agreement.contract").map((detail: any) => ({
      infoType: detail.infoType ?? "other", category: detail.category, description: detail.description, locators: detail.locators, suggestedTarget: detail.suggestedTarget,
      affectedTable: AFFECTED_TABLE[docClass] ?? "documents", ...(observed ? { observedDate: observed } : {}),
    })),
    ...classes.gaps.map((row) => ({ ...row, fromClassStage: true })),
  ];

  const sourceExternalIds = [...new Set(input.files.map((file) => file.fileKey))];
  const bundle: Record<string, unknown> = {
    metadata: {
      name: `Intake review: ${input.files[0]?.name ?? extraction.fileKey}`,
      createdFrom: "intake-review",
      intakeExtractionId: extraction._id,
      sourceSystem: "local-folder",
      reviewOnly: false,
      note: `Created by promoting a reviewed ${CLASS_PROMOTION[docClass].noun}. Only reviewer-accepted fields are included.`,
    },
    documentMap: input.files.map((file) => sourceDocumentPayload(file, docClass)),
    ...collections,
  };
  return {
    bundle, applied, warnings, gaps, existingDirectors, material, sourceExternalIds,
    collections: Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, rows.length])),
  };
}

/** Bundle collection key for an import record kind (inverse of COLLECTION_KIND). */
export function collectionForKind(kind: string): string | undefined {
  return Object.entries(COLLECTION_KIND).find(([, value]) => value === kind)?.[0];
}

type CreatedTarget = { kind: string; table: string; id: string; payload: Record<string, any> };

/** Native field (on the class's main record) for a reviewed field pattern. */
const NATIVE_FIELD: Record<string, Record<string, string>> = {
  policy: { title: "policyName", versionLabel: "policyName", policyNumber: "policyNumber", effectiveDate: "effectiveDate", adoptedDate: "effectiveDate", reviewDate: "reviewDate", governsBody: "owner", status: "status" },
  bylaws: { title: "policyName", versionLabel: "policyName", effectiveDate: "effectiveDate", adoptedDate: "effectiveDate", status: "status" },
  insurance: { insurer: "insurer", broker: "broker", policyNumber: "policyNumber", termStart: "startDate", termEnd: "endDate", premium: "premiumCents", fees: "policyFeeCents", totalCost: "totalCostCents", kind: "kind", proposedStatus: "status", documentType: "versionType", "coverages.type": "coverageSummary", "coverages.limit": "coverageSummary", "coverages.deductible": "coverageSummary", additionalInsureds: "additionalInsureds" },
  financialStatement: { title: "title", periodEnd: "periodEnd", periodStart: "periodStart", statementType: "statementType", currency: "currency", versionLabel: "notes" },
  budget: { title: "title", periodEnd: "periodEnd", periodStart: "periodStart", currency: "currency", versionLabel: "notes" },
  registryFiling: { filingType: "kind", filedDate: "filedAt", period: "periodLabel", confirmationNumber: "confirmationNumber", feePaid: "feePaidCents", filingStatus: "status" },
  grant: { title: "title", funder: "funder", program: "program", amount: "amountAwardedCents", amountRequested: "amountRequestedCents", purpose: "restrictedPurpose", effective: "startDate", expiry: "endDate" },
  invoice: { date: "transactionDate", amount: "amountCents", vendor: "counterparty", invoiceNumber: "comment", direction: "debitCredit" },
  correspondence: { subject: "sourceTitle", date: "sourceDate", from: "summary" },
  agreement: { title: "title", kind: "kind", parties: "parties", effective: "effectiveDate", expiry: "endDate", amount: "valueCents", agreementNumber: "agreementNumber", status: "status", deliverables: "deliverables", reportingRequirements: "reportingObligations", reportingDue: "reportingObligations", signatories: "ourSignatories", paymentSchedule: "paymentSchedule", purpose: "summary", funder: "parties" },
};

/** Main table per class (where header fields land). */
const MAIN_TABLE: Record<string, string[]> = {
  policy: ["policies", "committees"], bylaws: ["policies", "bylawRuleSets"], insurance: ["insurancePolicies"], financialStatement: ["financialStatementImports"], budget: ["budgetSnapshots"],
  registryFiling: ["filings", "directors"], grant: ["grants"], agreement: ["agreements"], invoice: ["transactionCandidates"], correspondence: ["sourceEvidence"],
  directorConsent: ["directors", "proxies", "organizationSeats"], roster: ["directors", "organizationSeats"], proxy: ["proxies", "organizationSeats", "directors"],
  agenda: ["meetings", "meetingMaterials"], meetingPackage: ["meetings", "meetingMaterials"], agmMaterial: ["meetings", "meetingMaterials"],
};

export type ClassProvenance = { targetTable: string; targetId: string; fieldPath: string; sourceFieldPath: string };

/**
 * Which native record each promoted field landed on. People (roster entries,
 * consents, listed directors) attach to the director with the same name; rule
 * fields of bylaws attach to the rule set; everything else to the class's main
 * record, under its native field name when there is one, else the source path.
 */
export function classProvenanceTargets(docClass: string, record: Record<string, any>, promotedPaths: string[], created: CreatedTarget[]): { rows: ClassProvenance[]; notLanded: string[] } {
  const rows: ClassProvenance[] = [];
  const notLanded: string[] = [];
  const byTable = (table: string) => created.filter((target) => target.table === table);
  const main = (MAIN_TABLE[docClass] ?? []).map((table) => byTable(table)[0]).find(Boolean);
  const directorByName = new Map(byTable("directors").map((target) => [directorMatchKey(String(target.payload.fullName ?? "")), target]));
  const nameAt = (path: string): string | undefined => {
    const match = /^(entries|directorsListed)\[(\d+)\]/.exec(path);
    if (!match) return undefined;
    const item = record[match[1]]?.[Number(match[2])];
    const person = match[1] === "entries" ? item?.person?.value : item?.value;
    return person ? String(person.resolvedName ?? person.nameAsWritten ?? "") : undefined;
  };
  for (const path of promotedPaths) {
    const pattern = patternOf(path);
    const top = pattern.split(".")[0];
    const person = nameAt(path);
    if (person) {
      const director = directorByName.get(directorMatchKey(person));
      if (director) {
        rows.push({ targetTable: "directors", targetId: director.id, fieldPath: /\.person$|^directorsListed\[\d+\]$/.test(path) ? "fullName" : pattern.split(".").pop() ?? pattern, sourceFieldPath: path });
        continue;
      }
    }
    if (docClass === "bylaws" && top === "rules") {
      const ruleSet = byTable("bylawRuleSets")[0];
      if (ruleSet) { rows.push({ targetTable: "bylawRuleSets", targetId: ruleSet.id, fieldPath: pattern.replace(/^rules\./, ""), sourceFieldPath: path }); continue; }
    }
    if (docClass === "policy" && top === "rules") {
      const committee = byTable("committees")[0];
      if (committee) { rows.push({ targetTable: "committees", targetId: committee.id, fieldPath: "quorumRule", sourceFieldPath: path }); continue; }
    }
    if (docClass === "correspondence" && top === "decisionsOrCommitments") {
      const index = Number(/\[(\d+)\]/.exec(path)?.[1] ?? 0);
      const evidence = byTable("sourceEvidence")[index] ?? byTable("sourceEvidence")[0];
      if (evidence) { rows.push({ targetTable: "sourceEvidence", targetId: evidence.id, fieldPath: "summary", sourceFieldPath: path }); continue; }
    }
    if (docClass === "agreement" && /^(?:reportingRequirements|deliverables|paymentSchedule|parties|signatories)$/.test(top)) {
      const agreement = byTable("agreements")[0];
      const index = Number(/\[(\d+)\]/.exec(path)?.[1] ?? 0);
      const list = top === "reportingRequirements" ? "reportingObligations" : top === "signatories" ? "ourSignatories" : top;
      const leaf = pattern.endsWith(".due") ? "dueDate" : pattern.endsWith(".amount") ? "amountCents" : top === "paymentSchedule" ? "label" : top === "parties" || top === "signatories" ? "name" : "text";
      if (agreement) { rows.push({ targetTable: "agreements", targetId: agreement.id, fieldPath: `${list}[${index}].${leaf}`, sourceFieldPath: path }); continue; }
    }
    if (!main) { notLanded.push(path); continue; }
    const field = NATIVE_FIELD[docClass]?.[pattern] ?? NATIVE_FIELD[docClass]?.[top];
    const meetingField: Record<string, string> = { date: "scheduledAt", meetingDate: "scheduledAt", startTime: "scheduledAt", location: "location", electronic: "electronic", body: "type", bodyLabel: "type", title: "title" };
    const native = main.table === "meetings" ? meetingField[pattern] ?? pattern.replace(/^items/, "agendaItems") : field ?? pattern;
    rows.push({ targetTable: main.table, targetId: main.id, fieldPath: native, sourceFieldPath: path });
  }
  return { rows, notLanded };
}

/** Policy identity as the import checks it: policy number, else name (case and punctuation ignored). */
export function policyIdentityKey(row: { policyNumber?: unknown; policyName?: unknown; name?: unknown }): string {
  const text = String(row.policyNumber || row.policyName || row.name || "");
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Another version of a policy that is already in the register (same number or name, another date)
 * gets its date in the name, as versions of one family do in a bulk import. The same version again
 * (same identity and date) is a copy: `copyOf` names the existing policy and nothing is written. */
export function versionPolicyRows(rows: Array<Record<string, any>>, existing: Array<Record<string, any>>): { rows: Array<Record<string, any>>; copyOf?: string } {
  const out: Array<Record<string, any>> = [];
  for (const row of rows) {
    const date = String(row.effectiveDate ?? row.adoptedDate ?? "");
    const same = existing.filter((policy) => policyIdentityKey(policy) === policyIdentityKey(row));
    if (!same.length) {
      out.push(row);
      continue;
    }
    if (same.some((policy) => String(policy.effectiveDate ?? policy.adoptedDate ?? "") === date)) return { rows: [], copyOf: String(same[0].policyName ?? same[0].policyNumber) };
    const label = date || String(row.reviewDate ?? "") || "another version";
    const versioned = { ...row, policyName: `${row.policyName} (${label})`.slice(0, 200), ...(row.policyNumber ? { policyNumber: `${row.policyNumber} (${label})` } : {}) };
    if (existing.some((policy) => policyIdentityKey(policy) === policyIdentityKey(versioned))) return { rows: [], copyOf: String(versioned.policyName) };
    out.push(versioned);
  }
  return { rows: out };
}
