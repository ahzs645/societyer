// Workflow recipe DATA (types + constant definitions/samples) extracted from
// workflowCatalog.ts. Pure literals + enums; no engine/helper dependencies.

import { type WorkflowProvider } from "../shared/workflows/schemas";

type RecipeStep = {
  key: string;
  label: string;
  note?: string;
};


type NodePreview = {
  key: string;
  type:
    | "manual_trigger"
    | "form"
    | "pdf_fill"
    | "document_create"
    | "email"
    | "ai_agent"
    | "external_n8n";
  label: string;
  description?: string;
  status?: "draft" | "ready" | "needs_setup";
  config?: Record<string, any>;
};


type RecipeKey =
  | "workspace_onboarding"
  | "agm_prep"
  | "insurance_renewal"
  | "annual_report_filing"
  | "agm_date_deadlines"
  | "filing_due_notify_officer"
  | "conflict_disclosed_agenda_item"
  | "unbc_affiliate_id_request"
  | "unbc_key_access_request"
  | "ote_keycard_access_request"
  | "csj_remote_worker_orientation";


const UNBC_AFFILIATE_FIELDS = [
  "Legal First Name of Affiliate",
  "Legal Middle Name of Affiliate",
  "Legal Last Name of Affiliate",
  "Current Mailing Address",
  "Emergency Contact(Name and Ph)",
  "UNBC ID #",
  "Birthdate of Affiliate (MM/DD/YYYY)",
  "Personal email address",
  "Name of requesting Manager",
  "UNBC Department/Organization",
  "Length of Affiliate status(lf known)",
  "ManagerPhone",
  "Manager Email",
  "Authorizing Name (if different from Manager)",
  "Date signed",
  "Check Box0",
  "Check Box1",
];


const UNBC_KEY_ACCESS_FIELDS = [
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
  "Budget Holder Approval Name - Print",
  "Budget Holder Approval Signature",
  "Fund",
  "Org",
  "Account",
  "Authorizing Authority Signature",
  "Checkbox - Other",
  "Checkbox - TA/RA",
  "Checkbox - Student",
  "Checkbox - Faculty",
  "Checkbox - Staff",
  "Account Codes",
  "DIRECTOR OF FACILITIES MANAGEMENT or DESIGNATE",
  "SIGNATURE FOR RECEIPT OF KEY",
  "Physical Key",
  "TS1000",
  "Encoded",
  "AFX",
  "Pinned",
  "Cash",
  "Cheque",
];


const UNBC_KEY_ACCESS_INTAKE_FIELDS = [
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
];


const RECIPE_LABELS: Record<RecipeKey, string> = {
  workspace_onboarding: "Workspace onboarding",
  agm_prep: "AGM prep",
  insurance_renewal: "Insurance renewal reminder",
  annual_report_filing: "Annual report filing",
  agm_date_deadlines: "AGM date set -> generate deadlines",
  filing_due_notify_officer: "Filing due in 14 days -> notify officer",
  conflict_disclosed_agenda_item: "Conflict disclosed -> add board agenda item",
  unbc_affiliate_id_request: "UNBC Affiliate ID Request",
  unbc_key_access_request: "UNBC Key & Access Request",
  ote_keycard_access_request: "OTE Individual Access Request",
  csj_remote_worker_orientation: "CSJ Remote Worker Orientation",
};


const RECIPE_DESCRIPTIONS: Record<RecipeKey, string> = {
  workspace_onboarding:
    "Starts a new society workspace with the essentials, then leaves registry verification and advanced setup as optional follow-up work.",
  agm_prep:
    "T-minus reminders before an AGM — draft agenda, queue notice-of-meeting, confirm quorum threshold.",
  insurance_renewal:
    "Watches insurancePolicies.renewalDate and pings the board 60/30/7 days before each policy lapses.",
  annual_report_filing:
    "When the annual-report filing is due, runs the Societies Online filing bot and records the confirmation.",
  agm_date_deadlines:
    "n8n recipe metadata for turning a newly set AGM date into notice, package, minutes, and annual-report deadlines.",
  filing_due_notify_officer:
    "n8n recipe metadata for notifying the responsible officer when an unfiled governance filing reaches its 14-day window.",
  conflict_disclosed_agenda_item:
    "n8n recipe metadata for adding a disclosed conflict to the next board agenda for acknowledgement and management.",
  unbc_affiliate_id_request:
    "Collects affiliate intake, hands execution to n8n, fills the UNBC PDF, and saves the generated document.",
  unbc_key_access_request:
    "Collects key/access request intake, fills the UNBC Facilities PDF, and stages the generated request for review.",
  ote_keycard_access_request:
    "Sends an Over the Edge individual access request through n8n, then queues the Facilities email draft.",
  csj_remote_worker_orientation:
    "Grant-specific system workflow for Canada Summer Jobs onboarding: send Young Workers resources, remote safety orientation links, and retain evidence for the EED attestation.",
};


