/**
 * The three fictional corporation demo stories (see corporations.ts for how a
 * story becomes rows). Every person, company, address and number is invented.
 * Dates here are history and do not move; the yearly cycle (annual
 * resolutions, filings, dividends, register reviews) is generated up to the
 * demo's "today" from the rules in each story.
 */
import type { CorporationDemoKey } from "./corporationIdentities";

export type DemoUserRole = "Owner" | "Admin" | "Director" | "Viewer";

export type DemoPersonSpec = {
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  dateOfBirth: string;
  gender: "F" | "M" | "X";
  pronouns: string;
  occupation: string;
  canadianStatus: "citizen" | "permanent_resident" | "neither";
  citizenshipCountries: string[];
  taxResidenceCountries: string[];
  /** "Resident Canadian" as the CBCA defines it (citizen or permanent resident ordinarily resident in Canada). */
  residentCanadian: boolean;
  bcResident: boolean;
  user?: DemoUserRole;
};

/** A shareholder that is not an individual: the people behind it are looked through for the ISC/transparency register. */
export type DemoEntitySpec = {
  key: string;
  name: string;
  nonNaturalPersonType: "trust" | "corporation";
  jurisdiction: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  /** Person keys who control it, and how (shown on the controller entries). */
  controllers: Array<{ person: string; natureOfControl: string }>;
  /** Who signs consents for it. */
  signatory: string;
};

export type DemoTermSpec = { person: string; start: string; end?: string; endNote?: string };
export type DemoOfficerSpec = DemoTermSpec & { title: string; additionalTitles?: string[] };

export type DemoClassSpec = {
  key: string;
  className: string;
  idPrefix: string;
  singular: string;
  plural: string;
  votesPerShare: number;
  votingRights: string;
  dividendEntitlement: "discretionary_by_class" | "fixed_rate" | "cumulative_fixed" | "participating";
  dividendRateBps?: number;
  redemption?: { byCompany: boolean; byHolder: boolean; priceCents?: number; includesDeclaredUnpaid?: boolean; minNoticeDays?: number };
  liquidationRank: number;
  maxAuthorized?: number;
  articlesPart?: string;
  conditionsToTransfer: string;
  otherProvisions?: string;
  startDate: string;
};

type LedgerBase = { key: string; date: string; cls: string; quantity: number; resolution: string; sequence?: number };
export type DemoLedgerEventSpec =
  | (LedgerBase & { kind: "issuance"; to: string; totalCents: number; consideration: "cash" | "property" | "past_services"; considerationDescription: string })
  | (LedgerBase & { kind: "transfer"; from: string; to: string; priceToVendorCents: number })
  | (LedgerBase & { kind: "redemption"; from: string; totalCents: number; noticeDate: string; solvencyDate: string; solvencyBasis: string });

export type DemoResolutionSpec = {
  key: string;
  title: string;
  body: "directors" | "shareholders";
  /** Shareholder decisions: who is asked. "all" includes non-voting holders (auditor waivers, unanimous agreements). */
  electorate?: "voting" | "all";
  kind: "Ordinary" | "Special";
  date: string;
  text: string;
  notes?: string;
  documentKey?: string;
};

export type DemoDocumentSpec = {
  key: string;
  title: string;
  category: string;
  date: string;
  fileName: string;
  tags: string[];
  content: string;
  retentionYears?: number;
  /** An uploaded file version (the certificate establishing formation). */
  uploaded?: boolean;
};

export type DemoAgreementSpec = {
  key: string;
  title: string;
  kind: string;
  status: "active" | "expired";
  summary: string;
  parties: string[];
  signedDate: string;
  effectiveDate: string;
  endDate?: string;
  renewalNoticeDays?: number;
  terminationNoticeDays?: number;
  valueCents?: number;
  paymentTerms?: string;
  governingLaw: string;
  confidential: boolean;
  documentKey?: string;
  notes?: string;
};

export type DemoDividendSpec = {
  key: string;
  cls: string;
  firstYear: number;
  /** Month-day of the declaration each year (MM-DD). */
  declaredOn: string;
  paymentDays: number;
  perShare: (year: number) => string;
};

/** A monthly recurring bank line (positive = money in). */
export type DemoCashFlowSpec = {
  key: string;
  description: string;
  counterparty: string;
  category: string;
  day: number;
  minDollars: number;
  maxDollars: number;
  direction: "in" | "out";
  /** Months of the year (1–12) it occurs in; default every month. */
  months?: number[];
  method: string;
};

export type DemoTaskSpec = {
  key: string;
  title: string;
  description: string;
  /** Days from the demo's today (negative = in the past). */
  dueInDays: number;
  status: "Todo" | "InProgress" | "Done";
  priority: "Low" | "Medium" | "High";
  assignee: string;
  tags: string[];
};

export type CorporationStory = {
  key: CorporationDemoKey;
  /** Name at incorporation when the company later changed it (numbered companies). */
  formerName?: { name: string; endDate: string; resolution: string };
  legislationLabel: string;
  registryLabel: string;
  registeredOffice: { street: string; city: string; province: string; postalCode: string };
  mailingAddress: string;
  recordsOfficeNote: string;
  officialEmail: string;
  shortName: string;
  business: string;
  businessNumber: string;
  naicsCode: string;
  people: DemoPersonSpec[];
  entities: DemoEntitySpec[];
  directors: DemoTermSpec[];
  officers: DemoOfficerSpec[];
  classes: DemoClassSpec[];
  ledger: DemoLedgerEventSpec[];
  resolutions: DemoResolutionSpec[];
  documents: DemoDocumentSpec[];
  agreements: DemoAgreementSpec[];
  dividends: DemoDividendSpec[];
  /** Annual shareholder business, in writing instead of a meeting. */
  annualShareholders: { firstYear: number; monthDay: string; auditorWaiver: string; financialWaiver?: boolean };
  /** Directors approve each year's financial statements this many days after the year end. */
  annualDirectorsDaysAfterYearEnd: number;
  /** Ownership register (BC transparency register, CBCA/OBCA ISC register). */
  ownershipRegister: {
    label: string;
    startedOn: string;
    startNote: string;
    reviewMonthDay: string;
    firstReviewYear: number;
    /** A change the company learned about recently and has not yet recorded. */
    pendingChange?: { person: string; awareDaysAgo: number; narrative: string };
    updateDays: number;
  };
  serviceProviders: Array<{ key: string; fn: "lawyer" | "accountant" | "banker" | "registered_agent"; firmName: string; contactName: string; firmLocation: string; appointedOn: string }>;
  insurance: { key: string; kind: string; insurer: string; broker: string; policyNumber: string; renewalMonthDay: string; coverageCents: number; premiumCents: number; summary: string };
  finance: {
    bankName: string;
    operatingLast4: string;
    openingCents: number;
    savingsOpeningCents: number;
    flows: DemoCashFlowSpec[];
    budget: Array<{ category: string; plannedCents: number }>;
    /** Revenue, expenses and closing equity per completed fiscal year (cents). */
    statements: (fiscalYear: number) => { revenueCents: number; expensesCents: number; netAssetsCents: number };
  };
  tasks: DemoTaskSpec[];
  boardMeeting: { location: string; agenda: string[]; decisions: string[] };
};

// ---------------------------------------------------------------------------
// BC: Cedar Demo Holdings Ltd.
// ---------------------------------------------------------------------------

