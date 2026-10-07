/** Import-bundle payloads for every class beyond minutes (WP-L), in WP-B's
 * bundle contract: meetings evidenced by agendas ("held, minutes missing"),
 * meetingMaterials, policies (+ versions), bylawRuleSets (Draft), committees
 * (terms of reference), directors with term intervals, organizationSeats,
 * proxies, financialStatementImports, budgetSnapshots, insurancePolicies,
 * grants, deadlines, filings, sourceEvidence and transactionCandidates.
 * Facts without a native home stay in representationGaps (agreements,
 * signing tiers, AGM cadence …). Everything stages as Pending review. */
import type { IntakeExtractionResult, IntakeRunResult } from "./bundle";
import { bodyKeyFor } from "./entities";
import { bodyFromText } from "./minutes/extractMinutes";
import { normalizePersonKey } from "./names";
import type { Locator } from "./schemas/common";

const val = (field: any) => (field && (field.status === "stated" || field.status === "inferred" || field.status === "conflicting") ? field.value : undefined);
const dayIso = (field: any): string | undefined => {
  const value = val(field);
  return value?.precision === "day" && /^\d{4}-\d{2}-\d{2}$/.test(value.iso) ? value.iso : undefined;
};
function locatorRef(locators: Locator[] | undefined): string {
  const locator = locators?.[0];
  if (!locator) return "document";
  return [locator.page ? `p.${locator.page}` : "", locator.sheet ? `sheet ${locator.sheet}` : "", locator.cell ? `cell ${locator.cell}` : "", locator.blockIndex !== undefined && !locator.cell ? `block ${locator.blockIndex}` : ""].filter(Boolean).join(", ") || locator.kind;
}
const quoteOf = (field: any) => field?.locators?.[0]?.quote as string | undefined;
const MEETING_TYPE: Record<string, string> = { board: "Board", executive: "Committee", operations: "Committee", committee: "Committee", agm: "AGM", sgm: "SGM", joint: "AGM", members: "AGM" };

export type ClassBundle = {
  collections: Record<string, Array<Record<string, unknown>>>;
  /** Source file keys that landed in a native collection (for coverage). */
  transposed: Set<string>;
  /** Extra representation-gap rows (facts with no native home). */
  gaps: Array<Record<string, unknown>>;
};

function push(bundle: ClassBundle, key: string, payload: Record<string, unknown>, sources: string[]) {
  (bundle.collections[key] ??= []).push(payload);
  for (const source of sources) bundle.transposed.add(source);
}