const RECIPE_PROVIDERS: Record<RecipeKey, WorkflowProvider> = {
  workspace_onboarding: "internal",
  agm_prep: "internal",
  insurance_renewal: "internal",
  annual_report_filing: "internal",
  agm_date_deadlines: "n8n",
  filing_due_notify_officer: "n8n",
  conflict_disclosed_agenda_item: "n8n",
  unbc_affiliate_id_request: "n8n",
  unbc_key_access_request: "n8n",
  ote_keycard_access_request: "n8n",
  csj_remote_worker_orientation: "internal",
};


const RECIPE_STEPS: Record<RecipeKey, RecipeStep[]> = {
  workspace_onboarding: [
    { key: "profile", label: "Create society profile" },
    { key: "registry_optional", label: "Optionally verify BC Registry access" },
    { key: "locations", label: "Set registered locations" },
    { key: "documents", label: "Add governance documents" },
    { key: "people", label: "Add people and workspace access" },
    { key: "optional_setup", label: "Choose optional setup areas to finish later" },
  ],
  agm_prep: [
    { key: "collect_rosters", label: "Collect active members and director roster" },
    { key: "draft_agenda", label: "Draft agenda from bylaw-required items" },
    { key: "queue_notice", label: "Queue notice-of-meeting communication" },
    { key: "confirm_quorum", label: "Confirm quorum threshold and proxy window" },
    { key: "chair_reminder", label: "Open dashboard reminder for the chair" },
  ],
  insurance_renewal: [
    { key: "scan_policies", label: "Scan insurance policies nearing renewal" },
    { key: "compare_coverage", label: "Compare coverage to funder requirements" },
    { key: "notify_board", label: "Notify responsible director + treasurer" },
    { key: "open_task", label: "Open a renewal task with broker contact" },
  ],
  annual_report_filing: [
    { key: "locate_filing", label: "Locate the open AnnualReport filing" },
    { key: "run_bot", label: "Hand off to the Societies Online filing bot" },
    { key: "record_confirmation", label: "Record confirmation number on the filing" },
  ],
  agm_date_deadlines: [
    { key: "agm_date_set", label: "Receive AGM date set event" },
    { key: "calculate_deadlines", label: "Calculate governance deadlines in n8n" },
    { key: "create_deadline_records", label: "Create Societyer deadline records" },
    { key: "notify_officers", label: "Notify chair and secretary" },
  ],
  filing_due_notify_officer: [
    { key: "scan_due_filings", label: "Find unfiled filings due in 14 days" },
    { key: "prepare_notice", label: "Prepare officer notification in n8n" },
    { key: "send_notice", label: "Send notification and link filing record" },
  ],
  conflict_disclosed_agenda_item: [
    { key: "conflict_disclosed", label: "Receive conflict disclosure event" },
    { key: "find_board_meeting", label: "Find next board meeting" },
    { key: "add_agenda_item", label: "Add conflict acknowledgement agenda item" },
    { key: "notify_secretary", label: "Notify secretary for review" },
  ],
  unbc_affiliate_id_request: [
    { key: "manual", label: "Launch manually" },
    { key: "intake", label: "Affiliate intake form" },
    { key: "fill_pdf", label: "Fill UNBC ID PDF" },
    { key: "save_document", label: "Save generated PDF" },
    { key: "notify", label: "Notify/request manager review" },
  ],
  unbc_key_access_request: [
    { key: "manual", label: "Launch manually" },
    { key: "intake", label: "Key/access intake form" },
    { key: "fill_pdf", label: "Fill key request PDF" },
    { key: "save_document", label: "Save generated PDF" },
    { key: "notify", label: "Notify Facilities review" },
  ],
  ote_keycard_access_request: [
    { key: "manual", label: "Launch manually" },
    { key: "access_change", label: "Select individual for access" },
    { key: "facilities_email", label: "Queue Facilities email draft" },
  ],
  csj_remote_worker_orientation: [
    { key: "select_employee", label: "Select funded employee" },
    { key: "queue_orientation_email", label: "Queue Young Workers orientation email" },
    { key: "orientation_meeting", label: "Schedule/review virtual safety orientation" },
    { key: "retain_evidence", label: "Retain evidence for GCOS EED attestation" },
  ],
};


