import Dexie, { type Table } from "dexie";
import { RECORD_TABLE_OBJECTS } from "../../convex/recordTableMetadataDefinitions";
import { BUILT_IN_GRANT_SOURCE_PROFILES, BUILT_IN_GRANT_SOURCES } from "../../shared/grantSourceLibrary";
import { INTEGRATION_CATALOG } from "../../shared/integrationCatalog";
import { STATIC_DEMO_SOCIETY_ID, STATIC_DEMO_USER_ID } from "./staticIds";

const FUNCTION_NAME = Symbol.for("functionName");

const SOCIETY_ID = STATIC_DEMO_SOCIETY_ID;
const USER_OWNER_ID = STATIC_DEMO_USER_ID;
const USER_TREASURER_ID = "static_user_treasurer";
const USER_SECRETARY_ID = "static_user_secretary";
const MEETING_BOARD_ID = "static_meeting_board_q2";
const MEETING_AGM_ID = "static_meeting_agm_2025";
const DOCUMENT_BYLAWS_ID = "static_document_bylaws";
const DOCUMENT_POLICY_ID = "static_document_privacy";
const DOCUMENT_TENANCY_ID = "static_document_tenancy";
const DOCUMENT_PRESENTATION_ID = "static_document_needs_presentation";
const DOCUMENT_UNBC_GENERATED_ID = "static_document_unbc_affiliate";
const DOCUMENT_ANNUAL_REPORT_CONFIRMATION_ID = "static_document_annual_report_confirmation";
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
  jurisdictionCode: "CA-BC",
  isCharity: true,
  isMemberFunded: false,
  registeredOfficeAddress: "400 Granville Street, Vancouver, BC V6C 1T2",
  mailingAddress: "PO Box 2407, Vancouver, BC V6B 3W7",
  purposes: "Community education, neighbourhood resilience, and low-barrier civic programs in British Columbia.",
  privacyOfficerName: "Avery Santos",
  privacyOfficerEmail: "privacy@riverside.example",
  privacyProgramStatus: "Documented",
  privacyProgramReviewedAtISO: "2026-04-21",
  privacyProgramNotes: "Demo privacy program includes a PIPA policy, complaint process, privacy officer contact, and annual training.",
  memberDataAccessStatus: "Partially available",
  memberDataGapDocumented: true,
  memberDataAccessReviewedAtISO: "2026-04-21",
  memberDataAccessNotes: "Demo funding records include aggregate university fee remittances without a member-level remittance list.",
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
  {
    key: "unbc_key_access_request",
    label: "UNBC Key & Access Request",
    description: "Collects key/access request intake, fills the UNBC Facilities PDF, and stages the generated request for review.",
    provider: "n8n",
    steps: ["Launch manually", "Key/access intake form", "Fill key request PDF", "Save generated PDF", "Notify Facilities review"],
    nodePreview: [
      { key: "manual", type: "manual_trigger", label: "Launch manually", status: "ready" },
      { key: "intake", type: "form", label: "Key/access intake form", status: "ready" },
      { key: "fill_pdf", type: "pdf_fill", label: "Fill key request PDF", status: "needs_setup" },
      { key: "save_document", type: "document_create", label: "Save generated PDF", status: "ready" },
      {
        key: "notify",
        type: "email",
        label: "Notify Facilities review",
        status: "needs_setup",
        config: {
          to: "",
          subject: "Completed key/access request - {{intake.first_name}} {{intake.last_name}}",
          body: [
            "Hello,",
            "",
            "Please review the attached completed UNBC key/access request for {{intake.first_name}} {{intake.last_name}}.",
            "",
            "Thanks,",
            "{{currentUser.name}}",
          ].join("\n"),
        },
      },
    ],
    config: {
      pdfTemplateKey: "unbc_key_access_request",
      pdfFields: [
        "Last Name",
        "First Name",
        "Request Date",
        "Department",
        "UNBC ID #",
        "Email",
        "Phone #",
        "Supervisor Name",
        "Supervisor Phone #",
        "Term End Date",
        "Other",
        "Authorizing Authority Name - Print",
        "Building / Room Number",
        "Building / Room Number 2",
        "Building / Room Number 3",
        "Building / Room Number 4",
        "Building / Room Number 5",
        "Checkbox - Other",
        "Checkbox - TA/RA",
        "Checkbox - Student",
        "Checkbox - Faculty",
        "Checkbox - Staff",
      ],
      intakeFields: [
        "Last Name",
        "First Name",
        "Request Date",
        "Department",
        "UNBC ID #",
        "Email",
        "Phone #",
        "Supervisor Name",
        "Supervisor Phone #",
        "Term End Date",
        "Checkbox - Staff",
        "Checkbox - Faculty",
        "Checkbox - Student",
        "Checkbox - TA/RA",
        "Checkbox - Other",
        "Other",
        "Authorizing Authority Name - Print",
        "Building / Room Number",
        "Building / Room Number 2",
        "Building / Room Number 3",
        "Building / Room Number 4",
        "Building / Room Number 5",
        "Account Codes",
        "Fund",
        "Org",
        "Account",
      ],
      documentCategory: "WorkflowGenerated",
      documentTags: ["workflow-generated", "unbc-key-access-request"],
      documentRetentionYears: 10,
      documentTitleTemplate: "UNBC Key Access Request - {{intake.first_name}} {{intake.last_name}}",
      documentChangeNote: "Generated by UNBC Key & Access Request workflow.",
      emailSubject: "Completed key/access request - {{intake.first_name}} {{intake.last_name}}",
      emailBody: [
        "Hello,",
        "",
        "Please review the attached completed UNBC key/access request for {{intake.first_name}} {{intake.last_name}}.",
        "",
        "Thanks,",
        "{{currentUser.name}}",
      ].join("\n"),
      sampleInput: {
        "Last Name": "Requester",
        "First Name": "Sample",
        "Request Date": "2026-04-18",
        Department: "Sample Department",
        "UNBC ID #": "000000000",
        Email: "sample.requester@example.com",
        "Phone #": "250-555-0100",
        "Supervisor Name": "Sample Supervisor",
        "Supervisor Phone #": "250-555-0101",
        "Term End Date": "2026-12-31",
        "Building / Room Number": "Building A / 101",
        "Checkbox - Staff": true,
      },
    },
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

const operatingSubscriptions = [
  {
    _id: "static_operating_subscription_workspace",
    societyId: SOCIETY_ID,
    name: "Google Workspace",
    vendorName: "Google",
    category: "Software",
    amountCents: 4320,
    currency: "CAD",
    interval: "month",
    status: "Active",
    nextRenewalDate: "2026-05-01",
    notes: "Six active seats for staff and board mailboxes.",
    createdAtISO: "2026-04-01T16:00:00.000Z",
    updatedAtISO: "2026-04-01T16:00:00.000Z",
  },
  {
    _id: "static_operating_subscription_paperless",
    societyId: SOCIETY_ID,
    name: "Paperless archive hosting",
    vendorName: "Local hosting provider",
    category: "Records",
    amountCents: 36000,
    currency: "CAD",
    interval: "year",
    status: "Active",
    nextRenewalDate: "2026-10-15",
    notes: "Document archive hosting and backups.",
    createdAtISO: "2026-04-01T16:00:00.000Z",
    updatedAtISO: "2026-04-01T16:00:00.000Z",
  },
  {
    _id: "static_operating_subscription_design",
    societyId: SOCIETY_ID,
    name: "Design tool seats",
    vendorName: "Figma",
    category: "Programs",
    amountCents: 11400,
    currency: "CAD",
    interval: "quarter",
    status: "Planned",
    nextRenewalDate: "2026-07-01",
    notes: "Potential program design workspace.",
    createdAtISO: "2026-04-01T16:00:00.000Z",
    updatedAtISO: "2026-04-01T16:00:00.000Z",
  },
];

const membershipFeePeriods = [
  {
    _id: "static_fee_regular_2022",
    societyId: SOCIETY_ID,
    planId: "static_plan_regular",
    membershipClass: "Regular",
    label: "Regular member",
    priceCents: 2000,
    currency: "CAD",
    interval: "year",
    effectiveFrom: "2022-04-01",
    effectiveTo: "2025-03-31",
    status: "retired",
    notes: "Original annual dues before AGM approval.",
    createdAtISO: "2022-04-01T16:00:00.000Z",
    updatedAtISO: "2025-03-31T23:59:59.000Z",
  },
  {
    _id: "static_fee_regular_2025",
    societyId: SOCIETY_ID,
    planId: "static_plan_regular",
    membershipClass: "Regular",
    label: "Regular member",
    priceCents: 2500,
    currency: "CAD",
    interval: "year",
    effectiveFrom: "2025-04-01",
    status: "active",
    notes: "Current AGM-approved regular member fee.",
    createdAtISO: "2025-04-01T16:00:00.000Z",
    updatedAtISO: "2025-04-01T16:00:00.000Z",
  },
  {
    _id: "static_fee_student_2024",
    societyId: SOCIETY_ID,
    planId: "static_plan_student",
    membershipClass: "Student",
    label: "Student",
    priceCents: 500,
    currency: "CAD",
    interval: "year",
    effectiveFrom: "2024-09-01",
    status: "active",
    notes: "Reduced annual dues for students.",
    createdAtISO: "2024-09-01T16:00:00.000Z",
    updatedAtISO: "2024-09-01T16:00:00.000Z",
  },
  {
    _id: "static_fee_sustainer_2026",
    societyId: SOCIETY_ID,
    planId: "static_plan_sustainer",
    label: "Sustainer",
    priceCents: 1500,
    currency: "CAD",
    interval: "month",
    effectiveFrom: "2026-01-01",
    status: "active",
    notes: "Monthly recurring support tier.",
    createdAtISO: "2026-01-01T16:00:00.000Z",
    updatedAtISO: "2026-01-01T16:00:00.000Z",
  },
];

const fundingSources = [
  {
    _id: "static_funding_harbour",
    societyId: SOCIETY_ID,
    name: "Harbour Foundation",
    sourceType: "Grant funder",
    status: "Active",
    contactName: "Program officer",
    email: "programs@harbour.example",
    expectedAnnualCents: 500000,
    committedCents: 500000,
    receivedToDateCents: 500000,
    currency: "CAD",
    startDate: "2026-04-03",
    restrictedPurpose: "Youth resilience grant",
    notes: "Institutional grant funder tracked for reporting and renewal planning.",
    createdAtISO: "2026-04-03T16:00:00.000Z",
    updatedAtISO: "2026-04-03T16:00:00.000Z",
  },
  {
    _id: "static_funding_member_dues",
    societyId: SOCIETY_ID,
    name: "University student-fee remittance",
    sourceType: "Member dues",
    status: "Active",
    collectionAgentName: "University finance office",
    collectionModel: "third_party",
    memberDisclosureLevel: "aggregate_amount",
    estimatedMemberCount: 120,
    collectionFrequency: "semester",
    collectionScheduleNotes: "Collected for Fall and Winter semesters. Summer semester is excluded unless a special agreement is recorded.",
    nextExpectedCollectionDate: "2026-09-30",
    reconciliationCadence: "term",
    expectedAnnualCents: 300000,
    receivedToDateCents: 125000,
    currency: "CAD",
    startDate: "2025-04-01",
    notes: "Aggregate member-fee revenue collected by the university without a member-level remittance list.",
    createdAtISO: "2025-04-01T16:00:00.000Z",
    updatedAtISO: "2026-04-01T16:05:00.000Z",
  },
];

const fundingSourceEvents = [
  {
    _id: "static_funding_event_harbour_received",
    societyId: SOCIETY_ID,
    sourceId: "static_funding_harbour",
    eventDate: "2026-04-03",
    kind: "Received",
    label: "Grant deposit received",
    amountCents: 500000,
    notes: "Receipt RCS-2026-0012 issued.",
    createdAtISO: "2026-04-03T16:00:00.000Z",
    updatedAtISO: "2026-04-03T16:00:00.000Z",
  },
  {
    _id: "static_funding_event_member_renewal",
    societyId: SOCIETY_ID,
    sourceId: "static_funding_member_dues",
    eventDate: "2026-04-01",
    kind: "Received",
    label: "Spring term fee remittance",
    amountCents: 125000,
    memberCount: 50,
    periodStart: "2026-01-01",
    periodEnd: "2026-04-30",
    attributionStatus: "aggregate",
    createdAtISO: "2026-04-01T16:05:00.000Z",
    updatedAtISO: "2026-04-01T16:05:00.000Z",
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
    remoteUrl: "https://teams.microsoft.com/l/meetup-join/static-demo",
    remoteMeetingId: "RCS-Q2-BOARD",
    remotePasscode: "demo",
    quorumRequired: 4,
    bylawRuleSetId: "static_bylaw_rules",
    quorumRuleVersion: 1,
    quorumRuleEffectiveFromISO: "2025-06-25T00:00:00.000Z",
    quorumSourceLabel: "Bylaw rules v1, effective 2025-06-25",
    quorumComputedAtISO: "2026-04-16T16:00:00.000Z",
    attendeeIds: ["static_director_mina", "static_director_jordan", "static_director_devon"],
    agendaJson: JSON.stringify(["Privacy program review", "Finance committee update", "Grant reporting calendar"]),
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
    bylawRuleSetId: "static_bylaw_rules",
    quorumRuleVersion: 1,
    quorumRuleEffectiveFromISO: "2025-06-25T00:00:00.000Z",
    quorumSourceLabel: "Bylaw rules v1, effective 2025-06-25",
    quorumComputedAtISO: "2025-06-19T18:30:00.000Z",
    attendeeIds: [],
    agendaJson: JSON.stringify(["Annual report", "Financial statements", "Director elections"]),
    status: "Held",
    sourceReviewStatus: "source_reviewed",
    sourceReviewNotes: "Demo source minutes checked against the local record.",
    sourceReviewedAtISO: "2025-07-10T18:00:00.000Z",
    sourceReviewedByUserId: USER_SECRETARY_ID,
    packageReviewStatus: "needs_review",
    packageReviewNotes: "Financial statements still need signature review before the package is ready.",
  },
];

const minutes = [
  {
    _id: "static_minutes_board_q2",
    societyId: SOCIETY_ID,
    meetingId: MEETING_BOARD_ID,
    status: "Draft",
    heldAt: "2026-04-23T19:00:00.000Z",
    chairName: "Devon Clarke",
    secretaryName: "Mina Patel",
    recorderName: "Avery Santos",
    calledToOrderAt: null,
    adjournedAt: null,
    detailedAttendance: [
      { name: "Mina Patel", status: "present", roleTitle: "Secretary", quorumCounted: true },
      { name: "Jordan Lee", status: "present", roleTitle: "Treasurer", quorumCounted: true },
      { name: "Devon Clarke", status: "present", roleTitle: "President", quorumCounted: true },
    ],
    attendees: ["Mina Patel", "Jordan Lee", "Devon Clarke"],
    absent: ["Sam Nguyen"],
    quorumMet: false,
    quorumRequired: 4,
    bylawRuleSetId: "static_bylaw_rules",
    quorumRuleVersion: 1,
    quorumRuleEffectiveFromISO: "2025-06-25T00:00:00.000Z",
    quorumSourceLabel: "Bylaw rules v1, effective 2025-06-25",
    quorumComputedAtISO: "2026-04-23T19:00:00.000Z",
    discussion: "",
    sections: [
      {
        title: "Privacy program review",
        type: "policy",
        presenter: "Avery Santos",
        discussion: "",
        decisions: [],
        actionItems: [],
        depth: 0,
      },
      {
        title: "Finance committee update",
        type: "report",
        presenter: "Jordan Lee",
        discussion: "",
        decisions: [],
        actionItems: [],
        depth: 0,
      },
      {
        title: "Grant reporting calendar",
        type: "report",
        presenter: "Mina Patel",
        discussion: "",
        decisions: [],
        actionItems: [],
        depth: 0,
      },
    ],
    appendices: [],
    motions: [],
    decisions: [],
    actionItems: [],
    nextMeetingAt: null,
    nextMeetingLocation: null,
  },
  {
    _id: "static_minutes_agm",
    societyId: SOCIETY_ID,
    meetingId: MEETING_AGM_ID,
    status: "Approved",
    heldAt: "2025-06-19T18:30:00.000Z",
    approvedAt: "2025-07-10",
    chairName: "Mina Patel",
    secretaryName: "Jordan Lee",
    recorderName: "Avery Santos",
    calledToOrderAt: "2025-06-19T18:32:00.000Z",
    adjournedAt: "2025-06-19T19:46:00.000Z",
    detailedAttendance: [
      { name: "Mina Patel", status: "present", roleTitle: "Chair", quorumCounted: true },
      { name: "Jordan Lee", status: "present", roleTitle: "Secretary", quorumCounted: true },
      { name: "Devon Clarke", status: "present", roleTitle: "Director", quorumCounted: true },
      { name: "Avery Santos", status: "present", roleTitle: "Recorder", quorumCounted: true },
      { name: "Sam Nguyen", status: "regrets", quorumCounted: false },
    ],
    attendees: ["Mina Patel", "Jordan Lee", "Devon Clarke", "Avery Santos"],
    absent: ["Sam Nguyen"],
    quorumMet: true,
    quorumRequired: 20,
    bylawRuleSetId: "static_bylaw_rules",
    quorumRuleVersion: 1,
    quorumRuleEffectiveFromISO: "2025-06-25T00:00:00.000Z",
    quorumSourceLabel: "Bylaw rules v1, effective 2025-06-25",
    quorumComputedAtISO: "2025-06-19T18:30:00.000Z",
    discussion: "Members reviewed the annual report, financial statements, and director slate.",
    sections: [
      {
        title: "Annual report",
        type: "report",
        presenter: "Mina Patel",
        discussion: "Members reviewed the annual report and program highlights.",
        reportSubmitted: true,
      },
      {
        title: "Financial statements",
        type: "report",
        presenter: "Jordan Lee",
        discussion: "The 2025 financial statements were presented and discussed.",
        reportSubmitted: true,
      },
    ],
    appendices: [
      { title: "Annual report package", type: "report", reference: "Source documents" },
      { title: "Director slate", type: "election_roster", reference: "AGM package" },
    ],
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
    nextMeetingAt: "2025-07-10T18:30:00.000Z",
    nextMeetingLocation: "Riverside Community Hall",
    sourceReviewStatus: "source_reviewed",
    sourceReviewNotes: "Demo source minutes checked against the local record.",
    sourceReviewedAtISO: "2025-07-10T18:00:00.000Z",
    sourceReviewedByUserId: USER_SECRETARY_ID,
    agmDetails: {
      financialStatementsPresented: true,
      financialStatementsNotes: "The 2025 financial statements were presented to the members.",
      directorElectionNotes: "The director slate was reviewed and accepted.",
      directorAppointments: [
        { name: "Mina Patel", roleTitle: "Director", term: "2025-2026", consentRecorded: true, elected: true, status: "Confirmed" },
        { name: "Jordan Lee", roleTitle: "Director", term: "2025-2026", consentRecorded: true, elected: true, status: "Confirmed" },
      ],
    },
  },
];

const filings = [
  {
    _id: "static_filing_ar",
    societyId: SOCIETY_ID,
    kind: "AnnualReport",
    title: "2026 BC annual report",
    dueDate: "2026-04-01",
    filedAt: "2026-04-14",
    status: "Filed",
    submissionMethod: "Societies Online",
    submittedByUserId: USER_OWNER_ID,
    confirmationNumber: "BC-AR-2026-0414",
    receiptDocumentId: DOCUMENT_ANNUAL_REPORT_CONFIRMATION_ID,
    evidenceNotes: "Societies Online confirmation receipt retained in the document library.",
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

const commitments = [
  {
    _id: "static_commitment_tenancy_presentation",
    societyId: SOCIETY_ID,
    title: "Annual society needs presentation",
    category: "Facility",
    sourceDocumentId: DOCUMENT_TENANCY_ID,
    sourceLabel: "Tenancy agreement section 6.2",
    sourceExcerpt: "The tenant must present its space, programming, accessibility, and community needs to the landlord once each year before the lease review.",
    counterparty: "Community Hall Association",
    requirement: "Present the society's space, programming, accessibility, and community needs to the landlord once each year.",
    cadence: "Annual",
    nextDueDate: "2026-09-14",
    dueDateBasis: "Annual anniversary of the 2025 AGM presentation, with a 30-day preparation lead before the lease review.",
    noticeLeadDays: 30,
    owner: "Secretary",
    status: "Active",
    reviewStatus: "Verified",
    confidence: 0.92,
    lastCompletedAtISO: "2025-09-14",
    lastCompletionSummary: "Presented at the 2025 AGM and filed the slide deck.",
    notes: "Keep the presentation and meeting minutes linked as evidence before the lease review.",
    createdAtISO: "2026-04-21T18:00:00.000Z",
    updatedAtISO: "2026-04-21T18:00:00.000Z",
  },
  {
    _id: "static_commitment_privacy_review",
    societyId: SOCIETY_ID,
    title: "Annual privacy program review",
    category: "Privacy",
    sourceDocumentId: DOCUMENT_POLICY_ID,
    sourceLabel: "PIPA privacy policy review clause",
    sourceExcerpt: "Privacy practices and officer contact details should be reviewed on a regular cycle and when society operations change.",
    requirement: "Review privacy practices, training status, and contact details annually.",
    cadence: "Annual",
    nextDueDate: "2026-05-12",
    dueDateBasis: "Annual review cadence inferred from the current privacy policy.",
    noticeLeadDays: 14,
    owner: "Privacy officer",
    status: "Watching",
    reviewStatus: "NeedsReview",
    confidence: 0.68,
    uncertaintyNote: "The policy supports regular review, but the annual cadence should be confirmed by the board.",
    lastCompletedAtISO: "2025-05-09",
    lastCompletionSummary: "Policy reviewed and minor contact updates approved.",
    createdAtISO: "2026-04-21T18:15:00.000Z",
    updatedAtISO: "2026-04-21T18:15:00.000Z",
  },
];

const commitmentEvents = [
  {
    _id: "static_commitment_event_presentation_2025",
    societyId: SOCIETY_ID,
    commitmentId: "static_commitment_tenancy_presentation",
    title: "2025 society needs presentation",
    happenedAtISO: "2025-09-14",
    meetingId: MEETING_AGM_ID,
    evidenceDocumentIds: [DOCUMENT_PRESENTATION_ID],
    evidenceStatus: "Verified",
    evidenceNotes: "Slide deck is filed and the AGM minutes include the presentation agenda item.",
    summary: "Board presented tenancy-related programming and accessibility needs at the AGM.",
    createdAtISO: "2025-09-14T21:05:00.000Z",
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
    _id: DOCUMENT_TENANCY_ID,
    societyId: SOCIETY_ID,
    title: "Community hall tenancy agreement",
    kind: "Agreement",
    category: "Agreement",
    status: "Active",
    fileName: "community-hall-tenancy-agreement.pdf",
    mimeType: "application/pdf",
    retentionYears: 10,
    createdAtISO: "2025-03-01T17:00:00.000Z",
    reviewStatus: "approved",
    flaggedForDeletion: false,
    tags: ["agreement", "tenancy", "facility"],
  },
  {
    _id: DOCUMENT_PRESENTATION_ID,
    societyId: SOCIETY_ID,
    meetingId: MEETING_AGM_ID,
    title: "2025 society needs presentation",
    kind: "Presentation",
    category: "Other",
    status: "Filed",
    fileName: "2025-society-needs-presentation.pdf",
    mimeType: "application/pdf",
    retentionYears: 10,
    createdAtISO: "2025-09-14T21:00:00.000Z",
    lastOpenedAtISO: "2026-04-14T18:10:00.000Z",
    reviewStatus: "approved",
    librarySection: "meeting_material",
    flaggedForDeletion: false,
    tags: ["commitment", "tenancy", "AGM-2025"],
  },
  {
    _id: DOCUMENT_ANNUAL_REPORT_CONFIRMATION_ID,
    societyId: SOCIETY_ID,
    title: "2026 annual report filing confirmation",
    kind: "FilingConfirmation",
    category: "Filing",
    status: "Filed",
    fileName: "2026-annual-report-confirmation.pdf",
    mimeType: "application/pdf",
    retentionYears: 10,
    createdAtISO: "2026-04-14T18:09:00.000Z",
    lastOpenedAtISO: "2026-04-14T18:10:00.000Z",
    reviewStatus: "approved",
    librarySection: "governance",
    flaggedForDeletion: false,
    tags: ["annual-report", "filing", "confirmation"],
  },
  {
    _id: DOCUMENT_UNBC_GENERATED_ID,
    societyId: SOCIETY_ID,
    title: "UNBC Affiliate ID Request - Sample Affiliate",
    kind: "WorkflowGenerated",
    category: "WorkflowGenerated",
    status: "Generated",
    fileName: "UNBC Affiliate ID Request - Sample Affiliate.pdf",
    mimeType: "application/pdf",
    retentionYears: 10,
    createdAtISO: "2026-04-18T19:32:00.000Z",
    flaggedForDeletion: false,
    tags: ["workflow-generated", "unbc-affiliate-id", "workflow-run:static_workflow_run_unbc"],
    public: false,
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
    lastOpenedAtISO: "2026-04-15T18:10:00.000Z",
    reviewStatus: "needs_signature",
    librarySection: "finance",
    flaggedForDeletion: false,
    tags: ["finance", "AGM", "public"],
    public: true,
  },
];

const meetingMaterials = [
  {
    _id: "static_material_agm_financials",
    societyId: SOCIETY_ID,
    meetingId: MEETING_AGM_ID,
    documentId: "static_document_financials",
    agendaLabel: "Financial statements",
    label: "FY2025 financial statements",
    order: 1,
    requiredForMeeting: true,
    accessLevel: "members",
    accessGrants: [
      { subjectType: "group", subjectLabel: "Voting members", access: "view" },
      { subjectType: "user", subjectId: USER_TREASURER_ID, subjectLabel: "Jordan Lee", access: "manage" },
    ],
    availabilityStatus: "available",
    syncStatus: "synced",
    expiresAtISO: "2026-06-19",
    createdAtISO: "2026-04-10T19:35:00.000Z",
  },
  {
    _id: "static_material_agm_presentation",
    societyId: SOCIETY_ID,
    meetingId: MEETING_AGM_ID,
    documentId: DOCUMENT_PRESENTATION_ID,
    agendaLabel: "Annual report",
    label: "Society needs presentation",
    order: 2,
    requiredForMeeting: false,
    accessLevel: "members",
    accessGrants: [{ subjectType: "attendee", subjectLabel: "Avery Santos", access: "comment" }],
    availabilityStatus: "available",
    syncStatus: "online",
    createdAtISO: "2025-09-14T21:05:00.000Z",
  },
  {
    _id: "static_material_board_policy",
    societyId: SOCIETY_ID,
    meetingId: MEETING_BOARD_ID,
    documentId: DOCUMENT_POLICY_ID,
    agendaLabel: "Privacy program review",
    label: "PIPA privacy policy",
    order: 1,
    requiredForMeeting: true,
    accessLevel: "board",
    accessGrants: [
      { subjectType: "committee", subjectId: "static_committee_governance", subjectLabel: "Governance committee", access: "comment" },
      { subjectType: "director", subjectId: "static_director_mina", subjectLabel: "Mina Patel", access: "manage" },
    ],
    availabilityStatus: "pending",
    syncStatus: "offline",
    expiresAtISO: "2026-05-15",
    createdAtISO: "2026-04-16T18:00:00.000Z",
  },
];

const documentComments = [
  {
    _id: "static_document_comment_financials",
    societyId: SOCIETY_ID,
    documentId: "static_document_financials",
    pageNumber: 3,
    anchorText: "restricted funds note",
    authorName: "Jordan Lee",
    authorUserId: USER_TREASURER_ID,
    body: "Confirm the restricted-fund note matches the grant register before final sign-off.",
    status: "open",
    createdAtISO: "2026-04-15T18:20:00.000Z",
  },
];

const expenseReports = [
  {
    _id: "static_expense_workshop_supplies",
    societyId: SOCIETY_ID,
    claimantName: "Avery Santos",
    claimantUserId: USER_SECRETARY_ID,
    title: "Workshop supplies reimbursement",
    category: "Supplies",
    amountCents: 8642,
    currency: "CAD",
    incurredAtISO: "2026-04-12",
    submittedAtISO: "2026-04-13",
    status: "Submitted",
    receiptDocumentId: DOCUMENT_PRESENTATION_ID,
    notes: "Supplies for the youth resilience workshop.",
    createdAtISO: "2026-04-13T16:00:00.000Z",
    updatedAtISO: "2026-04-13T16:00:00.000Z",
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
    tags: [],
  },
  {
    _id: "static_task_commitment_presentation",
    societyId: SOCIETY_ID,
    title: "Prepare 2026 society needs presentation",
    description: "Use the tenancy agreement clause, last AGM evidence, and current program/facility needs to prepare the annual landlord presentation.",
    status: "Todo",
    priority: "High",
    dueDate: "2026-08-15",
    assignee: "Secretary",
    documentId: DOCUMENT_TENANCY_ID,
    commitmentId: "static_commitment_tenancy_presentation",
    eventId: "commitment:static_commitment_tenancy_presentation",
    tags: ["commitment", "tenancy", "facility"],
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
    meetingId: MEETING_BOARD_ID,
    documentId: DOCUMENT_POLICY_ID,
    tags: [],
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
      account: 4,
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
  waveResource("static_wave_account_grant_revenue", "account", "cat_grant_revenue", "Grant revenue", "INCOME / INCOME", {
    id: "cat_grant_revenue",
    name: "Grant revenue",
    type: { value: "INCOME", name: "Income" },
    subtype: { value: "INCOME", name: "Income" },
    balanceInBusinessCurrency: "15000.00",
    currency: { code: "CAD" },
  }),
  waveResource("static_wave_account_facilities", "account", "cat_facilities", "Facilities", "EXPENSE / EXPENSE", {
    id: "cat_facilities",
    name: "Facilities",
    type: { value: "EXPENSE", name: "Expense" },
    subtype: { value: "EXPENSE", name: "Expense" },
    balanceInBusinessCurrency: "420.00",
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
    categoryAccountExternalId: "cat_grant_revenue",
    counterparty: "Harbour Foundation",
    counterpartyExternalId: "vendor_harbour",
    counterpartyResourceType: "vendor",
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
    categoryAccountExternalId: "cat_facilities",
    counterparty: "Riverside Hall",
    counterpartyExternalId: "vendor_city",
    counterpartyResourceType: "vendor",
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
  version: 1,
  status: "Active",
  effectiveFromISO: "2025-06-25T00:00:00.000Z",
  sourceBylawDocumentId: DOCUMENT_BYLAWS_ID,
  generalNoticeMinDays: 14,
  generalNoticeMaxDays: 60,
  allowElectronicMeetings: true,
  allowHybridMeetings: true,
  allowElectronicVoting: false,
  allowProxyVoting: true,
  proxyHolderMustBeMember: true,
  proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "fixed",
  quorumValue: 4,
  memberProposalThresholdPct: 5,
  memberProposalMinSignatures: 3,
  memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10,
  annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true,
  requireAgmElections: true,
  ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true,
  inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false,
  inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true,
  ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67,
  unanimousWrittenSpecialResolution: true,
  updatedAtISO: "2026-04-16T16:00:00.000Z",
};

const workflowCatalog = [
  {
    key: "unbc_affiliate_id_request",
    label: "UNBC Affiliate ID Request",
    description: "Collects affiliate intake, hands execution to n8n, fills the UNBC PDF, and saves the generated document.",
    provider: "n8n",
    steps: ["Launch manually", "Affiliate intake form", "Fill UNBC ID PDF", "Save generated PDF", "Notify/request manager review"],
    nodePreview: [
      { key: "manual", type: "manual_trigger", label: "Launch manually", status: "ready" },
      { key: "intake", type: "form", label: "Affiliate intake form", status: "ready" },
      { key: "fill_pdf", type: "pdf_fill", label: "Fill UNBC ID PDF", status: "needs_setup" },
      { key: "save_document", type: "document_create", label: "Save generated PDF", status: "ready" },
      {
        key: "notify",
        type: "email",
        label: "Notify UNBC processing",
        status: "ready",
        config: {
          to: "employmentprocessing@unbc.ca",
          subject: "Completed affiliate status request form - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
          body: [
            "Hello,",
            "",
            "Please see the attached completed UNBC affiliate status request form for {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}.",
            "",
            "The generated PDF is attached for processing.",
            "",
            "Thanks,",
            "{{intake.name_of_requesting_manager}}",
          ].join("\n"),
        },
      },
    ],
    config: {
      pdfTemplateKey: "unbc_affiliate_id",
      emailTo: "employmentprocessing@unbc.ca",
      emailSubject: "Completed affiliate status request form - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
      emailBody: [
        "Hello,",
        "",
        "Please see the attached completed UNBC affiliate status request form for {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}.",
        "",
        "The generated PDF is attached for processing.",
        "",
        "Thanks,",
        "{{intake.name_of_requesting_manager}}",
      ].join("\n"),
      sampleAffiliate: {
        "Legal First Name of Affiliate": "Sample",
        "Legal Middle Name of Affiliate": "A",
        "Legal Last Name of Affiliate": "Affiliate",
        "Current Mailing Address": "3333 University Way, Prince George, BC V2N 4Z9",
        "Emergency Contact(Name and Ph)": "Sample Contact 250 555 0100",
        "UNBC ID #": "000000000",
        "Birthdate of Affiliate (MM/DD/YYYY)": "01/01/1990",
        "Personal email address": "sample.affiliate@example.com",
        "Name of requesting Manager": "Sample Manager",
        "UNBC Department/Organization": "Sample Department",
        "Length of Affiliate status(lf known)": "1 year",
        ManagerPhone: "250-555-0101",
        "Manager Email": "manager@example.com",
        "Authorizing Name (if different from Manager)": "",
        "Date signed": "2026-04-18",
        "Check Box0": true,
        "Check Box1": false,
      },
    },
  },
];

const workflows = [
  {
    _id: "static_workflow_unbc",
    societyId: SOCIETY_ID,
    recipe: "unbc_affiliate_id_request",
    name: "UNBC Affiliate ID Request",
    status: "paused",
    provider: "n8n",
    providerConfig: {
      externalWebhookUrl: "http://127.0.0.1:5678/webhook/societyer/unbc-affiliate-id",
      externalEditUrl: "http://127.0.0.1:5678/workflow",
    },
    nodePreview: workflowCatalog[0].nodePreview,
    trigger: { kind: "manual" },
    config: workflowCatalog[0].config,
  },
];

const workflowRuns: any[] = [];

const aiAgentDefinitions = [
  {
    key: "compliance_analyst",
    name: "Compliance analyst",
    summary: "Reviews governance posture against BC society obligations and produces a bounded issue list.",
    scope: "Compliance review only. May inspect workspace records and suggest next steps; cannot file, approve, or change records.",
    modelId: "auto:societyer-smart",
    skillNames: ["compliance-review", "data-table-access"],
    allowedActions: ["summarize_gaps", "prioritize_findings", "cite_workspace_evidence", "recommend_tasks"],
    allowedTools: ["find_society_profile", "find_directors", "find_meetings", "find_filings", "find_policies", "find_activity", "draft_task"],
    requiredInputHints: ["Review period or event", "Compliance concern or obligation", "Records to include"],
  },
  {
    key: "minute_drafter",
    name: "Meeting minutes copilot",
    summary: "Drafts agendas, revises draft minutes, and turns uploaded content or spoken notes into structured minutes.",
    scope: "Meeting drafting support only. May draft agenda or minutes content for secretary review; cannot approve minutes, record final decisions, or overwrite source evidence.",
    modelId: "auto:societyer-smart",
    skillNames: ["meeting-minutes", "data-table-access"],
    allowedActions: ["draft_agenda", "revise_draft_minutes", "draft_minutes", "extract_motions", "extract_action_items", "flag_quorum_gaps", "flag_source_gaps"],
    allowedTools: ["find_meetings", "find_minutes", "find_documents", "find_members", "find_directors", "app_extract_minutes_action_items", "draft_task"],
    requiredInputHints: ["Meeting date or title", "Uploaded content, transcript, rough notes, or spoken instructions", "Agenda/minutes style", "Known chair, secretary, attendance, quorum, or approval constraints"],
    workflowModes: [
      "Agenda from upload or spoken instructions",
      "Edit existing draft minutes without changing approval status",
      "Generate structured minutes from prompt, transcript, agenda, and meeting metadata",
    ],
    outputContract: [
      "agendaItems: ordered strings suitable for meeting.agendaJson",
      "sections: title/type/presenter/discussion/decisions/actionItems records suitable for minutes.sections",
      "motions: text/movedBy/secondedBy/outcome/vote fields suitable for minutes.motions",
      "decisions and actionItems: top-level arrays for summary export",
      "reviewGaps: quorum, attendance, source, approval, or ambiguous-speaker items requiring human confirmation",
    ],
  },
  {
    key: "filing_assistant",
    name: "Filing assistant",
    summary: "Plans registry filing packets and preflight checks without submitting anything externally.",
    scope: "Filing preparation only. May assemble filing data and checklist; cannot submit, sign, or represent completion.",
    modelId: "auto:societyer-fast",
    skillNames: ["registry-filings", "workflow-building"],
    allowedActions: ["preflight_filing", "prepare_packet_outline", "identify_missing_fields", "draft_operator_checklist"],
    allowedTools: ["find_society_profile", "find_directors", "find_filings", "find_documents", "find_activity", "app_prepare_filing_packet", "draft_task"],
    requiredInputHints: ["Filing type", "Effective date or filing period", "Known changed information"],
  },
  {
    key: "policy_reviewer",
    name: "Policy reviewer",
    summary: "Reviews internal policies for stale dates, missing owners, and implementation evidence.",
    scope: "Policy review only. May comment and recommend revisions; cannot adopt policies or alter approved text.",
    modelId: "auto:societyer-fast",
    skillNames: ["policy-review", "data-table-access"],
    allowedActions: ["review_policy", "compare_to_template", "flag_review_dates", "suggest_revision_notes"],
    allowedTools: ["find_policies", "find_documents", "find_activity", "find_tasks", "draft_task"],
    requiredInputHints: ["Policy name or area", "Review reason", "Applicable template or requirement"],
  },
  {
    key: "grant_reporting_assistant",
    name: "Grant reporting assistant",
    summary: "Plans grant report evidence, restricted-fund summaries, and missing deliverables.",
    scope: "Grant reporting support only. May summarize evidence and draft report structure; cannot certify, submit, or alter financials.",
    modelId: "auto:societyer-smart",
    skillNames: ["grant-reporting", "data-table-access"],
    allowedActions: ["summarize_grant_progress", "map_evidence", "flag_restricted_fund_gaps", "draft_report_outline"],
    allowedTools: ["find_grants", "find_financials", "find_documents", "find_tasks", "find_activity", "draft_task"],
    requiredInputHints: ["Grant or funder name", "Reporting period", "Deliverables or budget categories"],
  },
];

const aiSkills: any[] = [
  { name: "compliance-review", label: "Compliance Review", description: "Review governance records, missing evidence, filings, and board obligations.", isCustom: false },
  { name: "meeting-minutes", label: "Meeting Minutes", description: "Draft agendas and minutes from meetings, transcripts, documents, and prompts.", isCustom: false },
  { name: "registry-filings", label: "Registry Filings", description: "Prepare filing packets and preflight checklists without submitting externally.", isCustom: false },
  { name: "policy-review", label: "Policy Review", description: "Review policies for stale dates, missing owners, and implementation evidence.", isCustom: false },
  { name: "grant-reporting", label: "Grant Reporting", description: "Map grant deliverables, financial evidence, and missing report materials.", isCustom: false },
  { name: "workflow-building", label: "Workflow Building", description: "Plan workflow runs and workflow package handoffs.", isCustom: false },
  { name: "data-table-access", label: "Data Table Access", description: "Use Societyer record tables safely through permissioned read tools.", isCustom: false },
];

const aiToolCatalog = [
  ["DATABASE_CRUD", ["find_society_profile", "find_members", "find_directors", "find_meetings", "find_minutes", "find_filings", "find_documents", "find_policies", "find_tasks", "find_grants", "find_financials", "find_activity"]],
  ["ACTION", ["draft_task", "navigate_app"]],
  ["WORKFLOW", ["list_workflows"]],
  ["METADATA", ["list_object_metadata"]],
  ["VIEW", ["list_views"]],
  ["DASHBOARD", ["summarize_dashboard"]],
  ["LOGIC_FUNCTION", ["app_prepare_filing_packet", "app_extract_minutes_action_items"]],
].flatMap(([category, names]) =>
  (names as string[]).map((name) => ({
    name,
    label: name.replace(/^app_/, "").replace(/_/g, " "),
    category,
    description: `Permissioned ${String(category).toLowerCase()} tool for ${name}.`,
  })),
);

const aiAgentRuns: any[] = [];
const aiAgentAuditEvents: any[] = [];
const aiChatThreads: any[] = [];
const aiMessages: any[] = [];
const aiToolDrafts: any[] = [];
const aiProviderSettings: any[] = [];

const motionBacklog = [
  {
    _id: "static_motion_backlog_pipa_policy",
    societyId: SOCIETY_ID,
    title: "Adopt PIPA privacy policy and complaint process",
    motionText:
      "BE IT RESOLVED THAT the Society adopt the PIPA privacy policy, privacy practices, access and correction process, complaint process, safeguards, and retention approach presented to the meeting, effective [date], and authorize the privacy officer to maintain the working copy and evidence record.",
    category: "privacy",
    status: "Backlog",
    priority: "high",
    source: "pipa-setup",
    seededKey: "pipa-adopt-privacy-policy",
    notes: "Use after the draft policy has been reviewed and is ready for approval.",
    createdAtISO: "2026-04-21T18:00:00.000Z",
    updatedAtISO: "2026-04-21T18:00:00.000Z",
  },
  {
    _id: "static_motion_backlog_pipa_data_gap",
    societyId: SOCIETY_ID,
    title: "Approve member-data access gap memo",
    motionText:
      "BE IT RESOLVED THAT the Society approve the member-data access gap memo presented to the meeting, recording which member or eligibility records are controlled by the Society, which records are held by the university or other institution, and how privacy and records requests will be handled.",
    category: "privacy",
    status: "Backlog",
    priority: "normal",
    source: "pipa-setup",
    seededKey: "pipa-member-data-gap-memo",
    notes: "Useful where an institution does not share the full member list.",
    createdAtISO: "2026-04-21T18:00:00.000Z",
    updatedAtISO: "2026-04-21T18:00:00.000Z",
  },
];

const tables: Record<string, any[]> = {
  activity: [
    {
      _id: "static_activity_1",
      societyId: SOCIETY_ID,
      actor: "Mina Patel",
      entityType: "filing",
      entityId: "static_filing_ar",
      action: "filed",
      summary: "Filed the annual report and attached the Societies Online confirmation.",
      createdAtISO: "2026-04-14T18:12:00.000Z",
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
  workflows,
  workflowRuns,
  aiAgentRuns,
  aiAgentAuditEvents,
  aiChatThreads,
  aiMessages,
  aiToolDrafts,
  aiProviderSettings,
  motionBacklog,
  pendingEmails: [
    {
      _id: "static_pending_email_unbc",
      societyId: SOCIETY_ID,
      workflowId: "static_workflow_unbc",
      workflowRunId: "static_workflow_run_unbc",
      nodeKey: "notify",
      to: "employmentprocessing@unbc.ca",
      subject: "Completed affiliate status request form - Sample Affiliate",
      body: [
        "Hello,",
        "",
        "Please see the attached completed UNBC affiliate status request form for Sample Affiliate.",
        "",
        "The generated PDF is attached for processing.",
        "",
        "Thanks,",
        "Sample Manager",
      ].join("\n"),
      attachments: [
        {
          documentId: DOCUMENT_UNBC_GENERATED_ID,
          fileName: "UNBC Affiliate ID Request - Sample Affiliate.pdf",
        },
      ],
      status: "ready",
      createdAtISO: "2026-04-18T19:32:00.000Z",
      notes: "Queued by workflow UNBC Affiliate ID Request · node notify",
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
  commitments,
  commitmentEvents,
  courtOrders: [],
  deadlines,
  directors,
  documents,
  documentComments,
  documentVersions: [],
  expenseReports,
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
  orgChartAssignments: [],
  filings,
  financials,
  operatingSubscriptions,
  waveCacheSnapshots,
  waveCacheResources,
  waveCacheStructures,
  goals,
  grants: [
    {
      _id: "static_grant",
      societyId: SOCIETY_ID,
      title: "Youth resilience grant",
      funder: "Harbour Foundation",
      funderName: "Harbour Foundation",
      program: "Neighbourhood Youth Resilience Fund",
      status: "Active",
      amountRequestedCents: 1500000,
      amountAwardedCents: 1500000,
      linkedFinancialAccountId: GRANT_ACCOUNT_ID,
      allowPublicApplications: true,
      confirmationCode: "HF-2026-0412",
      opportunityType: "Foundation",
      priority: "High",
      fitScore: 80,
      nextAction: "Submit Q1 outcomes report",
      sourcePath: "demo://grant-packet/youth-resilience",
      sourceImportedAtISO: "2026-04-12",
      sourceFileCount: 6,
      sourceNotes: "Demo dossier data. Review sensitive contact details before public use.",
      keyFacts: [
        "Awarded $15,000",
        "Q1 outcomes report due 2026-05-15",
        "Restricted to youth resilience programming",
      ],
      useOfFunds: [
        { label: "Honoraria", amountCents: 600000, notes: "Youth peer facilitators and guest speakers." },
        { label: "Program materials", amountCents: 350000, notes: "Workshop supplies and outreach materials." },
        { label: "Digital access", amountCents: 250000, notes: "Accessibility tools and online resource hosting." },
        { label: "Operations support", amountCents: 300000, notes: "Coordination and reporting support." },
      ],
      timelineEvents: [
        { label: "Award letter received", date: "2026-04-12", status: "Attached" },
        { label: "Q1 outcomes report due", date: "2026-05-15", status: "Due" },
        { label: "Final reconciliation due", date: "2026-09-30", status: "Scheduled" },
      ],
      complianceFlags: [
        { label: "Confirmation saved", status: "Attached" },
        { label: "Board approval evidence linked", status: "Ready" },
        { label: "Post-award report scheduled", status: "Ready" },
      ],
      contacts: [
        { role: "Primary contact", name: "Mina Patel", organization: "Riverside Community Society" },
        { role: "Finance signatory", name: "Jordan Lee", organization: "Riverside Community Society" },
      ],
      answerLibrary: [
        {
          section: "Program description",
          title: "Youth resilience workshops",
          body: "Riverside runs low-barrier youth workshops focused on civic skills, peer support, practical resilience planning, and community storytelling.",
        },
        {
          section: "Community benefit",
          title: "Neighbourhood participation",
          body: "The program helps young residents build practical skills, connect with trusted local mentors, and contribute to public community resources.",
        },
      ],
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
  grantSources: [
    {
      _id: "static_grant_source_cihr_researchnet",
      societyId: SOCIETY_ID,
      libraryKey: "cihr-researchnet",
      name: "CIHR ResearchNet current funding opportunities",
      url: "https://www.researchnet-recherchenet.ca/rnetsso/ssologin?language=en",
      sourceType: "government_portal",
      jurisdiction: "Canada",
      funderType: "government",
      eligibilityTags: ["research", "health-research", "canada", "institutional-applicants"],
      topicTags: ["cihr", "researchnet", "health", "grants"],
      scrapeCadence: "weekly",
      trustLevel: "official",
      status: "active",
      notes: "Official CIHR ResearchNet source profile for public funding opportunities.",
      createdAtISO: "2026-05-10T00:00:00.000Z",
      updatedAtISO: "2026-05-10T00:00:00.000Z",
    },
  ],
  grantSourceProfiles: [
    {
      _id: "static_grant_source_profile_cihr_researchnet",
      societyId: SOCIETY_ID,
      sourceId: "static_grant_source_cihr_researchnet",
      libraryKey: "cihr-researchnet",
      profileKind: "html_selectors",
      listSelector: "section, main, body",
      itemSelector: "a[href*='Opportunity']",
      detailUrlPattern: "/rnr16/vwOpprtntyDtls.do?prog={programId}&view=currentOpps&org=CIHR&type=EXACT&resultCount=25&sort=program&all=1&masterList=true&language=E",
      fieldMappings: {
        title: "linkText",
        funder: "constant:Canadian Institutes of Health Research",
        program: "linkTextPrefixBeforeColon",
        registrationDeadline: "followingText:Registration/LOI Deadline",
        applicationDeadline: "followingText:Application Deadline",
        applicationUrl: "href",
        description: "nearestRowText",
      },
      detailFieldMappings: {
        fundingOrganization: "labelAfterText:Funding Organization",
        programName: "labelAfterText:Program Name",
        alternateTitle: "textAfterProgramNameParentheses",
        sponsors: "labelAfterText:Sponsor(s)",
        programLaunchDate: "labelAfterText:Program Launch Date",
        competitions: "importantDatesRow:Competition",
        registrationDeadline: "importantDatesRow:Registration Deadline|LOI Deadline",
        applicationDeadline: "importantDatesRow:Application Deadline",
        anticipatedNoticeOfDecision: "importantDatesRow:Anticipated Notice of Decision",
        fundingStartDate: "importantDatesRow:Funding Start Date",
        notices: "sectionText:Notices",
        description: "sectionText:Description",
        objectives: "sectionText:Objectives",
        eligibility: "sectionText:Eligibility",
        guidelines: "sectionText:Guidelines",
        reviewProcess: "sectionText:Review Process and Evaluation",
        howToApply: "sectionText:How to Apply",
        contactInformation: "sectionText:Contact Information",
        sponsorDescription: "sectionText:Sponsor Description",
        additionalInformation: "sectionText:Additional Information",
        fundsAvailable: "subsectionText:Funds Available",
        dateModified: "labelAfterText:Date Modified",
      },
      dateFormat: "YYYY-MM-DD",
      currency: "CAD",
      pagination: { mode: "none" },
      requiresAuth: false,
      connectorId: "researchnet",
      notes: "Public-page extraction profile for CIHR ResearchNet opportunity listings.",
      createdAtISO: "2026-05-10T00:00:00.000Z",
      updatedAtISO: "2026-05-10T00:00:00.000Z",
    },
  ],
  grantOpportunityCandidates: [],
  inspections: [],
  meetingMaterials,
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
  bylawRuleSets: [bylawRules],
  insurance: [
    {
      _id: "static_insurance",
      societyId: SOCIETY_ID,
      kind: "DirectorsOfficers",
      insurer: "Community Mutual",
      broker: "Harbour Risk Advisors",
      policyNumber: "CM-2026-331",
      policySeriesKey: "dno|community-mutual|harbour-risk-advisors|management-liability",
      policyTermLabel: "2026",
      versionType: "renewal",
      coverageCents: 200000000,
      premiumCents: 185000,
      deductibleCents: 100000,
      coverageSummary: "Directors and officers liability coverage.",
      coveredParties: [
        { name: "Board of directors", partyType: "covered class", coveredClass: "directors" },
        { name: "Officers", partyType: "covered class", coveredClass: "officers" },
      ],
      coverageItems: [
        { label: "Directors and officers liability", coverageType: "D&O liability", coveredClass: "directors_officers", limitCents: 200000000, deductibleCents: 100000 },
      ],
      policyDefinitions: [
        { term: "Claims-made", definition: "Demo D&O policy record; verify actual reporting terms against source documents.", sourceExternalIds: ["demo:insurance-dno-2026"] },
      ],
      declinedCoverages: [],
      certificatesOfInsurance: [
        {
          holderName: "University venue",
          additionalInsuredLegalName: "University venue and its governors, employees, and agents",
          eventName: "Demo room booking",
          eventDate: "2026-04-22",
          requiredLimitCents: 200000000,
          status: "Needs review",
          sourceExternalIds: ["demo:insurance-dno-2026"],
        },
      ],
      insuranceRequirements: [
        {
          context: "Recognized student society room booking",
          requirementType: "event_or_facility",
          coverageSource: "Needs review",
          cglLimitRequiredCents: 200000000,
          additionalInsuredRequired: true,
          coiStatus: "Needs review",
          riskTriggers: ["room_booking"],
          sourceExternalIds: ["demo:insurance-dno-2026"],
          notes: "Demo requirement based on public campus room-booking research; verify against actual booking.",
        },
      ],
      claimsMadeTerms: {
        reportingDeadline: "2026-08-31",
        defenseCostsInsideLimit: true,
        retentionCents: 100000,
        territory: "Worldwide",
        claimsNoticeContact: "Broker or insurer claims contact",
        sourceExternalIds: ["demo:insurance-dno-2026"],
        notes: "Demo terms only; verify actual D&O wording.",
      },
      annualReviews: [
        {
          reviewDate: "2026-03-18",
          boardMeetingDate: "2026-03-18",
          reviewer: "Treasurer",
          outcome: "Needs renewal comparison",
          nextReviewDate: "2026-07-31",
          sourceExternalIds: ["demo:insurance-dno-2026"],
        },
      ],
      complianceChecks: [
        {
          label: "Board insurance review before renewal",
          status: "Needs review",
          dueDate: "2026-07-31",
          sourceExternalIds: ["demo:insurance-dno-2026"],
        },
        {
          label: "Confirm WorkSafeBC coverage or exemption if workers are hired",
          status: "Needs review",
          dueDate: "2026-07-31",
          sourceExternalIds: ["demo:insurance-dno-2026"],
        },
      ],
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
  assets: [
    {
      _id: "static_asset_projector",
      societyId: SOCIETY_ID,
      assetTag: "AST-0001",
      name: "Epson community projector",
      category: "Program equipment",
      serialNumber: "EP-DEMO-4421",
      supplier: "Harbour Office Supply",
      purchaseDate: "2025-09-12",
      purchaseValueCents: 92000,
      currency: "CAD",
      fundingSource: "Neighbourhood resilience grant",
      grantRestrictions: "Must be used for public workshops until 2028-03-31.",
      retentionUntil: "2028-03-31",
      disposalRules: "Board approval required before sale, donation, or disposal.",
      location: "Records office equipment cabinet",
      condition: "Good",
      status: "Available",
      custodianType: "location",
      custodianName: "Records office",
      responsiblePersonName: "Jordan Lee",
      insurancePolicyId: "static_insurance",
      insuranceNotes: "Covered under property/casualty schedule subject to deductible.",
      capitalized: false,
      bookValueCents: 69000,
      sourceDocumentIds: ["static_document_financials"],
      warrantyExpiresAt: "2027-09-12",
      nextMaintenanceDate: "2026-06-15",
      nextVerificationDate: "2026-08-31",
      disposalDocumentIds: [],
      notes: "Demo asset used for workshop room bookings.",
      createdAtISO: "2025-09-12T18:00:00.000Z",
      updatedAtISO: "2026-05-01T18:00:00.000Z",
    },
    {
      _id: "static_asset_laptop",
      societyId: SOCIETY_ID,
      assetTag: "AST-0002",
      name: "Treasurer laptop",
      category: "IT",
      serialNumber: "MBP-DEMO-2026",
      supplier: "Apple Canada",
      purchaseDate: "2026-01-20",
      purchaseValueCents: 210000,
      currency: "CAD",
      fundingSource: "Operating reserve",
      location: "With treasurer",
      condition: "Good",
      status: "Checked out",
      custodianType: "director",
      custodianName: "Jordan Lee",
      responsiblePersonName: "Jordan Lee",
      expectedReturnDate: "2026-06-30",
      insurancePolicyId: "static_insurance",
      capitalized: true,
      depreciationMethod: "Straight line",
      usefulLifeMonths: 36,
      bookValueCents: 198333,
      sourceDocumentIds: ["static_document_financials"],
      warrantyExpiresAt: "2027-01-20",
      nextMaintenanceDate: "2026-07-15",
      nextVerificationDate: "2026-08-31",
      disposalDocumentIds: [],
      notes: "Used for finance, Wave sync review, and board packages.",
      createdAtISO: "2026-01-20T18:00:00.000Z",
      updatedAtISO: "2026-05-01T18:00:00.000Z",
    },
  ],
  assetEvents: [
    {
      _id: "static_asset_event_projector_intake",
      societyId: SOCIETY_ID,
      assetId: "static_asset_projector",
      eventType: "intake",
      happenedAtISO: "2025-09-12T18:00:00.000Z",
      actorName: "Jordan Lee",
      toCustodianType: "location",
      toCustodianName: "Records office",
      responsiblePersonName: "Jordan Lee",
      location: "Records office equipment cabinet",
      condition: "Good",
      documentIds: ["static_document_financials"],
      notes: "Imported from grant purchase record.",
      createdAtISO: "2025-09-12T18:00:00.000Z",
    },
    {
      _id: "static_asset_event_laptop_checkout",
      societyId: SOCIETY_ID,
      assetId: "static_asset_laptop",
      eventType: "checkout",
      happenedAtISO: "2026-01-20T18:30:00.000Z",
      actorName: "Mina Patel",
      toCustodianType: "director",
      toCustodianName: "Jordan Lee",
      responsiblePersonName: "Jordan Lee",
      location: "With treasurer",
      condition: "Good",
      expectedReturnDate: "2026-06-30",
      documentIds: [],
      notes: "Treasurer accepted custody for board finance work.",
      createdAtISO: "2026-01-20T18:30:00.000Z",
    },
  ],
  assetMaintenance: [
    {
      _id: "static_asset_maintenance_projector",
      societyId: SOCIETY_ID,
      assetId: "static_asset_projector",
      title: "Projector lamp and cable check",
      kind: "maintenance",
      dueDate: "2026-06-15",
      status: "Scheduled",
      notes: "Check before summer workshop series.",
      createdAtISO: "2026-05-01T18:00:00.000Z",
      updatedAtISO: "2026-05-01T18:00:00.000Z",
    },
  ],
  assetVerificationRuns: [],
  assetVerificationItems: [],
  meetings,
  memberProposals: [],
  memberSubscriptions,
  membershipFeePeriods,
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
  fundingSources,
  fundingSourceEvents,
  tasks,
  transparency: [
    {
      _id: "static_publication_annual_report",
      societyId: SOCIETY_ID,
      title: "2026 annual report filing confirmation",
      category: "AnnualReport",
      status: "Published",
      reviewStatus: "Approved",
      documentId: DOCUMENT_ANNUAL_REPORT_CONFIRMATION_ID,
      publishedAtISO: "2026-04-14",
      summary: "Filed annual report confirmation retained for public transparency.",
      featured: true,
    },
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

const staticRecordTableDefinitions = new Map(
  RECORD_TABLE_OBJECTS.map((definition) => [definition.nameSingular, definition]),
);

function staticRecordTableSetup(args: StaticArgs) {
  const nameSingular = String(args?.nameSingular ?? "");
  const definition = staticRecordTableDefinitions.get(nameSingular);
  if (!definition) return { object: null, views: [], activeView: null };

  const objectMetadataId = `static_object_${nameSingular}`;
  const viewId = `static_view_${nameSingular}_all`;
  const now = "2026-04-16T16:00:00.000Z";
  const fields = definition.fields.map((field, position) => ({
    _id: `static_field_${nameSingular}_${field.name}`,
    societyId: args?.societyId ?? SOCIETY_ID,
    objectMetadataId,
    name: field.name,
    label: field.label,
    description: field.description,
    icon: field.icon,
    fieldType: field.fieldType,
    configJson: field.config ? JSON.stringify(field.config) : undefined,
    isSystem: field.isSystem ?? false,
    isHidden: field.isHidden ?? false,
    isNullable: true,
    isReadOnly: field.isReadOnly ?? false,
    position,
    createdAtISO: now,
    updatedAtISO: now,
  }));
  const view = {
    _id: viewId,
    societyId: args?.societyId ?? SOCIETY_ID,
    objectMetadataId,
    name: definition.defaultView.name,
    type: "table",
    icon: definition.icon,
    filtersJson: "[]",
    sortsJson: "[]",
    density: "compact",
    isShared: true,
    isSystem: true,
    position: 0,
    createdAtISO: now,
    updatedAtISO: now,
  };
  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const columns = definition.defaultView.columns
    .map((column, position) => {
      const field = fieldsByName.get(column.fieldName);
      if (!field) return null;
      return {
        viewField: {
          _id: `static_view_field_${nameSingular}_${column.fieldName}`,
          societyId: args?.societyId ?? SOCIETY_ID,
          viewId,
          fieldMetadataId: field._id,
          position,
          size: column.size ?? 160,
          isVisible: true,
          aggregateOperation: null,
          createdAtISO: now,
          updatedAtISO: now,
        },
        field,
      };
    })
    .filter((column): column is { viewField: any; field: any } => column !== null);

  return {
    object: {
      _id: objectMetadataId,
      societyId: args?.societyId ?? SOCIETY_ID,
      nameSingular,
      namePlural: definition.namePlural,
      labelSingular: definition.labelSingular,
      labelPlural: definition.labelPlural,
      icon: definition.icon,
      iconColor: definition.iconColor,
      labelIdentifierFieldName: definition.labelIdentifierFieldName,
      isSystem: true,
      isActive: true,
      routePath: definition.routePath,
      createdAtISO: now,
      updatedAtISO: now,
      fields,
    },
    views: [
      {
        _id: view._id,
        name: view.name,
        position: view.position,
        isSystem: view.isSystem,
      },
    ],
    activeView: { view, columns },
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

function staticCounterpartyStats(externalId?: string) {
  if (!externalId) return {};
  const rows = financialTransactions.filter((row) => row.counterpartyExternalId === externalId);
  if (rows.length === 0) return {};
  return {
    linkedTransactionCount: rows.length,
    linkedTransactionTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

function staticCategoryAccountStats(externalId?: string, label?: string) {
  if (!externalId && !label) return {};
  const normalizedLabel = normalizeStaticCategoryLabel(label);
  const rows = financialTransactions.filter((row) => {
    if (externalId && row.categoryAccountExternalId === externalId) return true;
    return Boolean(normalizedLabel && normalizeStaticCategoryLabel(row.category) === normalizedLabel);
  });
  if (rows.length === 0) return {};
  return {
    linkedCategoryTransactionCount: rows.length,
    linkedCategoryTransactionTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}

function normalizeStaticCategoryLabel(value?: string) {
  return String(value ?? "").trim().toLowerCase();
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
    overdueFilings: overdueFilings.slice(0, 12),
    goals: goals
      .filter((goal) => goal.status !== "Completed")
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
      .slice(0, 4),
    openTasks: tasks
      .filter((task) => task.status !== "Done")
      .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31"))
      .slice(0, 6),
    complianceFlags: [
      {
        ruleId: "BC-SOC-DIRECTORS-MIN",
        level: "ok",
        text: "At least three active directors are on record.",
        citationId: "BC-SOC-DIRECTORS-MIN",
        evidenceRequired: ["Active director register"],
        remediationActions: [{ id: "open-directors", label: "Review directors", intent: "navigate", to: "/app/directors" }],
      },
      {
        ruleId: "BC-SOC-DIRECTORS-BC-RESIDENT",
        level: "ok",
        text: "At least one BC-resident director is on record for this non-member-funded society.",
        citationId: "BC-SOC-DIRECTORS-BC-RESIDENT",
        evidenceRequired: ["Active director register", "Director residency field"],
        remediationActions: [{ id: "open-directors", label: "Review directors", intent: "navigate", to: "/app/directors" }],
      },
      {
        ruleId: "BC-SOC-DIRECTOR-CONSENT",
        level: "warn",
        text: "1 director is missing consent evidence.",
        citationId: "BC-SOC-DIRECTOR-CONSENT",
        evidenceRequired: ["Active director register", "Written consent evidence"],
        remediationActions: [
          { id: "open-directors", label: "Update consent", intent: "navigate", to: "/app/directors" },
          { id: "upload-evidence", label: "Upload evidence", intent: "navigate", to: "/app/documents" },
          { id: "assign-review", label: "Assign review", intent: "createComplianceReviewTask" },
        ],
      },
      {
        ruleId: "BC-SOC-ANNUAL-REPORT-FILED",
        level: "ok",
        text: "Annual report is filed with confirmation evidence.",
        citationId: "BC-SOC-AGM",
        evidenceRequired: ["Filing record", "Filed date", "Confirmation document", "Audit log"],
        remediationActions: [{ id: "open-filings", label: "Review filing", intent: "navigate", to: "/app/filings" }],
      },
    ],
    evidenceChains: [
      {
        id: "static_filing_ar",
        title: "Annual report proof chain",
        status: "verified",
        summary: "Every link needed to explain why this is complete is present.",
        actionHref: "/app/filings",
        nodes: [
          { label: "Compliance result", value: "Annual report complete", status: "verified" },
          { label: "Filing record", value: "2026 BC annual report", status: "verified", href: "/app/filings" },
          { label: "Filing date", value: "2026-04-14", status: "verified" },
          { label: "Confirmation / evidence", value: "Confirmation BC-AR-2026-0414", status: "verified", href: "/app/documents" },
          { label: "Responsible person", value: "Mina Patel", status: "verified" },
          { label: "Audit log", value: "Mina Patel filed 2026-04-14", status: "verified", href: "/app/audit" },
        ],
      },
    ],
  };
}

function annualCycleSummary(args: StaticArgs) {
  const cycleYear = Number(args?.year ?? new Date().getFullYear());
  const today = "2026-05-10";
  const activeMembers = members.filter((member) => member.status === "Active");
  const votingMembers = activeMembers.filter((member) => member.votingRights);
  const activeDirectors = directors.filter((director: any) => director.status === "Active" && !director.resignedAt);
  const agm = meetings.find((meeting) => meeting.type === "AGM" && inStaticYear(meeting.scheduledAt, cycleYear)) ?? null;
  const agmMinutes = agm ? minutes.find((row) => row.meetingId === agm._id) ?? null : null;
  const annualReport = filings.find((filing) => filing.kind === "AnnualReport" && filingMatchesStaticYear(filing, cycleYear)) ?? null;
  const financial = financials.find((row) => inStaticYear(row.periodEnd, cycleYear) || String(row.fiscalYear).includes(String(cycleYear))) ?? null;
  const annualReportDueDate = agm ? addStaticDays(dateOnlyStatic(agm.scheduledAt), bylawRules.annualReportDueDaysAfterMeeting) : annualReport?.dueDate;
  const noticeWindowClose = agm ? addStaticDays(dateOnlyStatic(agm.scheduledAt), -bylawRules.generalNoticeMinDays) : undefined;
  const officialRecordEvidenceCount = [
    society.constitutionDocId,
    society.bylawsDocId,
    (financial as any)?.statementsDocId,
    annualReport?.receiptDocumentId,
    ...(((agmMinutes as any)?.sourceDocumentIds ?? []) as string[]),
  ].filter(Boolean).length;

  const items = [
    cycleItem("agm-scheduled", "before", "Schedule the AGM", agm ? `${agm.title} is on ${dateOnlyStatic(agm.scheduledAt)}.` : "No AGM is scheduled for this cycle year.", agm ? "complete" : "attention", ["AGM meeting record", "Active bylaw rule set"], agm?.scheduledAt, agm ? `/meetings/${agm._id}` : "/meetings", agm ? "Open AGM" : "Schedule AGM"),
    cycleItem("member-register", "before", "Confirm voting member register", `${votingMembers.length} active voting members found for notice and quorum planning.`, votingMembers.length > 0 || society.memberDataGapDocumented ? "complete" : "attention", ["Active member register", "Voting rights and contact details"], undefined, "/members", "Review members"),
    cycleItem("financial-statements", "before", "Prepare financial statements", financial ? `${financial.fiscalYear} statements end ${financial.periodEnd}; board approval ${financial.approvedByBoardAt ? "recorded" : "not recorded"}.` : "No financial statement record is linked to this cycle yet.", financial?.approvedByBoardAt ? "complete" : financial ? "attention" : "blocked", ["Financial statement document", "Board approval"], agm?.scheduledAt, financial ? `/financials/fy/${encodeURIComponent(financial.fiscalYear)}` : "/financials", financial ? "Open financials" : "Add financials"),
    cycleItem("notice-package", "before", "Send member notice package", agm ? `Notice window closes ${noticeWindowClose}.` : "Schedule the AGM before sending notice.", agm ? "attention" : "blocked", ["Notice delivery log", "Agenda", "Motions"], noticeWindowClose, agm ? `/meetings/${agm._id}/agm` : "/meetings", "Handle notice"),
    cycleItem("attendance-quorum", "during", "Record attendance and quorum", agmMinutes ? `${agmMinutes.attendees?.length ?? 0} attendees; quorum ${agmMinutes.quorumMet ? "met" : "not met"}.` : "Minutes have not captured attendance and quorum yet.", agmMinutes?.quorumMet ? "complete" : agm ? "attention" : "upcoming", ["Attendance list", "Quorum snapshot"], agm?.scheduledAt, agm ? `/meetings/${agm._id}` : "/meetings", "Open meeting"),
    cycleItem("votes-minutes", "during", "Capture votes and minutes", agmMinutes ? `${agmMinutes.motions?.length ?? 0} motions and ${agmMinutes.decisions?.length ?? 0} decisions recorded.` : "No AGM minutes are linked yet.", agmMinutes?.motions?.length || agmMinutes?.decisions?.length ? "complete" : "attention", ["Draft minutes", "Motion outcomes"], undefined, "/minutes", "Open minutes"),
    cycleItem("financials-presented", "during", "Present financial statements", agmMinutes?.agmDetails?.financialStatementsPresented ? "Financial presentation evidence is linked to the AGM." : "Financial presentation has not been confirmed.", agmMinutes?.agmDetails?.financialStatementsPresented ? "complete" : "attention", ["AGM minutes reference", "Financial statements"], agm?.scheduledAt, financial ? `/financials/fy/${encodeURIComponent(financial.fiscalYear)}` : "/financials", "Review presentation"),
    cycleItem("minutes-approval", "after", "Approve and store minutes", agmMinutes?.approvedAt ? `Approved ${agmMinutes.approvedAt}.` : "Minutes are not approved yet.", agmMinutes?.approvedAt ? "complete" : agmMinutes ? "attention" : "upcoming", ["Approved minutes", "Approval evidence"], undefined, "/minutes", "Review minutes"),
    cycleItem("annual-report", "after", "File annual report", annualReport?.status === "Filed" ? `Filed ${annualReport.filedAt ?? "with evidence"}.` : annualReportDueDate ? `Expected due date ${annualReportDueDate}.` : "Schedule the AGM to compute the annual report filing deadline.", annualReport?.status === "Filed" ? "complete" : annualReportDueDate && today > annualReportDueDate ? "blocked" : "attention", ["Annual report filing", "Confirmation number"], annualReport?.dueDate ?? annualReportDueDate, "/filings", annualReport?.status === "Filed" ? "Open filing" : "Prepare filing"),
    cycleItem("minute-book", "after", "Update minute book evidence", `${officialRecordEvidenceCount} core evidence links found for AGM, financials, filings, and governing documents.`, officialRecordEvidenceCount >= 3 ? "complete" : "attention", ["Notice", "Minutes", "Financial statements", "Annual report evidence"], undefined, "/minute-book", "Open minute book"),
    cycleItem("pipa-review", "ongoing", "Review PIPA privacy program", `${society.privacyProgramStatus} privacy program.`, society.privacyPolicyDocId && society.privacyProgramStatus === "Documented" ? "complete" : "attention", ["Privacy policy evidence", "Privacy officer"], undefined, "/privacy", "Open privacy"),
    cycleItem("conflicts", "ongoing", "Refresh conflict disclosures", `${conflicts.filter((conflict) => !conflict.resolvedAt).length} open conflict disclosure.`, conflicts.some((conflict) => !conflict.resolvedAt) ? "attention" : "complete", ["Conflict register", "Resolution notes"], undefined, "/conflicts", "Open conflicts"),
    cycleItem("open-deadlines", "ongoing", "Clear deadlines and recurring obligations", `${deadlines.filter((deadline) => !deadline.done && deadline.dueDate < today).length} overdue deadlines.`, deadlines.some((deadline) => !deadline.done && deadline.dueDate < today) ? "blocked" : "complete", ["Deadline register", "Completion notes"], undefined, "/deadlines", "Open deadlines"),
  ];
  const completed = items.filter((item) => item.status === "complete").length;
  const blocked = items.filter((item) => item.status === "blocked").length;
  const attention = items.filter((item) => item.status === "attention").length;
  const nextItem = items.find((item) => item.status === "blocked") ?? items.find((item) => item.status === "attention") ?? items[0];

  return {
    cycleYear,
    currentStage: annualReport?.status === "Filed" ? "Annual report filed" : agmMinutes ? "Post-AGM work" : agm ? "Planning and notice" : "Not scheduled",
    society,
    agm,
    annualReport,
    annualReportDueDate,
    counts: {
      completed,
      total: items.length,
      blocked,
      attention,
      activeMembers: activeMembers.length,
      votingMembers: votingMembers.length,
      activeDirectors: activeDirectors.length,
      openConflicts: conflicts.filter((conflict) => !conflict.resolvedAt).length,
    },
    nextItem,
    phases: {
      before: items.filter((item) => item.phase === "before"),
      during: items.filter((item) => item.phase === "during"),
      after: items.filter((item) => item.phase === "after"),
      ongoing: items.filter((item) => item.phase === "ongoing"),
    },
    caveats: [
      "Compliance status means evidence readiness in Societyer, not a legal opinion.",
      "Notice, quorum, proxy, electronic voting, and director term rules depend on the active bylaw rule set.",
      "BC annual reports, CRA charity returns, payroll, GST/HST, funder reports, and federal annual returns are separate obligations.",
    ],
  };
}

function cycleItem(id: string, phase: string, title: string, detail: string, status: string, evidence: string[], dueDate: string | undefined, to: string, actionLabel: string) {
  return { id, phase, title, detail, status, evidence, dueDate, to, actionLabel };
}

function dateOnlyStatic(value?: string | null) {
  return String(value ?? "").slice(0, 10);
}

function inStaticYear(value: unknown, year: number) {
  return typeof value === "string" && value.slice(0, 4) === String(year);
}

function filingMatchesStaticYear(filing: any, year: number) {
  return String(filing.periodLabel ?? filing.title ?? "").includes(String(year)) || inStaticYear(filing.dueDate, year) || inStaticYear(filing.filedAt, year);
}

function addStaticDays(date: string, days: number) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
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

function staticMonthlyEstimateCents(amountCents: number, interval: string) {
  if (interval === "semester") return Math.round((amountCents * 2) / 12);
  if (interval === "week") return Math.round((amountCents * 52) / 12);
  if (interval === "quarter") return Math.round(amountCents / 3);
  if (interval === "year") return Math.round(amountCents / 12);
  return amountCents;
}

function profitAndLoss(args: StaticArgs) {
  const from = args?.from ?? "2026-01-01";
  const to = args?.to ?? "2026-12-31";
  const rows = financialTransactions.filter((transaction) => transaction.date >= from && transaction.date <= to);
  const incomeByCategoryMap = new Map<string, number>();
  const expenseByCategoryMap = new Map<string, number>();
  let totalIncomeCents = 0;
  let totalExpenseCents = 0;

  for (const transaction of rows) {
    const category = transaction.category ?? "Uncategorized";
    if (transaction.amountCents > 0) {
      incomeByCategoryMap.set(category, (incomeByCategoryMap.get(category) ?? 0) + transaction.amountCents);
      totalIncomeCents += transaction.amountCents;
    } else {
      expenseByCategoryMap.set(category, (expenseByCategoryMap.get(category) ?? 0) + Math.abs(transaction.amountCents));
      totalExpenseCents += Math.abs(transaction.amountCents);
    }
  }

  // Mirror the server shape: arrays of `{ category, cents }` so non-ASCII
  // category names (e.g. Wave's en-dash) survive Convex value validation.
  return {
    from,
    to,
    totalIncomeCents,
    totalExpenseCents,
    netCents: totalIncomeCents - totalExpenseCents,
    incomeByCategory: Array.from(incomeByCategoryMap, ([category, cents]) => ({ category, cents })),
    expenseByCategory: Array.from(expenseByCategoryMap, ([category, cents]) => ({ category, cents })),
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

function staticDocumentReviewQueues() {
  const taskCounts = new Map<string, number>();
  for (const task of tasks.filter((task) => task.status !== "Done" && task.documentId)) {
    taskCounts.set(String(task.documentId), (taskCounts.get(String(task.documentId)) ?? 0) + 1);
  }
  const commentCounts = new Map<string, number>();
  for (const comment of documentComments.filter((comment) => comment.status !== "resolved")) {
    commentCounts.set(String(comment.documentId), (commentCounts.get(String(comment.documentId)) ?? 0) + 1);
  }
  const materialDocIds = new Set(meetingMaterials.map((row) => String(row.documentId)));
  const annotate = (document: any) => ({
    ...document,
    openTaskCount: taskCounts.get(String(document._id)) ?? 0,
    openCommentCount: commentCounts.get(String(document._id)) ?? 0,
    signatureCount: 0,
    linkedToMeetingPackage: materialDocIds.has(String(document._id)) || !!document.meetingId,
  });
  const annotated = documents.map(annotate);
  return {
    recent: annotated
      .filter((document) => document.lastOpenedAtISO || document.createdAtISO)
      .sort((a, b) => String(b.lastOpenedAtISO ?? b.createdAtISO).localeCompare(String(a.lastOpenedAtISO ?? a.createdAtISO)))
      .slice(0, 8),
    actionRequired: annotated
      .filter((document) => document.reviewStatus === "needs_signature" || document.openCommentCount > 0 || document.openTaskCount > 0)
      .slice(0, 8),
    workInProgress: annotated
      .filter((document) => document.reviewStatus === "in_review" || document.linkedToMeetingPackage || document.openCommentCount > 0)
      .slice(0, 8),
    counts: {
      documents: annotated.length,
      recent: annotated.length,
      actionRequired: annotated.filter((document) => document.reviewStatus === "needs_signature" || document.openCommentCount > 0 || document.openTaskCount > 0).length,
      workInProgress: annotated.filter((document) => document.reviewStatus === "in_review" || document.linkedToMeetingPackage || document.openCommentCount > 0).length,
    },
  };
}

function staticMeetingPackage(args: StaticArgs) {
  const meeting = byId(meetings, args?.meetingId) ?? meetings[0];
  const materials = meetingMaterials
    .filter((material) => material.meetingId === meeting._id)
    .map((material) => ({ ...material, document: byId(documents, material.documentId) }))
    .sort((a, b) => a.order - b.order);
  return {
    meeting,
    minutes: minutes.find((row) => row.meetingId === meeting._id) ?? null,
    agenda: parseStaticAgenda(meeting.agendaJson),
    materials,
    tasks: tasks.filter((task) => task.meetingId === meeting._id),
    counts: {
      agendaItems: parseStaticAgenda(meeting.agendaJson).length,
      materials: materials.length,
      requiredMaterials: materials.filter((material) => material.requiredForMeeting).length,
      openTasks: tasks.filter((task) => task.meetingId === meeting._id && task.status !== "Done").length,
    },
  };
}

function staticLibraryOverview() {
  const referenceDocuments = documents
    .filter((document) =>
      document.librarySection ||
      ["Policy", "Bylaws", "Constitution"].includes(document.category) ||
      document.tags?.includes("library") ||
      meetingMaterials.some((material) => material.documentId === document._id),
    )
    .sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
  const sectionsMap = new Map<string, any[]>();
  for (const document of referenceDocuments) {
    const section = document.librarySection ?? (document.category === "Policy" ? "policy" : document.category === "FinancialStatement" ? "finance" : "governance");
    if (!sectionsMap.has(section)) sectionsMap.set(section, []);
    sectionsMap.get(section)!.push(document);
  }
  const meetingPackets = Array.from(new Set(meetingMaterials.map((material) => material.meetingId)))
    .map((meetingId) => {
      const meeting = byId(meetings, meetingId);
      const materials = meetingMaterials
        .filter((material) => material.meetingId === meetingId)
        .map((material) => ({ ...material, document: byId(documents, material.documentId) }))
        .filter((material) => material.document);
      return { meeting, materials, requiredCount: materials.filter((material) => material.requiredForMeeting).length };
    })
    .filter((packet) => packet.meeting);
  return {
    referenceDocuments,
    meetingPackets,
    sections: Array.from(sectionsMap, ([section, documents]) => ({ section, documents })),
    counts: {
      referenceDocuments: referenceDocuments.length,
      meetingPackets: meetingPackets.length,
      meetingMaterials: meetingMaterials.length,
    },
  };
}

function parseStaticAgenda(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((entry) => typeof entry === "string" ? entry : String(entry?.title ?? "")).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function parseStaticAgendaItems(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const entries: Array<{ title: string; depth: 0 | 1; type?: string; presenter?: string; details?: string; motionText?: string }> = [];
    let hasRoot = false;
    for (const entry of parsed) {
      const title = typeof entry === "string" ? entry.trim() : String(entry?.title ?? "").trim();
      if (!title) continue;
      const depth: 0 | 1 = typeof entry === "object" && entry?.depth === 1 && hasRoot ? 1 : 0;
      entries.push({
        title,
        depth,
        type: typeof entry === "object" ? entry?.type : undefined,
        presenter: typeof entry === "object" ? entry?.presenter : undefined,
        details: typeof entry === "object" ? entry?.details : undefined,
        motionText: typeof entry === "object" ? entry?.motionText : undefined,
      });
      if (depth === 0) hasRoot = true;
    }
    return entries;
  } catch {
    return [];
  }
}

function staticAgendaItemType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
}

function staticFundingSourcesList() {
  return fundingSources.map((source) => {
    const events = fundingSourceEvents
      .filter((event) => event.sourceId === source._id)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
    const receivedFromEventsCents = events
      .filter((event) => event.kind === "Received")
      .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    const committedFromEventsCents = events
      .filter((event) => event.kind === "Pledged" || event.kind === "Agreement")
      .reduce((sum, event) => sum + (event.amountCents ?? 0), 0);
    return {
      ...source,
      events,
      eventCount: events.length,
      lastEventDate: events[0]?.eventDate,
      committedTotalCents: (source.committedCents ?? 0) + committedFromEventsCents,
      receivedTotalCents: (source.receivedToDateCents ?? 0) + receivedFromEventsCents,
    };
  });
}

function staticFundingRollup(args: StaticArgs) {
  const from = args?.from;
  const to = args?.to;
  const inRange = (date?: string) => {
    if (!date) return true;
    const day = date.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  };
  const groups = new Map<string, any>();
  const group = (name: string, sourceType: string) => {
    const key = `${sourceType}:${name}`.toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name,
        sourceType,
        plannedCents: 0,
        committedCents: 0,
        receivedCents: 0,
        sourceCount: 0,
        observedFrom: [],
        restrictedPurposes: [],
        collectionAgents: [],
        memberDisclosureLevels: [],
        collectionFrequencies: [],
        collectionScheduleNotes: [],
      });
    }
    return groups.get(key);
  };
  const observe = (row: any, label: string) => {
    if (!row.observedFrom.includes(label)) row.observedFrom.push(label);
  };
  const activity = (row: any, date?: string) => {
    if (date && (!row.lastActivityDate || date > row.lastActivityDate)) row.lastActivityDate = date;
  };

  for (const source of fundingSources) {
    const row = group(source.name, source.sourceType);
    row.sourceCount += 1;
    row.plannedCents += source.expectedAnnualCents ?? 0;
    row.committedCents += source.committedCents ?? 0;
    row.receivedCents += source.receivedToDateCents ?? 0;
    if (source.restrictedPurpose && !row.restrictedPurposes.includes(source.restrictedPurpose)) {
      row.restrictedPurposes.push(source.restrictedPurpose);
    }
    if (source.collectionAgentName && !row.collectionAgents.includes(source.collectionAgentName)) {
      row.collectionAgents.push(source.collectionAgentName);
    }
    if (source.memberDisclosureLevel && !row.memberDisclosureLevels.includes(source.memberDisclosureLevel)) {
      row.memberDisclosureLevels.push(source.memberDisclosureLevel);
    }
    if (source.collectionFrequency && !row.collectionFrequencies.includes(source.collectionFrequency)) {
      row.collectionFrequencies.push(source.collectionFrequency);
    }
    if (source.collectionScheduleNotes && !row.collectionScheduleNotes.includes(source.collectionScheduleNotes)) {
      row.collectionScheduleNotes.push(source.collectionScheduleNotes);
    }
    if (source.nextExpectedCollectionDate && (!row.nextExpectedCollectionDate || source.nextExpectedCollectionDate < row.nextExpectedCollectionDate)) {
      row.nextExpectedCollectionDate = source.nextExpectedCollectionDate;
    }
    if (source.estimatedMemberCount != null) {
      row.estimatedMemberCount = (row.estimatedMemberCount ?? 0) + source.estimatedMemberCount;
    }
    observe(row, "register");
    activity(row, source.startDate);
  }
  for (const event of fundingSourceEvents.filter((event) => inRange(event.eventDate))) {
    const source = fundingSources.find((candidate) => candidate._id === event.sourceId);
    if (!source) continue;
    const row = group(source.name, source.sourceType);
    if (event.kind === "Received") row.receivedCents += event.amountCents ?? 0;
    if (event.kind === "Pledged" || event.kind === "Agreement") row.committedCents += event.amountCents ?? 0;
    if (event.attributionStatus && !row.memberDisclosureLevels.includes(event.attributionStatus)) {
      row.memberDisclosureLevels.push(event.attributionStatus);
    }
    if (event.memberCount != null) {
      row.estimatedMemberCount = (row.estimatedMemberCount ?? 0) + event.memberCount;
    }
    observe(row, "funding events");
    activity(row, event.eventDate);
  }
  for (const receipt of tables.receipts.filter((receipt) => inRange(receipt.issuedAtISO))) {
    const row = group(receipt.donorName, "Donor");
    row.receivedCents += receipt.amountCents ?? 0;
    observe(row, "receipts");
    activity(row, receipt.issuedAtISO);
  }
  for (const subscription of memberSubscriptions.filter((subscription) => subscription.status !== "canceled")) {
    const plan = subscriptionPlans.find((plan) => plan._id === subscription.planId);
    const row = group(subscription.fullName, "Member dues");
    if (subscription.status === "active" && plan) {
      row.plannedCents += plan.interval === "month" ? plan.priceCents * 12 : plan.interval === "semester" ? plan.priceCents * 2 : plan.priceCents;
    }
    if (inRange(subscription.lastPaymentAtISO)) row.receivedCents += subscription.lastPaymentCents ?? 0;
    observe(row, "member billing");
    activity(row, subscription.lastPaymentAtISO ?? subscription.startedAtISO);
  }

  const rows = Array.from(groups.values()).sort((a, b) => b.receivedCents - a.receivedCents || a.name.localeCompare(b.name));
  return {
    rows,
    totalPlannedCents: rows.reduce((sum, row) => sum + row.plannedCents, 0),
    totalCommittedCents: rows.reduce((sum, row) => sum + row.committedCents, 0),
    totalReceivedCents: rows.reduce((sum, row) => sum + row.receivedCents, 0),
  };
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

function staticGrantSourceLibrary() {
  return BUILT_IN_GRANT_SOURCES.map((librarySource) => {
    const source = tables.grantSources.find((row) => row.libraryKey === librarySource.libraryKey);
    const profile = tables.grantSourceProfiles.find((row) => row.libraryKey === librarySource.libraryKey);
    return {
      ...(source ?? {}),
      ...librarySource,
      builtIn: true,
      profile: profile ?? BUILT_IN_GRANT_SOURCE_PROFILES.find((row) => row.libraryKey === librarySource.libraryKey),
    };
  });
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
    directors: society.publicShowBoard
      ? directors
          .filter((director) => director.status === "Active")
          .map((director) => ({
            _id: director._id,
            name: `${director.firstName} ${director.lastName}`,
            position: director.position,
          }))
      : [],
    publications: tables.transparency.filter((row) => {
      if (row.status !== "Published") return false;
      if (!society.publicShowBylaws && row.category === "Bylaws") return false;
      if (!society.publicShowFinancials && ["AnnualReport", "FinancialSummary"].includes(row.category)) return false;
      return true;
    }),
    documents: documents.filter((document) => document.public),
  };
}

const STATIC_EXPORT_TABLES = [
  "societies",
  "organizationAddresses",
  "organizationRegistrations",
  "organizationIdentifiers",
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
  "operatingSubscriptions",
  "budgetSnapshots",
  "budgetSnapshotLines",
  "financialStatementImports",
  "financialStatementImportLines",
  "treasurerReports",
  "transactionCandidates",
  "signatures",
  "filingBotRuns",
  "recordLayouts",
  "workflows",
  "workflowPackages",
  "pendingEmails",
  "workflowRuns",
  "subscriptionPlans",
  "membershipFeePeriods",
  "memberSubscriptions",
  "fundingSources",
  "fundingSourceEvents",
  "transcripts",
  "transcriptionJobs",
  "customFieldDefinitions",
  "customFieldValues",
  "objectMetadata",
  "fieldMetadata",
  "views",
  "viewFields",
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
  "grantSources",
  "grantSourceProfiles",
  "grantOpportunityCandidates",
  "deadlines",
  "commitments",
  "commitmentEvents",
  "documents",
  "publications",
  "policies",
  "conflicts",
  "financials",
  "bylawRuleSets",
  "goals",
  "tasks",
  "assets",
  "assetEvents",
  "assetMaintenance",
  "assetVerificationRuns",
  "assetVerificationItems",
  "minuteBookItems",
  "activity",
  "notes",
  "invitations",
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
  "meetingTemplates",
  "motionTemplates",
  "motionBacklog",
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

function staticPipaPolicyDraft() {
  const today = new Date().toISOString().slice(0, 10);
  return `# ${society.name} Privacy Policy

Draft created: ${today}

Status: Draft - not adopted until approved by the authorized board, executive, or officer.

This draft is a Societyer starter template based on BC PIPA guidance. It is not legal advice and it is not an official BC OIPC template. Replace bracketed text and remove options that do not apply before adoption.

## 1. Organization

${society.name} collects, uses, discloses, stores, and disposes of personal information in accordance with British Columbia's Personal Information Protection Act (PIPA) and other applicable laws.

- Legal name: ${society.name}
- Incorporation number: ${society.incorporationNumber}
- Mailing address: ${society.mailingAddress}
- General contact: ${society.publicContactEmail}

## 2. Privacy Officer

The privacy officer is responsible for privacy questions, access and correction requests, privacy complaints, and maintaining this policy.

- Privacy officer: ${society.privacyOfficerName}
- Email: ${society.privacyOfficerEmail}
- Mailing address: ${society.mailingAddress}

## 3. Member Records and Institution-Held Data

Current member-data access status in Societyer: ${society.memberDataAccessStatus}.

Tailor this section to the actual member list, university data-sharing limits, and evidence stored in Societyer before adoption.

## 4. Complaint Process

Privacy questions, access requests, correction requests, and complaints should be sent to the privacy officer. The organization will review the request, gather relevant information, respond within the timelines required by law, and keep a record of the outcome.

## 5. Adoption

Policy adopted by: [board / executive / authorized officer]

Adoption date: [YYYY-MM-DD]

Last review date: ${today}

Next review date: [YYYY-MM-DD]
`;
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

function queryResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null) {
  switch (name) {
    case "activity:list":
      return tables.activity.slice(0, args?.limit ?? tables.activity.length);
    case "aiAgents:listDefinitions":
      return aiAgentDefinitions;
    case "aiAgents:listSkills":
      return aiSkills.filter((skill: any) => skill.isActive !== false);
    case "aiAgents:listAllSkills":
      return aiSkills;
    case "aiAgents:loadSkills": {
      const names = new Set(args?.skillNames ?? []);
      const skills = aiSkills.filter((skill) => names.has(skill.name));
      return { skills, missing: [...names].filter((name) => !skills.some((skill) => skill.name === name)), message: `Loaded ${skills.length} skill(s).` };
    }
    case "aiAgents:getToolCatalog": {
      const catalog: Record<string, any[]> = {};
      aiToolCatalog.forEach((tool) => {
        catalog[tool.category as string] ??= [];
        catalog[tool.category as string].push(tool);
      });
      return { role: "Owner", categories: Object.keys(catalog), catalog, tools: aiToolCatalog };
    }
    case "assets:bundle": {
      const asset = store?.getRow("assets", args?.id) ?? byId(tables.assets, args?.id);
      if (!asset) return null;
      return {
        asset,
        events: (store?.listRows("assetEvents", { societyId: asset.societyId }) ?? tables.assetEvents)
          .filter((row: any) => row.assetId === asset._id)
          .sort((a: any, b: any) => b.happenedAtISO.localeCompare(a.happenedAtISO)),
        maintenance: (store?.listRows("assetMaintenance", { societyId: asset.societyId }) ?? tables.assetMaintenance)
          .filter((row: any) => row.assetId === asset._id),
      };
    }
    case "assets:events":
      return (store?.listRows("assetEvents", args) ?? tables.assetEvents)
        .filter((row: any) => row.assetId === args?.assetId)
        .sort((a: any, b: any) => b.happenedAtISO.localeCompare(a.happenedAtISO));
    case "assets:maintenance":
      return store?.listRows("assetMaintenance", args) ?? scopedRows(tables.assetMaintenance, args);
    case "assets:verificationRuns":
      return store?.listRows("assetVerificationRuns", args) ?? scopedRows(tables.assetVerificationRuns, args);
    case "assets:verificationItems":
      return (store?.listRows("assetVerificationItems", args) ?? tables.assetVerificationItems)
        .filter((row: any) => row.runId === args?.runId);
    case "aiAgents:getChatContext": {
      const catalog: Record<string, any[]> = {};
      aiToolCatalog.forEach((tool) => {
        catalog[tool.category as string] ??= [];
        catalog[tool.category as string].push(tool);
      });
      return {
        role: "Owner",
        user: { id: USER_OWNER_ID, displayName: "Mina Patel", role: "Owner" },
        skillCatalog: aiSkills,
        toolCatalog: catalog,
        browsingContext: args?.browsingContext ?? null,
        systemPrompt: "You are Societyer's AI assistant. Follow Plan -> Skill -> Learn -> Execute.",
      };
    }
    case "aiAgents:learnTools": {
      const names = new Set(args?.toolNames ?? []);
      const tools = aiToolCatalog
        .filter((tool) => names.has(tool.name))
        .map((tool) => ({ ...tool, inputSchema: { type: "object", additionalProperties: true } }));
      return { tools, notFound: [...names].filter((name) => !tools.some((tool) => tool.name === name)), message: `Learned ${tools.length} tool(s).` };
    }
    case "aiAgents:executeTool":
      return { success: true, toolName: args?.toolName, rows: [] };
    case "annualCycle:summary":
      return annualCycleSummary(args);
    case "aiAgents:listRuns":
      return aiAgentRuns.slice(0, args?.limit ?? aiAgentRuns.length);
    case "aiAgents:auditForRun":
      return aiAgentAuditEvents.filter((event) => event.runId === args?.runId);
    case "aiAgents:listToolDrafts":
      return aiToolDrafts.slice(0, args?.limit ?? aiToolDrafts.length);
    case "aiSettings:getEffective": {
      const personal = aiProviderSettings.filter((row) => row.societyId === args?.societyId && row.userId === args?.actingUserId);
      const workspace = aiProviderSettings.filter((row) => row.societyId === args?.societyId && row.scope === "workspace");
      return {
        effective: personal.find((row) => row.status === "active") ?? workspace.find((row) => row.status === "active") ?? null,
        personal,
        workspace,
      };
    }
    case "aiChat:listThreads":
      return aiChatThreads.slice(0, args?.limit ?? aiChatThreads.length);
    case "aiChat:messagesForThread":
      return aiMessages.filter((message) => message.threadId === args?.threadId);
    case "apiPlatform:listIntegrationCatalog":
      return INTEGRATION_CATALOG.map((manifest) => {
        const installation = tables.pluginInstallations.find((row) => row.slug === manifest.slug);
        return {
          ...manifest,
          installation,
          installed: installation?.status === "installed",
          health: {
            status: installation ? (manifest.status === "planned" ? "planned" : "ready") : "not_installed",
            checkedAtISO: installation?.updatedAtISO,
            messages: installation
              ? ["Static demo integration manifest is installed."]
              : ["Install this integration to configure credentials, actions, and webhooks."],
          },
        };
      });
    case "recordLayouts:get":
      return null;
    case "agm:noticeDeliveries":
      return [];
    case "agm:runForMeeting":
      return { _id: "static_agm_run", meetingId: args?.meetingId, status: "Ready", steps: [] };
    case "agendas:getForMeeting": {
      const meeting = byId(meetings, args?.meetingId);
      if (!meeting) return null;
      const items = parseStaticAgendaItems(meeting.agendaJson).map((entry, order) => ({
        _id: `static_agenda_item_${meeting._id}_${order}`,
        societyId: meeting.societyId,
        agendaId: `static_agenda_${meeting._id}`,
        order,
        type: entry.type || staticAgendaItemType(entry.title),
        title: entry.title,
        depth: entry.depth,
        presenter: entry.presenter,
        details: entry.details,
        motionText: entry.motionText,
        createdAtISO: meeting.scheduledAt,
      }));
      if (items.length === 0) return null;
      return {
        agenda: {
          _id: `static_agenda_${meeting._id}`,
          societyId: meeting.societyId,
          meetingId: meeting._id,
          title: `${meeting.title} agenda`,
          status: "Draft",
          createdAtISO: meeting.scheduledAt,
          updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
        },
        items,
      };
    }
    case "agendas:listForSociety":
      return scopedRows(meetings, args)
        .map((meeting) => ({
          _id: `static_agenda_${meeting._id}`,
          societyId: meeting.societyId,
          meetingId: meeting._id,
          title: `${meeting.title} agenda`,
          status: "Draft",
          createdAtISO: meeting.scheduledAt,
          updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
        }));
    case "attestations:missingForYear":
      return directors.filter((director) => director._id === "static_director_sam");
    case "bylawRules:getActive":
    case "bylawRules:getForDate":
      return bylawRules;
    case "bylawRules:list":
      return tables.bylawRuleSets;
    case "committees:detail":
      return { committee: byId(committees, args?.id), members: [], meetings: [], tasks, goals };
    case "commitments:eventsForSociety":
      return scopedRows(commitmentEvents, args).sort((a, b) => b.happenedAtISO.localeCompare(a.happenedAtISO));
    case "commitments:eventsForCommitment":
      return commitmentEvents.filter((event) => event.commitmentId === args?.commitmentId);
    case "dashboard:summary":
      return dashboardSummary();
    case "documentComments:listForDocument":
      return documentComments
        .filter((comment) => comment.documentId === args?.documentId)
        .sort((a, b) => b.createdAtISO.localeCompare(a.createdAtISO));
    case "documents:reviewQueues":
      return staticDocumentReviewQueues();
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
    case "financials:detailByFiscalYear": {
      const financial = financials.find((row) => row.fiscalYear === args?.fiscalYear) ?? null;
      const financialDocument = documents.find((row) => row._id === "static_document_financials");
      return {
        financial,
        financials: financial ? [financial] : [],
        imports: [],
        documents: financialDocument ? [financialDocument] : [],
        budgets: [],
        presentedAtMeeting: null,
      };
    }
    case "financialHub:accounts":
      return financialAccounts;
    case "financialHub:connections":
      return financialConnections;
    case "financialHub:getConnection":
      return byId(financialConnections, args?.id) ?? financialConnections[0];
    case "financialHub:oauthUrl":
      return { provider: "wave", live: false, demoAvailable: true };
    case "financialHub:summary":
      return financialSummary();
    case "financialHub:transactions":
      return financialTransactions.slice(0, args?.limit ?? financialTransactions.length);
    case "financialHub:transactionsForAccountExternalId": {
      const account = financialAccounts.find((row) => row.externalId === args?.externalId) ?? null;
      const rows = account
        ? financialTransactions
            .filter((row) => row.accountId === account._id)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [];
      return {
        account,
        transactions: rows.slice(0, args?.limit ?? 500),
        total: rows.length,
      };
    }
    case "financialHub:transactionsForCounterpartyExternalId": {
      const rows = financialTransactions
        .filter((row) => row.counterpartyExternalId === args?.externalId)
        .filter((row) => !args?.resourceType || row.counterpartyResourceType === args.resourceType)
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        transactions: rows.slice(0, args?.limit ?? 500).map((row) => {
          const account = financialAccounts.find((candidate) => candidate._id === row.accountId) ?? null;
          const accountResource = account
            ? waveCacheResources.find((resource) => resource.resourceType === "account" && resource.externalId === account.externalId) ?? null
            : null;
          return { ...row, account, accountResource };
        }),
        total: rows.length,
        linkedTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      };
    }
    case "financialHub:transactionsForCategoryAccountExternalId": {
      const normalizedLabel = normalizeStaticCategoryLabel(args?.label);
      const rows = financialTransactions
        .filter((row) => {
          if (row.categoryAccountExternalId === args?.externalId) return true;
          return Boolean(!row.categoryAccountExternalId && normalizedLabel && normalizeStaticCategoryLabel(row.category) === normalizedLabel);
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      return {
        transactions: rows.slice(0, args?.limit ?? 500).map((row) => {
          const account = financialAccounts.find((candidate) => candidate._id === row.accountId) ?? null;
          const accountResource = account
            ? waveCacheResources.find((resource) => resource.resourceType === "account" && resource.externalId === account.externalId) ?? null
            : null;
          return { ...row, account, accountResource };
        }),
        total: rows.length,
        linkedTotalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      };
    }
    case "financialHub:operatingSubscriptions":
      return operatingSubscriptions.map((row) => {
        const monthlyEstimateCents = staticMonthlyEstimateCents(row.amountCents, row.interval);
        return {
          ...row,
          monthlyEstimateCents,
          annualEstimateCents: monthlyEstimateCents * 12,
        };
      });
    case "library:overview":
      return staticLibraryOverview();
    case "fundingSources:list":
      return staticFundingSourcesList();
    case "fundingSources:rollup":
      return staticFundingRollup(args);
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
        .map(({ rawJson, ...row }) => ({
          ...row,
          ...staticCounterpartyStats(row.externalId),
          ...staticCategoryAccountStats(row.externalId, row.label),
          hasRawJson: Boolean(rawJson),
        }));
    }
    case "waveCache:resource": {
      const row = byId(waveCacheResources, args?.id);
      return row
        ? { ...row, ...staticCounterpartyStats(row.externalId), ...staticCategoryAccountStats(row.externalId, row.label), raw: JSON.parse(row.rawJson) }
        : null;
    }
    case "waveCache:resourceByExternalId": {
      const row = waveCacheResources.find(
        (resource) =>
          resource.externalId === args?.externalId &&
          (!args?.resourceType || resource.resourceType === args.resourceType),
      );
      return row
        ? { ...row, ...staticCounterpartyStats(row.externalId), ...staticCategoryAccountStats(row.externalId, row.label), raw: JSON.parse(row.rawJson) }
        : null;
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
    case "grantSources:library":
      return staticGrantSourceLibrary();
    case "grantSources:list":
      return tables.grantSources;
    case "grantSources:listWithLibrary":
      return {
        library: staticGrantSourceLibrary().map((source: any) => ({
          ...source,
          _id: tables.grantSources.find((row) => row.libraryKey === source.libraryKey)?._id,
          installed: tables.grantSources.some((row) => row.libraryKey === source.libraryKey),
        })),
        workspace: tables.grantSources,
      };
    case "grantSources:candidates":
      return tables.grantOpportunityCandidates;
    case "members:get":
      return store?.getRow("members", args?.id) ?? byId(members, args?.id);
    case "meetings:get":
      return byId(meetings, args?.id) ?? meetings[0];
    case "meetingMaterials:packageForMeeting":
      return staticMeetingPackage(args);
    case "meetingMaterials:listForMeeting":
      return staticMeetingPackage(args).materials;
    case "meetingMaterials:listForSociety":
      return meetingMaterials.map((material) => ({
        ...material,
        document: byId(documents, material.documentId),
        meeting: byId(meetings, material.meetingId),
      }));
    case "minutes:getByMeeting":
      return minutes.find((row) => row.meetingId === args?.meetingId) ?? null;
    case "notifications:list":
      return notifications.slice(0, args?.limit ?? notifications.length);
    case "notifications:unreadCount":
      return notifications.filter((notification) => !notification.readAt).length;
    case "objectMetadata:getFullTableSetup":
      return staticRecordTableSetup(args);
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
    case "subscriptions:feeTimeline":
      return membershipFeePeriods
        .map((period) => ({
          ...period,
          planName: subscriptionPlans.find((plan) => plan._id === period.planId)?.name,
          activePlan: subscriptionPlans.find((plan) => plan._id === period.planId)?.active,
        }))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.label.localeCompare(b.label));
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
    case "orgChartAssignments:list":
      return tables.orgChartAssignments;
    case "users:get":
      return store?.getRow("users", args?.id) ?? byId(users, args?.id) ?? users[0];
    case "volunteers:applications":
      return tables.volunteerApplications;
    case "volunteers:screenings":
      return tables.volunteerScreenings;
    case "volunteers:summary":
      return { active: tables.volunteers.length, pendingApplications: tables.volunteerApplications.length };
    case "workflows:listCatalog":
      return workflowCatalog;
    case "workflows:list":
      return scopedRows(workflows, args);
    case "workflows:get":
      return byId(workflows, args?.id);
    case "workflows:listRuns":
      return workflowRuns.slice(0, args?.limit ?? workflowRuns.length);
    case "workflows:runsForWorkflow":
      return workflowRuns.filter((run) => run.workflowId === args?.workflowId);
    case "workflows:getRun":
      return byId(workflowRuns, args?.id);
  }

  const [moduleName, exportName] = name.split(":");
  const tableName = staticTableNameForModule(moduleName);
  if (moduleName === "society" && exportName === "get") return store?.getRow("societies", args?.id ?? SOCIETY_ID) ?? society;
  if (moduleName === "society" && exportName === "list") return store?.listRows("societies", args) ?? [society];
  if (exportName === "list") return store?.listRows(tableName, args) ?? scopedRows(tables[tableName] ?? [], args);
  if (exportName === "get") return store?.getRow(tableName, args?.id) ?? byId(tables[tableName] ?? [], args?.id);
  return [];
}

function mutableQueryResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null) {
  return store?.queryResult(name, args) ?? queryResult(name, args, store);
}

function mutationResult(name: string, args: StaticArgs, store?: StaticDemoDexieStore | null) {
  const localResult = store?.mutationResult(name, args);
  if (localResult !== undefined) return localResult;

  if (name === "aiChat:createThread") {
    const now = new Date().toISOString();
    const thread = {
      _id: `static_ai_chat_thread_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      title: args?.title ?? "New AI chat",
      status: "active",
      modelId: args?.modelId,
      browsingContext: args?.browsingContext,
      createdByUserId: args?.actingUserId,
      createdAtISO: now,
      updatedAtISO: now,
      lastMessageAtISO: now,
    };
    aiChatThreads.unshift(thread);
    return thread._id;
  }
  if (name === "aiChatActions:sendChatMessage") {
    const now = new Date().toISOString();
    const threadId = args?.threadId ?? mutationResult("aiChat:createThread", {
      societyId: args?.societyId,
      title: args?.content,
      actingUserId: args?.actingUserId,
    });
    aiMessages.push({
      _id: `static_ai_message_user_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      threadId,
      role: "user",
      content: args?.content ?? "",
      status: "complete",
      createdAtISO: now,
    });
    const content = [
      "Static AI chat reply.",
      "",
      "This route is wired to the same skill catalog and tool catalog as live Convex.",
      "Set OPENAI_API_KEY or OPENROUTER_API_KEY in a real deployment to stream through the Vercel AI SDK.",
    ].join("\n");
    const message = {
      _id: `static_ai_message_assistant_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      threadId,
      role: "assistant",
      content,
      status: "complete",
      provider: "static_fallback",
      createdAtISO: now,
    };
    aiMessages.push(message);
    return { threadId, messageId: message._id, content, provider: "static_fallback" };
  }
  if (name === "aiSettingsActions:validateProviderKey") {
    const provider = args?.provider ?? "openai";
    const modelCatalog = staticModelCatalog(provider);
    return {
      ok: Boolean(args?.apiKey),
      provider,
      baseUrl: args?.baseUrl ?? (provider === "openrouter" ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1"),
      message: args?.apiKey ? "Static provider key validated." : "API key is required.",
      modelIds: modelCatalog.models.map((model: any) => model.id),
      modelCatalog,
    };
  }
  if (name === "aiSettingsActions:listProviderModels") {
    return staticModelCatalog(args?.provider ?? "openai");
  }
  if (name === "aiSettings:upsert") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_ai_provider_${Date.now()}`;
    const existing = aiProviderSettings.find((row) => row._id === id);
    const row = {
      _id: id,
      societyId: args?.societyId ?? SOCIETY_ID,
      scope: args?.scope ?? "personal",
      userId: args?.scope === "workspace" ? undefined : args?.actingUserId,
      provider: args?.provider ?? "openai",
      label: args?.label ?? "OpenAI",
      status: args?.validationStatus === "ok" ? "active" : "needs_validation",
      modelId: args?.modelId ?? "gpt-4.1-mini",
      baseUrl: args?.baseUrl,
      secretVaultItemId: args?.secretVaultItemId,
      temperature: args?.temperature,
      maxSteps: args?.maxSteps,
      validationStatus: args?.validationStatus,
      validationMessage: args?.validationMessage,
      validatedAtISO: args?.validationStatus === "ok" ? now : undefined,
      createdAtISO: now,
      updatedAtISO: now,
    };
    if (existing) Object.assign(existing, row);
    else aiProviderSettings.unshift(row);
    return id;
  }
  if (name === "aiSettings:setStatus") {
    const existing = aiProviderSettings.find((row) => row._id === args?.id);
    if (existing) existing.status = args?.status;
    return args?.id;
  }
  if (name === "secrets:create") {
    return `static_secret_${Date.now()}`;
  }
  if (name === "aiAgents:upsertSkill") {
    const now = new Date().toISOString();
    const id = args?.id ?? `static_ai_skill_${Date.now()}`;
    const existing = aiSkills.find((skill: any) => skill._id === id);
    const payload = {
      _id: id,
      name: args?.name,
      label: args?.label,
      description: args?.description,
      content: args?.content,
      isActive: args?.isActive !== false,
      isCustom: true,
      createdAtISO: now,
      updatedAtISO: now,
    };
    if (existing) Object.assign(existing, payload);
    else aiSkills.push(payload);
    return id;
  }
  if (name === "aiAgents:setSkillActive") {
    const existing = aiSkills.find((skill: any) => skill._id === args?.id);
    if (existing) existing.isActive = args?.isActive;
    return args?.id;
  }
  if (name === "aiAgents:removeSkill") {
    const idx = aiSkills.findIndex((skill: any) => skill._id === args?.id);
    if (idx >= 0) aiSkills.splice(idx, 1);
    return args?.id;
  }
  if (name === "aiAgents:executeTool") {
    if (args?.toolName === "draft_task") {
      const now = new Date().toISOString();
      const draft = {
        _id: `static_ai_tool_draft_${Date.now()}`,
        societyId: args?.societyId ?? SOCIETY_ID,
        threadId: args?.threadId,
        runId: args?.runId,
        agentKey: args?.agentKey,
        toolName: "draft_task",
        title: args?.arguments?.title ?? "AI drafted task",
        payload: { status: "draft", priority: "Medium", tags: [], ...(args?.arguments ?? {}) },
        status: "draft",
        createdAtISO: now,
        updatedAtISO: now,
      };
      aiToolDrafts.unshift(draft);
      return { success: true, draftId: draft._id, draft: draft.payload };
    }
    return { success: true, toolName: args?.toolName, rows: [], recordReferences: [] };
  }
  if (name === "aiAgents:approveToolDraft") {
    const draft = aiToolDrafts.find((item) => item._id === args?.id);
    if (draft) draft.status = "executed";
    return { status: "executed", taskId: `static_task_${Date.now()}` };
  }
  if (name === "aiAgents:rejectToolDraft") {
    const draft = aiToolDrafts.find((item) => item._id === args?.id);
    if (draft) draft.status = "rejected";
    return args?.id;
  }
  if (name === "aiAgents:runAgent") {
    const agent = aiAgentDefinitions.find((item) => item.key === args?.agentKey) ?? aiAgentDefinitions[0];
    const now = new Date().toISOString();
    const run = {
      _id: `static_ai_agent_run_${Date.now()}`,
      societyId: args?.societyId ?? SOCIETY_ID,
      agentKey: agent.key,
      agentName: agent.name,
      status: "completed",
      input: args?.input ?? "",
      inputHints: agent.requiredInputHints,
      scope: agent.scope,
      allowedActions: agent.allowedActions,
      allowedTools: agent.allowedTools,
      loadedSkillNames: agent.skillNames ?? [],
      toolCatalogSnapshot: aiToolCatalog.filter((tool) => agent.allowedTools.includes(tool.name)),
      unavailableTools: [],
      plannedToolCalls: agent.allowedTools.map((toolName: string) => ({
        toolName,
        purpose: `Use ${toolName} within the agent scope.`,
        status: "planned",
      })),
      output: staticAgentOutput(agent, args?.input ?? ""),
      provider: "deterministic_skill_router",
      createdAtISO: now,
      completedAtISO: now,
      triggeredByUserId: args?.actingUserId,
    };
    aiAgentRuns.unshift(run);
    return {
      runId: run._id,
      output: run.output,
      plannedToolCalls: run.plannedToolCalls,
      loadedSkills: aiSkills.filter((skill) => (agent.skillNames ?? []).includes(skill.name)),
      learnedTools: run.toolCatalogSnapshot,
      unavailableTools: [],
    };
  }
  if (name === "apiPlatform:installIntegration") {
    const manifest = INTEGRATION_CATALOG.find((item) => item.slug === args?.slug);
    if (!manifest) return "static_integration_unknown";
    const now = new Date().toISOString();
    const existing = tables.pluginInstallations.find((row) => row.slug === manifest.slug);
    if (existing) {
      existing.status = "installed";
      existing.updatedAtISO = now;
      existing.configJson = JSON.stringify({ manifestVersion: 1, actions: manifest.actions }, null, 2);
      return existing._id;
    }
    const row = {
      _id: `static_integration_${manifest.slug}`,
      _creationTime: Date.now(),
      societyId: args?.societyId ?? SOCIETY_ID,
      name: manifest.name,
      slug: manifest.slug,
      status: "installed",
      capabilities: manifest.capabilities,
      configJson: JSON.stringify({ manifestVersion: 1, actions: manifest.actions }, null, 2),
      installedByUserId: args?.installedByUserId,
      createdAtISO: now,
      updatedAtISO: now,
    };
    tables.pluginInstallations.push(row);
    return row._id;
  }
  if (name === "apiPlatform:updateIntegrationHealth") return null;
  if (name === "workflowPackages:createBoardPack") {
    return {
      packageId: "static_board_pack_package",
      taskIds: [
        "static_board_pack_prepare_agenda",
        "static_board_pack_attach_materials",
        "static_board_pack_send_notice",
        "static_board_pack_record_quorum",
        "static_board_pack_draft_minutes",
        "static_board_pack_publish",
      ],
    };
  }
  if (name === "recordLayouts:upsert") return "static_record_layout";
  if (name === "recordLayouts:remove") return null;
  if (name === "views:seedGovernanceDataTableViews") {
    return {
      created: ["Open AGM tasks", "Missing filing evidence", "Directors needing attestation", "Unresolved conflicts", "Grant reports due"],
      skipped: [],
    };
  }
  if (name === "workflows:setupGovernanceN8nRecipes") {
    return {
      created: ["AGM date set -> generate deadlines", "Filing due in 14 days -> notify officer", "Conflict disclosed -> add board agenda item"],
      updated: [],
    };
  }
  if (name === "seed:run") {
    void store?.reseed();
    return { societyId: SOCIETY_ID };
  }
  if (name === "seed:reset") {
    void store?.reseed();
    return { ok: true };
  }
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
  if (name === "motionBacklog:seedPipaSetup") {
    return { inserted: 0, existing: motionBacklog.length };
  }
  if (name === "motionBacklog:addToAgenda") {
    return { agendaItemId: "static_agenda_item_motion_backlog", reused: false };
  }
  if (name === "motionBacklog:seedToMinutes") {
    return { inserted: 1, considered: 1, minutesId: "static_minutes_board_q2" };
  }
  if (name === "legalOperations:seedStarterPolicyTemplates") {
    return { inserted: 18, updated: 0, skipped: 0, total: 18 };
  }
  if (name === "documents:markOpened") return { openedAtISO: new Date().toISOString() };
  if (name === "documents:updateReviewStatus") return null;
  if (name === "documentComments:create") return "static_document_comment_new";
  if (name === "documentComments:setStatus") return null;
  if (name === "documentComments:remove") return null;
  if (name === "meetings:markSourceReview") return null;
  if (name === "meetings:setPackageReviewStatus") return null;
  if (name === "meetingMaterials:attach") return "static_material_new";
  if (name === "meetingMaterials:remove") return null;
  if (name === "orgChartAssignments:upsert") return "static_org_chart_assignment";
  if (name === "orgChartAssignments:remove") return null;
  if (name === "expenseReports:upsert") return "static_expense_new";
  if (name === "expenseReports:setStatus") return null;
  if (name === "expenseReports:remove") return null;
  if (name === "documents:createPipaPolicyDraft") {
    return {
      reused: false,
      refreshed: false,
      document: {
        _id: "static_pipa_policy_draft",
        societyId: args?.societyId ?? SOCIETY_ID,
        title: `Draft PIPA privacy policy - ${society.name}`,
        category: "Policy",
        content: staticPipaPolicyDraft(),
        createdAtISO: new Date().toISOString(),
        flaggedForDeletion: false,
        retentionYears: 10,
        tags: ["privacy", "privacy-policy", "pipa", "draft", "societyer-template", "society-filled"],
      },
    };
  }
  if (name === "documents:rebuildPipaPolicyDraftFromSociety") {
    return {
      _id: args?.id ?? "static_pipa_policy_draft",
      societyId: SOCIETY_ID,
      title: `Draft PIPA privacy policy - ${society.name}`,
      category: "Policy",
      content: staticPipaPolicyDraft(),
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      retentionYears: 10,
      tags: ["privacy", "privacy-policy", "pipa", "draft", "societyer-template", "society-filled"],
    };
  }
  if (name === "documents:createMemberDataGapMemoDraft") {
    return {
      reused: false,
      document: {
        _id: "static_member_data_gap_memo_draft",
        societyId: args?.societyId ?? SOCIETY_ID,
        title: `Draft member-data access gap memo - ${society.name}`,
        category: "Policy",
        content: `# ${society.name} Member-Data Access Gap Memo\n\nStatus: Draft\n\nDocument what the society controls, what the university or parent body holds, and what evidence supports that conclusion.\n`,
        createdAtISO: new Date().toISOString(),
        flaggedForDeletion: false,
        retentionYears: 10,
        tags: ["privacy", "member-data-gap", "pipa", "draft", "societyer-template"],
      },
    };
  }
  if (name === "documents:updateDraftContent") {
    return {
      _id: args?.id ?? "static_draft_document",
      societyId: SOCIETY_ID,
      title: args?.title ?? "Draft document",
      category: "Policy",
      content: args?.content ?? "",
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      retentionYears: 10,
      tags: args?.tags ?? ["privacy", "draft"],
    };
  }
  if (name === "documents:linkPrivacyPolicyEvidence") {
    return { documentId: args?.documentId ?? DOCUMENT_POLICY_ID };
  }
  if (name === "dashboardRemediation:createComplianceReviewTask" || name === "dashboardRemediation:createPrivacyReviewTask") {
    return {
      taskId: `static_task_${args?.ruleId ?? "compliance"}`,
      remediationId: `static_remediation_${args?.ruleId ?? "compliance"}`,
      reused: false,
    };
  }
  if (name === "dashboardRemediation:markPrivacyProgramReviewed" || name === "dashboardRemediation:markMemberDataAccessReviewed") {
    return {
      remediationId: `static_remediation_${args?.ruleId ?? "compliance"}`,
      reviewedAtISO: new Date().toISOString(),
    };
  }
  if (name === "commitments:recordEvent") return `static_commitment_event_${Date.now()}`;
  if (name === "commitments:removeEvent") return null;
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
        { name: "WAVE_CLIENT_ID", required: false, secret: true, purpose: "OAuth connect link client id; value is never returned in diagnostics", present: false },
        { name: "WAVE_CLIENT_SECRET", required: false, secret: true, purpose: "OAuth connect client secret; value is never returned in diagnostics", present: false },
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
          id: "api-probe",
          label: "Wave API probe",
          status: "pass",
          message: "Static demo API probe resolved against fixture data.",
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
  if (name === "fundingSources:importStudentLevy") {
    return {
      sourceId: "static_student_levy_source",
      fundingSourceAction: "created",
      createdFeePeriods: args?.feePeriods?.length ?? 0,
      updatedFeePeriods: 0,
    };
  }
  if (name === "grantSources:addFromLibrary") {
    const librarySource = BUILT_IN_GRANT_SOURCES.find((source) => source.libraryKey === args?.libraryKey);
    if (!librarySource) return { sourceId: "static_grant_source_unknown", installed: false };
    const { profile: _profile, ...sourcePayload } = librarySource;
    const now = new Date().toISOString();
    let source = tables.grantSources.find((row) => row.libraryKey === librarySource.libraryKey);
    if (source) {
      Object.assign(source, {
        ...sourcePayload,
        societyId: args?.societyId ?? SOCIETY_ID,
        updatedAtISO: now,
      });
    } else {
      source = {
        _id: `static_grant_source_${librarySource.libraryKey}`,
        _creationTime: Date.now(),
        societyId: args?.societyId ?? SOCIETY_ID,
        ...sourcePayload,
        createdByUserId: args?.actingUserId,
        createdAtISO: now,
        updatedAtISO: now,
      };
      tables.grantSources.push(source);
    }
    const libraryProfile = BUILT_IN_GRANT_SOURCE_PROFILES.find((profile) => profile.libraryKey === librarySource.libraryKey);
    if (libraryProfile) {
      const existingProfile = tables.grantSourceProfiles.find((profile) => profile.sourceId === source._id || profile.libraryKey === librarySource.libraryKey);
      const profilePayload = {
        societyId: args?.societyId ?? SOCIETY_ID,
        sourceId: source._id,
        ...libraryProfile,
        updatedAtISO: now,
      };
      if (existingProfile) {
        Object.assign(existingProfile, profilePayload);
      } else {
        tables.grantSourceProfiles.push({
          _id: `static_grant_source_profile_${librarySource.libraryKey}`,
          _creationTime: Date.now(),
          ...profilePayload,
          createdAtISO: now,
        });
      }
    }
    return { sourceId: source._id, installed: true };
  }
  if (name === "assets:recordEvent") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    const event = {
      _id: `static_asset_event_${Date.now()}`,
      societyId: asset.societyId,
      assetId: asset._id,
      eventType: args?.event?.eventType ?? "note",
      happenedAtISO: now,
      actorName: args?.event?.actorName,
      fromCustodianName: asset.custodianName,
      toCustodianType: args?.event?.toCustodianType,
      toCustodianName: args?.event?.toCustodianName,
      responsiblePersonName: args?.event?.responsiblePersonName,
      location: args?.event?.location,
      condition: args?.event?.condition,
      expectedReturnDate: args?.event?.expectedReturnDate,
      acceptanceSignature: args?.event?.acceptanceSignature,
      documentIds: args?.event?.documentIds ?? [],
      notes: args?.event?.notes,
      createdAtISO: now,
    };
    store?.upsertRow("assetEvents", event);
    const patch: any = { updatedAtISO: now };
    if (event.eventType === "checkout" || event.eventType === "transfer") {
      patch.status = "Checked out";
      patch.custodianType = event.toCustodianType;
      patch.custodianName = event.toCustodianName;
      patch.responsiblePersonName = event.responsiblePersonName || event.toCustodianName;
      patch.expectedReturnDate = event.expectedReturnDate;
    }
    if (event.eventType === "checkin") {
      patch.status = "Available";
      patch.custodianType = "location";
      patch.custodianName = event.location;
      patch.expectedReturnDate = undefined;
    }
    if (event.location) patch.location = event.location;
    if (event.condition) patch.condition = event.condition;
    store?.upsertRow("assets", { ...asset, ...patch });
    return event._id;
  }
  if (name === "assets:scheduleMaintenance") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    const now = new Date().toISOString();
    const row = {
      _id: `static_asset_maintenance_${Date.now()}`,
      societyId: asset.societyId,
      assetId: asset._id,
      title: args?.title,
      kind: args?.kind,
      dueDate: args?.dueDate,
      status: "Scheduled",
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    };
    store?.upsertRow("assetMaintenance", row);
    store?.upsertRow("assets", { ...asset, nextMaintenanceDate: args?.dueDate, updatedAtISO: now });
    return row._id;
  }
  if (name === "assets:completeMaintenance") {
    const row = store?.getRow("assetMaintenance", args?.id) ?? byId(tables.assetMaintenance, args?.id);
    if (!row) return null;
    const now = new Date().toISOString();
    store?.upsertRow("assetMaintenance", { ...row, status: "Completed", completedAtISO: args?.completedAtISO ?? now, notes: args?.notes ?? row.notes, updatedAtISO: now });
    return args?.id;
  }
  if (name === "assets:startVerificationRun") {
    const now = new Date().toISOString();
    const assets = store?.listRows("assets", args) ?? scopedRows(tables.assets, args);
    const runId = `static_asset_verification_${Date.now()}`;
    store?.upsertRow("assetVerificationRuns", {
      _id: runId,
      societyId: args?.societyId ?? SOCIETY_ID,
      title: args?.title,
      status: "Open",
      startedAtISO: now,
      reviewerName: args?.reviewerName,
      notes: args?.notes,
      createdAtISO: now,
      updatedAtISO: now,
    });
    assets.forEach((asset: any) => {
      store?.upsertRow("assetVerificationItems", {
        _id: `static_asset_verification_item_${asset._id}_${Date.now()}`,
        societyId: asset.societyId,
        runId,
        assetId: asset._id,
        status: "pending",
        createdAtISO: now,
        updatedAtISO: now,
      });
    });
    return runId;
  }
  if (name === "assets:verifyAsset") {
    const item = store?.getRow("assetVerificationItems", args?.itemId) ?? byId(tables.assetVerificationItems, args?.itemId);
    if (!item) return null;
    const now = new Date().toISOString();
    store?.upsertRow("assetVerificationItems", {
      ...item,
      status: args?.status,
      verifiedAtISO: now,
      verifiedByName: args?.verifiedByName,
      observedLocation: args?.observedLocation,
      observedCondition: args?.observedCondition,
      notes: args?.notes,
      updatedAtISO: now,
    });
    return args?.itemId;
  }
  if (name === "assets:completeVerificationRun") {
    const run = store?.getRow("assetVerificationRuns", args?.id) ?? byId(tables.assetVerificationRuns, args?.id);
    if (!run) return null;
    const now = new Date().toISOString();
    store?.upsertRow("assetVerificationRuns", { ...run, status: "Completed", completedAtISO: now, updatedAtISO: now });
    return args?.id;
  }
  if (name === "assets:dispose") {
    const asset = store?.getRow("assets", args?.assetId) ?? byId(tables.assets, args?.assetId);
    if (!asset) return null;
    store?.upsertRow("assets", {
      ...asset,
      status: "Disposed",
      disposedAt: args?.disposedAt,
      disposalMethod: args?.disposalMethod,
      disposalReason: args?.disposalReason,
      disposalValueCents: args?.disposalValueCents,
      notes: args?.notes ?? asset.notes,
      updatedAtISO: new Date().toISOString(),
    });
    return args?.assetId;
  }
  const [moduleName, exportName] = name.split(":");
  if (exportName && /^(create|update|upsert|issue|setStatus|remove)/.test(exportName)) {
    const tableName = staticMutationTableName(moduleName, exportName);
    if (exportName.startsWith("remove")) {
      store?.removeRow(tableName, args?.id);
      return null;
    }
    const id = args?.id ?? `static_${moduleName}_${Date.now()}`;
    const existing = store?.getRow(tableName, id) ?? {};
    const patch = args?.patch && typeof args.patch === "object" ? args.patch : {};
    const row = {
      ...existing,
      ...args,
      ...patch,
      _id: id,
      societyId: args?.societyId ?? existing.societyId ?? SOCIETY_ID,
      updatedAtISO: new Date().toISOString(),
      createdAtISO: existing.createdAtISO ?? args?.createdAtISO ?? new Date().toISOString(),
    };
    delete row.id;
    delete row.patch;
    store?.upsertRow(tableName, row);
    return id;
  }
  return null;
}

function staticAgentOutput(agent: any, input: string) {
  return [
    `${agent.name} guidance`,
    "",
    `Scope: ${agent.scope}`,
    `Request: ${input}`,
    "",
    ...(agent.workflowModes?.length ? ["Supported workflow modes:", ...agent.workflowModes.map((mode: string) => `- ${mode}`), ""] : []),
    ...(agent.outputContract?.length ? ["Expected output contract:", ...agent.outputContract.map((field: string) => `- ${field}`), ""] : []),
    "Provider status: static demo deterministic stub.",
  ].join("\n");
}

type StaticDemoSeed = Record<string, any[]>;

const STATIC_DEMO_SEED: StaticDemoSeed = {
  ...tables,
  societies: [society],
};

class StaticDemoDexieDatabase extends Dexie {
  meetings!: Table<any, string>;
  minutes!: Table<any, string>;
  records!: Table<any, string>;

  constructor() {
    super("societyer-static-demo");
    this.version(1).stores({
      meetings: "_id, societyId, scheduledAt, status",
      minutes: "_id, meetingId, societyId, heldAt, status",
    });
    this.version(2).stores({
      meetings: "_id, societyId, scheduledAt, status",
      minutes: "_id, meetingId, societyId, heldAt, status",
      records: "&key, table, id, societyId",
    });
  }
}

class StaticDemoDexieStore {
  private db: StaticDemoDexieDatabase | null = null;
  private cache: StaticDemoSeed;
  private seed: StaticDemoSeed;
  private listeners = new Set<() => void>();

  constructor(seed: StaticDemoSeed) {
    this.seed = cloneStaticSeed(seed);
    this.cache = cloneStaticSeed(seed);

    if (typeof window === "undefined" || !("indexedDB" in window)) return;

    this.db = new StaticDemoDexieDatabase();
    void this.hydrate(seed).catch((error) => {
      console.warn("[societyer-demo] Dexie hydrate failed; using in-memory static data.", error);
    });
  }

  onUpdate(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  queryResult(name: string, args: StaticArgs) {
    switch (name) {
      case "agendas:getForMeeting":
        return this.agendaForMeeting(args?.meetingId);
      case "agendas:get": {
        const meetingId = String(args?.agendaId ?? "").replace(/^static_agenda_/, "");
        return this.agendaForMeeting(meetingId);
      }
      case "agendas:listForMeeting": {
        const record = this.agendaForMeeting(args?.meetingId);
        return record ? [record.agenda] : [];
      }
      case "agendas:listForSociety":
        return scopedRows(this.cache.meetings, args).map((meeting) => this.agendaSummaryForMeeting(meeting));
      case "meetings:get":
        return this.getRow("meetings", args?.id) ?? this.listRows("meetings", args)[0] ?? null;
      case "meetings:list":
        return this.listRows("meetings", args);
      case "minutes:getByMeeting":
        return this.rows("minutes").find((row) => row.meetingId === args?.meetingId) ?? null;
      case "minutes:get":
        return this.getRow("minutes", args?.id);
    }
    return undefined;
  }

  mutationResult(name: string, args: StaticArgs) {
    if (name === "meetings:update") {
      const updated = this.patchRow("meetings", args?.id, args?.patch ?? {});
      return updated?._id ?? null;
    }

    if (name === "agendas:syncForMeeting") {
      const items = Array.isArray(args?.items) ? args.items : [];
      const agendaJson = JSON.stringify(items.map((item: any) => ({
        title: String(item?.title ?? "").trim(),
        depth: item?.depth === 1 ? 1 : 0,
        type: item?.type,
        presenter: item?.presenter,
        details: item?.details,
        motionText: item?.motionText,
      })).filter((item: any) => item.title));
      const updated = this.patchRow("meetings", args?.meetingId, { agendaJson });
      const minute = this.cache.minutes.find((row) => row.meetingId === args?.meetingId);
      if (minute) {
        this.patchRow("minutes", minute._id, {
          sections: items.filter((item: any) => String(item?.title ?? "").trim()).map((item: any) => ({
            title: String(item.title).trim(),
            type: item.type || staticAgendaItemType(item.title),
            presenter: item.presenter,
            discussion: item.details ?? "",
            decisions: [],
            actionItems: [],
            depth: item.depth === 1 ? 1 : 0,
          })),
          motions: items
            .map((item: any, index: number) => ({
              text: String(item.motionText ?? "").trim(),
              outcome: "Pending",
              resolutionType: "Ordinary",
              sectionIndex: index,
              sectionTitle: item.title,
            }))
            .filter((motion: any) => motion.text),
        });
      }
      return updated ? `static_agenda_${updated._id}` : null;
    }

    if (name === "agendas:startMinutesFromAgenda") {
      const meetingId = String(args?.agendaId ?? "").replace(/^static_agenda_/, "");
      const meeting = byId(this.cache.meetings, meetingId);
      if (!meeting) return { minutesId: null, reused: false };
      const existing = this.cache.minutes.find((row) => row.meetingId === meetingId);
      if (existing) return { minutesId: existing._id, reused: true };
      const items = parseStaticAgendaItems(meeting.agendaJson);
      const now = Date.now();
      const row = {
        _id: `static_minutes_${now}`,
        _creationTime: now,
        societyId: meeting.societyId,
        meetingId,
        heldAt: meeting.scheduledAt,
        attendees: meeting.attendeeIds ?? [],
        absent: [],
        quorumMet: false,
        quorumRequired: meeting.quorumRequired,
        discussion: "",
        sections: items.map((item) => ({
          title: item.title,
          type: staticAgendaItemType(item.title),
          discussion: "",
          decisions: [],
          actionItems: [],
          depth: item.depth,
        })),
        motions: [],
        decisions: [],
        actionItems: [],
      };
      this.cache.minutes = upsertStaticRow(this.cache.minutes, row);
      void this.db?.minutes.put(cloneStaticRow(row));
      this.patchRow("meetings", meetingId, { minutesId: row._id });
      this.notify();
      return { minutesId: row._id, reused: false };
    }

    if (name === "minutes:update") {
      const updated = this.patchRow("minutes", args?.id, args?.patch ?? {});
      return updated?._id ?? null;
    }

    if (name === "minutes:create") {
      const now = Date.now();
      const row = {
        _id: args?.id ?? `static_minutes_${now}`,
        _creationTime: now,
        status: args?.status ?? "Draft",
        createdAtISO: new Date(now).toISOString(),
        updatedAtISO: new Date(now).toISOString(),
        ...args,
      };
      this.upsertRow("minutes", row);
      this.notify();
      return row._id;
    }

    return undefined;
  }

  listRows(table: string, args?: StaticArgs) {
    return scopedRows(this.rows(table), args);
  }

  getRow(table: string, id: string | undefined) {
    return byId(this.rows(table), id);
  }

  upsertRow(table: string, row: any) {
    if (!row?._id) return null;
    this.cache[table] = upsertStaticRow(this.rows(table), row);
    this.persistRow(table, row);
    this.notify();
    return row;
  }

  removeRow(table: string, id: string | undefined) {
    if (!id) return null;
    const previous = this.getRow(table, id);
    this.cache[table] = this.rows(table).filter((row) => row._id !== id);
    void this.db?.records.delete(staticRecordKey(table, id));
    if (table === "meetings" || table === "minutes") void this.db?.[table].delete(id);
    this.notify();
    return previous;
  }

  async reseed() {
    this.cache = cloneStaticSeed(this.seed);
    if (!this.db) {
      this.notify();
      return;
    }
    await this.db.open();
    await Promise.all([
      this.db.records.clear(),
      this.db.meetings.clear(),
      this.db.minutes.clear(),
    ]);
    await this.writeSeed(this.seed);
    this.notify();
  }

  private agendaSummaryForMeeting(meeting: any) {
    return {
      _id: `static_agenda_${meeting._id}`,
      societyId: meeting.societyId,
      meetingId: meeting._id,
      title: `${meeting.title} agenda`,
      status: "Draft",
      createdAtISO: meeting.scheduledAt,
      updatedAtISO: meeting.updatedAtISO ?? meeting.scheduledAt,
    };
  }

  private agendaForMeeting(meetingId: string | undefined) {
    const meeting = byId(this.cache.meetings, meetingId);
    if (!meeting) return null;
    const items = parseStaticAgendaItems(meeting.agendaJson).map((entry, order) => ({
      _id: `static_agenda_item_${meeting._id}_${order}`,
      societyId: meeting.societyId,
      agendaId: `static_agenda_${meeting._id}`,
      order,
      type: staticAgendaItemType(entry.title),
      title: entry.title,
      depth: entry.depth,
      createdAtISO: meeting.scheduledAt,
    }));
    if (items.length === 0) return null;
    return { agenda: this.agendaSummaryForMeeting(meeting), items };
  }

  private async hydrate(seed: StaticDemoSeed) {
    if (!this.db) return;

    await this.db.open();
    if ((await this.db.records.count()) === 0) {
      const [legacyMeetings, legacyMinutes] = await Promise.all([
        this.db.meetings.toArray(),
        this.db.minutes.toArray(),
      ]);
      await this.writeSeed({
        ...seed,
        meetings: legacyMeetings.length ? legacyMeetings : seed.meetings,
        minutes: legacyMinutes.length ? legacyMinutes : seed.minutes,
      });
    } else {
      await this.putMissingSeedRows(seed);
    }

    const localRecords = await this.db.records.toArray();
    const next = cloneStaticSeed(seed);
    for (const record of localRecords) {
      if (!record?.table || !record?.value?._id) continue;
      next[record.table] = upsertStaticRow(next[record.table] ?? [], record.value);
    }

    this.cache = next;
    this.notify();
  }

  private async writeSeed(seed: StaticDemoSeed) {
    if (!this.db) return;
    const records = Object.entries(seed).flatMap(([table, rows]) =>
      rows.filter((row) => row?._id).map((row) => staticRecord(table, row)),
    );
    if (records.length) await this.db.records.bulkPut(records);
    await Promise.all([
      seed.meetings?.length ? this.db.meetings.bulkPut(cloneStaticRows(seed.meetings)) : Promise.resolve(),
      seed.minutes?.length ? this.db.minutes.bulkPut(cloneStaticRows(seed.minutes)) : Promise.resolve(),
    ]);
  }

  private async putMissingSeedRows(seed: StaticDemoSeed) {
    if (!this.db) return;
    const missing: any[] = [];
    for (const [table, rows] of Object.entries(seed)) {
      for (const row of rows) {
        if (!row?._id) continue;
        if (!(await this.db.records.get(staticRecordKey(table, row._id)))) missing.push(staticRecord(table, row));
      }
    }
    if (missing.length) await this.db.records.bulkPut(missing);
  }

  private rows(table: string) {
    return this.cache[table] ?? [];
  }

  private patchRow(table: string, id: string | undefined, patch: Record<string, any>) {
    if (!id) return null;
    const existing = this.rows(table).find((row) => row._id === id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAtISO: new Date().toISOString() };
    this.upsertRow(table, updated);
    this.notify();
    return updated;
  }

  private persistRow(table: string, row: any) {
    void this.db?.records.put(staticRecord(table, row));
    if (table === "meetings" || table === "minutes") void this.db?.[table].put(cloneStaticRow(row));
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

function cloneStaticRow<T>(row: T): T {
  return JSON.parse(JSON.stringify(row));
}

function cloneStaticRows<T>(rows: T[]): T[] {
  return rows.map((row) => cloneStaticRow(row));
}

function cloneStaticSeed(seed: StaticDemoSeed): StaticDemoSeed {
  return Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, cloneStaticRows(rows)]));
}

function staticRecordKey(table: string, id: string) {
  return `${table}:${id}`;
}

function staticRecord(table: string, row: any) {
  return {
    key: staticRecordKey(table, row._id),
    table,
    id: row._id,
    societyId: row.societyId,
    value: cloneStaticRow(row),
  };
}

function staticTableNameForModule(moduleName: string) {
  if (moduleName === "society") return "societies";
  return moduleName;
}

function staticMutationTableName(moduleName: string, exportName: string) {
  if (moduleName === "society") return "societies";
  if (moduleName === "organizationDetails" && exportName.includes("Address")) return "organizationAddresses";
  if (moduleName === "organizationDetails" && exportName.includes("Registration")) return "organizationRegistrations";
  if (moduleName === "organizationDetails" && exportName.includes("Identifier")) return "organizationIdentifiers";
  if (moduleName === "volunteers" && exportName.includes("Screening")) return "volunteerScreenings";
  if (moduleName === "volunteers" && exportName.includes("Application")) return "volunteerApplications";
  if (moduleName === "fundingSources" && exportName.includes("Event")) return "fundingSourceEvents";
  if (moduleName === "fundingSources") return "fundingSources";
  if (moduleName === "financialHub" && exportName.includes("Budget")) return "budgets";
  if (moduleName === "financialHub" && exportName.includes("OperatingSubscription")) return "operatingSubscriptions";
  if (moduleName === "transparency") return "transparency";
  return staticTableNameForModule(moduleName);
}

function upsertStaticRow(rows: any[], row: any) {
  const index = rows.findIndex((candidate) => candidate._id === row._id);
  if (index === -1) return [...rows, row];
  const next = rows.slice();
  next[index] = row;
  return next;
}

async function putMissingStaticRows(table: Table<any, string>, seedRows: any[]) {
  const missing: any[] = [];
  for (const row of seedRows) {
    if (!(await table.get(row._id))) missing.push(cloneStaticRow(row));
  }
  if (missing.length) await table.bulkPut(missing);
}

function staticModelCatalog(provider: string) {
  const models = provider === "openrouter"
    ? [
        staticModel("openai/gpt-4.1-mini", "GPT-4.1 Mini", "openai", 1_000_000, true, false, false, "0.0000004", "0.0000016"),
        staticModel("openai/gpt-4.1", "GPT-4.1", "openai", 1_000_000, true, false, false, "0.000002", "0.000008"),
        staticModel("anthropic/claude-sonnet-4", "Claude Sonnet 4", "anthropic", 200_000, true, true, false, "0.000003", "0.000015"),
        staticModel("google/gemini-2.5-pro", "Gemini 2.5 Pro", "google", 1_000_000, true, true, false, "0.00000125", "0.00001"),
        staticModel("meta-llama/llama-3.1-70b-instruct:free", "Llama 3.1 70B Instruct Free", "meta-llama", 131_000, false, false, true, "0", "0"),
      ]
    : [
        staticModel("gpt-4.1-mini", "GPT-4.1 Mini", "openai", 1_000_000, true, false, false, "0.0000004", "0.0000016"),
        staticModel("gpt-4.1", "GPT-4.1", "openai", 1_000_000, true, false, false, "0.000002", "0.000008"),
        staticModel("gpt-4o-mini", "GPT-4o Mini", "openai", 128_000, true, true, false, "0.00000015", "0.0000006"),
      ];
  return {
    provider,
    cached: true,
    stale: false,
    fetchedAtISO: new Date().toISOString(),
    recommendedIds: models.map((model) => model.id),
    models,
    categories: {
      recommended: models.slice(0, 4),
      fastCheap: models.filter((model) => model.isFree || Number(model.promptPrice) < 0.000001),
      reasoning: models.filter((model) => /gpt-4\.1|claude|gemini/i.test(model.id)),
      coding: models.filter((model) => /gpt|claude|llama/i.test(model.id)),
      vision: models.filter((model) => model.supportsVision),
      free: models.filter((model) => model.isFree),
      tools: models.filter((model) => model.supportsTools),
      all: models,
    },
  };
}

function staticModel(
  id: string,
  name: string,
  provider: string,
  contextLength: number,
  supportsTools: boolean,
  supportsVision: boolean,
  isFree: boolean,
  promptPrice: string,
  completionPrice: string,
) {
  return {
    id,
    name,
    provider,
    contextLength,
    promptPrice,
    completionPrice,
    inputModalities: supportsVision ? ["text", "image"] : ["text"],
    outputModalities: ["text"],
    supportedParameters: supportsTools ? ["tools", "temperature", "max_tokens", "response_format"] : ["temperature", "max_tokens"],
    supportsTools,
    supportsVision,
    supportsStructuredOutputs: supportsTools,
    isFree,
  };
}

export class StaticConvexClient {
  private store = new StaticDemoDexieStore(STATIC_DEMO_SEED);

  get url() {
    return "static://societyer-demo";
  }

  watchQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => mutableQueryResult(name, args, this.store),
      journal: () => undefined,
    };
  }

  watchPaginatedQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => ({
        results: mutableQueryResult(name, args, this.store) ?? [],
        status: "Exhausted",
        loadMore: () => undefined,
      }),
    };
  }

  query(query: any, args?: StaticArgs) {
    return Promise.resolve(mutableQueryResult(functionName(query), args, this.store));
  }

  mutation(mutation: any, args?: StaticArgs) {
    return Promise.resolve(mutationResult(functionName(mutation), args, this.store));
  }

  action(action: any, args?: StaticArgs) {
    return Promise.resolve(mutationResult(functionName(action), args, this.store));
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

  reseedStaticDemo() {
    return this.store.reseed();
  }
}

export const staticConvex = new StaticConvexClient();

export function reseedStaticDemoData() {
  return staticConvex.reseedStaticDemo();
}
