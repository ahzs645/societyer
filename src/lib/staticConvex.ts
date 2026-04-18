const FUNCTION_NAME = Symbol.for("functionName");

export const STATIC_DEMO_SOCIETY_ID = "static_society_riverside";
export const STATIC_DEMO_USER_ID = "static_user_owner";

const SOCIETY_ID = STATIC_DEMO_SOCIETY_ID;
const USER_OWNER_ID = STATIC_DEMO_USER_ID;
const USER_TREASURER_ID = "static_user_treasurer";
const USER_SECRETARY_ID = "static_user_secretary";
const MEETING_BOARD_ID = "static_meeting_board_q2";
const MEETING_AGM_ID = "static_meeting_agm_2025";
const DOCUMENT_BYLAWS_ID = "static_document_bylaws";
const DOCUMENT_POLICY_ID = "static_document_privacy";
const ELECTION_ID = "static_election";
const ELECTION_QUESTION_ID = "static_election_question_directors";
const FINANCIAL_CONNECTION_ID = "static_financial_connection";
const PAPERLESS_CONNECTION_ID = "static_paperless_connection";
const CASH_ACCOUNT_ID = "static_financial_cash";
const GRANT_ACCOUNT_ID = "static_financial_grant";

type StaticArgs = Record<string, any> | undefined;

const society = {
  _id: SOCIETY_ID,
  _creationTime: Date.parse("2025-01-05T12:00:00.000Z"),
  name: "Riverside Community Society",
  incorporationNumber: "S-0076543",
  incorporationDate: "2017-05-12",
  fiscalYearEnd: "03-31",
  isCharity: true,
  isMemberFunded: false,
  registeredOfficeAddress: "400 Granville Street, Vancouver, BC V6C 1T2",
  mailingAddress: "PO Box 2407, Vancouver, BC V6B 3W7",
  purposes: "Community education, neighbourhood resilience, and low-barrier civic programs in British Columbia.",
  privacyOfficerName: "Avery Santos",
  privacyOfficerEmail: "privacy@riverside.example",
  publicSlug: "riverside-community-society",
  publicSummary: "A fictional BC society used to show Societyer's governance workflows.",
  publicContactEmail: "hello@riverside.example",
  publicTransparencyEnabled: true,
  publicShowBoard: true,
  publicShowBylaws: true,
  publicShowFinancials: true,
  publicVolunteerIntakeEnabled: true,
  publicGrantIntakeEnabled: true,
  privacyPolicyDocId: DOCUMENT_POLICY_ID,
  constitutionDocId: "static_document_constitution",
  bylawsDocId: DOCUMENT_BYLAWS_ID,
  demoMode: true,
  updatedAt: Date.parse("2026-04-16T16:00:00.000Z"),
};

const users = [
  {
    _id: USER_OWNER_ID,
    societyId: SOCIETY_ID,
    displayName: "Mina Patel",
    email: "mina@riverside.example",
    role: "Owner",
    memberId: "static_member_mina",
  },
  {
    _id: USER_TREASURER_ID,
    societyId: SOCIETY_ID,
    displayName: "Jordan Lee",
    email: "jordan@riverside.example",
    role: "Director",
    memberId: "static_member_jordan",
  },
  {
    _id: USER_SECRETARY_ID,
    societyId: SOCIETY_ID,
    displayName: "Avery Santos",
    email: "avery@riverside.example",
    role: "Admin",
  },
];

const directors = [
  director("static_director_mina", "Mina", "Patel", "Secretary", true, true, "2024-06-20"),
  director("static_director_jordan", "Jordan", "Lee", "Treasurer", true, true, "2023-06-22"),
  director("static_director_devon", "Devon", "Clarke", "President", true, true, "2022-06-18"),
  director("static_director_sam", "Sam", "Nguyen", "Director", false, false, "2026-03-15"),
];

const orgHistoryBoardTerms = [
  {
    _id: "static_orghistory_term_devon",
    _creationTime: Date.parse("2026-02-10T18:00:00.000Z"),
    kind: "boardTerm",
    personName: "Devon Clarke",
    position: "President",
    committeeName: "Board",
    startDate: "2022-06-18",
    endDate: null,
    status: "Verified",
    sourceIds: ["static_orghistory_source_agm_2022"],
    createdAtISO: "2026-02-10T18:00:00.000Z",
  },
  {
    _id: "static_orghistory_term_jordan",
    _creationTime: Date.parse("2026-02-10T18:00:00.000Z"),
    kind: "boardTerm",
    personName: "Jordan Lee",
    position: "Treasurer",
    committeeName: "Board",
    startDate: "2023-06-22",
    endDate: null,
    status: "Verified",
    sourceIds: ["static_orghistory_source_agm_2023"],
    createdAtISO: "2026-02-10T18:00:00.000Z",
  },
  {
    _id: "static_orghistory_term_mina",
    _creationTime: Date.parse("2026-02-10T18:00:00.000Z"),
    kind: "boardTerm",
    personName: "Mina Patel",
    position: "Secretary",
    committeeName: "Board",
    startDate: "2024-06-20",
    endDate: null,
    status: "NeedsReview",
    sourceIds: ["static_orghistory_source_agm_2024"],
    createdAtISO: "2026-02-10T18:00:00.000Z",
  },
  {
    _id: "static_orghistory_term_rae",
    _creationTime: Date.parse("2026-02-10T18:00:00.000Z"),
    kind: "boardTerm",
    personName: "Rae Thompson",
    position: "Director",
    committeeName: "Board",
    startDate: "2021-06-15",
    endDate: "2023-06-15",
    status: "NeedsReview",
    sourceIds: ["static_orghistory_source_agm_2021"],
    createdAtISO: "2026-02-10T18:00:00.000Z",
  },
  {
    _id: "static_orghistory_term_avery_staff",
    _creationTime: Date.parse("2026-02-10T18:00:00.000Z"),
    kind: "boardTerm",
    personName: "Avery Santos",
    position: "Operations lead",
    committeeName: "Staff",
    startDate: "2023-09-01",
    endDate: null,
    status: "Verified",
    sourceIds: ["static_orghistory_source_staff_masthead"],
    createdAtISO: "2026-02-10T18:00:00.000Z",
  },
];

const orgHistoryBundle = {
  sources: [],
  facts: [],
  events: [],
  boardTerms: orgHistoryBoardTerms,
  motions: [],
  budgets: [],
};

const evidenceRegistersOverview = {
  boardRoleAssignments: [],
  boardRoleChanges: [],
  signingAuthorities: [],
  meetingAttendanceRecords: [],
  motionEvidence: [],
  budgetSnapshots: [],
  budgetSnapshotLines: [],
  financialStatementImports: [],
  financialStatementImportLines: [],
  treasurerReports: [],
  transactionCandidates: [],
  sourceEvidence: [],
  archiveAccessions: [],
};

const members = [
  member("static_member_mina", "Mina", "Patel", "Regular", true, "2021-04-13"),
  member("static_member_jordan", "Jordan", "Lee", "Regular", true, "2020-08-01"),
  member("static_member_devon", "Devon", "Clarke", "Regular", true, "2019-11-15"),
  member("static_member_avery", "Avery", "Santos", "Associate", false, "2024-01-10"),
];

const subscriptionPlans = [
  {
    _id: "static_plan_regular",
    societyId: SOCIETY_ID,
    name: "Regular member",
    description: "Voting rights at general meetings, program discounts, and member notices.",
    priceCents: 2500,
    currency: "CAD",
    interval: "year",
    benefits: ["AGM vote", "Program discount", "Quarterly newsletter"],
    membershipClass: "Regular",
    active: true,
  },
  {
    _id: "static_plan_student",
    societyId: SOCIETY_ID,
    name: "Student",
    description: "Reduced annual dues for students and emerging community organizers.",
    priceCents: 500,
    currency: "CAD",
    interval: "year",
    benefits: ["AGM vote", "Program discount"],
    membershipClass: "Student",
    active: true,
  },
  {
    _id: "static_plan_sustainer",
    societyId: SOCIETY_ID,
    name: "Sustainer",
    description: "Monthly recurring support for core operations and resilience programs.",
    priceCents: 1500,
    currency: "CAD",
    interval: "month",
    benefits: ["Named in annual report", "Invite to donor events"],
    active: true,
  },
];