const UNBC_DOCUMENT_DEFAULTS = {
  category: "WorkflowGenerated",
  tags: ["workflow-generated", "unbc-affiliate-id"],
  retentionYears: 10,
  titleTemplate: "UNBC Affiliate ID Request - {{intake.legal_first_name_of_affiliate}} {{intake.legal_last_name_of_affiliate}}",
  changeNote: "Generated by UNBC Affiliate ID Request workflow.",
};


const UNBC_EMAIL_DEFAULTS = {
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
};


const UNBC_KEY_DOCUMENT_DEFAULTS = {
  category: "WorkflowGenerated",
  tags: ["workflow-generated", "unbc-key-access-request"],
  retentionYears: 10,
  titleTemplate: "UNBC Key Access Request - {{intake.first_name}} {{intake.last_name}}",
  changeNote: "Generated by UNBC Key & Access Request workflow.",
};


const UNBC_KEY_EMAIL_DEFAULTS = {
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
};


const OTE_KEYCARD_EMAIL_DEFAULTS = {
  fromName: "Over the Edge",
  fromEmail: "ote@unbc.ca",
  to: "facilities@unbc.ca",
  subject: "Keycard access",
  body: [
    "Hello There,",
    "",
    "Can you provide keycard access for {{intake.access_person_name}}{{intake.access_person_context}}?",
    "",
    "Thanks,",
    "{{intake.sender_name}}",
    "{{intake.sender_title}}",
  ].join("\n"),
};


const OTE_KEYCARD_INTAKE_FIELDS = [
  {
    key: "access_person",
    label: "Individual needing access",
    type: "person",
    required: true,
    categories: ["directors", "volunteers", "employees"],
    helpText: "Pick a director, volunteer, or employee from the existing records.",
  },
  { key: "access_person_name", label: "Individual name", type: "text", required: false, isHidden: true },
  { key: "access_person_email", label: "Individual email", type: "email", required: false, isHidden: true },
  { key: "access_person_context", label: "Role/context", type: "text", required: false, isHidden: true },
  { key: "access_scope", label: "Access needed", type: "text", required: true, defaultValue: "keycard access" },
  { key: "access_notes", label: "Access notes", type: "textarea", required: false },
  { key: "sender_name", label: "Sender name", type: "text", required: true },
  { key: "sender_title", label: "Sender title", type: "text", required: true },
  { key: "from_name", label: "From name", type: "text", required: true },
  { key: "from_email", label: "From email", type: "email", required: true },
  { key: "facilities_email", label: "Facilities email", type: "email", required: true },
  { key: "request_subject", label: "Subject", type: "text", required: true },
  { key: "source_sent_at_iso", label: "Original sent timestamp", type: "text", required: false, isHidden: true },
];


const CSJ_ORIENTATION_EMAIL_DEFAULTS = {
  fromName: "Over the Edge",
  fromEmail: "ote@unbc.ca",
  subject: "Canada Summer Jobs remote work orientation resources",
  body: [
    "Hi {{employee.firstName}},",
    "",
    "Thanks for completing the required documentation, no need to worry about the employee number, we will do that on our end. Since you'll be working primarily remotely, I've gathered some resources that we'll review during your virtual orientation in your first week.",
    "",
    "Young Workers Website",
    "Please review: https://www.ccohs.ca/youngworkers",
    "This covers your rights, health and safety basics, and workplace responsibilities.",
    "",
    "Virtual Health and Safety Orientation",
    "We'll conduct a video call orientation covering remote work safety:",
    "- Home Office Ergonomics: https://www.ccohs.ca/oshanswers/ergonomics/office",
    "- Digital Equipment Safety: We'll review proper setup for your computer, software access, and digital security.",
    "- Remote Emergency Procedures: Contact information, reporting protocols, and what to do in case of power/internet outages.",
    "- Remote Work Safety Checks: Tips for maintaining a safe home workspace.",
    "",
    "Remote Work and Employment Policies",
    "While we don't have formal written policies, we'll discuss expectations for remote work including:",
    "- Harassment Prevention: BC Human Rights Code basics: https://www2.gov.bc.ca/gov/content/justice/human-rights",
    "- Digital Communication Guidelines: Professional expectations for email, messaging, and video calls.",
    "- Conflict Resolution: Virtual open-door policy and how to raise concerns remotely.",
    "- Privacy and Confidentiality: Protecting organizational data when working from home.",
    "- Work Hours and Boundaries: Setting healthy remote work practices.",
    "",
    "BC Employment Standards for Remote Workers",
    "Review your rights: https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards",
    "",
    "Additional Remote Work Resources",
    "- Health tips for remote workers: https://www.ccohs.ca/oshanswers/hsprograms/telework.html",
    "- WorkSafeBC remote work guidelines: https://www.worksafebc.com/en/resources/health-safety/information-sheets/working-from-home-guide-keeping-workers-healthy-safe?lang=en",
    "",
    "Please review these resources before our virtual orientation meeting.",
    "",
    "Looking forward to having you join our team!",
    "",
    "Best regards,",
    "",
    "Ahmad Jalil",
  ].join("\n"),
};