function gapRow(input: { infoType: string; reason?: string; fileKey: string; locators?: Locator[]; excerpt: string; observedDate?: string; affectedTable: string; proposedTargetTable?: string; proposedField?: string; notes?: string; proposedValue?: unknown }): Record<string, unknown> {
  const locator = input.locators?.[0];
  return {
    infoType: input.infoType,
    reason: input.reason ?? "no_schema_field",
    sourceExternalId: input.fileKey,
    locator: { ...(locator?.page ? { page: String(locator.page) } : {}), ...(locator?.blockIndex !== undefined ? { section: `block ${locator.blockIndex}` } : {}), ...(locator?.sheet ? { sheet: locator.sheet } : {}), ...(locator?.cell ? { cellRange: locator.cell } : {}) },
    excerpt: input.excerpt.slice(0, 400),
    ...(input.observedDate ? { observedDate: input.observedDate } : {}),
    affectedTable: input.affectedTable,
    ...(input.proposedTargetTable ? { proposedTargetTable: input.proposedTargetTable } : {}),
    ...(input.proposedField ? { proposedField: input.proposedField } : {}),
    ...(input.proposedValue !== undefined && (typeof input.proposedValue !== "object" || input.proposedValue === null) ? { proposedValue: input.proposedValue } : {}),
    status: "open",
    reviewHistory: [],
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

// ---------------------------------------------------------------- agendas / packages / AGM material
function agendaItemsOf(record: any): Array<Record<string, unknown>> {
  const items = (record.items ?? []).map((item: any) => ({
    title: val(item.title),
    ...(val(item.number) ? { itemNumber: val(item.number) } : {}),
    ...(val(item.scheduledTime) ? { scheduledTimeText: val(item.scheduledTime) } : {}),
    ...(val(item.presenter) ? { presenter: val(item.presenter) } : {}),
    ...(val(item.requestedAction) ? { requestedAction: val(item.requestedAction) } : {}),
    ...(val(item.consent) !== undefined ? { consent: val(item.consent) } : {}),
    ...(item.depth ? { depth: Math.min(1, item.depth) } : {}),
  })).filter((item: any) => item.title);
  // AGM material lists agenda items as plain strings.
  for (const text of record.agendaItems ?? []) if (val(text)) items.push({ title: val(text) });
  // Proposed resolutions (notices, scripts, special-resolution notices): agenda items, never motions.
  for (const resolution of [...(record.proposedResolutions ?? []).filter((item: any) => typeof val(item) === "string"), ...(record.resolutions ?? [])]) {
    const value = val(resolution);
    const text = typeof value === "string" ? value : value?.text;
    if (text && !items.some((item: any) => item.details === text)) items.push({ title: `Proposed resolution${value?.kind === "special" ? " (special)" : ""}`, details: text.slice(0, 1000), type: "proposed_resolution", requestedAction: "approve" });
  }
  return items;
}

function consentEvidence(record: any, fileKey: string): Array<Record<string, unknown>> {
  return (record.consentItems ?? []).map((item: any, index: number) => ({
    id: `${fileKey}#consent-${index}`,
    title: val(item.title),
    outcome: val(item.outcome) ?? "pending",
    sourceReference: `${locatorRef(item.title?.locators)}${quoteOf(item.title) ? `: ${quoteOf(item.title)!.slice(0, 120)}` : ""}`,
    sourceExternalIds: [fileKey],
  })).filter((row: any) => row.title);
}

function meetingTitle(bodyKey: string, record: any, date: string): string {
  const label = String(val(record.bodyLabel) ?? bodyFromText(bodyKey)?.label ?? "Meeting");
  // "Annual General Meeting meeting" reads badly: only add "meeting" when the label lacks it.
  return `${label}${/\bmeeting$/i.test(label) ? "" : " meeting"} — ${date}`;
}

// ---------------------------------------------------------------- people & terms
type Observation = { name: string; date?: string; precision?: string; end?: string; role?: string; org?: string; kind: string; fileKey: string; consent?: boolean; holder?: string; meetingDate?: string };

/** Term intervals from dated observations: a term opens at the first observation and
 * closes at an explicit end (left / replaced / term end); a later observation reopens. */
export function deriveTerms(observations: Observation[]): Array<{ termStart?: string; termEnd?: string; position?: string; sourceExternalIds: string[] }> {
  const sorted = [...observations].sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
  const terms: Array<{ termStart?: string; termEnd?: string; position?: string; sourceExternalIds: string[] }> = [];
  let open: (typeof terms)[number] | undefined;
  for (const observation of sorted) {
    if (!open) {
      open = { termStart: observation.date, position: observation.role, sourceExternalIds: [observation.fileKey] };
      terms.push(open);
    } else if (!open.sourceExternalIds.includes(observation.fileKey)) open.sourceExternalIds.push(observation.fileKey);
    if (observation.end) {
      open.termEnd = observation.end;
      open = undefined;
    }
  }
  return terms;
}

const POSITION = (role?: string) => (role && /president|chair|treasurer|secretary|vice/i.test(role) ? role : "Director");

// ---------------------------------------------------------------- main
/**
 * Extracted registry filing type → native filing kind (the BC Societies Online
 * forms in shared/filingPreparation.ts). A statement of directors lists the
 * directors in office after a change and is filed with the registry as a
 * change of directors (X-07), like a notice of change of directors; it is not
 * an annual report, which has its own AGM-date evidence.
 */
export const REGISTRY_FILING_KIND: Record<string, string> = {
  annual_report: "AnnualReport",
  statement_of_directors: "ChangeOfDirectors",
  change_of_directors: "ChangeOfDirectors",
  change_of_address: "ChangeOfAddress",
  bylaw_amendment: "BylawAmendment",
  transition: "Other",
  other: "Other",
};

export function classBundleRecords(run: IntakeRunResult, context: { minutesPayloads: Array<Record<string, any>> }): ClassBundle {
  const bundle: ClassBundle = { collections: {}, transposed: new Set(), gaps: [] };
  const byClass = (classes: string[]) => run.extractions.filter((extraction) => classes.includes(extraction.docClass) && !extraction.parentFileKey);
  const fileName = (fileKey: string) => run.files.find((file) => file.fileKey === fileKey)?.name ?? fileKey;
  const asOf = run.startedAtISO.slice(0, 10);

  // 1. Agendas, packages and AGM material.
  const minutesByKey = new Map<string, Record<string, any>>();
  for (const payload of context.minutesPayloads) {
    const body = bodyFromText(String(payload.meetingTitle ?? ""))?.body ?? "";
    minutesByKey.set(`${payload.meetingDate}`, payload);
    if (body) minutesByKey.set(`${body}@${payload.meetingDate}`, payload);
  }
  const evidenced = new Map((run.reconciliation.evidencedMeetings ?? []).map((meeting) => [meeting.fileId, meeting]));
  // Several files can show the same minutes-less meeting (agenda + consent agenda): they enrich one staged meeting.
  const evidencedPayloads = new Map<string, Record<string, any>>();
  // Staged meetings whose agenda items came from a consent agenda: a full agenda replaces them.
  const consentOnlyAgenda = new WeakSet<object>();
  const agendaLike = byClass(["agenda", "meetingPackage", "agmMaterial"]).sort((a, b) => Number(!evidenced.has(a.fileKey)) - Number(!evidenced.has(b.fileKey)));
  for (const extraction of agendaLike) {
    const record: any = extraction.record;
    const date = dayIso(record.date) ?? dayIso(record.meetingDate);
    if (!date) continue;
    const evidence = evidenced.get(extraction.fileKey);
    const items = agendaItemsOf(record);
    const consentItems = consentEvidence(record, extraction.fileKey);
    if (evidence) {
      // A meeting shown by its agenda/package with no minutes: staged as held, minutes missing.
      const slate = (record.electionSlate ?? []).map((entry: any) => val(entry)).filter(Boolean);
      const fs = val(record.financialStatementsPresented);
      const staged: Record<string, any> = {
        meetingDate: date,
        meetingTitle: meetingTitle(evidence.bodyKey, record, date),
        meetingType: MEETING_TYPE[evidence.bodyKey] ?? "Board",
        body: evidence.bodyKey,
        meetingStatus: "Held",
        scheduledAtPrecision: "date",
        ...(val(record.startTime) ? { localStartText: val(record.startTime) } : {}),
        ...(val(record.endTime) ? { localEndText: val(record.endTime) } : {}),
        ...(val(record.location) ? { location: String(val(record.location)).slice(0, 200) } : {}),
        ...(val(record.electronic) !== undefined ? { electronic: val(record.electronic) } : {}),
        detailedAttendance: [], attendees: [], absent: [], motions: [], decisions: [], actionItems: [],
        quorumStatus: "not_recorded",
        ...(items.length ? { agendaItems: items } : {}),
        ...(consentItems.length ? { consentItems } : {}),
        ...(slate.length || fs ? { agmDetails: { ...(fs ? { financialStatementsNotes: `Listed for presentation: ${fs}` } : {}), ...(slate.length ? { directorAppointments: slate.map((entry: any) => ({ name: entry.resolvedName ?? entry.nameAsWritten, ...(entry.affiliation ? { affiliation: entry.affiliation } : {}), ...(entry.role ? { roleTitle: entry.role } : {}), status: "nominated" })) } : {}) } } : {}),
        discussion: `No minutes were found for this meeting. It is evidenced by ${fileName(extraction.fileKey)} (${evidence.kind.replace(/_/g, " ")}). Upload the minutes or confirm the meeting was held.`,
        sourceExternalIds: [extraction.fileKey],
        sourceDocumentTitle: fileName(extraction.fileKey),
        confidence: "Review",
        notes: `Meeting evidenced by an agenda/package (minutes missing). Agenda items and consent items are as circulated, not as decided. Extracted by ${extraction.model}.`,
      };
      push(bundle, "meetingMinutes", staged, [extraction.fileKey]);
      if (val(record.kind) === "consent_agenda") consentOnlyAgenda.add(staged);
      evidencedPayloads.set(`${evidence.bodyKey}@${date}`, staged);
      continue;
    }
    // Minutes exist: the agenda/package is a meeting material; consent receipts and agenda items enrich the minutes payload.
    const bodyKey = bodyFromText(String(val(record.bodyLabel) ?? val(record.body) ?? ""))?.body;
    const evidenceKey = bodyKeyFor(String(val(record.bodyLabel) ?? val(record.body) ?? (extraction.docClass === "agmMaterial" ? "Annual General Meeting" : "")));
    const minutes = (bodyKey && minutesByKey.get(`${bodyKey}@${date}`)) ?? minutesByKey.get(date) ?? evidencedPayloads.get(`${evidenceKey}@${date}`);
    if (minutes) {
      if (items.length && (!(minutes.agendaItems as unknown[] | undefined)?.length || (consentOnlyAgenda.has(minutes) && val(record.kind) !== "consent_agenda"))) {
        minutes.agendaItems = items;
        consentOnlyAgenda.delete(minutes);
      }
      if (consentItems.length) minutes.consentItems = [...(minutes.consentItems ?? []), ...consentItems];
      minutes.sourceExternalIds = [...new Set([...(minutes.sourceExternalIds ?? []), extraction.fileKey])];
      push(bundle, "meetingMaterials", {
        meetingDate: date,
        ...(minutes.body ? { body: minutes.body } : bodyKey ? { body: bodyKey } : {}),
        meetingTitle: minutes.meetingTitle,
        label: String(val(record.title) ?? fileName(extraction.fileKey)).slice(0, 200),
        agendaLabel: extraction.docClass === "meetingPackage" ? "Meeting package" : extraction.docClass === "agmMaterial" ? "AGM material" : "Agenda",
        requiredForMeeting: false,
        sourceExternalIds: [extraction.fileKey],
        notes: `Linked by intake (${extraction.docClass}).`,
      }, [extraction.fileKey]);
    }
  }

  // 2. Policies, bylaws (versions) and bylaw rule sets; terms of reference → committees.
  const policyLinks = new Map((run.reconciliation.policyAdoptions ?? []).map((link) => [link.from, link]));
  const policyExtractions = byClass(["policy", "bylaws"]).filter((extraction) => !val((extraction.record as any).external));
  const families = new Map<string, IntakeExtractionResult[]>();
  for (const extraction of policyExtractions) {
    const cluster = run.files.find((file) => file.fileKey === extraction.fileKey)?.clusterKey;
    const title = String(val((extraction.record as any).title) ?? fileName(extraction.fileKey)).toLowerCase().replace(/\b(?:draft|final|amended|revised|20\d\d|19\d\d|v\d+)\b|[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    const key = cluster ?? `title:${extraction.docClass}:${title}`;
    families.set(key, [...(families.get(key) ?? []), extraction]);
  }
  for (const family of families.values()) {
    const dated = family.map((extraction) => ({ extraction, date: dayIso((extraction.record as any).adoptedDate) ?? dayIso((extraction.record as any).effectiveDate) ?? (val((extraction.record as any).effectiveDate)?.iso as string | undefined) })).sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    dated.forEach(({ extraction, date }, index) => {
      const record: any = extraction.record;
      const link = policyLinks.get(extraction.fileKey);
      const next = dated[index + 1];
      const superseded = Boolean(next && next.date && date && next.date > date);
      const title = String(val(record.title) ?? fileName(extraction.fileKey));
      const version = val(record.versionLabel);
      push(bundle, "policies", {
        policyName: (version && !title.includes(version) ? `${title} (${version})` : title).slice(0, 200),
        ...(val(record.policyNumber) ? { policyNumber: val(record.policyNumber) } : {}),
        ...(val(record.governsBody) ? { owner: val(record.governsBody) } : {}),
        // An explicit effective date wins; otherwise the stated adoption date is when it took effect (X-02).
        ...((dayIso(record.effectiveDate) ?? dayIso(record.adoptedDate)) ? { effectiveDate: dayIso(record.effectiveDate) ?? dayIso(record.adoptedDate) } : date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { effectiveDate: date } : {}),
        ...(dayIso(record.adoptedDate) ? { adoptedDate: dayIso(record.adoptedDate) } : {}),
        ...(dayIso(record.reviewDate) ? { reviewDate: dayIso(record.reviewDate) } : {}),
        ...(superseded && next.date && /^\d{4}-\d{2}-\d{2}$/.test(next.date) ? { ceasedDate: next.date } : {}),
        ...(link ? { adoptedAtMeeting: { meetingDate: link.meetingDate, body: link.bodyKey } } : {}),
        status: superseded ? "Superseded" : "Draft",
        sourceExternalIds: [extraction.fileKey],
        confidence: "Review",
        notes: [
          `${extraction.docClass === "bylaws" ? "Bylaws/constitution" : "Policy"} version${version ? ` "${version}"` : ""} from ${fileName(extraction.fileKey)}; ${(record.clauses ?? []).length} clause(s) outlined in the intake run.`,
          link ? `Adopting motion: ${link.detail}.` : val(record.status) === "adopted" ? "Marked approved/final in the source; no adopting motion found in the minutes." : "",
          superseded ? `Superseded by ${fileName(next.extraction.fileKey)}.` : "",
          "Imported as Draft: confirm the adopting motion before making it Active.",
        ].filter(Boolean).join("\n"),
      }, [extraction.fileKey]);
      const rules = record.rules;
      if (!rules) return;
      // Terms of reference: the committee's own quorum and cadence.
      if (val(record.kind) === "terms_of_reference" && val(record.governsBody)) {
        const quorum = (rules.bodyQuorumRules ?? []).find((rule: any) => val(rule.body) === "committee") ?? (rules.bodyQuorumRules ?? [])[0];
        const cadence = (record.clauses ?? []).map((clause: any) => val(clause.heading)).find((heading: any) => /monthly|quarterly|weekly/i.test(String(heading ?? "")));
        push(bundle, "committees", {
          name: val(record.governsBody),
          description: `${title}${version ? ` (${version})` : ""}. Imported from the terms of reference.`,
          ...(quorum && val(quorum.quorumType) && (val(quorum.quorumType) === "majority" || val(quorum.quorumValue) > 0) ? { quorumRule: { quorumType: val(quorum.quorumType), ...(val(quorum.quorumValue) !== undefined ? { quorumValue: val(quorum.quorumValue) } : {}), ...(val(quorum.quorumMinimumCount) !== undefined ? { quorumMinimumCount: val(quorum.quorumMinimumCount) } : {}), notes: quoteOf(quorum.quorumType)?.slice(0, 200) } } : {}),
          ...(cadence ? { cadenceNotes: String(cadence) } : {}),
          sourceExternalIds: [extraction.fileKey],
          confidence: "Review",
        }, [extraction.fileKey]);
        return;
      }
      if (extraction.docClass !== "bylaws" || superseded) return;
      const general = (rules.bodyQuorumRules ?? []).find((rule: any) => val(rule.body) === "general");
      const ruleSet: Record<string, unknown> = {
        ...(val(rules.noticeDays) ? { generalNoticeMinDays: val(rules.noticeDays) } : {}),
        ...(val(rules.noticeMaxDays) ? { generalNoticeMaxDays: val(rules.noticeMaxDays) } : {}),
        ...(val(rules.electronicMeetings) !== undefined ? { allowElectronicMeetings: val(rules.electronicMeetings) } : {}),
        ...(val(rules.proxiesAllowed) !== undefined ? { allowProxyVoting: val(rules.proxiesAllowed) } : {}),
        ...(val(rules.proxyHolderMustBeMember) !== undefined ? { proxyHolderMustBeMember: val(rules.proxyHolderMustBeMember) } : {}),
        ...(general && ["fixed", "percentage"].includes(val(general.quorumType)) && val(general.quorumValue) > 0 ? { quorumType: val(general.quorumType), quorumValue: val(general.quorumValue), ...(val(general.quorumMinimumCount) ? { quorumMinimumCount: val(general.quorumMinimumCount) } : {}) } : {}),
        ...(val(rules.specialResolutionThresholdPct) ? { specialResolutionThresholdPct: val(rules.specialResolutionThresholdPct) } : {}),
      };
      const bodyRules = (rules.bodyQuorumRules ?? []).filter((rule: any) => val(rule.body) !== "committee" && (val(rule.quorumType) === "majority" || val(rule.quorumType) === "all_members" || val(rule.quorumValue) > 0) && !(val(rule.quorumType) === "percentage" && val(rule.quorumValue) > 100)).map((rule: any) => ({ body: val(rule.body), quorumType: val(rule.quorumType), ...(val(rule.quorumValue) !== undefined ? { quorumValue: val(rule.quorumValue) } : {}), ...(val(rule.quorumMinimumCount) !== undefined ? { quorumMinimumCount: val(rule.quorumMinimumCount) } : {}), notes: (quoteOf(rule.quorumType) ?? "").slice(0, 200) }));
      if (Object.keys(ruleSet).length || bodyRules.length) {
        push(bundle, "bylawRuleSets", { ...ruleSet, ...(bodyRules.length ? { bodyQuorumRules: bodyRules } : {}), ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { effectiveFrom: date } : {}), sourceExternalIds: [extraction.fileKey], confidence: "Review", notes: `Typed rules extracted from ${fileName(extraction.fileKey)}; staged as Draft.` }, [extraction.fileKey]);
      }
      // Rules with no bylawRuleSets field.
      const noField: Array<[string, any, string, string]> = [
        ["bylaw.agm_cadence", rules.agmFrequency, "agmFrequency", `AGM cadence: ${val(rules.agmFrequency)}`],
        ["bylaw.agm_max_months", rules.agmMaxMonthsBetween, "agmMaxMonthsBetween", `AGM at most ${val(rules.agmMaxMonthsBetween)} months after the previous one`],
        ["bylaw.director_count", rules.directorCountMin ?? rules.directorCountMax, "directorCount", `Directors: ${val(rules.directorCountMin) ?? "?"}–${val(rules.directorCountMax) ?? "?"}`],
        ["bylaw.director_term", rules.directorTermYears ?? rules.directorTerm, "directorTerm", `Director term: ${val(rules.directorTermYears) ? `${val(rules.directorTermYears)} years` : String(val(rules.directorTerm) ?? "").slice(0, 160)}`],
        ["bylaw.proxy_limit", rules.proxyLimitPerHolder, "proxyLimitPerHolder", `A proxy holder may hold at most ${val(rules.proxyLimitPerHolder)} proxies`],
        ["bylaw.fiscal_year_end", rules.fiscalYearEnd, "fiscalYearEnd", `Fiscal year end: ${val(rules.fiscalYearEnd)}`],
      ];
      for (const [infoType, field, proposedField, excerpt] of noField) {
        if (!field || val(field) === undefined) continue;
        bundle.gaps.push(gapRow({ infoType, fileKey: extraction.fileKey, locators: field.locators, excerpt: `${excerpt}. "${(quoteOf(field) ?? "").slice(0, 200)}"`, affectedTable: "bylawRuleSets", proposedTargetTable: "bylawRuleSets", proposedField, observedDate: date, notes: "Typed bylaw rule without a bylawRuleSets field (ID-11)." }));
      }
    });
  }
  // Signing tiers (policies): A17 tiers live on signingAuthorities rows, which need a named signer.
  for (const extraction of policyExtractions) {
    const tiers = (extraction.record as any).rules?.signingTiersDetail ?? [];
    if (!tiers.length) continue;
    bundle.gaps.push(gapRow({ infoType: "policy.signing_tiers", reason: "no_import_key", fileKey: extraction.fileKey, locators: tiers[0].text?.locators, excerpt: tiers.map((tier: any) => `${val(tier.text)}: ${tier.signaturesRequired} signature(s)${tier.roles?.length ? ` (${tier.roles.join("; ")})` : ""}`).join(" | "), affectedTable: "signingAuthorities", proposedTargetTable: "signingAuthorities", proposedField: "tiers", notes: "Organization-level signing tiers from policy; signingAuthorities rows need a named signer. Apply the tiers when the signers are recorded." }));
  }

  // 3. Directors (consents, rosters, filings, AGM slates) with term intervals; seats; proxies.
  const observations = new Map<string, Observation[]>();
  const observe = (observation: Observation) => {
    const key = normalizePersonKey(observation.name);
    if (!key || key.split(" ").length < 2) return;
    observations.set(key, [...(observations.get(key) ?? []), observation]);
  };
  const seats = new Map<string, { organizationName: string; observations: Array<Record<string, unknown>>; sources: Set<string> }>();
  const seat = (org: string, observation: Record<string, unknown>, fileKey: string) => {
    const key = org.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!key) return;
    const entry = seats.get(key) ?? { organizationName: org, observations: [], sources: new Set<string>() };
    entry.observations.push({ ...observation, sourceExternalIds: [fileKey] });
    entry.sources.add(fileKey);
    seats.set(key, entry);
  };
  for (const extraction of byClass(["directorConsent", "proxy", "roster"])) {
    const record: any = extraction.record;
    const kind = val(record.kind);
    const asOfDate = val(record.asOfDate);
    for (const entry of record.entries ?? []) {
      const person = val(entry.person);
      const org = val(entry.organisationRepresented);
      const type = val(entry.representativeType);
      const signed = dayIso(entry.signedDate);
      const start = val(entry.termStart)?.iso ?? signed ?? (asOfDate?.iso as string | undefined);
      const end = val(entry.termEnd)?.iso;
      if (type === "vacant") {
        if (org) seat(org, { kind: "vacant", observedAt: asOfDate?.iso, notes: "Seat listed as VACANT." }, extraction.fileKey);
        continue;
      }
      // A member organization can itself grant a proxy (no individual grantor named).
      if (!person && !((kind === "proxy" || type === "proxy") && org)) continue;
      const name: string = person ? person.resolvedName ?? person.nameAsWritten : org;
      if (kind === "proxy" || type === "proxy") {
        const holder = val(entry.proxyHolder);
        const meetingDate = dayIso(entry.meetingDate);
        if (holder && meetingDate) push(bundle, "proxies", { meetingDate, grantorName: name, proxyHolderName: holder.nameAsWritten, signedAtISO: signed ?? meetingDate, sourceExternalIds: [extraction.fileKey], confidence: "Review" }, [extraction.fileKey]);
        else if (org || holder) seat(org ?? "Unassigned seat", { kind: "proxy", personName: holder?.nameAsWritten ?? name, principalName: holder ? name : undefined, termStart: start, termEnd: end, observedAt: signed ?? start, notes: holder ? `Standing proxy for ${name}` : "Listed as proxy/alternate" }, extraction.fileKey);
        if (!holder) observe({ name, date: start, end, role: "Proxy", org, kind: "proxy", fileKey: extraction.fileKey });
        continue;
      }
      if (type === "staff" || type === "member") continue;
      observe({ name, date: start, precision: val(entry.termStart)?.precision, end, role: val(entry.role) ?? person.role, org, kind: kind === "director_consent" ? "consent" : "roster", fileKey: extraction.fileKey, consent: kind === "director_consent" });
      if (org) seat(org, { kind: "representative", personName: name, termStart: start, termEnd: end, observedAt: asOfDate?.iso ?? signed }, extraction.fileKey);
    }
  }
  for (const extraction of byClass(["registryFiling"])) {
    const record: any = extraction.record;
    const filed = dayIso(record.agmDate) ?? dayIso(record.filedDate);
    for (const entry of record.directorsListed ?? []) {
      const person = val(entry);
      if (person) observe({ name: person.resolvedName ?? person.nameAsWritten, date: filed, kind: "filing", fileKey: extraction.fileKey });
    }
  }
  for (const [, list] of observations) {
    const named = list.find((observation) => observation.kind === "consent") ?? list[0];
    const terms = deriveTerms(list.filter((observation) => observation.kind !== "proxy"));
    if (!terms.length) continue;
    const sources = [...new Set(list.map((observation) => observation.fileKey))];
    const firstDay = terms.find((term) => term.termStart && /^\d{4}-\d{2}-\d{2}$/.test(term.termStart))?.termStart;
    push(bundle, "directors", {
      fullName: named.name,
      position: POSITION(named.role),
      ...(firstDay ? { termStart: firstDay } : {}),
      consentOnFile: list.some((observation) => observation.consent),
      status: "NeedsReview",
      terms: terms.map((term) => ({ position: POSITION(term.position), ...(term.termStart ? { termStart: /^\d{4}-\d{2}$/.test(term.termStart) ? `${term.termStart}-01` : term.termStart } : {}), ...(term.termEnd ? { termEnd: /^\d{4}-\d{2}$/.test(term.termEnd) ? `${term.termEnd}-28` : term.termEnd } : {}), sourceExternalIds: term.sourceExternalIds, notes: "Term interval derived from consent forms, rosters and registry filings; month-only dates are approximate." })),
      ...(list.find((observation) => observation.org) ? { notes: `Represents ${list.find((observation) => observation.org)!.org}.` } : {}),
      sourceExternalIds: sources,
      confidence: "Review",
    }, sources);
  }
  for (const [seatKey, entry] of seats) {
    push(bundle, "organizationSeats", { seatKey, organizationName: entry.organizationName, observations: entry.observations, sourceExternalIds: [...entry.sources], confidence: "Review" }, [...entry.sources]);
  }

  // 4. Financial statements and budgets.
  for (const extraction of byClass(["financialStatement", "budget"])) {
    const record: any = extraction.record;
    const type = val(record.statementType);
    const periodEnd = dayIso(record.periodEnd) ?? (val(record.periodEnd)?.precision === "month" ? `${val(record.periodEnd).iso}-28` : undefined);
    // Budgets are often labelled only by fiscal year ("2024", "2014_15"): budgetSnapshots.periodEnd is optional.
    const fiscalLabel = fiscalYearLabel(fileName(extraction.fileKey), String(val(record.title) ?? ""), val(record.periodEnd)?.iso);
    const isBudget = extraction.docClass === "budget" || type === "budget";
    if (!periodEnd && !(isBudget && fiscalLabel)) continue;
    const lines = (record.lines ?? []).map((line: any, index: number) => ({
      section: line.section ?? "Unclassified",
      label: val(line.label),
      amountCents: val(line.amount)?.amountCents,
      sourceCells: (line.amount?.locators ?? []).map((locator: Locator) => ({ sheet: locator.sheet, cell: locator.cell, page: locator.page, block: locator.blockIndex, text: locator.quote })),
      notes: `${val(line.column) ?? "unknown"} column`,
      sortOrder: index,
    })).filter((line: any) => line.label && typeof line.amountCents === "number");
    const totals = record.totals ?? [];
    const total = (re: RegExp) => totals.find((item: any) => re.test(String(val(item.label) ?? "")))?.amount;
    const revenue = val(total(/^total\b.*\b(?:revenues?|income|receipts)\b/i))?.amountCents;
    const expenses = val(total(/^total\b.*\b(?:expenses?|expenditures?)\b/i))?.amountCents;
    const net = val(total(/^net\b|surplus|excess/i))?.amountCents;
    const checks = totals.map((item: any) => val(item.arithmeticCheck)).filter(Boolean);
    const summary = `${checks.filter((check: string) => check === "ok").length}/${checks.length} totals re-add correctly${checks.includes("mismatch") ? " (mismatches flagged for review)" : ""}.`;
    const notes = [
      `Version: ${val(record.versionLabel) ?? "unknown"}. ${summary}`,
      val(record.titleConflict) ? `Title conflict: ${val(record.titleConflict)}` : "",
      val(record.fiscalYearEndChange) ? `Fiscal year end change: ${val(record.fiscalYearEndChange)}` : "",
    ].filter(Boolean).join("\n");
    if (isBudget) {
      push(bundle, "budgetSnapshots", {
        title: String(val(record.title) ?? fileName(extraction.fileKey)).slice(0, 200),
        fiscalYear: fiscalLabel ?? periodEnd!.slice(0, 4),
        ...(fiscalLabel && fiscalLabel !== periodEnd?.slice(0, 4) ? { periodLabel: `Fiscal year ${fiscalLabel}` } : {}),
        ...(dayIso(record.periodStart) ? { periodStart: dayIso(record.periodStart) } : {}),
        ...(periodEnd ? { periodEnd } : {}),
        currency: val(record.currency) ?? "CAD",
        ...(revenue !== undefined ? { totalIncomeCents: revenue } : {}),
        ...(expenses !== undefined ? { totalExpenseCents: expenses } : {}),
        ...(net !== undefined ? { netCents: net } : {}),
        lines: lines.map((line: any) => ({ lineType: /revenue|income/i.test(line.section) ? "income" : /expense/i.test(line.section) ? "expense" : /asset|carry/i.test(line.section) ? "asset" : "note", category: line.label, parentCategory: line.section, amountCents: line.amountCents, sourceCells: line.sourceCells, rawLabel: line.label, sortOrder: line.sortOrder, notes: line.notes })),
        sourceExternalIds: [extraction.fileKey],
        confidence: "Review",
        notes,
      }, [extraction.fileKey]);
    } else {
      if (!periodEnd) continue;
      push(bundle, "financialStatementImports", {
        title: String(val(record.title) ?? fileName(extraction.fileKey)).slice(0, 200),
        fiscalYear: periodEnd.slice(0, 4),
        currency: val(record.currency) ?? "CAD",
        statementType: type === "balance_sheet" ? "balance_sheet" : type === "income_statement" ? "income_statement" : "full_statement",
        ...(dayIso(record.periodStart) ? { periodStart: dayIso(record.periodStart) } : {}),
        periodEnd,
        ...(revenue !== undefined ? { revenueCents: revenue } : {}),
        ...(expenses !== undefined ? { expensesCents: expenses } : {}),
        ...(type === "balance_sheet" && net !== undefined ? { netAssetsCents: net } : {}),
        lines,
        sourceExternalIds: [extraction.fileKey],
        confidence: "Review",
        notes,
      }, [extraction.fileKey]);
    }
  }

  // 5. Insurance (explicit reviewed status; never Active by default).
  const INSURANCE_KIND: Record<string, string> = { directors_officers: "DirectorsOfficers", general_liability: "GeneralLiability", property: "PropertyCasualty", cyber: "CyberLiability", errors_omissions: "Other", other: "Other" };
  for (const extraction of byClass(["insurance"])) {
    const record: any = extraction.record;
    const start = dayIso(record.termStart), end = dayIso(record.termEnd);
    if (!start && !val(record.policyNumber)) continue;
    const coverages = (record.coverages ?? []).map((coverage: any) => `${val(coverage.type)}${val(coverage.limit) ? ` ${val(coverage.limit).text}` : ""}${val(coverage.deductible) ? ` (deductible ${val(coverage.deductible).text})` : ""}`);
    const limits = (record.coverages ?? []).map((coverage: any) => val(coverage.limit)?.amountCents).filter((cents: any) => typeof cents === "number");
    push(bundle, "insurancePolicies", {
      kind: INSURANCE_KIND[String(val(record.kind) ?? "other")] ?? "Other",
      insurer: val(record.insurer) ?? "Needs review",
      ...(val(record.broker) ? { broker: val(record.broker) } : {}),
      ...(val(record.policyNumber) ? { policyNumber: val(record.policyNumber) } : {}),
      ...(start ? { startDate: start } : {}),
      ...(end ? { endDate: end, renewalDate: end } : {}),
      ...(val(record.premium) ? { premiumCents: val(record.premium).amountCents } : {}),
      ...(val(record.fees) ? { policyFeeCents: val(record.fees).amountCents } : {}),
      ...(val(record.totalCost) ? { totalCostCents: val(record.totalCost).amountCents } : {}),
      ...(limits.length ? { coverageCents: Math.max(...limits) } : {}),
      ...(coverages.length ? { coverageSummary: coverages.join("; ").slice(0, 1000) } : {}),
      ...(record.additionalInsureds?.length ? { additionalInsureds: record.additionalInsureds.map(val).filter(Boolean) } : {}),
      versionType: val(record.documentType) ?? "unknown",
      status: val(record.proposedStatus) ?? "NeedsReview",
      sourceExternalIds: [extraction.fileKey],
      confidence: "Review",
      notes: `${val(record.kind) === "errors_omissions" ? "Errors & omissions (professional liability). " : ""}Status ${val(record.proposedStatus) ?? "NeedsReview"}: ${end && end < asOf ? `term ended ${end}` : "current or unknown term"} — confirm before marking Active.`,
    }, [extraction.fileKey]);
  }

  // 6. Grants (rich C10 fields) and agreements (representation gap + reporting deadlines).
  const GRANT_STATUS = (stage: string, expired: boolean) => stage === "application" || stage === "proposal" ? "Submitted" : stage === "report" ? (expired ? "Closed" : "Active") : stage === "award" || stage === "agreement" ? (expired ? "Closed" : "Active") : "Drafting";
  for (const extraction of byClass(["agreement", "grant"])) {
    const record: any = extraction.record;
    const title = String(val(record.title) ?? fileName(extraction.fileKey)).slice(0, 200);
    const expiry = dayIso(record.expiry);
    const reporting = (record.reportingRequirements ?? []).filter((item: any) => dayIso(item.due));
    for (const item of reporting) {
      push(bundle, "deadlines", { title: `Report due — ${title}`.slice(0, 200), dueDate: dayIso(item.due), category: extraction.docClass === "grant" ? "Grant reporting" : "Agreement reporting", done: false, sourceExternalIds: [extraction.fileKey], confidence: "Review", notes: `${String(val(item.text) ?? "").slice(0, 300)}${dayIso(item.due)! < asOf ? " (historical date: confirm whether the report was submitted)" : ""}` }, [extraction.fileKey]);
    }
    if (extraction.docClass !== "grant" && val(record.kind) !== "grant") {
      if (expiry && !reporting.length && expiry >= asOf) push(bundle, "deadlines", { title: `Agreement ends — ${title}`.slice(0, 200), dueDate: expiry, category: "Agreement", done: false, sourceExternalIds: [extraction.fileKey], confidence: "Review" }, [extraction.fileKey]);
      continue; // the agreement itself is a representation gap (from the extractor's unsupported[]).
    }
    const parties = (record.parties ?? []).map(val).filter(Boolean) as string[];
    const org = run.organizationName?.toLowerCase().slice(0, 20);
    const funder = val(record.funder) ?? parties.find((party) => !org || !party.toLowerCase().includes(org)) ?? "Needs review";
    const stage = String(val(record.grantStage) ?? "unknown");
    const amount = val(record.amount)?.amountCents;
    const nextReport = reporting.map((item: any) => dayIso(item.due)!).filter((date: string) => date >= asOf).sort()[0];
    push(bundle, "grants", {
      title,
      funder: String(funder).slice(0, 200),
      ...(val(record.program) ? { program: val(record.program) } : {}),
      status: GRANT_STATUS(stage, Boolean(expiry && expiry < asOf)),
      ...(val(record.amountRequested) ? { amountRequestedCents: val(record.amountRequested).amountCents } : stage === "application" || stage === "proposal" ? (amount !== undefined ? { amountRequestedCents: amount } : {}) : {}),
      ...(amount !== undefined && stage !== "application" && stage !== "proposal" ? { amountAwardedCents: amount } : {}),
      ...(val(record.purpose) ? { restrictedPurpose: String(val(record.purpose)).slice(0, 500) } : {}),
      ...(dayIso(record.effective) ? { startDate: dayIso(record.effective) } : {}),
      ...(expiry ? { endDate: expiry } : {}),
      ...(nextReport ? { nextReportDueAtISO: nextReport } : {}),
      ...(reporting.length || (record.reportingRequirements ?? []).length ? { requirements: (record.reportingRequirements ?? []).slice(0, 20).map((item: any, index: number) => ({ id: `report-${index + 1}`, category: "Reporting", label: String(val(item.text) ?? "Report").slice(0, 200), status: "Needed", ...(dayIso(item.due) ? { dueDate: dayIso(item.due) } : {}) })) } : {}),
      ...(record.paymentSchedule?.length ? { useOfFunds: record.paymentSchedule.slice(0, 20).map((item: any) => ({ label: String(val(item.text) ?? "Payment").slice(0, 200), ...(val(item.amount) ? { amountCents: val(item.amount).amountCents } : {}) })), timelineEvents: record.paymentSchedule.filter((item: any) => dayIso(item.due)).slice(0, 20).map((item: any) => ({ label: `Payment period ends: ${String(val(item.text) ?? "").slice(0, 120)}`, date: dayIso(item.due) })) } : {}),
      keyFacts: [val(record.agreementNumber) ? `Agreement ${val(record.agreementNumber)}` : "", parties.length ? `Parties: ${parties.join("; ")}` : "", `Stage: ${stage}`, (record.deliverables ?? []).length ? `${record.deliverables.length} deliverable(s) listed` : ""].filter(Boolean),
      ...(record.signatories?.length ? { contacts: record.signatories.map((entry: any) => ({ role: val(entry)?.role ?? "Signatory", name: val(entry)?.nameAsWritten })).filter((contact: any) => contact.name) } : {}),
      sourceExternalIds: [extraction.fileKey],
      confidence: "Review",
    }, [extraction.fileKey]);
  }

  // 7. Registry filings (one row per filing; confirmations, receipts and copies fold together).
  const FILING_KIND = REGISTRY_FILING_KIND;
  const filings = new Map<string, Record<string, any>>();
  for (const extraction of byClass(["registryFiling"])) {
    const record: any = extraction.record;
    const type = String(val(record.filingType) ?? "other");
    const filed = dayIso(record.filedDate);
    const key = `${FILING_KIND[type] ?? "Other"}@${filed ?? extraction.fileKey}`;
    const existing = filings.get(key);
    const confirmed = val(record.filingStatus) === "filed" && filed;
    const payload = existing ?? {
      kind: FILING_KIND[type] ?? "Other",
      ...(val(record.period) ? { periodLabel: String(val(record.period)) } : {}),
      ...(filed ? { filedAt: filed, dueDate: filed } : {}),
      ...(confirmed ? { submissionMethod: "BC Registries (Societies Online)", status: "Filed" } : { status: "NeedsReview" }),
      sourceExternalIds: [],
      confidence: "Review",
      notes: "",
    };
    payload.sourceExternalIds = [...new Set([...(payload.sourceExternalIds as string[]), extraction.fileKey])];
    if (val(record.confirmationNumber) && !payload.confirmationNumber) payload.confirmationNumber = val(record.confirmationNumber);
    if (val(record.feePaid) && payload.feePaidCents === undefined) payload.feePaidCents = val(record.feePaid).amountCents;
    if (!payload.periodLabel && val(record.period)) payload.periodLabel = String(val(record.period));
    payload.notes = [payload.notes, `${type.replace(/_/g, " ")} evidence: ${fileName(extraction.fileKey)}${dayIso(record.agmDate) ? ` (AGM ${dayIso(record.agmDate)})` : ""}${(record.directorsListed ?? []).length ? `; ${record.directorsListed.length} directors listed` : ""}.`].filter(Boolean).join("\n");
    filings.set(key, payload);
  }
  for (const payload of filings.values()) push(bundle, "filings", payload, payload.sourceExternalIds);

  // 8. Correspondence: evidence only (decisions/commitments as restricted source evidence).
  for (const extraction of byClass(["correspondence"])) {
    const record: any = extraction.record;
    const date = dayIso(record.date);
    for (const [index, decision] of (record.decisionsOrCommitments ?? []).entries()) {
      push(bundle, "sourceEvidence", { externalId: extraction.fileKey, sourceTitle: String(val(record.subject) ?? fileName(extraction.fileKey)).slice(0, 200), ...(date ? { sourceDate: date } : {}), evidenceKind: "correspondence_decision", sensitivity: "restricted", summary: `${val(record.from) ? `${val(record.from)}: ` : ""}${String(val(decision)).slice(0, 300)}`, sourceExternalIds: [extraction.fileKey], confidence: "Review", notes: `Decision/commitment ${index + 1} stated in correspondence; evidence for review, not a recorded decision.` }, [extraction.fileKey]);
    }
  }

  // 9. Invoices and receipts → transaction candidates (restricted).
  for (const extraction of byClass(["invoice"])) {
    const record: any = extraction.record;
    const date = dayIso(record.date);
    const amount = val(record.amount)?.amountCents;
    if (!date || amount === undefined) continue;
    const direction = String(val(record.direction) ?? "unknown");
    push(bundle, "transactionCandidates", {
      transactionDate: date,
      description: `${val(record.vendor) ?? "Unknown vendor"}${val(record.invoiceNumber) ? ` — invoice ${val(record.invoiceNumber)}` : ""}`.slice(0, 200),
      amountCents: amount,
      ...(direction === "payable" || direction === "receipt" ? { debitCents: amount, debitCredit: "debit" } : direction === "receivable" ? { creditCents: amount, debitCredit: "credit" } : {}),
      counterparty: String(direction === "receivable" ? val(record.billTo) ?? "Needs review" : val(record.vendor) ?? "Needs review").slice(0, 200),
      ...(val(record.invoiceNumber) ? { comment: `Invoice ${val(record.invoiceNumber)}` } : {}),
      sensitivity: "restricted",
      status: "NeedsReview",
      sourceExternalIds: [extraction.fileKey],
      confidence: "Review",
      notes: `${direction} document${val(record.gst) ? `; GST ${val(record.gst).text}` : ""}${dayIso(record.dueDate) ? `; due ${dayIso(record.dueDate)}` : ""}.`,
    }, [extraction.fileKey]);
  }
  return bundle;
}

/** Native table each class's representation gaps affect. */
export const AFFECTED_TABLE: Record<string, string> = {
  meetingMinutes: "meetings", agenda: "meetings", meetingPackage: "meetings", agmMaterial: "meetings", policy: "policies", bylaws: "bylawRuleSets",
  directorConsent: "directors", proxy: "proxies", roster: "directors", financialStatement: "financialStatementImports", budget: "budgetSnapshots",
  insurance: "insurancePolicies", agreement: "agreements", grant: "grants", registryFiling: "filings", correspondence: "sourceEvidence", invoice: "transactionCandidates",
};

/** "2014_15" / "2014-2015" → "2014-15"; a bare year → that year. */
export function fiscalYearLabel(...texts: Array<string | undefined>): string | undefined {
  for (const text of texts) {
    const split = /(?<!\d)((?:19|20)\d{2})\s*[_\-–/]\s*((?:19|20)?\d{2})(?!\d)/.exec(text ?? "");
    if (split) {
      const second = split[2].slice(-2);
      if (Number(second) === (Number(split[1]) + 1) % 100) return `${split[1]}-${second}`;
    }
  }
  for (const text of texts) {
    const year = /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(text ?? "");
    if (year) return year[1];
  }
  return undefined;
}