const memberSubscriptions = [
  {
    _id: "static_member_subscription_devon",
    societyId: SOCIETY_ID,
    planId: "static_plan_regular",
    memberId: "static_member_devon",
    email: "devon@riverside.example",
    fullName: "Devon Clarke",
    status: "active",
    startedAtISO: "2025-04-01T16:00:00.000Z",
    currentPeriodEndISO: "2027-03-31T23:59:59.000Z",
    lastPaymentAtISO: "2026-04-01T16:05:00.000Z",
    lastPaymentCents: 2500,
    demo: true,
  },
  {
    _id: "static_member_subscription_avery",
    societyId: SOCIETY_ID,
    planId: "static_plan_sustainer",
    memberId: "static_member_avery",
    email: "avery@riverside.example",
    fullName: "Avery Santos",
    status: "active",
    startedAtISO: "2026-01-15T18:30:00.000Z",
    currentPeriodEndISO: "2026-05-15T18:30:00.000Z",
    lastPaymentAtISO: "2026-04-15T18:30:00.000Z",
    lastPaymentCents: 1500,
    demo: true,
  },
];

const committees = [
  {
    _id: "static_committee_finance",
    societyId: SOCIETY_ID,
    name: "Finance committee",
    description: "Budget, grant tracking, and board reporting.",
    mission: "Keep restricted funds clear and board-ready.",
    cadence: "Monthly",
    color: "green",
    status: "Active",
    nextMeetingAt: "2026-04-18T18:00:00.000Z",
  },
  {
    _id: "static_committee_governance",
    societyId: SOCIETY_ID,
    name: "Governance committee",
    description: "Bylaws, director onboarding, and AGM readiness.",
    mission: "Make the society easy to govern well.",
    cadence: "Monthly",
    color: "purple",
    status: "Active",
    nextMeetingAt: "2026-04-21T19:00:00.000Z",
  },
];

const meetings = [
  {
    _id: MEETING_BOARD_ID,
    societyId: SOCIETY_ID,
    type: "Board",
    title: "Q2 board meeting",
    scheduledAt: "2026-04-23T19:00:00.000Z",
    location: "Riverside Community Hall",
    electronic: true,
    quorumRequired: 4,
    attendeeIds: ["static_director_mina", "static_director_jordan", "static_director_devon"],
    status: "Scheduled",
  },
  {
    _id: MEETING_AGM_ID,
    societyId: SOCIETY_ID,
    type: "AGM",
    title: "2025 annual general meeting",
    scheduledAt: "2025-06-19T18:30:00.000Z",
    location: "Riverside Community Hall",
    electronic: false,
    quorumRequired: 20,
    attendeeIds: [],
    status: "Held",
  },
];

const minutes = [
  {
    _id: "static_minutes_agm",
    societyId: SOCIETY_ID,
    meetingId: MEETING_AGM_ID,
    status: "Approved",
    heldAt: "2025-06-19T18:30:00.000Z",
    approvedAt: "2025-07-10",
    attendees: ["Mina Patel", "Jordan Lee", "Devon Clarke", "Avery Santos"],
    absent: ["Sam Nguyen"],
    quorumMet: true,
    discussion: "Members reviewed the annual report, financial statements, and director slate.",
    motions: [
      {
        text: "Approve the 2025 financial statements as presented.",
        movedBy: "Jordan Lee",
        secondedBy: "Mina Patel",
        outcome: "Carried",
        votesFor: 4,
        votesAgainst: 0,
        abstentions: 0,
      },
    ],
    decisions: ["Approved annual report filing package."],
    actionItems: [{ text: "File annual report package", assignee: "Mina Patel", dueDate: "2025-07-19", done: true }],
  },
];

const filings = [
  {
    _id: "static_filing_ar",
    societyId: SOCIETY_ID,
    kind: "AnnualReport",
    title: "2026 BC annual report",
    dueDate: "2026-04-01",
    status: "Draft",
    submissionMethod: "Societies Online",
    feeCents: 4000,
  },
  {
    _id: "static_filing_t3010",
    societyId: SOCIETY_ID,
    kind: "T3010",
    title: "CRA T3010 charity return",
    dueDate: "2026-09-30",
    status: "Upcoming",
    submissionMethod: "CRA My Business Account",
  },
  {
    _id: "static_filing_directors",
    societyId: SOCIETY_ID,
    kind: "ChangeOfDirectors",
    title: "Change of directors",
    dueDate: "2026-05-01",
    status: "InProgress",
    submissionMethod: "Societies Online",
  },
];

const deadlines = [
  {
    _id: "static_deadline_report",
    societyId: SOCIETY_ID,
    title: "File annual report",
    dueDate: "2026-04-18",
    category: "Governance",
    done: false,
    recurrence: "Annual",
  },
  {
    _id: "static_deadline_privacy",
    societyId: SOCIETY_ID,
    title: "PIPA policy review",
    dueDate: "2026-05-12",
    category: "Privacy",
    done: false,
    recurrence: "Annual",
  },
];

const documents = [
  {
    _id: DOCUMENT_BYLAWS_ID,
    societyId: SOCIETY_ID,
    title: "Current bylaws",
    kind: "Bylaws",
    category: "Bylaws",
    status: "Approved",
    effectiveDate: "2025-06-19",
    retentionYears: 0,
    createdAtISO: "2025-06-25T17:00:00.000Z",
    flaggedForDeletion: false,
    tags: ["bylaws", "corporate register", "public"],
    public: true,
  },
  {
    _id: DOCUMENT_POLICY_ID,
    societyId: SOCIETY_ID,
    title: "PIPA privacy policy",
    kind: "Policy",
    category: "Policy",
    status: "Published",
    effectiveDate: "2025-09-01",
    retentionYears: 7,
    createdAtISO: "2025-09-01T16:00:00.000Z",
    flaggedForDeletion: false,
    tags: ["privacy", "PIPA", "public"],
    public: true,
  },
  {
    _id: "static_document_financials",
    societyId: SOCIETY_ID,
    title: "FY2025 financial statements",
    kind: "FinancialStatement",
    category: "FinancialStatement",
    status: "Approved",
    effectiveDate: "2026-03-31",
    retentionYears: 10,
    createdAtISO: "2026-04-10T19:30:00.000Z",
    flaggedForDeletion: false,
    tags: ["finance", "AGM", "public"],
    public: true,
  },
];

const elections = [
  {
    _id: ELECTION_ID,
    societyId: SOCIETY_ID,
    meetingId: MEETING_AGM_ID,
    title: "2026 board slate approval",
    description: "Demo electronic ballot for approving the incoming director slate.",
    status: "Open",
    opensAtISO: "2026-04-16T16:00:00.000Z",
    closesAtISO: "2026-04-30T23:59:00.000Z",
    nominationsOpenAtISO: "2026-04-01T16:00:00.000Z",
    nominationsCloseAtISO: "2026-04-10T23:59:00.000Z",
    anonymousBallot: true,
    scrutineerUserIds: [USER_OWNER_ID, USER_SECRETARY_ID],
    createdByUserId: USER_SECRETARY_ID,
    createdAtISO: "2026-03-25T18:00:00.000Z",
    updatedAtISO: "2026-04-16T16:00:00.000Z",
  },
];

const electionQuestions = [
  {
    _id: ELECTION_QUESTION_ID,
    societyId: SOCIETY_ID,
    electionId: ELECTION_ID,
    title: "Approve the nominated director slate",
    description: "One anonymous vote is recorded. Eligibility is kept separate from the ballot.",
    kind: "single_choice",
    maxSelections: 1,
    seatsAvailable: 1,
    options: [
      { id: "approve", label: "Approve the slate" },
      { id: "oppose", label: "Do not approve" },
      { id: "abstain", label: "Abstain" },
    ],
    order: 0,
  },
];

