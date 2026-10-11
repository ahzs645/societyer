/** Annual-business preparation clauses resolved from the actual governing Act. */
import type { Actor } from './nlg';
import { legalGovernanceProfile, type GovernanceOrganization } from './legalGovernanceProfiles';
import { parseComplianceDate } from './corporationSettings';
import { legalSourceById } from './legalSources';

export interface AnnualResolutionInput {
  organization?: GovernanceOrganization;
  /** Separate requests: financial preparation never implicitly waives the auditor. */
  waivePrepFinancials?: boolean | null;
  waiveAuditor?: boolean | null;
  auditorName?: string | null;
  fiscalYearEnd?: string | null;
  financialPeriodEnd?: string | null;
  annualBusinessYear?: number;
  annualReferenceDate?: string | null;
  directors?: Actor[];
}
export interface AnnualResolutionContext {
  profileId: string;
  profileName: string;
  profileReviewedOn?: string;
  supported: boolean;
  preparationOnly: true;
  waivePrepFinancials: boolean;
  waiveAuditor: boolean;
  hasFiscalYearEnd: boolean;
  fiscalYearEnd: string;
  hasDirectors: boolean;
  directorSlate: string;
  financialClause: string;
  fiscalCalendarClause: string;
  auditorClause: string;
  directorClause: string;
  annualBusinessClause: string;
  filingClause: string;
  reviewNotes: Array<{ message: string }>;
  sourceIds: readonly string[];
  sourceText: string;
}
export function buildAnnualResolutionContext(input: AnnualResolutionInput): AnnualResolutionContext {
  const profile = legalGovernanceProfile(input.organization);
  const supported = Boolean(profile?.kind === 'corporation');
  const id = supported ? profile!.id : 'unreviewed';
  const privateStatus = input.organization?.distributing === false;
  const subtype = String(input.organization?.legalSubtype ?? '').trim().toLowerCase();
  const specialized = ['community_contribution_company', 'ccc', 'benefit_company', 'unlimited_liability_company', 'ulc'].includes(subtype);
  const bc = id === 'bc_company', federal = id === 'federal_cbca', ontario = id === 'ontario_obca';
  const waiverEligible = supported && privateStatus && !specialized;
  const waiveFinancials = Boolean(input.waivePrepFinancials && bc && waiverEligible);
  const waiveAuditor = Boolean(input.waiveAuditor && waiverEligible);
  const names = (input.directors ?? []).map(d => String(d.name ?? '').trim()).filter(Boolean);
  const fiscalYearEnd = typeof input.fiscalYearEnd === 'string' ? input.fiscalYearEnd.trim() : '';
  const period = parseComplianceDate(input.financialPeriodEnd) ? input.financialPeriodEnd! : '[insert the actual financial year-end]';
  const year = Number.isInteger(input.annualBusinessYear) && input.annualBusinessYear! >= 1 && input.annualBusinessYear! <= 9999 ? String(input.annualBusinessYear) : '[insert the annual-business year]';
  const reference = parseComplianceDate(input.annualReferenceDate) ? input.annualReferenceDate! : '[select the lawful annual reference date]';
  const auditor = String(input.auditorName ?? '').trim();
  const notes: string[] = [
    'This is an editable preparation draft. Complete the period, financial, electorate and execution checks before making a separate execution copy.',
    'Reconcile all shareholder classes and signing authority with the securities register. Directors, officers, workspace users and a general signing roster are not proof of shareholder consent.',
    'Identify every required annual matter and any class vote, governing-document requirement or director/auditor written statement that prevents the intended written route.',
  ];
  if (!supported) notes.push('No reviewed corporate Act profile was resolved. Do not use a society or unknown-Act record as authority for this corporate packet.');
  if (!privateStatus) notes.push('Private/non-offering/non-distributing status has not been established; this draft does not activate private audit or financial-waiver clauses.');
  if (specialized) notes.push('A specialized company subtype requires its own reporting, financial and governance review.');
  if (!parseComplianceDate(input.financialPeriodEnd)) notes.push('Supply the actual completed financial period, not only a recurring month/day preference.');
  if (input.waivePrepFinancials && !waiveFinancials) notes.push('The requested financial-statement waiver is not available through this reviewed private BC route; financial statements remain required unless a separately applicable lawful exemption is established.');
  if (input.waiveAuditor && !waiveAuditor) notes.push('The requested auditor waiver requires verified eligibility and consent of every shareholder, including non-voting holders.');
  if (waiveFinancials || waiveAuditor) notes.push('Verify independent securities, regulated-sector, contractual and funding audit/reporting duties; the corporate-law waiver does not remove them.');
  if (bc && !parseComplianceDate(input.annualReferenceDate)) notes.push('A BC written annual alternative must select the appropriate annual reference date under s. 182(3).');
  if (!waiveAuditor && !auditor) notes.push('Identify an eligible auditor and the shareholder appointment/continuation route. Annual appointment must not be generically delegated to directors.');
  if (!names.length) notes.push('Supply the proposed director slate, eligibility/consents, class rights and terms. Existing contacts do not prove an election.');

  const financialClause = waiveFinancials
    ? `Proposed unanimous shareholder resolution: waive production and publication of the financial statements for the financial year ended ${period} under BC BCA s. 200. Every shareholder, including non-voting holders, must consent; the waiver applies only to those statements.`
    : `Prepare the financial statements for the financial year ended ${period}, establish the required board approval and signatures, attach any required auditor report, and complete shareholder delivery. The proposed shareholder annual-business resolution records receipt of the identified statements; it does not substitute for board approval.`;
  const auditAuthority = bc ? 'BC BCA s. 203' : federal ? 'CBCA s. 163' : ontario ? 'OBCA s. 148' : 'the reviewed governing Act';
  const auditAppointment = bc ? 'BC BCA s. 204' : federal ? 'CBCA s. 162' : ontario ? 'OBCA s. 149' : 'the reviewed governing Act';
  const auditorClause = waiveAuditor
    ? `Proposed unanimous shareholder resolution: dispense with appointment of an auditor under ${auditAuthority}, with consent from every shareholder including non-voting holders. ${federal ? 'The resolution remains effective until the next annual meeting.' : `Identify the single financial year covered: ${period}.`} The financial-statement obligation is separate.`
    : `Proposed shareholder appointment under ${auditAppointment}: appoint ${auditor || '[insert the eligible auditor’s name]'} to hold office until the close of the next annual meeting, subject to the applicable incumbent/vacancy rules. Record the permitted remuneration decision separately.`;
  const annualBusinessClause = bc
    ? `Prepare the unanimous consent of all AGM voting shareholders to all required annual business for ${year} under BC BCA s. 182(2)(b). Select ${reference} as the annual reference date under s. 182(3). Completion of this draft does not itself establish execution, an effective waiver or a held meeting.`
    : federal
      ? `Prepare a resolution addressing every required annual matter for ${year}, signed by all shareholders entitled to vote, under CBCA s. 142. Check the director/auditor written-statement exceptions and required financial delivery. The annual meeting requirement is satisfied only when the statutory conditions and complete execution are evidenced.`
      : ontario
        ? `This draft uses the unanimous written annual-business route under OBCA s. 104(1)(a)–(b) for ${year}. A non-offering corporation’s ordinary-only majority route under s. 104(1)(c) requires a separate eligible-share calculation, any higher articles/USA threshold and ten-business-day notices. It cannot supply an all-shareholder auditor waiver.`
        : 'Select a reviewed corporate governing Act and its annual-business process before preparing operative resolutions.';
  const sourceText = bc ? 'BC BCA ss. 182, 185, 198–200, 203–204 and 51.' : federal ? 'CBCA ss. 133, 142, 155, 158–159, 162–163 and 263.' : ontario ? 'OBCA ss. 94, 104, 148–149, 154, 159; Ontario CIA s. 3.1 and O. Reg. 400/21.' : 'Governing Act unresolved.';
  return {
    profileId: id, profileName: supported ? profile!.name : 'Corporate Act requires review', profileReviewedOn: supported ? profile!.reviewedOn : undefined, supported, preparationOnly: true,
    waivePrepFinancials: waiveFinancials, waiveAuditor, hasFiscalYearEnd: fiscalYearEnd.length > 0, fiscalYearEnd,
    hasDirectors: names.length > 0, directorSlate: names.join('; '), financialClause,
    fiscalCalendarClause: `Recorded fiscal-year-end preference: ${fiscalYearEnd || '[insert fiscal calendar]'}. Any change needs the appropriate corporate and tax authorization; this shareholder draft does not automatically change the taxation year.`,
    auditorClause,
    directorClause: `Proposed director slate: ${names.length ? names.join('; ') : '[insert nominees]'}. Record the actual election/re-election, each term, eligibility and consent, with any articles or separate-class requirements. Do not treat the current roster as proof of renewed appointment.`,
    annualBusinessClause,
    filingClause: supported ? `${profile!.annualReturn.label}: ${profile!.annualReturn.anchor === 'fiscal_year_end' ? 'normally within six months after the actual taxation year-end' : profile!.annualReturn.months ? `within ${profile!.annualReturn.months} calendar months after the recognition anniversary` : `within ${profile!.annualReturn.days} days after the recognition anniversary`}. Retain the covered period and accepted filing receipt separately; signing annual resolutions does not file the return.` : 'Confirm the registry filing obligation after resolving the governing Act.',
    reviewNotes: notes.map(message => ({ message })),
    sourceIds: supported ? [...new Set([...profile!.annualMeeting.sourceIds, ...profile!.resolutions.sourceIds, ...profile!.annualReturn.sourceIds, ...profile!.directors.sourceIds, ...profile!.directors.consentSourceIds, ...['AUDITOR-WAIVER', 'AUDITOR-APPOINTMENT', 'ANNUAL-FINANCIALS'].map(topic => `${bc ? 'BC-BCA' : federal ? 'CBCA' : 'OBCA'}-${topic}`)])] : [],
    sourceText,
  };
}

/** Persist the resolved clauses and actual source editions beside the immutable template. */
export function annualResolutionDataWithAuthority(provenanceData: string, annual: AnnualResolutionContext, generatedAtISO: string): string {
  const data = JSON.parse(provenanceData);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.templateProvenance) throw new Error('Annual preparation requires the packet provenance.');
  const sourceSnapshots = annual.sourceIds.map(id => {
    const source = legalSourceById.get(id);
    if (!source) throw new Error(`Annual preparation source is missing: ${id}`);
    return { ...source };
  });
  return JSON.stringify({
    ...data,
    templateProvenance: {
      ...data.templateProvenance,
      templateVersion: 'societyer-annual-preparation-2026-10-11',
      legalAuthority: {
        profileId: annual.profileId,
        profileReviewedOn: annual.profileReviewedOn,
        generatedAtISO,
        reviewState: 'requires_entity_specific_review',
        sourceSnapshots,
        resolvedAnnualContext: annual,
      },
    },
  });
}
