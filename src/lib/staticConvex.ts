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
const CASH_ACCOUNT_ID = "static_financial_cash";
const GRANT_ACCOUNT_ID = "static_financial_grant";

type StaticArgs = Record<string, any> | undefined;

const society = {
  _id: SOCIETY_ID,
  _creationTime: Date.parse("2025-01-05T12:00:00.000Z"),
  name: "Riverside Community Society",
  incorporationNumber: "S-0076543",
  incorporationDate: "2017-05-12",
  fiscalYearEnd: "2026-03-31",
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
  privacyPolicyDocId: DOCUMENT_POLICY_ID,
  constitutionDocId: "static_document_constitution",
  bylawsDocId: DOCUMENT_BYLAWS_ID,
  demoMode: true,
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
    approvedAt: "2025-07-10",
    discussion: "Members reviewed the annual report, financial statements, and director slate.",
    motions: [
      {
        text: "Approve the 2025 financial statements as presented.",
        movedBy: "Jordan Lee",
        secondedBy: "Mina Patel",
        result: "Carried",
      },
    ],
    decisions: ["Approved annual report filing package."],
    actionItems: [{ text: "File annual report package", owner: "Mina Patel", status: "Done" }],
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
    status: "InProgress",
    dueDate: "2026-05-20",
    ownerUserId: USER_SECRETARY_ID,
    milestones: [
      { title: "Draft agenda", done: true },
      { title: "Publish notice", done: false },
      { title: "Finalize annual report", done: false },
    ],
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
  insurance: [
    {
      _id: "static_insurance",
      societyId: SOCIETY_ID,
      provider: "Community Mutual",
      policyNumber: "CM-2026-331",
      coverageType: "D&O and CGL",
      renewalDate: "2026-08-31",
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

function publicCenter() {
  return {
    society,
    directors: directors.filter((director) => director.status === "Active"),
    publications: tables.transparency.filter((row) => row.status === "Published"),
    documents: documents.filter((document) => document.public),
  };
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
    case "elections:get":
      return electionBundle(args);
    case "elections:listMine":
      return mineElections(args);
    case "elections:listNominations":
      return [];
    case "elections:tally":
      return electionTally(args);
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
    case "publicPortal:volunteerIntakeContext":
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
      return publicCenter();
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