const electionEligibleVoters = [
  {
    _id: "static_election_eligible_mina",
    societyId: SOCIETY_ID,
    electionId: ELECTION_ID,
    memberId: "static_member_mina",
    userId: USER_OWNER_ID,
    email: "mina@riverside.example",
    fullName: "Mina Patel",
    status: "Eligible",
    eligibilityReason: "Active voting member at the eligibility cutoff.",
    createdAtISO: "2026-04-16T16:00:00.000Z",
  },
  {
    _id: "static_election_eligible_jordan",
    societyId: SOCIETY_ID,
    electionId: ELECTION_ID,
    memberId: "static_member_jordan",
    userId: USER_TREASURER_ID,
    email: "jordan@riverside.example",
    fullName: "Jordan Lee",
    status: "Confirmed",
    eligibilityReason: "Active voting member at the eligibility cutoff.",
    confirmedAtISO: "2026-04-16T16:10:00.000Z",
    createdAtISO: "2026-04-16T16:00:00.000Z",
  },
];

const electionAuditEvents = [
  {
    _id: "static_election_audit_opened",
    societyId: SOCIETY_ID,
    electionId: ELECTION_ID,
    actorName: "Avery Santos",
    action: "opened",
    detail: "Eligible voting members were snapshotted and voting opened.",
    createdAtISO: "2026-04-16T16:00:00.000Z",
  },
];

const goals = [
  {
    _id: "static_goal_agm",
    societyId: SOCIETY_ID,
    title: "Prepare AGM package",
    description: "Publish board materials, financials, and member notices.",
    category: "Governance",
    status: "OnTrack",
    startDate: "2026-04-01",
    targetDate: "2026-05-20",
    progressPercent: 35,
    ownerName: "Mina Patel",
    ownerUserId: USER_SECRETARY_ID,
    milestones: [
      { title: "Draft agenda", done: true },
      { title: "Publish notice", done: false },
      { title: "Finalize annual report", done: false },
    ],
    keyResults: [],
  },
];

const tasks = [
  {
    _id: "static_task_consent",
    societyId: SOCIETY_ID,
    title: "Collect Sam Nguyen director consent",
    status: "Todo",
    priority: "High",
    dueDate: "2026-04-20",
    ownerUserId: USER_SECRETARY_ID,
    goalId: "static_goal_agm",
  },
  {
    _id: "static_task_board_packet",
    societyId: SOCIETY_ID,
    title: "Lock Q2 board packet",
    status: "InProgress",
    priority: "Medium",
    dueDate: "2026-04-21",
    ownerUserId: USER_OWNER_ID,
    goalId: "static_goal_agm",
  },
];

const conflicts = [
  {
    _id: "static_conflict_jordan",
    societyId: SOCIETY_ID,
    directorId: "static_director_jordan",
    subject: "Grant vendor procurement",
    disclosedAt: "2026-03-14",
    meetingId: MEETING_BOARD_ID,
    leftRoom: true,
    abstained: true,
    resolvedAt: null,
  },
];

const financials = [
  {
    _id: "static_financials_2025",
    societyId: SOCIETY_ID,
    fiscalYear: "2025-2026",
    periodEnd: "2026-03-31",
    revenueCents: 18640000,
    expensesCents: 17125000,
    netAssetsCents: 6240000,
    restrictedFundsCents: 2750000,
    auditStatus: "Review engagement",
    auditorName: "North Shore CPA LLP",
    approvedByBoardAt: "2026-04-10",
    remunerationDisclosures: [{ role: "Executive Director", amountCents: 8425000 }],
  },
];

const financialConnections = [
  {
    _id: FINANCIAL_CONNECTION_ID,
    societyId: SOCIETY_ID,
    provider: "wave",
    status: "connected",
    accountLabel: "Riverside demo book",
    connectedAtISO: "2026-04-02T18:00:00.000Z",
    demo: true,
  },
];

const WAVE_CACHE_SNAPSHOT_ID = "static_wave_cache_snapshot";

const waveCacheSnapshots = [
  {
    _id: WAVE_CACHE_SNAPSHOT_ID,
    societyId: SOCIETY_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    provider: "wave",
    businessId: "static_wave_business",
    businessName: "Riverside demo book",
    currencyCode: "CAD",
    fetchedAtISO: "2026-04-16T16:00:00.000Z",
    resourceCountsJson: JSON.stringify({
      business: 1,
      account: 2,
      vendor: 2,
      product: 2,
      invoice: 1,
    }),
    resourceTypes: ["business", "account", "vendor", "product", "invoice"],
    structureTypes: ["Business", "Account", "Vendor", "Product", "Invoice", "Money"],
    status: "complete",
  },
];

const waveCacheResources = [
  waveResource("static_wave_business_resource", "business", "static_wave_business", "Riverside demo book", "CAD", {
    id: "static_wave_business",
    name: "Riverside demo book",
    currency: { code: "CAD" },
    timezone: "America/Vancouver",
  }),
  waveResource("static_wave_account_operating", "account", "cash", "Operating chequing", "ASSET / CASH_AND_BANK", {
    id: "cash",
    name: "Operating chequing",
    type: { value: "ASSET", name: "Asset" },
    subtype: { value: "CASH_AND_BANK", name: "Cash and Bank" },
    balanceInBusinessCurrency: "34900.00",
    currency: { code: "CAD" },
  }),
  waveResource("static_wave_account_grant", "account", "grant", "Neighbourhood grant fund", "ASSET / CASH_AND_BANK", {
    id: "grant",
    name: "Neighbourhood grant fund",
    type: { value: "ASSET", name: "Asset" },
    subtype: { value: "CASH_AND_BANK", name: "Cash and Bank" },
    balanceInBusinessCurrency: "27500.00",
    currency: { code: "CAD" },
  }),
  waveResource("static_wave_vendor_harbour", "vendor", "vendor_harbour", "Harbour Print Co.", "print@example.org", {
    id: "vendor_harbour",
    name: "Harbour Print Co.",
    email: "print@example.org",
    isArchived: false,
  }),
  waveResource("static_wave_vendor_city", "vendor", "vendor_city", "City Facilities", "facilities@example.org", {
    id: "vendor_city",
    name: "City Facilities",
    email: "facilities@example.org",
    isArchived: false,
  }),
  waveResource("static_wave_product_hall", "product", "product_hall", "Hall rental", "bought", {
    id: "product_hall",
    name: "Hall rental",
    isBought: true,
    isSold: false,
    unitPrice: "420.00",
  }),
  waveResource("static_wave_product_program", "product", "product_program", "Program fee", "sold", {
    id: "product_program",
    name: "Program fee",
    isBought: false,
    isSold: true,
    unitPrice: "25.00",
  }),
  waveResource("static_wave_invoice_1", "invoice", "invoice_1", "INV-1001", "Monthly program fees", {
    id: "invoice_1",
    invoiceNumber: "INV-1001",
    title: "Monthly program fees",
    status: "PAID",
    total: { value: "840.00", currency: { code: "CAD" } },
  }),
];

const waveCacheStructures = [
  waveStructure("static_wave_structure_business", "Business", "OBJECT", [
    { name: "id", type: { kind: "SCALAR", name: "ID" } },
    { name: "name", type: { kind: "SCALAR", name: "String" } },
    { name: "accounts", args: [{ name: "page" }, { name: "pageSize" }] },
  ]),
  waveStructure("static_wave_structure_account", "Account", "OBJECT", [
    { name: "id", type: { kind: "SCALAR", name: "ID" } },
    { name: "name", type: { kind: "SCALAR", name: "String" } },
    { name: "type", type: { kind: "OBJECT", name: "AccountType" } },
    { name: "subtype", type: { kind: "OBJECT", name: "AccountSubtype" } },
  ]),
  waveStructure("static_wave_structure_vendor", "Vendor", "OBJECT", [
    { name: "id", type: { kind: "SCALAR", name: "ID" } },
    { name: "name", type: { kind: "SCALAR", name: "String" } },
    { name: "email", type: { kind: "SCALAR", name: "String" } },
  ]),
  waveStructure("static_wave_structure_product", "Product", "OBJECT", [
    { name: "id", type: { kind: "SCALAR", name: "ID" } },
    { name: "name", type: { kind: "SCALAR", name: "String" } },
    { name: "isBought", type: { kind: "SCALAR", name: "Boolean" } },
    { name: "isSold", type: { kind: "SCALAR", name: "Boolean" } },
  ]),
  waveStructure("static_wave_structure_invoice", "Invoice", "OBJECT", [
    { name: "id", type: { kind: "SCALAR", name: "ID" } },
    { name: "invoiceNumber", type: { kind: "SCALAR", name: "String" } },
    { name: "total", type: { kind: "OBJECT", name: "Money" } },
  ]),
  waveStructure("static_wave_structure_money", "Money", "OBJECT", [
    { name: "value", type: { kind: "SCALAR", name: "String" } },
    { name: "minorUnitValue", type: { kind: "SCALAR", name: "Decimal" } },
    { name: "currency", type: { kind: "OBJECT", name: "Currency" } },
  ]),
];