const RECIPE_NODE_PREVIEWS: Partial<Record<RecipeKey, NodePreview[]>> = {
  workspace_onboarding: [
    {
      key: "profile",
      type: "form",
      label: "Society profile",
      description: "Legal name, incorporation number/date, fiscal year end, jurisdiction, purposes, charity/member-funded flags, and official email.",
      status: "ready",
    },
    {
      key: "registry_optional",
      type: "form",
      label: "Registry verification",
      description: "Optional check for registry status, last annual report, filing history, key custody, authorized filers, and BC Registry connector setup.",
      status: "draft",
    },
    {
      key: "locations",
      type: "form",
      label: "Registered locations",
      description: "Registered office, mailing address, and records location only when records are kept somewhere else.",
      status: "ready",
    },
    {
      key: "documents",
      type: "document_create",
      label: "Governance documents",
      description: "Start with constitution, bylaws, certificate or registry summary, statement of directors/registered office, and latest annual report if available.",
      status: "ready",
    },
    {
      key: "people",
      type: "form",
      label: "People",
      description: "Add directors, known officers, privacy officer, workspace users, and signing authorities if known.",
      status: "ready",
    },
    {
      key: "optional_setup",
      type: "manual_trigger",
      label: "Optional setup",
      description: "Skip or choose later: annual calendar, member register, finance controls, privacy program, insurance/risk, integrations, and board adoption packet.",
      status: "draft",
    },
  ],
  agm_date_deadlines: [
    {
      key: "agm_date_set",
      type: "external_n8n",
      label: "AGM date set webhook",
      description: "n8n receives the AGM meeting id and scheduled date from Societyer or another governance source.",
      status: "needs_setup",
    },
    {
      key: "calculate_deadlines",
      type: "external_n8n",
      label: "Calculate statutory and bylaw deadlines",
      description: "Template metadata covers notice window, board package target, minutes approval, and annual-report filing due date.",
      status: "draft",
    },
    {
      key: "create_deadline_records",
      type: "external_n8n",
      label: "Create deadline records",
      description: "n8n calls Societyer APIs to create or update governance deadline rows; Societyer does not run this recipe internally.",
      status: "draft",
    },
    {
      key: "notify_officers",
      type: "email",
      label: "Notify chair and secretary",
      description: "n8n sends the setup summary and links the AGM workspace.",
      status: "draft",
    },
  ],
  filing_due_notify_officer: [
    {
      key: "scan_due_filings",
      type: "external_n8n",
      label: "14-day filing scan",
      description: "n8n owns the schedule and queries Societyer for unfiled governance filings due in 14 days.",
      status: "needs_setup",
    },
    {
      key: "prepare_notice",
      type: "external_n8n",
      label: "Prepare officer notice",
      description: "Builds a notification with filing type, deadline, portal link, and evidence requirements.",
      status: "draft",
    },
    {
      key: "send_notice",
      type: "email",
      label: "Notify responsible officer",
      description: "n8n sends the reminder and records a callback on the workflow run.",
      status: "draft",
    },
  ],
  conflict_disclosed_agenda_item: [
    {
      key: "conflict_disclosed",
      type: "external_n8n",
      label: "Conflict disclosure webhook",
      description: "n8n receives a disclosed conflict event with director, matter, and disclosure date metadata.",
      status: "needs_setup",
    },
    {
      key: "find_board_meeting",
      type: "external_n8n",
      label: "Find next board meeting",
      description: "Queries Societyer for the next scheduled board meeting that can receive the agenda item.",
      status: "draft",
    },
    {
      key: "add_agenda_item",
      type: "external_n8n",
      label: "Add agenda item",
      description: "n8n creates or stages an agenda item for conflict acknowledgement and recusal handling.",
      status: "draft",
    },
    {
      key: "notify_secretary",
      type: "email",
      label: "Notify secretary",
      description: "Sends a review prompt so the secretary can confirm wording before the agenda is circulated.",
      status: "draft",
    },
  ],
  unbc_affiliate_id_request: [
    {
      key: "manual",
      type: "manual_trigger",
      label: "Launch manually",
      description: "A Societyer user starts the affiliate request.",
      status: "ready",
    },
    {
      key: "intake",
      type: "form",
      label: "Affiliate intake form",
      description: "Collects the fields that map to the UNBC AcroForm widgets.",
      status: "ready",
    },
    {
      key: "fill_pdf",
      type: "pdf_fill",
      label: "Fill UNBC ID PDF",
      description: "n8n calls Societyer's PDF fill endpoint using the configured local template path.",
      status: "needs_setup",
    },
    {
      key: "save_document",
      type: "document_create",
      label: "Save generated PDF",
      description: "Stores the generated affiliate request as a Societyer document.",
      status: "ready",
      config: {
        category: UNBC_DOCUMENT_DEFAULTS.category,
        tags: UNBC_DOCUMENT_DEFAULTS.tags,
        retentionYears: UNBC_DOCUMENT_DEFAULTS.retentionYears,
        titleTemplate: UNBC_DOCUMENT_DEFAULTS.titleTemplate,
        changeNote: UNBC_DOCUMENT_DEFAULTS.changeNote,
      },
    },
    {
      key: "notify",
      type: "email",
      label: "Notify UNBC processing",
      description: "Queues an Outbox email to UNBC Employment Processing with the generated PDF attached.",
      status: "ready",
      config: {
        to: UNBC_EMAIL_DEFAULTS.to,
        subject: UNBC_EMAIL_DEFAULTS.subject,
        body: UNBC_EMAIL_DEFAULTS.body,
      },
    },
  ],
  unbc_key_access_request: [
    {
      key: "manual",
      type: "manual_trigger",
      label: "Launch manually",
      description: "A Societyer user starts the key/access request.",
      status: "ready",
    },
    {
      key: "intake",
      type: "form",
      label: "Key/access intake form",
      description: "Collects the requester and room/access rows that map to the Facilities AcroForm.",
      status: "ready",
    },
    {
      key: "fill_pdf",
      type: "pdf_fill",
      label: "Fill key request PDF",
      description: "n8n calls Societyer's generic PDF fill endpoint using the configured key request template.",
      status: "needs_setup",
    },
    {
      key: "save_document",
      type: "document_create",
      label: "Save generated PDF",
      description: "Stores the generated key/access request as a Societyer document.",
      status: "ready",
      config: {
        category: UNBC_KEY_DOCUMENT_DEFAULTS.category,
        tags: UNBC_KEY_DOCUMENT_DEFAULTS.tags,
        retentionYears: UNBC_KEY_DOCUMENT_DEFAULTS.retentionYears,
        titleTemplate: UNBC_KEY_DOCUMENT_DEFAULTS.titleTemplate,
        changeNote: UNBC_KEY_DOCUMENT_DEFAULTS.changeNote,
      },
    },
    {
      key: "notify",
      type: "email",
      label: "Notify Facilities review",
      description: "Queues an Outbox draft with the generated key/access PDF attached.",
      status: "needs_setup",
      config: {
        to: UNBC_KEY_EMAIL_DEFAULTS.to,
        subject: UNBC_KEY_EMAIL_DEFAULTS.subject,
        body: UNBC_KEY_EMAIL_DEFAULTS.body,
      },
    },
  ],
  ote_keycard_access_request: [
    {
      key: "manual",
      type: "manual_trigger",
      label: "Launch manually",
      description: "A Societyer user starts the Over the Edge keycard access workflow.",
      status: "ready",
    },
    {
      key: "access_change",
      type: "form",
      label: "Select individual for access",
      description: "Picks a director, volunteer, or employee and captures the sender identity for the Facilities request.",
      status: "ready",
      config: {
        fields: OTE_KEYCARD_INTAKE_FIELDS,
      },
    },
    {
      key: "facilities_email",
      type: "email",
      label: "Queue Facilities email draft",
      description: "Queues an Outbox draft addressed to UNBC Facilities from the OTE mailbox identity.",
      status: "ready",
      config: {
        fromName: OTE_KEYCARD_EMAIL_DEFAULTS.fromName,
        fromEmail: OTE_KEYCARD_EMAIL_DEFAULTS.fromEmail,
        to: OTE_KEYCARD_EMAIL_DEFAULTS.to,
        subject: OTE_KEYCARD_EMAIL_DEFAULTS.subject,
        body: OTE_KEYCARD_EMAIL_DEFAULTS.body,
      },
    },
  ],
  csj_remote_worker_orientation: [
    {
      key: "select_employee",
      type: "manual_trigger",
      label: "Select funded employee",
      description: "Start from a linked Canada Summer Jobs funded employee on the grant page.",
      status: "ready",
    },
    {
      key: "queue_orientation_email",
      type: "email",
      label: "Queue orientation email",
      description: "Creates an Outbox draft with Young Workers, remote work safety, Employment Standards, and WorkSafeBC links.",
      status: "ready",
      config: {
        fromName: CSJ_ORIENTATION_EMAIL_DEFAULTS.fromName,
        fromEmail: CSJ_ORIENTATION_EMAIL_DEFAULTS.fromEmail,
        subject: CSJ_ORIENTATION_EMAIL_DEFAULTS.subject,
        body: CSJ_ORIENTATION_EMAIL_DEFAULTS.body,
      },
    },
    {
      key: "orientation_meeting",
      type: "form",
      label: "Review during orientation",
      description: "Use the email and meeting notes as evidence that the Young Workers information was shared.",
      status: "ready",
    },
    {
      key: "retain_evidence",
      type: "document_create",
      label: "Retain EED evidence",
      description: "Keep the sent email or orientation note with the grant evidence packet before confirming the GCOS EED attestation.",
      status: "ready",
    },
  ],
};