const CEDAR: CorporationStory = {
  key: "bc_company",
  formerName: { name: "1234567 B.C. Ltd.", endDate: "2019-05-14", resolution: "name_change" },
  legislationLabel: "Business Corporations Act (British Columbia)",
  registryLabel: "BC Registries",
  registeredOffice: { street: "Suite 1200, 1055 Example Street", city: "Vancouver", province: "BC", postalCode: "V6E 0A1" },
  mailingAddress: "PO Box 4100 Stn Main, Vancouver, BC V6B 0A2",
  recordsOfficeNote: "Records office and minute book kept at Alder Finch Law Corporation, the registered office.",
  officialEmail: "records@cedar-demo.example",
  shortName: "the Company",
  business: "Holds and leases a light-industrial strata unit in Burnaby and provides management services to a related family business.",
  businessNumber: "701234567RC0001",
  naicsCode: "531120",
  people: [
    { key: "maya", firstName: "Maya", lastName: "Thornbury", email: "maya@cedar-demo.example", phone: "+1 604 555 0141", street: "2210 Example Crescent", city: "Vancouver", province: "BC", postalCode: "V6K 0B3", country: "CA", dateOfBirth: "1974-08-19", gender: "F", pronouns: "she/her", occupation: "Company director", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: true, user: "Director" },
    { key: "daniel", firstName: "Daniel", lastName: "Okafor", email: "daniel@cedar-demo.example", phone: "+1 604 555 0177", street: "418 Sample Road", city: "North Vancouver", province: "BC", postalCode: "V7L 0C2", country: "CA", dateOfBirth: "1980-03-07", gender: "M", pronouns: "he/him", occupation: "Operations manager", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: true, user: "Owner" },
    { key: "priya", firstName: "Priya", lastName: "Lindqvist", email: "priya@cedar-demo.example", phone: "+1 250 555 0123", street: "77 Placeholder Lane", city: "Victoria", province: "BC", postalCode: "V8V 0D4", country: "CA", dateOfBirth: "1986-11-23", gender: "F", pronouns: "she/her", occupation: "Chartered professional accountant", canadianStatus: "permanent_resident", citizenshipCountries: ["SE"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: true, user: "Admin" },
    { key: "graham", firstName: "Graham", lastName: "Thornbury", email: "graham.thornbury@example.ca", phone: "+1 604 555 0188", street: "2210 Example Crescent", city: "Vancouver", province: "BC", postalCode: "V6K 0B3", country: "CA", dateOfBirth: "1971-02-14", gender: "M", pronouns: "he/him", occupation: "Architect", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: true },
    { key: "hollis", firstName: "Hollis", lastName: "Abernathy", email: "hollis@abernathy.example", phone: "+1 250 555 0109", street: "9 Fictional Way", city: "Kelowna", province: "BC", postalCode: "V1Y 0E5", country: "CA", dateOfBirth: "1962-05-30", gender: "X", pronouns: "they/them", occupation: "Retired controller", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: true },
  ],
  entities: [
    { key: "trust", name: "Thornbury Family Trust", nonNaturalPersonType: "trust", jurisdiction: "CA-BC", street: "2210 Example Crescent", city: "Vancouver", province: "BC", postalCode: "V6K 0B3", country: "CA", signatory: "Maya Thornbury and Graham Thornbury, trustees",
      controllers: [
        { person: "maya", natureOfControl: "Trustee of the Thornbury Family Trust; the trustees jointly direct the voting and disposition of its Class B Non-Voting Shares." },
        { person: "graham", natureOfControl: "Trustee of the Thornbury Family Trust; the trustees jointly direct the voting and disposition of its Class B Non-Voting Shares." },
      ] },
  ],
  directors: [
    { person: "maya", start: "2019-02-01" },
    { person: "hollis", start: "2019-02-01", end: "2022-09-30", endNote: "Resigned in writing effective September 30, 2022." },
    { person: "daniel", start: "2019-05-14" },
    { person: "priya", start: "2022-10-01" },
  ],
  officers: [
    { person: "maya", title: "president", start: "2019-02-01" },
    { person: "hollis", title: "secretary", start: "2019-02-01", end: "2022-09-30" },
    { person: "daniel", title: "secretary", start: "2022-10-01" },
    { person: "priya", title: "chief_financial_officer", start: "2022-10-01" },
  ],
  classes: [
    { key: "a", className: "Class A Common Voting Shares", idPrefix: "A", singular: "Class A Common Voting Share", plural: "Class A Common Voting Shares", votesPerShare: 1, votingRights: "One vote for each share at all meetings of shareholders.", dividendEntitlement: "discretionary_by_class", liquidationRank: 2, conditionsToTransfer: "Directors' consent required for every transfer (Table 1, Article 20.2).", startDate: "2019-02-01" },
    { key: "b", className: "Class B Non-Voting Shares", idPrefix: "B", singular: "Class B Non-Voting Share", plural: "Class B Non-Voting Shares", votesPerShare: 0, votingRights: "No right to vote at meetings of shareholders, except on a separate class vote the Act requires.", dividendEntitlement: "discretionary_by_class", liquidationRank: 2, articlesPart: "Part 24", conditionsToTransfer: "Directors' consent required for every transfer (Table 1, Article 20.2).", otherProvisions: "Dividends may be declared on this class to the exclusion of any other class.", startDate: "2019-02-01" },
    { key: "c", className: "Class C Preferred Shares", idPrefix: "C", singular: "Class C Preferred Share", plural: "Class C Preferred Shares", votesPerShare: 0, votingRights: "Non-voting.", dividendEntitlement: "fixed_rate", dividendRateBps: 500, redemption: { byCompany: true, byHolder: true, priceCents: 100, includesDeclaredUnpaid: true, minNoticeDays: 21 }, liquidationRank: 1, maxAuthorized: 1_000_000, articlesPart: "Part 25", conditionsToTransfer: "Directors' consent required for every transfer (Table 1, Article 20.2).", otherProvisions: "Non-cumulative preferential dividend of 5% of the redemption amount each financial year, when declared. Redeemable by the Company and retractable by the holder at $1.00 per share plus declared and unpaid dividends on 21 days' notice.", startDate: "2021-03-15" },
  ],
  ledger: [
    { key: "iss_a_maya", kind: "issuance", date: "2019-02-01", cls: "a", to: "maya", quantity: 100, totalCents: 10_000, consideration: "cash", considerationDescription: "$100.00 paid in cash on subscription.", resolution: "org_directors", sequence: 1 },
    { key: "iss_a_daniel", kind: "issuance", date: "2019-02-01", cls: "a", to: "daniel", quantity: 100, totalCents: 10_000, consideration: "cash", considerationDescription: "$100.00 paid in cash on subscription.", resolution: "org_directors", sequence: 2 },
    { key: "iss_b_trust", kind: "issuance", date: "2019-05-20", cls: "b", to: "trust", quantity: 100_000, totalCents: 100_000, consideration: "cash", considerationDescription: "$1,000.00 paid in cash by the trustees.", resolution: "allot_b" },
    { key: "iss_c_maya", kind: "issuance", date: "2021-03-15", cls: "c", to: "maya", quantity: 250_000, totalCents: 25_000_000, consideration: "property", considerationDescription: "Transfer of strata lot 14, 8800 Example Way, Burnaby, BC under the property transfer agreement of the same date, valued at $250,000.", resolution: "allot_c" },
    { key: "xfer_a_daniel_priya", kind: "transfer", date: "2022-09-30", cls: "a", from: "daniel", to: "priya", quantity: 20, priceToVendorCents: 100_000, resolution: "consent_transfer" },
    { key: "redeem_c_maya", kind: "redemption", date: "2024-12-16", cls: "c", from: "maya", quantity: 50_000, totalCents: 5_000_000, noticeDate: "2024-11-15", solvencyDate: "2024-12-13", solvencyBasis: "Directors reviewed the management accounts to November 30, 2024: cash of $412,000 against liabilities of $38,000. The Company can pay its debts as they become due after the $50,000 redemption payment (BCA s. 79).", resolution: "redeem_c" },
  ],
  resolutions: [
    { key: "org_directors", title: "Organizational resolutions of the first directors", body: "directors", kind: "Ordinary", date: "2019-02-01", documentKey: "incorporation_agreement",
      text: "BE IT RESOLVED THAT:\n1. 100 Class A Common Voting Shares are allotted and issued to each of Maya Thornbury and Daniel Okafor at $1.00 per share, the directors confirming receipt of the full consideration.\n2. Maya Thornbury is appointed President and Hollis Abernathy is appointed Secretary.\n3. The registered and records offices are fixed at Suite 1200, 1055 Example Street, Vancouver, BC.\n4. Harbourline Credit Union is appointed the Company's banker, with any two directors as signing officers." },
    { key: "name_change", title: "Change of name to Cedar Demo Holdings Ltd.", body: "directors", kind: "Ordinary", date: "2019-05-14",
      text: "BE IT RESOLVED THAT the Notice of Articles be altered to change the name of the Company from \"1234567 B.C. Ltd.\" to \"Cedar Demo Holdings Ltd.\", as permitted by Table 1, Article 9.2, and that any director file the Notice of Alteration with BC Registries.\nFURTHER RESOLVED THAT Daniel Okafor is appointed a director, his written consent to act being received." },
    { key: "allot_b", title: "Allotment of Class B Non-Voting Shares to the Thornbury Family Trust", body: "directors", kind: "Ordinary", date: "2019-05-20",
      text: "BE IT RESOLVED THAT 100,000 Class B Non-Voting Shares are allotted and issued to Maya Thornbury and Graham Thornbury, as trustees of the Thornbury Family Trust, at $0.01 per share. The directors confirm the shares are fully paid (BCA s. 64(2)) and certificate B-1 is issued." },
    { key: "allot_c", title: "Issue of Class C Preferred Shares for the Burnaby property", body: "directors", kind: "Ordinary", date: "2021-03-15", documentKey: "property_agreement",
      text: "BE IT RESOLVED THAT, in consideration of the transfer to the Company of strata lot 14, 8800 Example Way, Burnaby, BC, which the directors determine has a value of $250,000, 250,000 Class C Preferred Shares are allotted and issued to Maya Thornbury as fully paid (BCA ss. 63, 64(2)), and certificate C-1 is issued." },
    { key: "consent_transfer", title: "Consent to transfer of 20 Class A Common Voting Shares", body: "directors", kind: "Ordinary", date: "2022-09-28",
      text: "BE IT RESOLVED THAT the directors consent, as Table 1, Article 20.2 requires, to the transfer of 20 Class A Common Voting Shares from Daniel Okafor to Priya Lindqvist, that certificate A-2 be cancelled, and that certificate A-3 for 20 shares and balance certificate A-4 for 80 shares be issued." },
    { key: "board_change_2022", title: "Resignation of Hollis Abernathy and appointment of Priya Lindqvist", body: "directors", kind: "Ordinary", date: "2022-09-30",
      text: "BE IT RESOLVED THAT the resignation of Hollis Abernathy as a director and Secretary is accepted effective September 30, 2022; Priya Lindqvist, having consented in writing, is appointed a director to fill the casual vacancy effective October 1, 2022; Daniel Okafor is appointed Secretary and Priya Lindqvist Chief Financial Officer. Any director will file the Notice of Change of Directors within 15 days." },
    { key: "redeem_c", title: "Redemption of 50,000 Class C Preferred Shares", body: "directors", kind: "Ordinary", date: "2024-12-13",
      text: "BE IT RESOLVED THAT, the directors having determined there are no reasonable grounds for believing the Company is insolvent or that the payment would make it insolvent (BCA s. 79), the Company redeem 50,000 Class C Preferred Shares held by Maya Thornbury on December 16, 2024 at $1.00 per share under Part 25 of the Articles, notice having been given on November 15, 2024; certificate C-1 is cancelled and balance certificate C-2 for 200,000 shares is issued." },
  ],
  documents: [
    { key: "certificate", title: "Certificate of Incorporation (BC1234567)", category: "certificate", date: "2019-02-01", fileName: "certificate-of-incorporation-BC1234567.pdf", tags: ["1___incorporation_documents", "certificate"], uploaded: true,
      content: "CERTIFICATE OF INCORPORATION\nBUSINESS CORPORATIONS ACT\nI hereby certify that 1234567 B.C. LTD. was incorporated under the Business Corporations Act on February 1, 2019.\nIncorporation Number: BC1234567\n(Fictional demo record.)" },
    { key: "incorporation_agreement", title: "Incorporation agreement and Articles (Table 1 with Parts 24–25)", category: "articles", date: "2019-02-01", fileName: "articles-cedar-demo.pdf", tags: ["1___incorporation_documents", "articles"],
      content: "Articles of 1234567 B.C. Ltd. adopting Table 1 of the Business Corporations Regulation by reference, supplemented by Part 24 (Class B Non-Voting Shares) and Part 25 (Class C Preferred Shares). (Fictional demo record.)" },
    { key: "notice_of_articles", title: "Notice of Articles (current)", category: "notice_of_articles", date: "2021-03-15", fileName: "notice-of-articles.pdf", tags: ["1___incorporation_documents"],
      content: "Notice of Articles of Cedar Demo Holdings Ltd. listing the registered and records offices, the directors and the authorized share structure: unlimited Class A Common Voting Shares, unlimited Class B Non-Voting Shares and 1,000,000 Class C Preferred Shares with special rights or restrictions. (Fictional demo record.)" },
    { key: "shareholders_agreement", title: "Shareholders' agreement (2019)", category: "shareholder_agreement", date: "2019-05-20", fileName: "shareholders-agreement-2019.pdf", tags: ["12___shareholder_agreements"],
      content: "Agreement among Maya Thornbury, Daniel Okafor and the trustees of the Thornbury Family Trust: rights of first refusal, shotgun buy-sell and board nomination rights. (Fictional demo record.)" },
    { key: "property_agreement", title: "Property transfer agreement — strata lot 14", category: "share_transfer", date: "2021-03-15", fileName: "property-transfer-agreement.pdf", tags: ["13___material_agreements"],
      content: "Agreement for the transfer of strata lot 14, 8800 Example Way, Burnaby, BC by Maya Thornbury to the Company in exchange for 250,000 Class C Preferred Shares. (Fictional demo record.)" },
    { key: "lease", title: "Industrial lease — Unit 14, 8800 Example Way", category: "lease", date: "2022-01-04", fileName: "lease-unit-14.pdf", tags: ["13___material_agreements"],
      content: "Five-year lease of Unit 14 to Fraserline Fabrication Inc. from April 1, 2022 to March 31, 2027, base rent $6,250 a month plus operating costs. (Fictional demo record.)" },
    { key: "transparency_register", title: "Transparency register (restricted)", category: "transparency_register", date: "2020-10-01", fileName: "transparency-register.pdf", tags: ["transparency_register"], retentionYears: 7,
      content: "Transparency register opened October 1, 2020 under Part 4.1 of the Business Corporations Act. Restricted: directors and inspecting officials only (s. 119.61). (Fictional demo record.)" },
    { key: "securities_register", title: "Central securities register", category: "securities_register", date: "2024-12-16", fileName: "central-securities-register.pdf", tags: ["9___transfer_register"],
      content: "Central securities register by class and holder with certificate numbers, kept at the records office. (Fictional demo record.)" },
  ],
  agreements: [
    { key: "shareholders", title: "Shareholders' agreement", kind: "other", status: "active", summary: "Rights of first refusal, a shotgun buy-sell and board nomination rights among the three shareholders.", parties: ["Maya Thornbury", "Daniel Okafor", "Thornbury Family Trust"], signedDate: "2019-05-20", effectiveDate: "2019-05-20", governingLaw: "British Columbia", confidential: true, documentKey: "shareholders_agreement" },
    { key: "lease", title: "Industrial lease — Unit 14, 8800 Example Way", kind: "lease", status: "active", summary: "Five-year lease of the Burnaby unit to Fraserline Fabrication Inc.; the tenant must give 120 days' notice to renew.", parties: ["Cedar Demo Holdings Ltd.", "Fraserline Fabrication Inc."], signedDate: "2022-01-04", effectiveDate: "2022-04-01", endDate: "2027-03-31", renewalNoticeDays: 120, valueCents: 37_500_000, paymentTerms: "$6,250 a month, due on the first of each month.", governingLaw: "British Columbia", confidential: false, documentKey: "lease" },
    { key: "management", title: "Management services agreement", kind: "service", status: "active", summary: "Cedar provides bookkeeping, payroll administration and facilities management to Thornbury Cabinetry Ltd., a related company.", parties: ["Cedar Demo Holdings Ltd.", "Thornbury Cabinetry Ltd."], signedDate: "2020-01-02", effectiveDate: "2020-01-01", terminationNoticeDays: 90, valueCents: 4_800_000, paymentTerms: "$4,000 a month.", governingLaw: "British Columbia", confidential: true, notes: "Related-party agreement: Maya Thornbury disclosed her interest under BCA s. 148." },
  ],
  dividends: [
    { key: "a", cls: "a", firstYear: 2021, declaredOn: "12-10", paymentDays: 10, perShare: (year) => `${Math.min(100 + 10 * (year - 2021), 180)}.00` },
    { key: "c", cls: "c", firstYear: 2021, declaredOn: "12-10", paymentDays: 10, perShare: () => "0.05" },
  ],
  annualShareholders: { firstYear: 2020, monthDay: "06-12", financialWaiver: false, auditorWaiver: "BCA s. 203" },
  annualDirectorsDaysAfterYearEnd: 77,
  ownershipRegister: {
    label: "transparency register",
    startedOn: "2020-10-01",
    startNote: "Register opened when Part 4.1 of the Business Corporations Act came into force on October 1, 2020.",
    reviewMonthDay: "02-20",
    firstReviewYear: 2021,
    pendingChange: { person: "graham", awareDaysAgo: 12, narrative: "Graham Thornbury reported a new residential address; record it in the transparency register within 30 days (s. 119.31(1))." },
    updateDays: 30,
  },
  serviceProviders: [
    { key: "lawyer", fn: "lawyer", firmName: "Alder Finch Law Corporation", contactName: "Rosalind Kemp", firmLocation: "Vancouver, BC", appointedOn: "2019-02-01" },
    { key: "accountant", fn: "accountant", firmName: "Kestrel & Moss CPA LLP", contactName: "Theo Barrington", firmLocation: "Burnaby, BC", appointedOn: "2019-06-01" },
    { key: "banker", fn: "banker", firmName: "Harbourline Credit Union", contactName: "Business banking team", firmLocation: "Vancouver, BC", appointedOn: "2019-02-01" },
  ],
  insurance: { key: "cgl", kind: "Commercial general liability", insurer: "Northbank Mutual Insurance (demo)", broker: "Coastline Brokers (demo)", policyNumber: "CGL-CEDAR-0419", renewalMonthDay: "04-01", coverageCents: 500_000_000, premiumCents: 280_000, summary: "Commercial general liability and landlord's property coverage for the Burnaby unit." },
  finance: {
    bankName: "Harbourline Credit Union",
    operatingLast4: "4417",
    openingCents: 31_250_000,
    savingsOpeningCents: 12_000_000,
    flows: [
      { key: "rent", description: "Rent — Unit 14", counterparty: "Fraserline Fabrication Inc.", category: "Rental income", day: 1, minDollars: 6250, maxDollars: 6250, direction: "in", method: "EFT" },
      { key: "opex", description: "Operating cost recovery — Unit 14", counterparty: "Fraserline Fabrication Inc.", category: "Rental income", day: 1, minDollars: 840, maxDollars: 910, direction: "in", method: "EFT" },
      { key: "mgmt", description: "Management fee", counterparty: "Thornbury Cabinetry Ltd.", category: "Management fees", day: 5, minDollars: 4000, maxDollars: 4000, direction: "in", method: "EFT" },
      { key: "strata", description: "Strata fees — Unit 14", counterparty: "Example Way Strata Corporation", category: "Property costs", day: 3, minDollars: 610, maxDollars: 610, direction: "out", method: "Pre-authorized debit" },
      { key: "tax", description: "Property tax instalment", counterparty: "City of Burnaby (demo)", category: "Property costs", day: 2, minDollars: 4100, maxDollars: 4300, direction: "out", months: [7], method: "Bill payment" },
      { key: "bookkeeping", description: "Bookkeeping and payroll services", counterparty: "Kestrel & Moss CPA LLP", category: "Professional fees", day: 15, minDollars: 450, maxDollars: 520, direction: "out", method: "EFT" },
      { key: "legal", description: "Corporate records and annual filings", counterparty: "Alder Finch Law Corporation", category: "Professional fees", day: 20, minDollars: 380, maxDollars: 900, direction: "out", months: [3, 6, 12], method: "EFT" },
      { key: "insurance", description: "Insurance premium", counterparty: "Coastline Brokers (demo)", category: "Insurance", day: 1, minDollars: 2800, maxDollars: 2800, direction: "out", months: [4], method: "EFT" },
      { key: "fees", description: "Account fee", counterparty: "Harbourline Credit Union", category: "Bank charges", day: 28, minDollars: 18, maxDollars: 18, direction: "out", method: "Bank" },
    ],
    budget: [
      { category: "Rental income", plannedCents: 8_500_000 },
      { category: "Management fees", plannedCents: 4_800_000 },
      { category: "Property costs", plannedCents: 1_160_000 },
      { category: "Professional fees", plannedCents: 900_000 },
      { category: "Insurance", plannedCents: 280_000 },
      { category: "Bank charges", plannedCents: 22_000 },
    ],
    statements: (year) => ({ revenueCents: 13_000_000 + (year - 2020) * 350_000, expensesCents: 3_900_000 + (year - 2020) * 90_000, netAssetsCents: 36_000_000 + (year - 2020) * 2_100_000 }),
  },
  tasks: [
    { key: "transparency_update", title: "Record Graham Thornbury's new address in the transparency register", description: "He reported the change by email; the register must be updated within 30 days of becoming aware (BCA s. 119.31(1)).", dueInDays: 18, status: "Todo", priority: "High", assignee: "Daniel Okafor", tags: ["transparency-register"] },
    { key: "lease_renewal", title: "Ask the tenant whether it will renew the Unit 14 lease", description: "The lease ends March 31, 2027 and the tenant must give 120 days' notice.", dueInDays: 40, status: "InProgress", priority: "Medium", assignee: "Maya Thornbury", tags: ["lease"] },
    { key: "annual_report_prep", title: "Confirm the office and director particulars for the next annual report", description: "Check the registered office, records office and directors against BC Registries before the annual report is due.", dueInDays: 120, status: "Todo", priority: "Medium", assignee: "Daniel Okafor", tags: ["annual-report"] },
    { key: "certificates_after_redemption", title: "File cancelled certificate C-1 in the minute book", description: "Certificate C-1 was cancelled on the December 2024 redemption and balance certificate C-2 issued.", dueInDays: -300, status: "Done", priority: "Low", assignee: "Daniel Okafor", tags: ["certificates"] },
    { key: "solvency_pack", title: "Prepare solvency support for the year-end dividend", description: "Management accounts and a cash forecast for the directors' solvency confirmation (BCA s. 70(2)) before the December declaration.", dueInDays: 50, status: "Todo", priority: "Medium", assignee: "Priya Lindqvist", tags: ["dividends"] },
  ],
  boardMeeting: { location: "Alder Finch Law Corporation boardroom and video call", agenda: ["Lease renewal strategy for Unit 14", "Year-end dividend and solvency review", "Transparency register update"], decisions: ["Management to open renewal discussions with Fraserline Fabrication Inc.", "Priya Lindqvist to prepare the solvency support pack for the December dividend."] },
};

// ---------------------------------------------------------------------------
// Federal: Maple Demo Federal Inc. (CBCA)
// ---------------------------------------------------------------------------

const MAPLE: CorporationStory = {
  key: "federal_cbca",
  legislationLabel: "Canada Business Corporations Act",
  registryLabel: "Corporations Canada",
  registeredOffice: { street: "Suite 400, 220 Example Avenue", city: "Ottawa", province: "ON", postalCode: "K1P 0A9" },
  mailingAddress: "Suite 400, 220 Example Avenue, Ottawa, ON K1P 0A9",
  recordsOfficeNote: "Minute book and securities register kept at the registered office in Ottawa.",
  officialEmail: "corporate@maple-demo.example",
  shortName: "the Corporation",
  business: "Develops permit-tracking software sold to municipalities by subscription.",
  businessNumber: "702345678RC0001",
  naicsCode: "513210",
  people: [
    { key: "elodie", firstName: "Élodie", lastName: "Marchand", email: "elodie@maple-demo.example", phone: "+1 613 555 0150", street: "35 Sample Street", city: "Ottawa", province: "ON", postalCode: "K1S 0B7", country: "CA", dateOfBirth: "1983-04-11", gender: "F", pronouns: "she/her", occupation: "Chief executive officer", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false, user: "Director" },
    { key: "arjun", firstName: "Arjun", lastName: "Mehta", email: "arjun@maple-demo.example", phone: "+1 416 555 0164", street: "1200 Placeholder Avenue, Unit 9", city: "Toronto", province: "ON", postalCode: "M6H 0C4", country: "CA", dateOfBirth: "1985-09-02", gender: "M", pronouns: "he/him", occupation: "Chief technology officer", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false, user: "Viewer" },
    { key: "rafael", firstName: "Rafael", lastName: "Mendes", email: "rafael@atlantico-seed.example", phone: "+351 21 555 0100", street: "Rua Exemplo 12, 3.º", city: "Lisbon", province: "Lisboa", postalCode: "1100-000", country: "PT", dateOfBirth: "1977-12-19", gender: "M", pronouns: "he/him", occupation: "Managing partner, venture fund", canadianStatus: "neither", citizenshipCountries: ["PT"], taxResidenceCountries: ["PT"], residentCanadian: false, bcResident: false },
    { key: "siobhan", firstName: "Siobhan", lastName: "Kerr", email: "siobhan@maple-demo.example", phone: "+1 819 555 0172", street: "48 Demo Boulevard", city: "Gatineau", province: "QC", postalCode: "J8Y 0A6", country: "CA", dateOfBirth: "1981-06-27", gender: "F", pronouns: "she/her", occupation: "Chief financial officer", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false, user: "Owner" },
    { key: "tomasz", firstName: "Tomasz", lastName: "Wójcik", email: "tomasz@maple-demo.example", phone: "+1 613 555 0191", street: "6 Fictional Court", city: "Ottawa", province: "ON", postalCode: "K2P 0E1", country: "CA", dateOfBirth: "1990-01-15", gender: "M", pronouns: "he/him", occupation: "Senior software developer", canadianStatus: "permanent_resident", citizenshipCountries: ["PL"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false },
    { key: "grace", firstName: "Grace", lastName: "Holloway", email: "grace@holloway-advisory.example", phone: "+1 613 555 0115", street: "90 Example Drive", city: "Kanata", province: "ON", postalCode: "K2K 0G2", country: "CA", dateOfBirth: "1969-09-30", gender: "F", pronouns: "she/her", occupation: "Corporate advisor", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false },
  ],
  entities: [
    { key: "atlantico", name: "Atlântico Seed Partners, Lda.", nonNaturalPersonType: "corporation", jurisdiction: "PT", street: "Avenida Exemplo 200", city: "Lisbon", province: "Lisboa", postalCode: "1000-000", country: "PT", signatory: "Rafael Mendes, managing partner",
      controllers: [{ person: "rafael", natureOfControl: "Managing partner of Atlântico Seed Partners, Lda.; directs the voting and disposition of its Common and Class A Preferred Shares." }] },
  ],
  directors: [
    { person: "elodie", start: "2020-09-15" },
    { person: "arjun", start: "2020-09-15" },
    { person: "grace", start: "2020-09-15", end: "2022-05-31", endNote: "Resigned at the end of her advisory engagement." },
    { person: "rafael", start: "2021-03-01" },
    { person: "siobhan", start: "2022-06-01" },
  ],
  officers: [
    { person: "elodie", title: "chief_executive_officer", additionalTitles: ["president"], start: "2020-09-15" },
    { person: "arjun", title: "vice_president", start: "2020-09-15" },
    { person: "grace", title: "secretary", start: "2020-09-15", end: "2022-05-31" },
    { person: "siobhan", title: "chief_financial_officer", additionalTitles: ["secretary"], start: "2022-06-01" },
  ],
  classes: [
    { key: "com", className: "Common Shares", idPrefix: "C", singular: "Common Share", plural: "Common Shares", votesPerShare: 1, votingRights: "One vote for each share at all meetings of shareholders.", dividendEntitlement: "discretionary_by_class", liquidationRank: 2, conditionsToTransfer: "Restricted by the articles and the unanimous shareholder agreement: board approval and a right of first refusal.", startDate: "2020-09-15" },
    { key: "pa", className: "Class A Preferred Shares", idPrefix: "PA", singular: "Class A Preferred Share", plural: "Class A Preferred Shares", votesPerShare: 0, votingRights: "Non-voting, except as the Act requires.", dividendEntitlement: "cumulative_fixed", dividendRateBps: 600, redemption: { byCompany: true, byHolder: false, priceCents: 100, includesDeclaredUnpaid: true, minNoticeDays: 30 }, liquidationRank: 1, conditionsToTransfer: "Restricted by the articles and the unanimous shareholder agreement.", otherProvisions: "Cumulative preferential dividend of 6% a year on the $1.00 issue price. Redeemable by the Corporation at $1.00 per share plus accrued and unpaid dividends on 30 days' notice.", startDate: "2021-03-01" },
    { key: "b", className: "Class B Non-Voting Common Shares", idPrefix: "B", singular: "Class B Non-Voting Common Share", plural: "Class B Non-Voting Common Shares", votesPerShare: 0, votingRights: "Non-voting, except as the Act requires.", dividendEntitlement: "participating", liquidationRank: 2, conditionsToTransfer: "Restricted by the articles and the unanimous shareholder agreement.", otherProvisions: "Rank equally with the Common Shares on dividends and liquidation. Issued on the exercise of employee options.", startDate: "2023-04-03" },
  ],
  ledger: [
    { key: "iss_com_elodie", kind: "issuance", date: "2020-09-15", cls: "com", to: "elodie", quantity: 600_000, totalCents: 60_000, consideration: "cash", considerationDescription: "$600.00 paid in cash on subscription.", resolution: "org_directors", sequence: 1 },
    { key: "iss_com_arjun", kind: "issuance", date: "2020-09-15", cls: "com", to: "arjun", quantity: 250_000, totalCents: 25_000, consideration: "cash", considerationDescription: "$250.00 paid in cash on subscription.", resolution: "org_directors", sequence: 2 },
    { key: "iss_com_atlantico", kind: "issuance", date: "2021-03-01", cls: "com", to: "atlantico", quantity: 150_000, totalCents: 15_000_000, consideration: "cash", considerationDescription: "$150,000 paid by wire under the subscription agreement.", resolution: "seed_round", sequence: 1 },
    { key: "iss_pa_atlantico", kind: "issuance", date: "2021-03-01", cls: "pa", to: "atlantico", quantity: 500_000, totalCents: 50_000_000, consideration: "cash", considerationDescription: "$500,000 paid by wire under the subscription agreement.", resolution: "seed_round", sequence: 2 },
    { key: "iss_b_siobhan", kind: "issuance", date: "2023-04-03", cls: "b", to: "siobhan", quantity: 20_000, totalCents: 500_000, consideration: "cash", considerationDescription: "Option exercise at $0.25 per share, paid in cash.", resolution: "option_exercise", sequence: 1 },
    { key: "iss_b_tomasz", kind: "issuance", date: "2023-04-03", cls: "b", to: "tomasz", quantity: 10_000, totalCents: 250_000, consideration: "cash", considerationDescription: "Option exercise at $0.25 per share, paid in cash.", resolution: "option_exercise", sequence: 2 },
    { key: "xfer_com_elodie_arjun", kind: "transfer", date: "2024-06-28", cls: "com", from: "elodie", to: "arjun", quantity: 25_000, priceToVendorCents: 2_500_000, resolution: "consent_transfer" },
  ],
  resolutions: [
    { key: "org_directors", title: "Organizational resolutions of the first directors", body: "directors", kind: "Ordinary", date: "2020-09-15", documentKey: "articles",
      text: "BE IT RESOLVED THAT:\n1. By-law No. 1, the general by-law of the Corporation, is made and is to be submitted to the shareholders for confirmation (CBCA s. 103).\n2. 600,000 Common Shares are issued to Élodie Marchand and 250,000 Common Shares to Arjun Mehta at $0.001 per share, fully paid (CBCA s. 25).\n3. Élodie Marchand is appointed Chief Executive Officer and President, Arjun Mehta Vice-President and Grace Holloway Secretary.\n4. The register of individuals with significant control is established (CBCA s. 21.1)." },
    { key: "seed_round", title: "Seed financing: issue of Common and Class A Preferred Shares", body: "directors", kind: "Ordinary", date: "2021-02-26", documentKey: "subscription",
      text: "BE IT RESOLVED THAT, on receipt of $650,000, the Corporation issue to Atlântico Seed Partners, Lda. 150,000 Common Shares and 500,000 Class A Preferred Shares at $1.00 per share, fully paid (CBCA s. 25(3)); Rafael Mendes, having consented in writing, is appointed a director effective March 1, 2021; and the Corporation enter into the unanimous shareholder agreement." },
    { key: "usa_approval", title: "Approval of the unanimous shareholder agreement", body: "shareholders", electorate: "all", kind: "Ordinary", date: "2021-03-01", documentKey: "usa",
      text: "BE IT RESOLVED, by all of the shareholders, THAT the unanimous shareholder agreement dated March 1, 2021, which restricts the powers of the directors over the matters listed in its Schedule B (CBCA s. 146), is approved, and a copy is to be kept with the Corporation's records (CBCA s. 20(1)(a))." },
    { key: "board_change_2022", title: "Resignation of Grace Holloway and appointment of Siobhan Kerr", body: "directors", kind: "Ordinary", date: "2022-05-31",
      text: "BE IT RESOLVED THAT the resignation of Grace Holloway as a director and Secretary is accepted effective May 31, 2022; Siobhan Kerr, having consented in writing, is appointed a director effective June 1, 2022 to fill the vacancy (CBCA s. 111) and is appointed Chief Financial Officer and Secretary. A notice of change of directors is to be sent to Corporations Canada within 15 days (CBCA s. 113)." },
    { key: "option_exercise", title: "Issue of Class B Non-Voting Common Shares on option exercise", body: "directors", kind: "Ordinary", date: "2023-04-03",
      text: "BE IT RESOLVED THAT 20,000 Class B Non-Voting Common Shares are issued to Siobhan Kerr and 10,000 to Tomasz Wójcik on the exercise of options at $0.25 per share, the full price having been received (CBCA s. 25(3))." },
    { key: "consent_transfer", title: "Approval of transfer of 25,000 Common Shares", body: "directors", kind: "Ordinary", date: "2024-06-26",
      text: "BE IT RESOLVED THAT, the other shareholders having waived their rights of first refusal under the unanimous shareholder agreement, the transfer of 25,000 Common Shares from Élodie Marchand to Arjun Mehta is approved, certificate C-1 is cancelled and certificates C-4 (25,000) and C-5 (575,000) are issued. The ISC register is to be updated within 15 days (CBCA s. 21.1(3))." },
  ],
  documents: [
    { key: "certificate", title: "Certificate of Incorporation (1234567-8)", category: "certificate", date: "2020-09-15", fileName: "certificate-of-incorporation-1234567-8.pdf", tags: ["1___incorporation_documents", "certificate"], uploaded: true,
      content: "CERTIFICATE OF INCORPORATION\nCANADA BUSINESS CORPORATIONS ACT\nMaple Demo Federal Inc., corporation number 1234567-8, was incorporated under the Canada Business Corporations Act on September 15, 2020.\n(Fictional demo record.)" },
    { key: "articles", title: "Articles of Incorporation (Form 1)", category: "articles", date: "2020-09-15", fileName: "articles-of-incorporation.pdf", tags: ["1___incorporation_documents", "articles"],
      content: "Articles of Incorporation: unlimited Common Shares, Class A Preferred Shares and Class B Non-Voting Common Shares; restrictions on share transfers; 1 to 10 directors. (Fictional demo record.)" },
    { key: "bylaw", title: "By-law No. 1 (general by-law)", category: "governance", date: "2020-09-15", fileName: "by-law-no-1.pdf", tags: ["3___by_laws"],
      content: "General by-law of Maple Demo Federal Inc.: board quorum of a majority of directors, officers, banking and execution of documents. Confirmed by the shareholders. (Fictional demo record.)" },
    { key: "usa", title: "Unanimous shareholder agreement (March 1, 2021)", category: "unanimous_shareholder_agreement", date: "2021-03-01", fileName: "unanimous-shareholder-agreement.pdf", tags: ["12___shareholder_agreements"],
      content: "Unanimous shareholder agreement among all shareholders of Maple Demo Federal Inc. Schedule B lists matters that need investor approval (new share issues, debt above $250,000, sale of the business). (Fictional demo record.)" },
    { key: "subscription", title: "Subscription agreement — Atlântico Seed Partners", category: "share_transfer", date: "2021-03-01", fileName: "subscription-agreement-atlantico.pdf", tags: ["13___material_agreements"],
      content: "Subscription for 150,000 Common Shares and 500,000 Class A Preferred Shares at $1.00 per share. (Fictional demo record.)" },
    { key: "isc_register", title: "Register of individuals with significant control", category: "isc_register", date: "2024-06-28", fileName: "isc-register.pdf", tags: ["isc_register"],
      content: "Register of individuals with significant control kept under CBCA s. 21.1, updated after the June 2024 share transfer. (Fictional demo record.)" },
    { key: "msa", title: "Master services agreement — Municipality of Example Bay", category: "contract", date: "2024-01-15", fileName: "msa-example-bay.pdf", tags: ["13___material_agreements"],
      content: "Three-year software subscription and support agreement with the Municipality of Example Bay. (Fictional demo record.)" },
  ],
  agreements: [
    { key: "usa", title: "Unanimous shareholder agreement", kind: "other", status: "active", summary: "Agreement among every shareholder that restricts the directors' powers over the Schedule B matters (CBCA s. 146) and gives the investor a board seat.", parties: ["Élodie Marchand", "Arjun Mehta", "Atlântico Seed Partners, Lda.", "Siobhan Kerr", "Tomasz Wójcik"], signedDate: "2021-03-01", effectiveDate: "2021-03-01", governingLaw: "Ontario and the federal laws of Canada applicable in it", confidential: true, documentKey: "usa", notes: "Siobhan Kerr and Tomasz Wójcik signed joinders on April 3, 2023." },
    { key: "msa", title: "Master services agreement — Municipality of Example Bay", kind: "service", status: "active", summary: "Permit-tracking software subscription and support for three years, renewable on 90 days' notice.", parties: ["Maple Demo Federal Inc.", "Municipality of Example Bay"], signedDate: "2024-01-15", effectiveDate: "2024-02-01", endDate: "2027-01-31", renewalNoticeDays: 90, valueCents: 21_600_000, paymentTerms: "$6,000 a month, invoiced monthly.", governingLaw: "Ontario", confidential: false, documentKey: "msa" },
  ],
  dividends: [
    { key: "pa", cls: "pa", firstYear: 2021, declaredOn: "12-12", paymentDays: 10, perShare: (year) => (year === 2021 ? "0.05" : "0.06") },
  ],
  annualShareholders: { firstYear: 2021, monthDay: "05-20", auditorWaiver: "CBCA s. 163" },
  annualDirectorsDaysAfterYearEnd: 84,
  ownershipRegister: {
    label: "register of individuals with significant control",
    startedOn: "2020-09-15",
    startNote: "Register established on incorporation (CBCA s. 21.1).",
    reviewMonthDay: "12-05",
    firstReviewYear: 2020,
    pendingChange: { person: "arjun", awareDaysAgo: 6, narrative: "Arjun Mehta moved; enter the new address in the ISC register within 15 days of becoming aware (CBCA s. 21.1(3))." },
    updateDays: 15,
  },
  serviceProviders: [
    { key: "lawyer", fn: "lawyer", firmName: "Beaumont Ridley LLP", contactName: "Nathalie Ouimet", firmLocation: "Ottawa, ON", appointedOn: "2020-09-15" },
    { key: "accountant", fn: "accountant", firmName: "Ridgeway Lund Chartered Professional Accountants", contactName: "Kofi Asante", firmLocation: "Ottawa, ON", appointedOn: "2021-01-10" },
    { key: "banker", fn: "banker", firmName: "Capital Valley Bank (demo)", contactName: "Technology banking", firmLocation: "Ottawa, ON", appointedOn: "2020-09-20" },
  ],
  insurance: { key: "do", kind: "Directors' and officers' liability", insurer: "Laurentian Shield Assurance (demo)", broker: "Bytown Risk Partners (demo)", policyNumber: "DO-MAPLE-2210", renewalMonthDay: "03-01", coverageCents: 200_000_000, premiumCents: 640_000, summary: "D&O liability and cyber coverage required by the unanimous shareholder agreement." },
  finance: {
    bankName: "Capital Valley Bank (demo)",
    operatingLast4: "2281",
    openingCents: 46_000_000,
    savingsOpeningCents: 20_000_000,
    flows: [
      { key: "example_bay", description: "Subscription — Municipality of Example Bay", counterparty: "Municipality of Example Bay", category: "Subscription revenue", day: 8, minDollars: 6000, maxDollars: 6000, direction: "in", method: "EFT" },
      { key: "subs", description: "Card subscription payouts", counterparty: "Stripe-style payments processor (demo)", category: "Subscription revenue", day: 3, minDollars: 21000, maxDollars: 26500, direction: "in", method: "Deposit" },
      { key: "payroll", description: "Payroll", counterparty: "Payroll service (demo)", category: "Salaries and benefits", day: 15, minDollars: 28500, maxDollars: 30500, direction: "out", method: "EFT" },
      { key: "source", description: "CRA source deductions", counterparty: "Receiver General for Canada", category: "Salaries and benefits", day: 14, minDollars: 7400, maxDollars: 8200, direction: "out", method: "Bill payment" },
      { key: "cloud", description: "Cloud hosting", counterparty: "Hosting provider (demo)", category: "Hosting and software", day: 2, minDollars: 1900, maxDollars: 2600, direction: "out", method: "Card" },
      { key: "rent", description: "Office rent", counterparty: "Example Avenue Properties (demo)", category: "Rent", day: 1, minDollars: 5200, maxDollars: 5200, direction: "out", method: "Pre-authorized debit" },
      { key: "legal", description: "Corporate legal services", counterparty: "Beaumont Ridley LLP", category: "Professional fees", day: 22, minDollars: 900, maxDollars: 2400, direction: "out", months: [2, 5, 9, 11], method: "EFT" },
      { key: "fees", description: "Monthly account fee", counterparty: "Capital Valley Bank (demo)", category: "Bank charges", day: 28, minDollars: 45, maxDollars: 45, direction: "out", method: "Bank" },
    ],
    budget: [
      { category: "Subscription revenue", plannedCents: 36_000_000 },
      { category: "Salaries and benefits", plannedCents: 45_000_000 },
      { category: "Hosting and software", plannedCents: 2_800_000 },
      { category: "Rent", plannedCents: 6_240_000 },
      { category: "Professional fees", plannedCents: 900_000 },
      { category: "Bank charges", plannedCents: 54_000 },
    ],
    statements: (year) => ({ revenueCents: 9_000_000 + (year - 2021) * 7_500_000, expensesCents: 21_000_000 + (year - 2021) * 6_000_000, netAssetsCents: 38_000_000 + (year - 2021) * 1_500_000 }),
  },
  tasks: [
    { key: "isc_update", title: "Enter Arjun Mehta's new address in the ISC register", description: "Changes must be entered within 15 days of becoming aware (CBCA s. 21.1(3)), then sent to Corporations Canada.", dueInDays: 9, status: "InProgress", priority: "High", assignee: "Siobhan Kerr", tags: ["isc-register"] },
    { key: "annual_return", title: "File the federal annual return and ISC information", description: "File through Corporations Canada Online Filing within 60 days after the anniversary, with the ISC information.", dueInDays: 31, status: "Todo", priority: "High", assignee: "Siobhan Kerr", tags: ["annual-return"] },
    { key: "residency_check", title: "Confirm the board still meets the resident Canadian requirement", description: "At least 25% of the directors must be resident Canadians (CBCA s. 105(3)); confirm before adding the next investor nominee.", dueInDays: 60, status: "Todo", priority: "Medium", assignee: "Siobhan Kerr", tags: ["directors"] },
    { key: "msa_renewal", title: "Prepare the Example Bay renewal proposal", description: "The agreement renews only if notice is given 90 days before January 31, 2027.", dueInDays: 25, status: "Todo", priority: "Medium", assignee: "Élodie Marchand", tags: ["agreements"] },
    { key: "usa_joinder", title: "Collect joinders to the unanimous shareholder agreement", description: "Every new shareholder signs a joinder before shares are issued.", dueInDays: -540, status: "Done", priority: "Medium", assignee: "Siobhan Kerr", tags: ["shareholder-agreement"] },
  ],
  boardMeeting: { location: "Video call", agenda: ["Quarterly financial report", "Example Bay renewal", "Option pool for 2027 hires"], decisions: ["Management to propose a 2027 option pool for investor approval under the unanimous shareholder agreement.", "Approve the renewal proposal to the Municipality of Example Bay."] },
};

// ---------------------------------------------------------------------------
// Ontario: Lakeshore Demo Ontario Inc. (OBCA)
// ---------------------------------------------------------------------------

const LAKESHORE: CorporationStory = {
  key: "ontario_obca",
  legislationLabel: "Business Corporations Act (Ontario)",
  registryLabel: "Ontario Business Registry",
  registeredOffice: { street: "1880 Example Road", city: "Oakville", province: "ON", postalCode: "L6J 0A4" },
  mailingAddress: "1880 Example Road, Oakville, ON L6J 0A4",
  recordsOfficeNote: "Minute book kept at the registered office; securities register maintained by the corporate secretary.",
  officialEmail: "office@lakeshore-demo.example",
  shortName: "the Corporation",
  business: "Residential renovation contractor serving the western Greater Toronto Area.",
  businessNumber: "703456789RC0001",
  naicsCode: "236118",
  people: [
    { key: "nadia", firstName: "Nadia", lastName: "Castellano", email: "nadia@lakeshore-demo.example", phone: "+1 905 555 0132", street: "52 Sample Court", city: "Oakville", province: "ON", postalCode: "L6H 0B2", country: "CA", dateOfBirth: "1972-07-08", gender: "F", pronouns: "she/her", occupation: "General contractor", canadianStatus: "citizen", citizenshipCountries: ["CA", "IT"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false, user: "Owner" },
    { key: "marcus", firstName: "Marcus", lastName: "Castellano", email: "marcus@lakeshore-demo.example", phone: "+1 905 555 0145", street: "52 Sample Court", city: "Oakville", province: "ON", postalCode: "L6H 0B2", country: "CA", dateOfBirth: "1970-01-22", gender: "M", pronouns: "he/him", occupation: "Site manager", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false, user: "Director" },
    { key: "farah", firstName: "Farah", lastName: "Siddiqui", email: "farah@siddiqui-advisory.example", phone: "+1 289 555 0157", street: "300 Placeholder Street", city: "Mississauga", province: "ON", postalCode: "L5B 0C9", country: "CA", dateOfBirth: "1979-10-03", gender: "F", pronouns: "she/her", occupation: "Chartered professional accountant", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false, user: "Admin" },
    { key: "owen", firstName: "Owen", lastName: "Whitfield", email: "owen@lakeshore-demo.example", phone: "+1 905 555 0168", street: "14 Fictional Avenue", city: "Burlington", province: "ON", postalCode: "L7R 0D3", country: "CA", dateOfBirth: "1992-05-16", gender: "M", pronouns: "he/him", occupation: "Project lead", canadianStatus: "citizen", citizenshipCountries: ["CA"], taxResidenceCountries: ["CA"], residentCanadian: true, bcResident: false },
  ],
  entities: [
    { key: "holdco", name: "Castellano Holdco Ltd.", nonNaturalPersonType: "corporation", jurisdiction: "CA-ON", street: "52 Sample Court", city: "Oakville", province: "ON", postalCode: "L6H 0B2", country: "CA", signatory: "Nadia Castellano, president",
      controllers: [
        { person: "nadia", natureOfControl: "Holds 50% of the voting shares of Castellano Holdco Ltd., which holds the Class A Special Shares." },
        { person: "marcus", natureOfControl: "Holds 50% of the voting shares of Castellano Holdco Ltd., which holds the Class A Special Shares." },
      ] },
  ],
  directors: [
    { person: "nadia", start: "2018-03-12" },
    { person: "marcus", start: "2018-03-12" },
    { person: "farah", start: "2023-09-01" },
  ],
  officers: [
    { person: "nadia", title: "president", start: "2018-03-12" },
    { person: "marcus", title: "secretary_treasurer", start: "2018-03-12" },
  ],
  classes: [
    { key: "com", className: "Common Shares", idPrefix: "C", singular: "Common Share", plural: "Common Shares", votesPerShare: 1, votingRights: "One vote for each share at all meetings of shareholders.", dividendEntitlement: "discretionary_by_class", liquidationRank: 2, conditionsToTransfer: "No transfer without the approval of the directors (articles, private issuer restrictions).", startDate: "2018-03-12" },
    { key: "sa", className: "Class A Special Shares", idPrefix: "SA", singular: "Class A Special Share", plural: "Class A Special Shares", votesPerShare: 0, votingRights: "Non-voting, except as the Act requires.", dividendEntitlement: "fixed_rate", dividendRateBps: 400, redemption: { byCompany: true, byHolder: true, priceCents: 100_000, includesDeclaredUnpaid: true, minNoticeDays: 30 }, liquidationRank: 1, conditionsToTransfer: "No transfer without the approval of the directors.", otherProvisions: "Non-cumulative dividend of 4% a year on the $1,000 redemption amount, when declared. Redeemable and retractable at $1,000 per share on 30 days' notice.", startDate: "2023-07-01" },
    { key: "b", className: "Class B Non-Voting Shares", idPrefix: "B", singular: "Class B Non-Voting Share", plural: "Class B Non-Voting Shares", votesPerShare: 0, votingRights: "Non-voting, except as the Act requires.", dividendEntitlement: "discretionary_by_class", liquidationRank: 2, conditionsToTransfer: "No transfer without the approval of the directors.", startDate: "2020-08-01" },
  ],
  ledger: [
    { key: "iss_com_nadia", kind: "issuance", date: "2018-03-12", cls: "com", to: "nadia", quantity: 60, totalCents: 6_000, consideration: "cash", considerationDescription: "$60.00 paid in cash on subscription.", resolution: "org_directors", sequence: 1 },
    { key: "iss_com_marcus", kind: "issuance", date: "2018-03-12", cls: "com", to: "marcus", quantity: 40, totalCents: 4_000, consideration: "cash", considerationDescription: "$40.00 paid in cash on subscription.", resolution: "org_directors", sequence: 2 },
    { key: "iss_b_owen", kind: "issuance", date: "2020-08-01", cls: "b", to: "owen", quantity: 10, totalCents: 1_000, consideration: "cash", considerationDescription: "$10.00 paid in cash on subscription.", resolution: "allot_b" },
    { key: "iss_sa_holdco", kind: "issuance", date: "2023-07-01", cls: "sa", to: "holdco", quantity: 500, totalCents: 50_000_000, consideration: "cash", considerationDescription: "$500,000 paid in cash to fund the equipment purchase.", resolution: "allot_sa" },
    { key: "redeem_sa_holdco", kind: "redemption", date: "2025-01-15", cls: "sa", from: "holdco", quantity: 50, totalCents: 5_000_000, noticeDate: "2024-12-10", solvencyDate: "2025-01-14", solvencyBasis: "Directors reviewed the December 31, 2024 interim statements: realizable assets of $1.9 million against liabilities and stated capital of $1.1 million. The Corporation can pay its liabilities as they become due after the $50,000 redemption (OBCA s. 32(2)).", resolution: "redeem_sa" },
  ],
  resolutions: [
    { key: "org_directors", title: "Organizational resolutions of the first directors", body: "directors", kind: "Ordinary", date: "2018-03-12", documentKey: "articles",
      text: "BE IT RESOLVED THAT:\n1. By-law No. 1, the general by-law, is made and is to be submitted to the shareholders (OBCA s. 116).\n2. 60 Common Shares are issued to Nadia Castellano and 40 Common Shares to Marcus Castellano at $1.00 per share, fully paid (OBCA s. 23(3)).\n3. Nadia Castellano is appointed President and Marcus Castellano Secretary-Treasurer.\n4. The financial year of the Corporation ends on June 30 in each year." },
    { key: "allot_b", title: "Issue of Class B Non-Voting Shares to Owen Whitfield", body: "directors", kind: "Ordinary", date: "2020-08-01",
      text: "BE IT RESOLVED THAT 10 Class B Non-Voting Shares are issued to Owen Whitfield at $1.00 per share, the consideration having been received in full (OBCA s. 23(3))." },
    { key: "allot_sa", title: "Issue of 500 Class A Special Shares to Castellano Holdco Ltd.", body: "directors", kind: "Ordinary", date: "2023-06-28",
      text: "BE IT RESOLVED THAT, on receipt of $500,000, 500 Class A Special Shares are issued to Castellano Holdco Ltd. at $1,000 per share, fully paid (OBCA s. 23(3)), and the amount is added to the stated capital account for that class (OBCA s. 24)." },
    { key: "articles_amendment", title: "Special resolution: articles of amendment creating Class A Special Shares", body: "shareholders", electorate: "voting", kind: "Special", date: "2023-06-20", documentKey: "amendment",
      text: "BE IT RESOLVED AS A SPECIAL RESOLUTION THAT the articles are amended under OBCA s. 168 to create an unlimited number of Class A Special Shares with the rights set out in Schedule A, and any director or officer may file articles of amendment through the Ontario Business Registry." },
    { key: "farah_appointment", title: "Election of Farah Siddiqui as a director", body: "shareholders", electorate: "voting", kind: "Ordinary", date: "2023-08-25",
      text: "BE IT RESOLVED THAT the number of directors is increased from two to three and Farah Siddiqui, having consented in writing (OBCA s. 119(9)), is elected a director effective September 1, 2023 to hold office until the next annual meeting." },
    { key: "redeem_sa", title: "Redemption of 50 Class A Special Shares", body: "directors", kind: "Ordinary", date: "2025-01-14",
      text: "BE IT RESOLVED THAT, the directors being satisfied that the Corporation meets the solvency test in OBCA s. 32(2), the Corporation redeem 50 Class A Special Shares held by Castellano Holdco Ltd. on January 15, 2025 at $1,000 per share, notice having been given on December 10, 2024; certificate SA-1 is cancelled and certificate SA-2 for 450 shares is issued." },
  ],
  documents: [
    { key: "certificate", title: "Certificate of Incorporation (1000123456)", category: "certificate", date: "2018-03-12", fileName: "certificate-of-incorporation-1000123456.pdf", tags: ["1___incorporation_documents", "certificate"], uploaded: true,
      content: "CERTIFICATE OF INCORPORATION\nBUSINESS CORPORATIONS ACT (ONTARIO)\nLakeshore Demo Ontario Inc., Ontario corporation number 1000123456, was incorporated on March 12, 2018.\n(Fictional demo record.)" },
    { key: "articles", title: "Articles of Incorporation", category: "articles", date: "2018-03-12", fileName: "articles-of-incorporation.pdf", tags: ["1___incorporation_documents", "articles"],
      content: "Articles of Incorporation: unlimited Common Shares and Class B Non-Voting Shares; private issuer restrictions on transfer; minimum 1 and maximum 10 directors. (Fictional demo record.)" },
    { key: "amendment", title: "Articles of Amendment (Class A Special Shares)", category: "articles", date: "2023-06-21", fileName: "articles-of-amendment-2023.pdf", tags: ["1___incorporation_documents", "articles"],
      content: "Articles of Amendment filed through the Ontario Business Registry creating the Class A Special Shares. (Fictional demo record.)" },
    { key: "bylaw", title: "By-law No. 1 (general by-law)", category: "governance", date: "2018-03-12", fileName: "by-law-no-1.pdf", tags: ["3___by_laws"],
      content: "General by-law: board quorum of a majority of directors, officers, banking and execution of documents. (Fictional demo record.)" },
    { key: "shareholders_agreement", title: "Shareholders' agreement (amended 2023)", category: "shareholder_agreement", date: "2023-07-01", fileName: "shareholders-agreement-2023.pdf", tags: ["12___shareholder_agreements"],
      content: "Shareholders' agreement among Nadia Castellano, Marcus Castellano and Castellano Holdco Ltd., amended July 1, 2023. It is not a unanimous shareholder agreement: it does not restrict the directors' powers. (Fictional demo record.)" },
    { key: "isc_register", title: "Register of individuals with significant control", category: "isc_register", date: "2023-01-01", fileName: "isc-register.pdf", tags: ["isc_register"],
      content: "Register of individuals with significant control kept under OBCA s. 140.2 since January 1, 2023. (Fictional demo record.)" },
    { key: "equipment_lease", title: "Equipment lease — excavator and trailer", category: "contract", date: "2023-07-10", fileName: "equipment-lease.pdf", tags: ["13___material_agreements"],
      content: "Four-year equipment lease with Ontario Demo Equipment Finance Corp. (Fictional demo record.)" },
  ],
  agreements: [
    { key: "shareholders", title: "Shareholders' agreement", kind: "other", status: "active", summary: "Buy-sell, life insurance funding and transfer restrictions among the Castellano shareholders; amended in 2023 to add Castellano Holdco Ltd.", parties: ["Nadia Castellano", "Marcus Castellano", "Castellano Holdco Ltd."], signedDate: "2018-03-12", effectiveDate: "2018-03-12", governingLaw: "Ontario", confidential: true, documentKey: "shareholders_agreement" },
    { key: "equipment", title: "Equipment lease — excavator and trailer", kind: "lease", status: "active", summary: "Four-year lease with a purchase option at the end of the term.", parties: ["Lakeshore Demo Ontario Inc.", "Ontario Demo Equipment Finance Corp."], signedDate: "2023-07-10", effectiveDate: "2023-08-01", endDate: "2027-07-31", terminationNoticeDays: 60, valueCents: 14_880_000, paymentTerms: "$3,100 a month by pre-authorized debit.", governingLaw: "Ontario", confidential: false, documentKey: "equipment_lease" },
  ],
  dividends: [
    { key: "com", cls: "com", firstYear: 2019, declaredOn: "12-15", paymentDays: 10, perShare: (year) => `${Math.min(150 + 25 * (year - 2019), 300)}.00` },
    { key: "sa", cls: "sa", firstYear: 2023, declaredOn: "12-15", paymentDays: 10, perShare: () => "40.00" },
  ],
  annualShareholders: { firstYear: 2018, monthDay: "11-25", auditorWaiver: "OBCA s. 148" },
  annualDirectorsDaysAfterYearEnd: 112,
  ownershipRegister: {
    label: "register of individuals with significant control",
    startedOn: "2023-01-01",
    startNote: "Register established on January 1, 2023, when OBCA s. 140.2 came into force.",
    reviewMonthDay: "06-10",
    firstReviewYear: 2023,
    updateDays: 15,
  },
  serviceProviders: [
    { key: "lawyer", fn: "lawyer", firmName: "Lakeview Corporate Law Professional Corporation", contactName: "Daniel Fairweather", firmLocation: "Oakville, ON", appointedOn: "2018-03-12" },
    { key: "accountant", fn: "accountant", firmName: "Halton Ledger CPA Professional Corporation", contactName: "Mei Tanaka-Ross", firmLocation: "Burlington, ON", appointedOn: "2018-07-01" },
    { key: "banker", fn: "banker", firmName: "Escarpment Trust Bank (demo)", contactName: "Small business banking", firmLocation: "Oakville, ON", appointedOn: "2018-03-20" },
  ],
  insurance: { key: "cgl", kind: "Contractor's commercial general liability", insurer: "Great Lakes Mutual (demo)", broker: "Trafalgar Insurance Brokers (demo)", policyNumber: "CGL-LKS-7731", renewalMonthDay: "08-15", coverageCents: 500_000_000, premiumCents: 960_000, summary: "Contractor's liability, tools and equipment floater and completed operations." },
  finance: {
    bankName: "Escarpment Trust Bank (demo)",
    operatingLast4: "9052",
    openingCents: 18_500_000,
    savingsOpeningCents: 9_000_000,
    flows: [
      { key: "progress", description: "Progress payment — renovation contract", counterparty: "Homeowner clients (various)", category: "Contract revenue", day: 10, minDollars: 38000, maxDollars: 64000, direction: "in", method: "Cheque deposit" },
      { key: "deposits", description: "Client deposits", counterparty: "Homeowner clients (various)", category: "Contract revenue", day: 24, minDollars: 9000, maxDollars: 18000, direction: "in", method: "E-transfer" },
      { key: "materials", description: "Building materials", counterparty: "Lakeshore Builders Supply (demo)", category: "Materials", day: 12, minDollars: 14000, maxDollars: 26000, direction: "out", method: "Trade account" },
      { key: "subtrades", description: "Electrical and plumbing subcontractors", counterparty: "Subtrades (various)", category: "Subcontractors", day: 18, minDollars: 9000, maxDollars: 21000, direction: "out", method: "EFT" },
      { key: "payroll", description: "Payroll", counterparty: "Payroll service (demo)", category: "Wages", day: 15, minDollars: 16500, maxDollars: 19500, direction: "out", method: "EFT" },
      { key: "equipment", description: "Equipment lease payment", counterparty: "Ontario Demo Equipment Finance Corp.", category: "Equipment", day: 1, minDollars: 3100, maxDollars: 3100, direction: "out", method: "Pre-authorized debit" },
      { key: "hst", description: "HST remittance", counterparty: "Receiver General for Canada", category: "Taxes", day: 28, minDollars: 7200, maxDollars: 11800, direction: "out", months: [1, 4, 7, 10], method: "Bill payment" },
      { key: "fees", description: "Monthly account fee", counterparty: "Escarpment Trust Bank (demo)", category: "Bank charges", day: 28, minDollars: 30, maxDollars: 30, direction: "out", method: "Bank" },
    ],
    budget: [
      { category: "Contract revenue", plannedCents: 72_000_000 },
      { category: "Materials", plannedCents: 24_000_000 },
      { category: "Subcontractors", plannedCents: 18_000_000 },
      { category: "Wages", plannedCents: 21_600_000 },
      { category: "Equipment", plannedCents: 3_720_000 },
      { category: "Bank charges", plannedCents: 36_000 },
    ],
    statements: (year) => ({ revenueCents: 52_000_000 + (year - 2019) * 3_000_000, expensesCents: 46_000_000 + (year - 2019) * 2_600_000, netAssetsCents: 14_000_000 + (year - 2019) * 6_500_000 }),
  },
  tasks: [
    { key: "isc_review", title: "Prepare the annual ISC register review", description: "Confirm every individual with significant control once in each financial year (OBCA s. 140.2(4)).", dueInDays: 70, status: "Todo", priority: "Medium", assignee: "Marcus Castellano", tags: ["isc-register"] },
    { key: "annual_return", title: "File the Ontario annual return", description: "File through the Ontario Business Registry within six months after the financial year end; the CRA T2 filing is separate.", dueInDays: 45, status: "Todo", priority: "High", assignee: "Farah Siddiqui", tags: ["annual-return"] },
    { key: "annual_resolutions", title: "Circulate the annual shareholder resolutions and audit exemption", description: "Resolutions in writing under OBCA s. 104 and the consent of every shareholder to the s. 148 audit exemption.", dueInDays: 38, status: "InProgress", priority: "High", assignee: "Nadia Castellano", tags: ["annual-resolutions"] },
    { key: "redemption_certificates", title: "Issue certificate SA-2 after the January redemption", description: "Cancel SA-1 and issue SA-2 for the remaining 450 Class A Special Shares.", dueInDays: -620, status: "Done", priority: "Low", assignee: "Marcus Castellano", tags: ["certificates"] },
  ],
  boardMeeting: { location: "1880 Example Road, Oakville", agenda: ["Fiscal year results and the Ontario annual return", "Equipment financing", "Year-end dividend and solvency"], decisions: ["Approve the year-end statements for circulation to the shareholders.", "Defer new equipment financing to the spring."] },
};

export const CORPORATION_STORIES: Readonly<Record<CorporationDemoKey, CorporationStory>> = {
  bc_company: CEDAR,
  federal_cbca: MAPLE,
  ontario_obca: LAKESHORE,
};