const paperlessConnections = [
  {
    _id: PAPERLESS_CONNECTION_ID,
    societyId: SOCIETY_ID,
    status: "connected",
    baseUrl: "demo://paperless-ngx",
    apiVersion: "demo",
    serverVersion: "demo",
    autoCreateTags: true,
    autoUpload: false,
    tagPrefix: "societyer",
    connectedAtISO: "2026-04-12T18:00:00.000Z",
    lastCheckedAtISO: "2026-04-16T16:00:00.000Z",
    demo: true,
  },
];

const paperlessDocumentSyncs = [
  {
    _id: "static_paperless_sync_bylaws",
    societyId: SOCIETY_ID,
    documentId: DOCUMENT_BYLAWS_ID,
    connectionId: PAPERLESS_CONNECTION_ID,
    status: "complete",
    paperlessTaskId: "demo-paperless-task-1001",
    paperlessDocumentId: 1001,
    paperlessDocumentUrl: "demo://paperless/1001",
    title: "Current bylaws",
    fileName: "current-bylaws.pdf",
    tags: ["societyer", "societyer:bylaws", "bylaws", "corporate register", "public"],
    queuedAtISO: "2026-04-12T18:05:00.000Z",
    completedAtISO: "2026-04-12T18:05:00.000Z",
  },
];

const financialAccounts = [
  {
    _id: CASH_ACCOUNT_ID,
    societyId: SOCIETY_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    externalId: "cash",
    name: "Operating chequing",
    currency: "CAD",
    accountType: "Bank",
    balanceCents: 3490000,
    isRestricted: false,
  },
  {
    _id: GRANT_ACCOUNT_ID,
    societyId: SOCIETY_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    externalId: "grant",
    name: "Neighbourhood grant fund",
    currency: "CAD",
    accountType: "Bank",
    balanceCents: 2750000,
    isRestricted: true,
    restrictedPurpose: "Youth resilience program",
  },
];

const financialTransactions = [
  {
    _id: "static_tx_grant",
    societyId: SOCIETY_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    accountId: GRANT_ACCOUNT_ID,
    externalId: "tx-grant",
    date: "2026-04-01",
    description: "Foundation grant deposit",
    amountCents: 1500000,
    category: "Grant revenue",
    counterparty: "Harbour Foundation",
  },
  {
    _id: "static_tx_space",
    societyId: SOCIETY_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    accountId: CASH_ACCOUNT_ID,
    externalId: "tx-space",
    date: "2026-04-05",
    description: "Community hall rental",
    amountCents: -42000,
    category: "Facilities",
    counterparty: "Riverside Hall",
  },
];

const budgets = [
  {
    _id: "static_budget_programs",
    societyId: SOCIETY_ID,
    fiscalYear: "2025-2026",
    category: "Programs",
    plannedCents: 9600000,
    notes: "Includes youth resilience and community dinners.",
  },
  {
    _id: "static_budget_facilities",
    societyId: SOCIETY_ID,
    fiscalYear: "2025-2026",
    category: "Facilities",
    plannedCents: 3600000,
  },
];

const notifications = [
  {
    _id: "static_notification_ar",
    societyId: SOCIETY_ID,
    userId: USER_OWNER_ID,
    kind: "filing",
    severity: "warn",
    title: "Annual report needs filing",
    body: "The BC annual report package is ready for director confirmation.",
    linkHref: "/app/filings",
    readAt: null,
    createdAtISO: "2026-04-14T16:30:00.000Z",
  },
  {
    _id: "static_notification_privacy",
    societyId: SOCIETY_ID,
    kind: "general",
    severity: "success",
    title: "PIPA policy published",
    body: "The public transparency page now includes the privacy policy.",
    linkHref: "/app/transparency",
    readAt: "2026-04-13T20:00:00.000Z",
    createdAtISO: "2026-04-13T19:45:00.000Z",
  },
];

const bylawRules = {
  _id: "static_bylaw_rules",
  societyId: SOCIETY_ID,
  name: "BC default + Riverside bylaws",
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  quorumType: "fixed",
  quorumValue: 4,
  proxyVotingAllowed: true,
  writtenResolutionsAllowed: true,
};