const UNBC_SAMPLE_AFFILIATE = {
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
};


const UNBC_SAMPLE_KEY_REQUEST = {
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
  Other: "",
  "Authorizing Authority Name - Print": "Sample Authorizer",
  "Building / Room Number": "Building A / 101",
  "Building / Room Number 2": "",
  "Building / Room Number 3": "",
  "Building / Room Number 4": "",
  "Building / Room Number 5": "",
  "Checkbox - Staff": true,
  "Checkbox - Faculty": false,
  "Checkbox - Student": false,
  "Checkbox - TA/RA": false,
  "Checkbox - Other": false,
};


const OTE_SAMPLE_KEYCARD_REQUEST = {
  access_person: {
    category: "directors",
    recordId: "",
    name: "Nazanin Parvizi",
    email: "",
    role: "Director",
  },
  access_person_name: "Nazanin Parvizi",
  access_person_email: "",
  access_person_context: " (Director)",
  access_scope: "keycard access",
  access_notes: "",
  sender_name: "Ahmad Jalil",
  sender_title: "Editor in Chief",
  from_name: "Over the Edge",
  from_email: "ote@unbc.ca",
  facilities_email: "facilities@unbc.ca",
  request_subject: "Keycard access",
  source_sent_at_iso: "2026-04-10T14:34:00-07:00",
  source_sent_at_display: "Friday, April 10, 2026 2:34 PM",
};



export {
  UNBC_AFFILIATE_FIELDS,
  UNBC_KEY_ACCESS_FIELDS,
  UNBC_KEY_ACCESS_INTAKE_FIELDS,
  RECIPE_LABELS,
  RECIPE_DESCRIPTIONS,
  RECIPE_PROVIDERS,
  RECIPE_STEPS,
  UNBC_DOCUMENT_DEFAULTS,
  UNBC_EMAIL_DEFAULTS,
  UNBC_KEY_DOCUMENT_DEFAULTS,
  UNBC_KEY_EMAIL_DEFAULTS,
  OTE_KEYCARD_EMAIL_DEFAULTS,
  OTE_KEYCARD_INTAKE_FIELDS,
  CSJ_ORIENTATION_EMAIL_DEFAULTS,
  RECIPE_NODE_PREVIEWS,
  UNBC_SAMPLE_AFFILIATE,
  UNBC_SAMPLE_KEY_REQUEST,
  OTE_SAMPLE_KEYCARD_REQUEST,
};

export type {
  RecipeStep,
  NodePreview,
  RecipeKey,
};