const tables: Record<string, any[]> = {
  activity: [
    {
      _id: "static_activity_1",
      societyId: SOCIETY_ID,
      actor: "Mina Patel",
      entityType: "filing",
      action: "prepared",
      summary: "Prepared annual report package for board review.",
      createdAtISO: "2026-04-14T18:10:00.000Z",
    },
    {
      _id: "static_activity_2",
      societyId: SOCIETY_ID,
      actor: "Avery Santos",
      entityType: "document",
      action: "published",
      summary: "Published the PIPA privacy policy to the transparency centre.",
      createdAtISO: "2026-04-13T19:45:00.000Z",
    },
  ],
  attestations: [],
  auditors: [
    {
      _id: "static_auditor",
      societyId: SOCIETY_ID,
      name: "North Shore CPA LLP",
      fiscalYear: "2025-2026",
      status: "Appointed",
      appointedAt: "2025-06-19",
    },
  ],
  bylawAmendments: [
    {
      _id: "static_bylaw_amendment",
      societyId: SOCIETY_ID,
      title: "Electronic meeting cleanup",
      status: "Filed",
      baseText: "General meetings must be held in British Columbia. Members may attend electronically only if the board permits it for accessibility reasons.",
      proposedText: "General meetings may be held in person, electronically, or in a hybrid format if all participating members can communicate adequately with each other.",
      createdByName: "Avery Santos",
      createdAtISO: "2025-05-18T17:00:00.000Z",
      updatedAtISO: "2025-06-25T18:00:00.000Z",
      consultationStartedAtISO: "2025-05-25T17:00:00.000Z",
      resolutionPassedAtISO: "2025-06-19T19:40:00.000Z",
      votesFor: 42,
      votesAgainst: 3,
      abstentions: 1,
      filedAtISO: "2025-06-25T18:00:00.000Z",
      history: [
        {
          atISO: "2025-05-18T17:00:00.000Z",
          actor: "Avery Santos",
          action: "created",
          note: "Drafted the electronic meeting amendment.",
        },
        {
          atISO: "2025-05-25T17:00:00.000Z",
          actor: "Mina Patel",
          action: "consultation-started",
          note: "Sent to members for comment before the AGM.",
        },
        {
          atISO: "2025-06-19T19:40:00.000Z",
          actor: "Mina Patel",
          action: "resolution-passed",
          note: "Special resolution passed at the AGM.",
        },
        {
          atISO: "2025-06-25T18:00:00.000Z",
          actor: "Avery Santos",
          action: "filed",
          note: "Filed through Societies Online.",
        },
      ],
    },
  ],
  committees,
  conflicts,
  courtOrders: [],
  deadlines,
  directors,
  documents,
  documentVersions: [],
  paperlessConnections,
  paperlessDocumentSyncs,
  electionAuditEvents,
  electionBallots: [],
  electionEligibleVoters,
  electionNominations: [],
  electionQuestions,
  elections,
  employees: [
    {
      _id: "static_employee",
      societyId: SOCIETY_ID,
      firstName: "Avery",
      lastName: "Santos",
      role: "Operations lead",
      status: "Active",
    },
  ],
  filings,
  financials,
  waveCacheSnapshots,
  waveCacheResources,
  waveCacheStructures,
  goals,
  grants: [
    {
      _id: "static_grant",
      societyId: SOCIETY_ID,
      title: "Youth resilience grant",
      funderName: "Harbour Foundation",
      status: "Active",
      amountAwardedCents: 1500000,
      linkedFinancialAccountId: GRANT_ACCOUNT_ID,
      allowPublicApplications: true,
      opportunityType: "Foundation",
      priority: "High",
      fitScore: 80,
      nextAction: "Submit Q1 outcomes report",
      requirements: [
        {
          id: "core-reporting-calendar",
          category: "Post-award",
          label: "Reporting deadlines added",
          status: "Ready",
        },
        {
          id: "core-submission-confirmation",
          category: "Submission",
          label: "Submission confirmation saved",
          status: "Attached",
        },
        {
          id: "core-budget",
          category: "Finance",
          label: "Requested amount and budget notes prepared",
          status: "Ready",
        },
      ],
    },
  ],
  grantApplications: [
    {
      _id: "static_grant_application",
      societyId: SOCIETY_ID,
      applicantName: "Riverside Youth Collective",
      email: "collective@example.org",
      projectTitle: "After-school repair cafe",
      status: "Reviewing",
      amountRequestedCents: 350000,
    },
  ],
  grantReports: [
    {
      _id: "static_grant_report",
      societyId: SOCIETY_ID,
      grantId: "static_grant",
      title: "Q1 outcomes report",
      dueAtISO: "2026-05-15",
      status: "Draft",
    },
  ],
  grantTransactions: [],
  inspections: [],
  secrets: [
    {
      _id: "static_access_registry",
      societyId: SOCIETY_ID,
      name: "BC Registry account recovery",
      service: "BC Registries",
      credentialType: "registry_key",
      ownerRole: "Secretary",
      custodianUserId: USER_SECRETARY_ID,
      custodianPersonName: "Avery Santos",
      custodianEmail: "avery@riverside.example",
      backupCustodianName: "Mina Patel",
      backupCustodianEmail: "mina@riverside.example",
      storageMode: "stored_encrypted",
      externalLocation: "Societyer demo vault",
      hasSecretValue: true,
      secretPreview: "•••• demo",
      revealPolicy: "owner_admin_custodian",
      lastVerifiedAtISO: "2026-03-15",
      rotationDueAtISO: "2026-09-15",
      status: "Active",
      sensitivity: "restricted",
      accessLevel: "restricted",
      sourceExternalIds: ["demo:registry-custody"],
      notes: "Demo custody metadata only.",
      createdAtISO: "2026-03-15T16:00:00.000Z",
      updatedAtISO: "2026-03-15T16:00:00.000Z",
    },
  ],
  insurance: [
    {
      _id: "static_insurance",
      societyId: SOCIETY_ID,
      kind: "DirectorsOfficers",
      insurer: "Community Mutual",
      broker: "Harbour Risk Advisors",
      policyNumber: "CM-2026-331",
      coverageCents: 200000000,
      premiumCents: 185000,
      deductibleCents: 100000,
      coverageSummary: "Directors and officers liability coverage.",
      startDate: "2026-01-01",
      endDate: "2026-08-31",
      renewalDate: "2026-08-31",
      sourceExternalIds: ["demo:insurance-dno-2026"],
      confidence: "High",
      sensitivity: "restricted",
      riskFlags: ["restricted"],
      notes: "Demo policy record with restricted source provenance.",
      status: "Active",
    },
  ],
  meetings,
  memberProposals: [],
  memberSubscriptions,
  members,
  minutes,
  notifications,
  pipaTraining: [
    {
      _id: "static_pipa_training",
      societyId: SOCIETY_ID,
      personName: "Avery Santos",
      completedAt: "2026-02-12",
      topic: "Privacy officer refresh",
      expiresAt: "2027-02-12",
    },
  ],
  proxies: [],
  receipts: [
    {
      _id: "static_receipt",
      societyId: SOCIETY_ID,
      receiptNumber: "RCS-2026-0012",
      donorName: "Harbour Foundation",
      amountCents: 500000,
      issuedAtISO: "2026-04-03",
      status: "Issued",
      location: "Vancouver, BC",
    },
  ],
  reconciliation: [],
  subscriptionPlans,
  subscriptions: memberSubscriptions,
  tasks,
  transparency: [
    {
      _id: "static_publication_bylaws",
      societyId: SOCIETY_ID,
      title: "Current bylaws",
      category: "Bylaws",
      status: "Published",
      reviewStatus: "Approved",
      documentId: DOCUMENT_BYLAWS_ID,
      publishedAtISO: "2025-06-25",
    },
  ],
  users,
  volunteers: [
    {
      _id: "static_volunteer",
      societyId: SOCIETY_ID,
      firstName: "Casey",
      lastName: "Morgan",
      email: "casey@example.org",
      status: "Active",
      annualRenewalAt: "2026-10-01",
    },
  ],
  volunteerApplications: [
    {
      _id: "static_volunteer_application",
      societyId: SOCIETY_ID,
      applicantName: "Riley Chen",
      email: "riley@example.org",
      status: "Submitted",
      interests: ["Events", "Food program"],
    },
  ],
  volunteerScreenings: [],
  writtenResolutions: [],
};

function director(id: string, firstName: string, lastName: string, position: string, isBCResident: boolean, consentOnFile: boolean, termStart: string) {
  return {
    _id: id,
    societyId: SOCIETY_ID,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}@riverside.example`,
    position,
    isBCResident,
    consentOnFile,
    termStart,
    status: "Active",
  };
}

function member(id: string, firstName: string, lastName: string, membershipClass: string, votingRights: boolean, joinedAt: string) {
  return {
    _id: id,
    societyId: SOCIETY_ID,
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}@riverside.example`,
    membershipClass,
    status: "Active",
    joinedAt,
    votingRights,
  };
}

function waveResource(id: string, resourceType: string, externalId: string, label: string, secondaryLabel: string, raw: any) {
  const rawJson = JSON.stringify(raw);
  return {
    _id: id,
    societyId: SOCIETY_ID,
    snapshotId: WAVE_CACHE_SNAPSHOT_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    provider: "wave",
    businessId: "static_wave_business",
    resourceType,
    externalId,
    label,
    secondaryLabel,
    typeValue: raw.type?.value,
    subtypeValue: raw.subtype?.value,
    status: raw.status ?? (raw.isArchived ? "archived" : "active"),
    currencyCode: raw.currency?.code ?? raw.total?.currency?.code,
    amountValue: raw.balanceInBusinessCurrency ?? raw.unitPrice ?? raw.total?.value,
    dateValue: raw.modifiedAt ?? raw.invoiceDate,
    searchText: `${resourceType} ${externalId} ${label} ${secondaryLabel}`.toLowerCase(),
    rawJson,
    fetchedAtISO: "2026-04-16T16:00:00.000Z",
  };
}

function waveStructure(id: string, typeName: string, kind: string, fields: any[]) {
  const raw = { name: typeName, kind, fields };
  return {
    _id: id,
    societyId: SOCIETY_ID,
    snapshotId: WAVE_CACHE_SNAPSHOT_ID,
    connectionId: FINANCIAL_CONNECTION_ID,
    provider: "wave",
    businessId: "static_wave_business",
    typeName,
    kind,
    fieldCount: fields.length,
    fieldsJson: JSON.stringify(fields),
    rawJson: JSON.stringify(raw),
    fetchedAtISO: "2026-04-16T16:00:00.000Z",
  };
}

function functionName(ref: any) {
  if (typeof ref === "string") return ref;
  const name = ref?.[FUNCTION_NAME];
  return typeof name === "string" ? name : "";
}

function byId(rows: any[], id: string | undefined) {
  return rows.find((row) => row._id === id) ?? null;
}

function scopedRows(rows: any[], args: StaticArgs) {
  if (!args?.societyId) return rows;
  return rows.filter((row) => !row.societyId || row.societyId === args.societyId);
}

function dashboardSummary() {
  const activeDirectors = directors.filter((director) => director.status === "Active");
  const activeMembers = members.filter((member) => member.status === "Active");
  const bcResidents = activeDirectors.filter((director) => director.isBCResident).length;
  const overdueFilings = filings.filter((filing) => filing.status !== "Filed" && filing.dueDate < "2026-04-16");
  const upcomingFilings = filings.filter((filing) => filing.status !== "Filed" && filing.dueDate >= "2026-04-16");
  const openDeadlines = deadlines.filter((deadline) => !deadline.done);
  const openConflicts = conflicts.filter((conflict) => !conflict.resolvedAt);

  return {
    society,
    counts: {
      members: activeMembers.length,
      directors: activeDirectors.length,
      bcResidents,
      meetingsThisYear: meetings.filter((meeting) => meeting.scheduledAt.startsWith("2026")).length,
      overdueFilings: overdueFilings.length,
      openDeadlines: openDeadlines.length,
      openConflicts: openConflicts.length,
      committees: committees.filter((committee) => committee.status === "Active").length,
      openGoals: goals.filter((goal) => goal.status !== "Completed").length,
      openTasks: tasks.filter((task) => task.status !== "Done").length,
    },
    upcomingMeetings: meetings.filter((meeting) => meeting.status === "Scheduled").slice(0, 3),
    upcomingFilings,
    overdueFilings,
    complianceFlags: [
      { level: "ok", text: "At least three active directors are on record." },
      { level: "ok", text: "At least one BC-resident director is on record." },
      { level: "warn", text: "1 director is missing written consent." },
      { level: "warn", text: "Annual report package is prepared but not filed." },
    ],
  };
}

function financialSummary() {
  return {
    totalBalance: financialAccounts.reduce((sum, account) => sum + account.balanceCents, 0),
    unrestricted: financialAccounts
      .filter((account) => !account.isRestricted)
      .reduce((sum, account) => sum + account.balanceCents, 0),
    restrictedAccounts: financialAccounts
      .filter((account) => account.isRestricted)
      .map((account) => ({
        name: account.name,
        balanceCents: account.balanceCents,
        purpose: account.restrictedPurpose,
      })),
    budgetRows: budgets.map((budget) => ({
      ...budget,
      actualCents: financialTransactions
        .filter((transaction) => transaction.category === budget.category)
        .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0),
    })),
    recentTransactions: financialTransactions,
  };
}

function profitAndLoss(args: StaticArgs) {
  const from = args?.from ?? "2026-01-01";
  const to = args?.to ?? "2026-12-31";
  const rows = financialTransactions.filter((transaction) => transaction.date >= from && transaction.date <= to);
  const incomeByCategory: Record<string, number> = {};
  const expenseByCategory: Record<string, number> = {};
  let totalIncomeCents = 0;
  let totalExpenseCents = 0;

  for (const transaction of rows) {
    const category = transaction.category ?? "Uncategorized";
    if (transaction.amountCents > 0) {
      incomeByCategory[category] = (incomeByCategory[category] ?? 0) + transaction.amountCents;
      totalIncomeCents += transaction.amountCents;
    } else {
      expenseByCategory[category] = (expenseByCategory[category] ?? 0) + Math.abs(transaction.amountCents);
      totalExpenseCents += Math.abs(transaction.amountCents);
    }
  }

  return {
    from,
    to,
    totalIncomeCents,
    totalExpenseCents,
    netCents: totalIncomeCents - totalExpenseCents,
    incomeByCategory,
    expenseByCategory,
    transactionCount: rows.length,
  };
}

function budgetVariance() {
  return budgets.map((budget) => {
    const actualCents = financialTransactions
      .filter((transaction) => transaction.category === budget.category)
      .reduce((sum, transaction) => sum + Math.abs(transaction.amountCents), 0);

    return {
      category: budget.category,
      plannedCents: budget.plannedCents,
      actualCents,
      varianceCents: actualCents - budget.plannedCents,
      notes: budget.notes,
    };
  });
}

function restrictedFunds() {
  return [
    {
      grantId: "static_grant",
      title: "Youth resilience grant",
      funder: "Harbour Foundation",
      purpose: "Youth resilience program",
      awardedCents: 1500000,
      inflowCents: 1500000,
      outflowCents: 0,
      balanceCents: 1500000,
      startDate: "2026-04-01",
      endDate: "2027-03-31",
      status: "Active",
    },
  ];
}

function grantsSummary() {
  return {
    total: tables.grants.length,
    pipeline: 1,
    active: 1,
    awardedCents: 1500000,
    linkedRestrictedBalanceCents: 2750000,
    pendingApplications: 1,
    ledgerSpendCents: 0,
    overdueReports: 0,
    dueSoonReports: 1,
  };
}

function electionBundle(args: StaticArgs) {
  const election = byId(elections, args?.id) ?? elections[0];
  const questions = electionQuestions.filter((row) => row.electionId === election._id);
  const eligible = electionEligibleVoters.filter((row) => row.electionId === election._id);
  const ballots = tables.electionBallots.filter((row) => row.electionId === election._id);
  const audit = electionAuditEvents.filter((row) => row.electionId === election._id);

  return {
    election,
    questions,
    eligible,
    ballots,
    ballotCount: ballots.length,
    audit,
    canSeeSensitive: true,
  };
}

function mineElections(args: StaticArgs) {
  if (!args?.userId) return [];
  const user = byId(users, args.userId);
  if (!user?.memberId) return [];

  return electionEligibleVoters
    .filter((row) => row.memberId === user.memberId)
    .map((eligibility) => ({
      election: byId(elections, eligibility.electionId),
      eligibility,
    }))
    .filter((row) => row.election?.societyId === args.societyId);
}

function electionTally(args: StaticArgs) {
  const electionId = args?.electionId ?? ELECTION_ID;
  return electionQuestions
    .filter((question) => question.electionId === electionId)
    .map((question) => ({
      questionId: question._id,
      title: question.title,
      totals: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        votes: 0,
      })),
    }));
}

function publicCenter(args?: StaticArgs) {
  if (!args?.slug || args.slug !== society.publicSlug || !society.publicTransparencyEnabled) {
    return null;
  }
  return {
    society: {
      ...society,
      volunteerApplyPath:
        society.publicVolunteerIntakeEnabled && society.publicSlug
          ? `/public/${society.publicSlug}/volunteer-apply`
          : undefined,
      grantApplyPath:
        society.publicGrantIntakeEnabled &&
        society.publicSlug &&
        tables.grants.some((grant) => grant.allowPublicApplications)
          ? `/public/${society.publicSlug}/grant-apply`
          : undefined,
    },
    directors: directors.filter((director) => director.status === "Active"),
    publications: tables.transparency.filter((row) => row.status === "Published"),
    documents: documents.filter((document) => document.public),
  };
}

const STATIC_EXPORT_TABLES = [
  "societies",
  "users",
  "apiClients",
  "apiTokens",
  "pluginInstallations",
  "webhookSubscriptions",
  "webhookDeliveries",
  "documentVersions",
  "paperlessConnections",
  "paperlessDocumentSyncs",
  "notifications",
  "notificationPrefs",
  "memberCommunicationPrefs",
  "communicationSegments",
  "communicationTemplates",
  "communicationCampaigns",
  "communicationDeliveries",
  "financialConnections",
  "waveCacheSnapshots",
  "waveCacheResources",
  "waveCacheStructures",
  "financialAccounts",
  "financialTransactions",
  "budgets",
  "budgetSnapshots",
  "budgetSnapshotLines",
  "financialStatementImports",
  "financialStatementImportLines",
  "treasurerReports",
  "transactionCandidates",
  "signatures",
  "filingBotRuns",
  "workflows",
  "workflowRuns",
  "subscriptionPlans",
  "memberSubscriptions",
  "transcripts",
  "transcriptionJobs",
  "members",
  "directors",
  "boardRoleAssignments",
  "boardRoleChanges",
  "signingAuthorities",
  "committees",
  "committeeMembers",
  "volunteers",
  "volunteerApplications",
  "volunteerScreenings",
  "meetings",
  "minutes",
  "meetingAttendanceRecords",
  "motionEvidence",
  "filings",
  "grants",
  "grantApplications",
  "grantReports",
  "grantTransactions",
  "deadlines",
  "documents",
  "publications",
  "conflicts",
  "financials",
  "bylawRuleSets",
  "goals",
  "tasks",
  "activity",
  "inspections",
  "directorAttestations",
  "writtenResolutions",
  "agmRuns",
  "noticeDeliveries",
  "insurancePolicies",
  "pipaTrainings",
  "proxies",
  "auditorAppointments",
  "memberProposals",
  "elections",
  "electionQuestions",
  "electionEligibleVoters",
  "electionBallots",
  "electionNominations",
  "electionAuditEvents",
  "donationReceipts",
  "employees",
  "courtOrders",
  "bylawAmendments",
  "agendas",
  "agendaItems",
  "motionTemplates",
  "recordsLocation",
  "sourceEvidence",
  "secretVaultItems",
  "archiveAccessions",
];

const STATIC_EXPORT_ALIASES: Record<string, string> = {
  donationReceipts: "receipts",
  insurancePolicies: "insurance",
  pipaTrainings: "pipaTraining",
  publications: "transparency",
  secretVaultItems: "secrets",
};

function staticExportRows(table: string, args?: StaticArgs) {
  if (!table) return [];
  if (table === "societies") return [society].filter((row) => !args?.societyId || row._id === args.societyId);
  const key = STATIC_EXPORT_ALIASES[table] ?? table;
  return scopedRows(tables[key] ?? [], args).map((row: any) => staticSanitizeExportRow(row));
}

function staticExportSummaries(args?: StaticArgs) {
  return STATIC_EXPORT_TABLES.map((name) => ({
    name,
    rowCount: staticExportRows(name, args).length,
    exportable: true,
  }));
}

function staticExportValidation(args?: StaticArgs) {
  const summaries = staticExportSummaries(args);
  const totalRows = summaries.reduce((sum, table) => sum + table.rowCount, 0);
  return {
    ok: true,
    version: 2,
    tableCount: STATIC_EXPORT_TABLES.length,
    nonEmptyTableCount: summaries.filter((table) => table.rowCount > 0).length,
    totalRows,
    issues: [],
    tables: summaries,
    generatedAtISO: new Date().toISOString(),
    societyId: args?.societyId ?? SOCIETY_ID,
    societyName: society.name,
  };
}

function staticExportWorkspace(args?: StaticArgs) {
  const summaries = staticExportSummaries(args);
  const tableRows = Object.fromEntries(
    STATIC_EXPORT_TABLES.map((table) => [table, staticExportRows(table, args)]),
  );
  return {
    kind: "societyer.workspaceExport",
    version: 2,
    generatedAtISO: new Date().toISOString(),
    society: staticSanitizeExportRow(society),
    manifest: {
      societyId: args?.societyId ?? SOCIETY_ID,
      societyName: society.name,
      tableCount: STATIC_EXPORT_TABLES.length,
      exportedTableCount: STATIC_EXPORT_TABLES.length,
      totalRows: summaries.reduce((sum, table) => sum + table.rowCount, 0),
      redactedFields: ["secretEncrypted", "tokenHash", "storageId"],
      binaryFilesIncluded: false,
      tables: summaries,
    },
    validation: staticExportValidation(args),
    tables: tableRows,
  };
}

function staticSanitizeExportRow(row: any) {
  const copy = { ...row };
  for (const field of ["secretEncrypted", "tokenHash", "storageId"]) {
    if (field in copy) copy[field] = "[redacted]";
  }
  return copy;
}

function queryResult(name: string, args: StaticArgs) {
  switch (name) {
    case "activity:list":
      return tables.activity.slice(0, args?.limit ?? tables.activity.length);
    case "agm:noticeDeliveries":
      return [];
    case "agm:runForMeeting":
      return { _id: "static_agm_run", meetingId: args?.meetingId, status: "Ready", steps: [] };
    case "attestations:missingForYear":
      return directors.filter((director) => director._id === "static_director_sam");
    case "bylawRules:getActive":
      return bylawRules;
    case "committees:detail":
      return { committee: byId(committees, args?.id), members: [], meetings: [], tasks, goals };
    case "dashboard:summary":
      return dashboardSummary();
    case "documentVersions:latest":
    case "documentVersions:listForDocument":
      return [];
    case "evidenceRegisters:overview":
      return evidenceRegistersOverview;
    case "importSessions:list":
      return [];
    case "importSessions:get":
      return null;
    case "organizationHistory:list":
      return orgHistoryBundle;
    case "paperless:connectionStatus":
      return {
        connection: paperlessConnections[0],
        runtime: {
          provider: "demo",
          live: false,
          configured: false,
          baseUrl: "demo://paperless-ngx",
        },
      };
    case "paperless:listConnection":
      return paperlessConnections[0];
    case "paperless:recentSyncs":
      return paperlessDocumentSyncs
        .slice(0, args?.limit ?? paperlessDocumentSyncs.length)
        .map((sync) => ({
          ...sync,
          documentTitle: byId(documents, sync.documentId)?.title ?? sync.title,
          documentCategory: byId(documents, sync.documentId)?.category,
        }));
    case "paperless:syncForDocument":
      return paperlessDocumentSyncs.find((sync) => sync.documentId === args?.documentId) ?? null;
    case "paperless:tagProfiles":
      return [
        {
          scope: "Core record",
          tags: ["societyer", "category:<document category>", "local document tags"],
          usage: "Every synced document carries stable app-level context.",
        },
        {
          scope: "Governance",
          tags: ["constitution", "bylaws", "minutes", "election", "auditor"],
          usage: "Society profile, meetings, elections, bylaws, and auditor records.",
        },
        {
          scope: "Compliance",
          tags: ["filing", "filing:<kind>", "records-inspection", "pipa-training"],
          usage: "Filing evidence, retained records, inspections, and privacy training proof.",
        },
        {
          scope: "Finance and programs",
          tags: ["financial-statement", "grant-report", "grant-transaction", "volunteer-screening"],
          usage: "Financials, grants, donation evidence, and volunteer screening files.",
        },
      ];
    case "elections:get":
      return electionBundle(args);
    case "elections:listMine":
      return mineElections(args);
    case "elections:listNominations":
      return [];
    case "elections:tally":
      return electionTally(args);
    case "exports:countTablePage":
      return { count: staticExportRows(args?.table, args).length, isDone: true, continueCursor: "" };
    case "exports:exportTable":
      return staticExportRows(args?.table, args);
    case "exports:exportWorkspace":
      return staticExportWorkspace(args);
    case "exports:listExportableTables":
      return staticExportSummaries(args);
    case "exports:validateCurrentDatabase":
      return staticExportValidation(args);
    case "filingBot:buildFilingPacket":
      return { filing: byId(filings, args?.filingId), documents: [] };
    case "filingBot:runsForFiling":
      return [];
    case "filingExports:craPreFill":
      return {
        form: "CRA T3010 Registered Charity Information Return",
        charityName: society.name,
        fiscalPeriodEnd: "2026-03-31",
        totalRevenue: 186400,
        totalExpenditures: 171250,
        netAssets: 62400,
        directorCount: directors.filter((director) => director.status === "Active").length,
        dueDate: "2026-09-30",
      };
    case "filingExports:societiesOnlinePreFill":
      return {
        formName: "BC Societies Annual Report",
        societyName: society.name,
        incorporationNumber: society.incorporationNumber,
        agmHeldOn: "2025-06-19",
        registeredOffice: society.registeredOfficeAddress,
        mailingAddress: society.mailingAddress,
        directors: directors.map((director) => ({
          fullName: `${director.firstName} ${director.lastName}`,
          position: director.position,
          email: director.email,
          isBCResident: director.isBCResident,
          termStart: director.termStart,
        })),
        feeCad: 40,
      };
    case "financialHub:accounts":
      return financialAccounts;
    case "financialHub:connections":
      return financialConnections;
    case "financialHub:getConnection":
      return byId(financialConnections, args?.id) ?? financialConnections[0];
    case "financialHub:oauthUrl":
      return { provider: "wave", live: false, url: "#", demo: true };
    case "financialHub:summary":
      return financialSummary();
    case "financialHub:transactions":
      return financialTransactions.slice(0, args?.limit ?? financialTransactions.length);
    case "waveCache:summary": {
      const snapshot = waveCacheSnapshots[0];
      return {
        ...snapshot,
        resourceCounts: JSON.parse(snapshot.resourceCountsJson),
      };
    }
    case "waveCache:resources": {
      const needle = args?.search?.trim?.().toLowerCase?.();
      return waveCacheResources
        .filter((row) => !args?.resourceType || row.resourceType === args.resourceType)
        .filter((row) => !needle || row.searchText.includes(needle))
        .slice(0, args?.limit ?? waveCacheResources.length)
        .map(({ rawJson, ...row }) => ({ ...row, hasRawJson: Boolean(rawJson) }));
    }
    case "waveCache:resource": {
      const row = byId(waveCacheResources, args?.id);
      return row ? { ...row, raw: JSON.parse(row.rawJson) } : null;
    }
    case "waveCache:structures":
      return waveCacheStructures.slice(0, args?.limit ?? waveCacheStructures.length).map((row) => ({
        ...row,
        fields: JSON.parse(row.fieldsJson),
      }));
    case "grants:applications":
      return tables.grantApplications;
    case "grants:publicOpenings":
      return tables.grants.filter((grant) => grant.allowPublicApplications);
    case "grants:reports":
      return tables.grantReports;
    case "grants:summary":
      return grantsSummary();
    case "grants:transactions":
      return tables.grantTransactions;
    case "members:get":
      return byId(members, args?.id);
    case "meetings:get":
      return byId(meetings, args?.id) ?? meetings[0];
    case "minutes:getByMeeting":
      return minutes.find((row) => row.meetingId === args?.meetingId) ?? null;
    case "notifications:list":
      return notifications.slice(0, args?.limit ?? notifications.length);
    case "notifications:unreadCount":
      return notifications.filter((notification) => !notification.readAt).length;
    case "publicPortal:getSocietyBySlug":
      return society.publicSlug === args?.slug ? society : null;
    case "publicPortal:grantIntakeContext":
      if (args?.slug !== society.publicSlug || !society.publicTransparencyEnabled || !society.publicGrantIntakeEnabled) return null;
      return { society, grants: tables.grants.filter((grant) => grant.allowPublicApplications), committees };
    case "publicPortal:volunteerIntakeContext":
      if (args?.slug !== society.publicSlug || !society.publicTransparencyEnabled || !society.publicVolunteerIntakeEnabled) return null;
      return { society, grants: tables.grants, committees };
    case "retention:expiredForSociety":
    case "signatures:listForEntity":
      return [];
    case "subscriptions:allSubscriptions":
      return memberSubscriptions;
    case "subscriptions:getPlan":
      return byId(subscriptionPlans, args?.id);
    case "subscriptions:plans":
      return subscriptionPlans;
    case "transcripts:getByMeeting":
    case "transcripts:jobForMeeting":
      return null;
    case "transparency:listPublications":
      return tables.transparency;
    case "transparency:publicCenter":
      return publicCenter(args);
    case "treasury:budgetVariance":
      return budgetVariance();
    case "treasury:profitAndLoss":
      return profitAndLoss(args);
    case "treasury:restrictedFunds":
      return restrictedFunds();
    case "users:get":
      return byId(users, args?.id) ?? users[0];
    case "volunteers:applications":
      return tables.volunteerApplications;
    case "volunteers:screenings":
      return tables.volunteerScreenings;
    case "volunteers:summary":
      return { active: tables.volunteers.length, pendingApplications: tables.volunteerApplications.length };
  }

  const [moduleName, exportName] = name.split(":");
  if (moduleName === "society" && exportName === "get") return society;
  if (moduleName === "society" && exportName === "list") return [society];
  if (exportName === "list") return scopedRows(tables[moduleName] ?? [], args);
  if (exportName === "get") return byId(tables[moduleName] ?? [], args?.id);
  return [];
}

function mutationResult(name: string, args: StaticArgs) {
  if (name === "seed:run") return SOCIETY_ID;
  if (name === "users:resolveAuthSession") return { userId: USER_OWNER_ID };
  if (name === "paperless:testConnection") {
    return {
      ok: true,
      provider: "demo",
      demo: true,
      baseUrl: "demo://paperless-ngx",
      apiVersion: "demo",
      serverVersion: "demo",
      documentCount: documents.length,
    };
  }
  if (name === "paperless:syncDocument") {
    return {
      taskId: "demo-paperless-task-1002",
      documentId: 1002,
      documentUrl: "demo://paperless/1002",
      demo: true,
      status: "complete",
      tags: ["societyer", "demo"],
    };
  }
  if (name === "waveCache:sync") {
    return {
      snapshotId: WAVE_CACHE_SNAPSHOT_ID,
      businessName: waveCacheSnapshots[0].businessName,
      resourceCounts: JSON.parse(waveCacheSnapshots[0].resourceCountsJson),
      resourceCount: waveCacheResources.length,
      structureCount: waveCacheStructures.length,
      fetchedAtISO: new Date().toISOString(),
    };
  }
  if (name === "waveCache:healthCheck") {
    return {
      provider: "wave",
      mode: "not_configured",
      ok: true,
      status: "pass",
      checkedAtISO: new Date().toISOString(),
      env: [
        { name: "WAVE_ACCESS_TOKEN", required: true, secret: true, purpose: "Wave GraphQL bearer token", present: false },
        { name: "WAVE_BUSINESS_ID", required: true, secret: false, purpose: "Business selected for live sync", present: false },
        { name: "WAVE_CLIENT_ID", required: false, secret: false, purpose: "OAuth connect link client id", present: false },
        { name: "WAVE_GRAPHQL_ENDPOINT", required: false, secret: false, purpose: "GraphQL endpoint override", present: false },
      ],
      business: {
        source: "firstAccessible",
        name: waveCacheSnapshots[0].businessName,
        currencyCode: waveCacheSnapshots[0].currencyCode,
      },
      steps: [
        {
          id: "environment",
          label: "Environment",
          status: "pass",
          message: "Static demo uses fixture Wave data without local secrets.",
        },
        {
          id: "auth",
          label: "Wave auth",
          status: "pass",
          message: "Static demo auth probe resolved against fixture data.",
        },
        {
          id: "accounts",
          label: "Accounts probe",
          status: "pass",
          message: "Fixture accounts are available.",
          detail: { accountCount: waveCacheResources.filter((row) => row.resourceType === "account").length },
        },
      ],
    };
  }
  if (name === "paperless:upsertConnection") return PAPERLESS_CONNECTION_ID;
  if (name === "secrets:revealSecret") {
    return { value: "demo-registry-recovery-key", revealedAtISO: new Date().toISOString() };
  }
  if (name === "subscriptions:beginCheckout") {
    return {
      url: `demo://checkout/${args?.planId ?? "membership"}`,
      demo: true,
    };
  }
  if (name.endsWith(":create") || name.includes(":upsert") || name.includes(":issue")) {
    return args?.id ?? `static_${Date.now()}`;
  }
  return null;
}

export class StaticConvexClient {
  get url() {
    return "static://societyer-demo";
  }

  watchQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    return {
      onUpdate: () => () => undefined,
      localQueryResult: () => queryResult(name, args),
      journal: () => undefined,
    };
  }

  watchPaginatedQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    return {
      onUpdate: () => () => undefined,
      localQueryResult: () => ({
        results: queryResult(name, args) ?? [],
        status: "Exhausted",
        loadMore: () => undefined,
      }),
    };
  }

  query(query: any, args?: StaticArgs) {
    return Promise.resolve(queryResult(functionName(query), args));
  }

  mutation(mutation: any, args?: StaticArgs) {
    return Promise.resolve(mutationResult(functionName(mutation), args));
  }

  action(action: any, args?: StaticArgs) {
    return Promise.resolve(mutationResult(functionName(action), args));
  }

  prewarmQuery() {
    return undefined;
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: false };
  }

  subscribeToConnectionState() {
    return () => undefined;
  }

  setAuth() {
    return undefined;
  }

  clearAuth() {
    return undefined;
  }

  close() {
    return Promise.resolve();
  }

  get logger() {
    return {
      logVerbose: () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
  }
}

export const staticConvex = new StaticConvexClient();
