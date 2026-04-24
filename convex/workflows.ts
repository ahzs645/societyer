// @ts-nocheck
import { v } from "convex/values";
import {
  query,
  mutation,
  action,
  internalMutation,
  internalAction,
  internalQuery,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireRole } from "./users";
import { PDFDocument } from "pdf-lib";
import {
  buildPdfTableImportBundle,
  normalizePdfTableStructures,
} from "./lib/pdfTableNormalization";

type WorkflowProvider = "internal" | "n8n";

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
    | "external_n8n";
  label: string;
  description?: string;
  status?: "draft" | "ready" | "needs_setup";
  config?: Record<string, any>;
};

type RecipeKey =
  | "agm_prep"
  | "insurance_renewal"
  | "annual_report_filing"
  | "unbc_affiliate_id_request"
  | "unbc_key_access_request"
  | "ote_keycard_access_request";

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
  agm_prep: "AGM prep",
  insurance_renewal: "Insurance renewal reminder",
  annual_report_filing: "Annual report filing",
  unbc_affiliate_id_request: "UNBC Affiliate ID Request",
  unbc_key_access_request: "UNBC Key & Access Request",
  ote_keycard_access_request: "OTE Individual Access Request",
};

const RECIPE_DESCRIPTIONS: Record<RecipeKey, string> = {
  agm_prep:
    "T-minus reminders before an AGM — draft agenda, queue notice-of-meeting, confirm quorum threshold.",
  insurance_renewal:
    "Watches insurancePolicies.renewalDate and pings the board 60/30/7 days before each policy lapses.",
  annual_report_filing:
    "When the annual-report filing is due, runs the Societies Online filing bot and records the confirmation.",
  unbc_affiliate_id_request:
    "Collects affiliate intake, hands execution to n8n, fills the UNBC PDF, and saves the generated document.",
  unbc_key_access_request:
    "Collects key/access request intake, fills the UNBC Facilities PDF, and stages the generated request for review.",
  ote_keycard_access_request:
    "Sends an Over the Edge individual access request through n8n, then queues the Facilities email draft.",
};

const RECIPE_PROVIDERS: Record<RecipeKey, WorkflowProvider> = {
  agm_prep: "internal",
  insurance_renewal: "internal",
  annual_report_filing: "internal",
  unbc_affiliate_id_request: "n8n",
  unbc_key_access_request: "n8n",
  ote_keycard_access_request: "n8n",
};

const RECIPE_STEPS: Record<RecipeKey, RecipeStep[]> = {
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

const RECIPE_NODE_PREVIEWS: Partial<Record<RecipeKey, NodePreview[]>> = {
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

export const RECIPE_CATALOG = (Object.keys(RECIPE_STEPS) as RecipeKey[]).map(
  (key) => ({
    key,
    label: RECIPE_LABELS[key],
    description: RECIPE_DESCRIPTIONS[key],
    provider: RECIPE_PROVIDERS[key],
    steps: RECIPE_STEPS[key].map((s) => s.label),
    nodePreview: nodePreviewForRecipe(key),
    config: configForRecipe(key),
  }),
);

// Node types the "Add Node" picker offers, and what each type is called in
// the UI. Keep the label in sync with `nodeTypeLabel` on the frontend.
export const NODE_TYPE_CATALOG: Array<{
  type: NodePreview["type"];
  label: string;
  description: string;
}> = [
  { type: "manual_trigger", label: "Manual trigger", description: "A person starts the workflow from Societyer." },
  { type: "form", label: "Form", description: "Collects structured input before handing off." },
  { type: "pdf_fill", label: "Fill PDF", description: "Hands a template + payload to the PDF fill endpoint." },
  { type: "document_create", label: "Save document", description: "Stores the generated file in Documents." },
  { type: "email", label: "Send notification", description: "Sends an email / in-app notification." },
  { type: "external_n8n", label: "External n8n step", description: "Delegates work to an n8n workflow node." },
];

type SetupCheck = { ok: boolean; message?: string };

function effectivePdfFields(
  cfg: Record<string, any>,
  workflowConfig?: { pdfFields?: string[]; intakeFields?: any[]; sampleAffiliate?: Record<string, any> },
): string[] {
  if (Array.isArray(cfg.fields) && cfg.fields.length > 0) return cfg.fields;
  if (Array.isArray(workflowConfig?.pdfFields) && workflowConfig.pdfFields.length > 0) {
    return workflowConfig.pdfFields;
  }
  if (cfg.fieldMappings && typeof cfg.fieldMappings === "object") {
    return Object.keys(cfg.fieldMappings);
  }
  return [];
}

function effectiveIntakeFields(
  cfg: Record<string, any>,
  workflowConfig?: { pdfFields?: string[]; intakeFields?: any[]; sampleAffiliate?: Record<string, any> },
): any[] {
  if (Array.isArray(cfg.fields) && cfg.fields.length > 0) return cfg.fields;
  if (Array.isArray(workflowConfig?.intakeFields) && workflowConfig.intakeFields.length > 0) {
    return workflowConfig.intakeFields;
  }
  if (Array.isArray(workflowConfig?.pdfFields) && workflowConfig.pdfFields.length > 0) {
    return workflowConfig.pdfFields;
  }
  if (workflowConfig?.sampleAffiliate && typeof workflowConfig.sampleAffiliate === "object") {
    return Object.keys(workflowConfig.sampleAffiliate);
  }
  return [];
}

function effectiveDocumentConfig(
  cfg: Record<string, any>,
  workflowConfig?: Record<string, any>,
) {
  const defaults =
    workflowConfig?.pdfTemplateKey === "unbc_affiliate_id"
      ? UNBC_DOCUMENT_DEFAULTS
      : workflowConfig?.pdfTemplateKey === "unbc_key_access_request"
        ? UNBC_KEY_DOCUMENT_DEFAULTS
        : {};
  return {
    category: cfg.category ?? workflowConfig?.documentCategory ?? defaults.category,
    tags: Array.isArray(cfg.tags)
      ? cfg.tags
      : Array.isArray(workflowConfig?.documentTags)
        ? workflowConfig.documentTags
        : Array.isArray((defaults as any).tags)
          ? (defaults as any).tags
          : [],
    retentionYears: typeof cfg.retentionYears === "number"
      ? cfg.retentionYears
      : typeof workflowConfig?.documentRetentionYears === "number"
        ? workflowConfig.documentRetentionYears
        : (defaults as any).retentionYears,
    titleTemplate: cfg.titleTemplate ?? workflowConfig?.documentTitleTemplate ?? (defaults as any).titleTemplate,
    changeNote: cfg.changeNote ?? workflowConfig?.documentChangeNote ?? (defaults as any).changeNote,
  };
}

function effectiveEmailConfig(
  cfg: Record<string, any>,
  workflowConfig?: Record<string, any>,
) {
  const defaults =
    workflowConfig?.pdfTemplateKey === "unbc_affiliate_id"
      ? UNBC_EMAIL_DEFAULTS
      : workflowConfig?.pdfTemplateKey === "unbc_key_access_request"
        ? UNBC_KEY_EMAIL_DEFAULTS
        : workflowConfig?.workflowTemplateKey === "ote_keycard_access_request"
          ? OTE_KEYCARD_EMAIL_DEFAULTS
        : {};
  return {
    fromName: cfg.fromName ?? workflowConfig?.emailFromName ?? workflowConfig?.notificationEmailFromName ?? (defaults as any).fromName,
    fromEmail: cfg.fromEmail ?? workflowConfig?.emailFromEmail ?? workflowConfig?.notificationEmailFromEmail ?? (defaults as any).fromEmail,
    replyTo: cfg.replyTo ?? workflowConfig?.emailReplyTo ?? workflowConfig?.notificationEmailReplyTo,
    to: cfg.to ?? workflowConfig?.emailTo ?? workflowConfig?.notificationEmailTo ?? (defaults as any).to,
    cc: cfg.cc ?? workflowConfig?.emailCc ?? workflowConfig?.notificationEmailCc,
    bcc: cfg.bcc ?? workflowConfig?.emailBcc ?? workflowConfig?.notificationEmailBcc,
    subject: cfg.subject ?? workflowConfig?.emailSubject ?? workflowConfig?.notificationEmailSubject ?? (defaults as any).subject,
    body: cfg.body ?? workflowConfig?.emailBody ?? workflowConfig?.notificationEmailBody ?? (defaults as any).body,
  };
}

function checkNodeSetup(
  node: NodePreview,
  providerConfig: { externalWebhookUrl?: string } | undefined,
  workflowConfig?: Record<string, any> | undefined,
): SetupCheck[] {
  const checks: SetupCheck[] = [];
  const cfg: Record<string, any> = node.config ?? {};

  if (node.type === "pdf_fill") {
    const hasTemplate = Boolean(cfg.templateDocumentId);
    checks.push({
      ok: hasTemplate,
      message: hasTemplate ? undefined : "Pick a fillable PDF template from Documents.",
    });
    const fields = effectivePdfFields(cfg, workflowConfig);
    checks.push({
      ok: fields.length > 0,
      message:
        fields.length > 0
          ? undefined
          : "Define at least one PDF field to fill (or auto-detect from the template).",
    });
    const hasSecret = Boolean(env("SOCIETYER_WORKFLOW_CALLBACK_SECRET"));
    checks.push({
      ok: hasSecret,
      message: hasSecret
        ? undefined
        : "SOCIETYER_WORKFLOW_CALLBACK_SECRET is not set — the filler can't call back.",
    });
    const hasWebhook = Boolean(providerConfig?.externalWebhookUrl);
    checks.push({
      ok: hasWebhook,
      message: hasWebhook ? undefined : "No n8n webhook URL configured on this workflow.",
    });
  } else if (node.type === "external_n8n") {
    const overrideUrl = typeof cfg.webhookUrl === "string" ? cfg.webhookUrl : undefined;
    const hasWebhook = Boolean(overrideUrl ?? providerConfig?.externalWebhookUrl);
    checks.push({
      ok: hasWebhook,
      message: hasWebhook
        ? undefined
        : "Set an n8n webhook URL on the workflow or override it on this node.",
    });
  } else if (node.type === "email") {
    const emailConfig = effectiveEmailConfig(cfg, workflowConfig);
    const hasRecipient = typeof emailConfig.to === "string" && emailConfig.to.trim().length > 0;
    checks.push({
      ok: hasRecipient,
      message: hasRecipient ? undefined : "Set a recipient (email address).",
    });
    const hasSubject = typeof emailConfig.subject === "string" && emailConfig.subject.trim().length > 0;
    checks.push({
      ok: hasSubject,
      message: hasSubject ? undefined : "Set a subject line.",
    });
  } else if (node.type === "form") {
    const fields = effectiveIntakeFields(cfg, workflowConfig);
    checks.push({
      ok: fields.length > 0,
      message: fields.length > 0 ? undefined : "Define at least one intake field.",
    });
  } else if (node.type === "document_create") {
    const docConfig = effectiveDocumentConfig(cfg, workflowConfig);
    const hasCategory = Boolean(docConfig.category);
    checks.push({
      ok: hasCategory,
      message: hasCategory ? undefined : "Set the document category to file under.",
    });
  }
  return checks;
}

// Computes the live node preview for rendering: starts from the stored
// (or catalog) preview and replaces each node's `status` based on the
// environment + provider config at read time. Also attaches `setupIssues`
// so the UI can explain *why* a node is not ready.
export function computeEffectiveNodePreview(
  baseNodes: NodePreview[] | undefined,
  providerConfig?: { externalWebhookUrl?: string },
  workflowConfig?: Record<string, any>,
) {
  const nodes = Array.isArray(baseNodes) ? baseNodes : [];
  return nodes.map((node) => {
    const checks = checkNodeSetup(node, providerConfig, workflowConfig);
    const failing = checks.filter((c) => !c.ok);
    const setupIssues = failing.map((c) => c.message!).filter(Boolean);
    let status: NodePreview["status"] = node.status ?? "ready";
    if (failing.length > 0) {
      // Respect an explicit "draft" designation — if the recipe author flagged
      // a step as draft, keep it draft rather than downgrading the badge to a
      // setup warning. Everything else with failing checks becomes needs_setup.
      status = node.status === "draft" ? "draft" : "needs_setup";
    } else if (node.status !== "draft" || checks.length > 0) {
      status = "ready";
    }
    return { ...node, status, setupIssues };
  });
}

// ---- queries -----------------------------------------------------------

export const listCatalog = query({
  args: {},
  returns: v.any(),
  handler: async () =>
    RECIPE_CATALOG.map((entry) => ({
      ...entry,
      // Recompute node statuses at read time so the preview reflects the
      // current server env (e.g. whether UNBC_AFFILIATE_TEMPLATE_PATH is set).
      nodePreview: computeEffectiveNodePreview(entry.nodePreview, undefined, entry.config),
    })),
});

export const listNodeTypes = query({
  args: {},
  returns: v.any(),
  handler: async () => NODE_TYPE_CATALOG,
});

export const inspectPdfTemplate = action({
  args: {
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
  },
  returns: v.any(),
  handler: async (ctx, { documentId, versionId }) => {
    const document = await ctx.runQuery(api.documents.get, { id: documentId });
    if (!document) throw new Error("Document not found.");
    const version = versionId
      ? await ctx.runQuery(api.documentVersions.get, { id: versionId })
      : await ctx.runQuery(api.documentVersions.latest, { documentId });
    if (!version) throw new Error("This document has no uploaded PDF version.");
    if (version.documentId !== documentId) throw new Error("Version does not belong to this document.");
    if (!/pdf/i.test(version.mimeType ?? document.mimeType ?? version.fileName ?? document.fileName ?? "")) {
      throw new Error("The selected document version is not a PDF.");
    }

    const url = await ctx.runAction(api.documentVersions.getDownloadUrl, {
      versionId: version._id,
    });
    if (!url || typeof url !== "string") throw new Error("Could not create a PDF download URL.");
    if (url.startsWith("demo://")) {
      throw new Error("Demo documents do not contain real PDF bytes to inspect.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not read selected PDF (${response.status}).`);
    }
    const bytes = await response.arrayBuffer();
    return await inspectPdfTemplateBytes(bytes, {
      documentId: String(documentId),
      versionId: String(version._id),
      fileName: version.fileName ?? document.fileName,
      title: document.title,
      externalSystem: "societyer-documents",
      externalId: String(documentId),
    });
  },
});

export const createPdfTemplateImportSession = action({
  args: {
    societyId: v.id("societies"),
    documentId: v.id("documents"),
    versionId: v.optional(v.id("documentVersions")),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, documentId, versionId, actingUserId }) => {
    if (!actingUserId) throw new Error("Role Director required - no authenticated actor.");
    await ctx.runQuery(api.paperless.authorizeMeetingImport, {
      societyId,
      actingUserId,
    });

    const document = await ctx.runQuery(api.documents.get, { id: documentId });
    if (!document || document.societyId !== societyId) throw new Error("Document not found.");
    const version = versionId
      ? await ctx.runQuery(api.documentVersions.get, { id: versionId })
      : await ctx.runQuery(api.documentVersions.latest, { documentId });
    if (!version) throw new Error("This document has no uploaded PDF version.");
    if (version.documentId !== documentId) throw new Error("Version does not belong to this document.");
    if (!/pdf/i.test(version.mimeType ?? document.mimeType ?? version.fileName ?? document.fileName ?? "")) {
      throw new Error("The selected document version is not a PDF.");
    }

    const url = await ctx.runAction(api.documentVersions.getDownloadUrl, {
      versionId: version._id,
    });
    if (!url || typeof url !== "string") throw new Error("Could not create a PDF download URL.");
    if (url.startsWith("demo://")) {
      throw new Error("Demo documents do not contain real PDF bytes to inspect.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not read selected PDF (${response.status}).`);
    }
    const bytes = await response.arrayBuffer();
    const inspection = await inspectPdfTemplateBytes(bytes, {
      documentId: String(documentId),
      versionId: String(version._id),
      fileName: version.fileName ?? document.fileName,
      title: document.title,
      externalSystem: "societyer-documents",
      externalId: String(documentId),
    });
    const sessionId = await ctx.runMutation(api.importSessions.createFromBundle, {
      societyId,
      name: `PDF template fields - ${document.title ?? version.fileName ?? "inspection"}`,
      bundle: inspection.importBundle,
    });
    return {
      sessionId,
      normalizedTables: inspection.normalizedTables?.length ?? 0,
      normalizedRows: inspection.normalizedTables?.reduce((sum: number, table: any) => sum + Number(table.rowCount ?? 0), 0) ?? 0,
      dataFields: inspection.importBundle?.legalTemplateDataFields?.length ?? 0,
    };
  },
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("workflows")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .collect(),
});

export const listRuns = query({
  args: { societyId: v.id("societies"), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { societyId, limit }) =>
    ctx.db
      .query("workflowRuns")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .order("desc")
      .take(limit ?? 50),
});

export const runsForWorkflow = query({
  args: { workflowId: v.id("workflows") },
  returns: v.any(),
  handler: async (ctx, { workflowId }) =>
    ctx.db
      .query("workflowRuns")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .order("desc")
      .collect(),
});

export const getRun = query({
  args: { id: v.id("workflowRuns") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const get = query({
  args: { id: v.id("workflows") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return null;
    return {
      ...wf,
      nodePreview: computeEffectiveNodePreview(wf.nodePreview, wf.providerConfig, wf.config),
    };
  },
});

// ---- mutations ---------------------------------------------------------

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    recipe: v.string(),
    name: v.string(),
    status: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerConfig: v.optional(
      v.object({
        externalWorkflowId: v.optional(v.string()),
        externalWebhookUrl: v.optional(v.string()),
        externalEditUrl: v.optional(v.string()),
      }),
    ),
    nodePreview: v.optional(v.any()),
    trigger: v.object({
      kind: v.string(),
      cron: v.optional(v.string()),
      offset: v.optional(
        v.object({
          anchor: v.string(),
          anchorId: v.optional(v.string()),
          daysBefore: v.number(),
        }),
      ),
    }),
    config: v.optional(v.any()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, {
      actingUserId: args.actingUserId,
      societyId: args.societyId,
      required: "Director",
    });
    if (!(args.recipe in RECIPE_STEPS)) {
      throw new Error(`Unknown recipe: ${args.recipe}`);
    }

    const recipe = args.recipe as RecipeKey;
    const provider = (args.provider ?? RECIPE_PROVIDERS[recipe] ?? "internal") as WorkflowProvider;
    const providerConfig =
      provider === "n8n"
        ? { ...providerConfigForRecipe(recipe), ...(args.providerConfig ?? {}) }
        : args.providerConfig;

    return await ctx.db.insert("workflows", {
      societyId: args.societyId,
      recipe: args.recipe,
      name: args.name,
      status: args.status ?? "active",
      provider,
      providerConfig,
      nodePreview: args.nodePreview ?? nodePreviewForRecipe(recipe),
      trigger: args.trigger,
      config: { ...configForRecipe(recipe), ...(args.config ?? {}) },
      nextRunAtISO: computeNextRunAt(args.trigger),
      createdByUserId: args.actingUserId,
    });
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("workflows"),
    status: v.string(), // active | paused | archived
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, { status });
  },
});

// Light-touch patch for inline edits from the record table. Only
// exposes the fields that are safe to tweak without re-computing the
// trigger / provider config: the human-facing `name` and the SELECT
// status. For status parity with the dedicated `setStatus` mutation,
// this also enforces Director role.
export const update = mutation({
  args: {
    id: v.id("workflows"),
    patch: v.object({
      name: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, patch);
  },
});

export const configure = mutation({
  args: {
    id: v.id("workflows"),
    patch: v.object({
      name: v.optional(v.string()),
      status: v.optional(v.string()),
      provider: v.optional(v.string()),
      providerConfig: v.optional(
        v.object({
          externalWorkflowId: v.optional(v.string()),
          externalWebhookUrl: v.optional(v.string()),
          externalEditUrl: v.optional(v.string()),
        }),
      ),
      nodePreview: v.optional(v.any()),
      trigger: v.optional(
        v.object({
          kind: v.string(),
          cron: v.optional(v.string()),
          offset: v.optional(
            v.object({
              anchor: v.string(),
              anchorId: v.optional(v.string()),
              daysBefore: v.number(),
            }),
          ),
        }),
      ),
      config: v.optional(v.any()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    const next: any = { ...patch };
    if (patch.trigger) {
      const nextRunAtISO = computeNextRunAt(patch.trigger);
      if (nextRunAtISO) next.nextRunAtISO = nextRunAtISO;
    }
    await ctx.db.patch(id, next);
  },
});

export const updateProviderLink = mutation({
  args: {
    id: v.id("workflows"),
    provider: v.optional(v.string()),
    providerConfig: v.object({
      externalWorkflowId: v.optional(v.string()),
      externalWebhookUrl: v.optional(v.string()),
      externalEditUrl: v.optional(v.string()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, provider, providerConfig, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.patch(id, {
      provider: provider ?? wf.provider ?? "n8n",
      providerConfig,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("workflows"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return;
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    await ctx.db.delete(id);
  },
});

// Append (or insert) a node into the workflow's preview graph. For now this
// is additive only — no runner logic is attached to user-added nodes; they
// show up in the canvas, the sidepanel, and the run timeline as "pending"
// and are marked skipped if the workflow runs. Clarifying the execution
// contract is tracked for the full bridge MVP.
export const addNode = mutation({
  args: {
    id: v.id("workflows"),
    node: v.object({
      type: v.string(),
      label: v.string(),
      description: v.optional(v.string()),
    }),
    afterKey: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, node, afterKey, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });

    const valid = NODE_TYPE_CATALOG.some((entry) => entry.type === node.type);
    if (!valid) throw new Error(`Unknown node type: ${node.type}`);

    const existing: NodePreview[] = Array.isArray(wf.nodePreview) ? [...wf.nodePreview] : [];
    const baseKey = node.type.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || "node";
    const usedKeys = new Set(existing.map((n) => n.key));
    let newKey = baseKey;
    let suffix = 1;
    while (usedKeys.has(newKey)) {
      newKey = `${baseKey}_${suffix++}`;
    }

    const newNode: NodePreview = {
      key: newKey,
      type: node.type as NodePreview["type"],
      label: node.label,
      description: node.description,
      status: "draft",
    };

    let next: NodePreview[];
    if (afterKey) {
      const idx = existing.findIndex((n) => n.key === afterKey);
      if (idx === -1) {
        next = [...existing, newNode];
      } else {
        next = [...existing.slice(0, idx + 1), newNode, ...existing.slice(idx + 1)];
      }
    } else {
      next = [...existing, newNode];
    }

    await ctx.db.patch(id, { nodePreview: next });
    return { key: newKey };
  },
});

export const updateNodeConfig = mutation({
  args: {
    id: v.id("workflows"),
    key: v.string(),
    config: v.any(),
    label: v.optional(v.string()),
    description: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, key, config, label, description, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    const existing: NodePreview[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
    const idx = existing.findIndex((n) => n.key === key);
    if (idx === -1) throw new Error(`Node ${key} not found on workflow ${id}`);
    const prev = existing[idx];
    const next = [...existing];
    next[idx] = {
      ...prev,
      config: { ...(prev.config ?? {}), ...(config ?? {}) },
      label: label ?? prev.label,
      description: description ?? prev.description,
    };
    await ctx.db.patch(id, { nodePreview: next });
  },
});

export const removeNode = mutation({
  args: {
    id: v.id("workflows"),
    key: v.string(),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, { id, key, actingUserId }) => {
    const wf = await ctx.db.get(id);
    if (!wf) throw new Error("Workflow not found");
    await requireRole(ctx, {
      actingUserId,
      societyId: wf.societyId,
      required: "Director",
    });
    const existing: NodePreview[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
    const next = existing.filter((n) => n.key !== key);
    if (next.length === existing.length) return;
    await ctx.db.patch(id, { nodePreview: next });
  },
});

export const receiveExternalCallback = mutation({
  args: {
    workflowId: v.id("workflows"),
    runId: v.id("workflowRuns"),
    externalRunId: v.optional(v.string()),
    event: v.string(),
    stepKey: v.optional(v.string()),
    note: v.optional(v.string()),
    output: v.optional(v.any()),
    generatedDocument: v.optional(
      v.object({
        documentId: v.id("documents"),
        versionId: v.id("documentVersions"),
        fileName: v.string(),
        storageKey: v.string(),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workflowId !== args.workflowId) {
      throw new Error("Workflow run not found.");
    }

    const now = new Date().toISOString();
    const isFailure = args.event === "run.failed" || args.event === "step.failed";
    let steps = run.steps ?? [];
    if (args.event === "document.created" && args.generatedDocument) {
      steps = steps.map((step) => {
        if (step.key === "fill_pdf") {
          return { ...step, status: "ok", atISO: now, note: "n8n returned a filled PDF." };
        }
        if (step.key === "save_document") {
          return { ...step, status: "ok", atISO: now, note: args.note ?? "Generated PDF saved to Societyer Documents." };
        }
        return step;
      });
    } else if (args.stepKey) {
      const status =
        args.event === "step.started"
          ? "running"
          : isFailure
            ? "fail"
            : "ok";
      steps = steps.map((step) =>
        step.key === args.stepKey
          ? { ...step, status, atISO: now, note: args.note ?? step.note }
          : step,
      );
    }

    if (isFailure) {
      steps = reconcileStepsOnFailure(
        steps,
        args.note ?? (args.event === "run.failed" ? "Workflow run failed." : "Step failed."),
        now,
      );
    }

    const output = {
      ...(run.output ?? {}),
      ...(args.output ?? {}),
      ...(args.generatedDocument ? { generatedDocument: args.generatedDocument } : {}),
    };

    const patch: any = {
      steps,
      output,
      externalRunId: args.externalRunId ?? run.externalRunId,
      externalStatus: args.event,
    };

    if (args.generatedDocument) {
      patch.generatedDocumentId = args.generatedDocument.documentId;
      patch.generatedDocumentVersionId = args.generatedDocument.versionId;
    }

    if (args.event === "run.completed") {
      patch.status = "success";
      patch.completedAtISO = now;
    } else if (isFailure) {
      patch.status = "failed";
      patch.completedAtISO = now;
    } else if (run.status === "queued") {
      patch.status = "running";
    }

    await ctx.db.patch(args.runId, patch);

    if (args.event === "run.completed") {
      await enqueueEmailsForRunInline(ctx, args.runId);
    }
  },
});

// When a workflow run succeeds, turn every configured email-type node into
// a pendingEmails row for the Outbox. We only fire for nodes with an
// effective `to` address, and we skip ones already enqueued for this run so
// retries don't duplicate drafts.
async function enqueueEmailsForRunInline(ctx: any, runId: any) {
  const run = await ctx.db.get(runId);
  if (!run) return;
  const wf = await ctx.db.get(run.workflowId);
  if (!wf) return;
  const nodes: any[] = Array.isArray(wf.nodePreview) ? wf.nodePreview : [];
  const emailNodes = nodes.filter((node) => {
    if (node.type !== "email") return false;
    const emailConfig = effectiveEmailConfig(node.config ?? {}, wf.config ?? {});
    return typeof emailConfig.to === "string" && emailConfig.to.trim().length > 0;
  });
  if (emailNodes.length === 0) return;

  const existing = await ctx.db
    .query("pendingEmails")
    .withIndex("by_society", (q: any) => q.eq("societyId", run.societyId))
    .collect();
  const alreadyEnqueued = new Set<string>(
    existing
      .filter((row: any) => row.workflowRunId === runId)
      .map((row: any) => row.nodeKey),
  );

  const attachments: Array<{ documentId: any; fileName: string }> = [];
  if (run.generatedDocumentId) {
    const doc = await ctx.db.get(run.generatedDocumentId);
    if (doc) {
      attachments.push({
        documentId: run.generatedDocumentId,
        fileName: doc.fileName ?? doc.title ?? "attachment",
      });
    }
  }

  const nowISO = new Date().toISOString();
  for (const node of emailNodes) {
    if (alreadyEnqueued.has(node.key)) continue;
    const cfg = effectiveEmailConfig(node.config ?? {}, wf.config ?? {});
    const templateContext = await buildWorkflowTemplateContext(ctx, wf, run, {
      document: attachments.length > 0 && run.generatedDocumentId
        ? await ctx.db.get(run.generatedDocumentId)
        : undefined,
    });
    const subjectTemplate =
      typeof cfg.subject === "string" && cfg.subject.length > 0 ? cfg.subject : node.label;
    const bodyTemplate = typeof cfg.body === "string" ? cfg.body : "";
    const to = renderWorkflowTemplate(String(cfg.to ?? ""), templateContext).trim();
    const cc = typeof cfg.cc === "string" ? renderWorkflowTemplate(cfg.cc, templateContext).trim() : undefined;
    const bcc = typeof cfg.bcc === "string" ? renderWorkflowTemplate(cfg.bcc, templateContext).trim() : undefined;
    const fromName = typeof cfg.fromName === "string"
      ? renderWorkflowTemplate(cfg.fromName, templateContext).trim()
      : undefined;
    const fromEmail = typeof cfg.fromEmail === "string"
      ? renderWorkflowTemplate(cfg.fromEmail, templateContext).trim()
      : undefined;
    const replyTo = typeof cfg.replyTo === "string"
      ? renderWorkflowTemplate(cfg.replyTo, templateContext).trim()
      : undefined;
    await ctx.db.insert("pendingEmails", {
      societyId: run.societyId,
      workflowId: run.workflowId,
      workflowRunId: runId,
      nodeKey: node.key,
      fromName: fromName || undefined,
      fromEmail: fromEmail || undefined,
      replyTo: replyTo || undefined,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject: renderWorkflowTemplate(subjectTemplate, templateContext),
      body: renderWorkflowTemplate(bodyTemplate, templateContext),
      attachments,
      status: "ready",
      createdAtISO: nowISO,
      notes: `Queued by workflow ${wf.name} · node ${node.key}`,
    });
  }
}

// Any step still running/pending when a run fails needs to be resolved so
// the timeline reflects where execution actually stopped. The first
// still-open step is attributed the failure; any pending steps after it are
// skipped. If the step that triggered the failure has already been marked
// "fail", that stays and only the trailing pending steps become "skip".
function reconcileStepsOnFailure(
  steps: Array<{ key?: string; label: string; status: string; atISO?: string; note?: string }>,
  errorNote: string,
  nowISO: string,
) {
  let failureAssigned = steps.some((s) => s.status === "fail");
  return steps.map((step) => {
    if (step.status === "ok" || step.status === "fail") return step;
    if (!failureAssigned && (step.status === "running" || step.status === "pending")) {
      failureAssigned = true;
      return { ...step, status: "fail", atISO: nowISO, note: errorNote };
    }
    if (step.status === "pending" || step.status === "running") {
      return {
        ...step,
        status: "skip",
        atISO: nowISO,
        note: "Skipped — earlier step failed.",
      };
    }
    return step;
  });
}

export const recordGeneratedDocument = mutation({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    runId: v.id("workflowRuns"),
    storageKey: v.string(),
    fileName: v.string(),
    mimeType: v.string(),
    fileSizeBytes: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.workflowId !== args.workflowId || run.societyId !== args.societyId) {
      throw new Error("Workflow run not found.");
    }
    const wf = await ctx.db.get(args.workflowId);
    if (!wf) throw new Error("Workflow not found.");
    const saveNode = findWorkflowNode(wf, "document_create");
    const documentConfig = effectiveDocumentConfig(saveNode?.config ?? {}, wf.config ?? {});
    const templateContext = await buildWorkflowTemplateContext(ctx, wf, run, {
      document: {
        title: args.fileName.replace(/\.pdf$/i, ""),
        fileName: args.fileName,
        category: documentConfig.category,
      },
    });

    const defaultTitle = args.fileName.replace(/\.pdf$/i, "");
    const title = renderWorkflowTemplate(documentConfig.titleTemplate ?? defaultTitle, templateContext).trim() || defaultTitle;
    const tags = Array.from(
      new Set([
        ...(Array.isArray(documentConfig.tags) ? documentConfig.tags : []),
        `workflow-run:${args.runId}`,
      ]),
    );
    const documentId = await ctx.db.insert("documents", {
      societyId: args.societyId,
      title,
      category: documentConfig.category ?? "WorkflowGenerated",
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      retentionYears: documentConfig.retentionYears,
      createdAtISO: new Date().toISOString(),
      flaggedForDeletion: false,
      tags,
    });

    const versionId = await ctx.db.insert("documentVersions", {
      societyId: args.societyId,
      documentId,
      version: 1,
      storageProvider: "local",
      storageKey: args.storageKey,
      fileName: args.fileName,
      mimeType: args.mimeType,
      fileSizeBytes: args.fileSizeBytes,
      uploadedAtISO: new Date().toISOString(),
      uploadedByName: "n8n workflow",
      changeNote: documentConfig.changeNote ?? "Generated by workflow.",
      isCurrent: true,
    });

    await ctx.db.insert("activity", {
      societyId: args.societyId,
      actor: "n8n workflow",
      entityType: "document",
      entityId: documentId,
      action: "workflow-generated",
      summary: `Generated ${args.fileName} from workflow run ${args.runId}.`,
      createdAtISO: new Date().toISOString(),
    });

    return { documentId, versionId };
  },
});

export const _createRun = internalMutation({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    recipe: v.string(),
    provider: v.optional(v.string()),
    nodePreview: v.optional(v.any()),
    demo: v.boolean(),
    triggeredBy: v.string(),
    triggeredByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const steps = stepsForRun(args.recipe, args.nodePreview);
    return await ctx.db.insert("workflowRuns", {
      societyId: args.societyId,
      workflowId: args.workflowId,
      recipe: args.recipe,
      status: "queued",
      startedAtISO: new Date().toISOString(),
      steps,
      provider: args.provider ?? "internal",
      demo: args.demo,
      triggeredBy: args.triggeredBy,
      triggeredByUserId: args.triggeredByUserId,
    });
  },
});

export const _updateStep = internalMutation({
  args: {
    id: v.id("workflowRuns"),
    stepIndex: v.number(),
    status: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, stepIndex, status, note }) => {
    const run = await ctx.db.get(id);
    if (!run) return;
    const steps = run.steps.map((s, i) =>
      i === stepIndex
        ? { ...s, status, atISO: new Date().toISOString(), note: note ?? s.note }
        : s,
    );
    await ctx.db.patch(id, {
      steps,
      status: status === "running" && run.status === "queued" ? "running" : run.status,
    });
  },
});

export const _markExternalQueued = internalMutation({
  args: {
    id: v.id("workflowRuns"),
    externalRunId: v.optional(v.string()),
    externalStatus: v.optional(v.string()),
    output: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run) return;
    await ctx.db.patch(args.id, {
      status: "running",
      externalRunId: args.externalRunId,
      externalStatus: args.externalStatus ?? "queued",
      output: { ...(run.output ?? {}), ...(args.output ?? {}) },
    });
  },
});

export const _completeRun = internalMutation({
  args: {
    id: v.id("workflowRuns"),
    status: v.string(),
    output: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, { id, status, output }) => {
    const run = await ctx.db.get(id);
    const now = new Date().toISOString();
    let steps = run?.steps ?? [];
    if (status === "failed" && steps.length > 0) {
      const errorNote =
        (output && typeof output === "object" && typeof (output as any).error === "string"
          ? (output as any).error
          : undefined) ?? "Workflow failed.";
      steps = reconcileStepsOnFailure(steps, errorNote, now);
    }
    await ctx.db.patch(id, {
      status,
      completedAtISO: now,
      output,
      steps,
    });
    if (status === "success") {
      await enqueueEmailsForRunInline(ctx, id);
    }
  },
});

export const _touchSchedule = internalMutation({
  args: { id: v.id("workflows") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const wf = await ctx.db.get(id);
    if (!wf) return;
    const now = new Date().toISOString();
    await ctx.db.patch(id, {
      lastRunAtISO: now,
      nextRunAtISO: computeNextRunAt(wf.trigger, new Date()),
    });
  },
});

// ---- triggers / scheduler ---------------------------------------------

function computeNextRunAt(
  trigger: { kind: string; cron?: string; offset?: { daysBefore: number } },
  from: Date = new Date(),
): string | undefined {
  if (trigger.kind === "manual") return undefined;
  if (trigger.kind === "cron") {
    const next = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    return next.toISOString();
  }
  if (trigger.kind === "date_offset") {
    const next = new Date(from.getTime() + 60 * 60 * 1000);
    return next.toISOString();
  }
  return undefined;
}

export const scan = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const dueBefore = new Date().toISOString();
    const candidates: any[] = await ctx.runQuery(internal.workflows._listDue, {
      dueBefore,
    });
    for (const wf of candidates) {
      await ctx.runAction(api.workflows.run, {
        societyId: wf.societyId,
        workflowId: wf._id,
        triggeredBy: "cron",
      });
    }
  },
});

export const _listDue = query({
  args: { dueBefore: v.string() },
  returns: v.any(),
  handler: async (ctx, { dueBefore }) => {
    const rows = await ctx.db
      .query("workflows")
      .withIndex("by_next_run")
      .collect();
    return rows.filter(
      (w) =>
        w.status === "active" &&
        typeof w.nextRunAtISO === "string" &&
        w.nextRunAtISO <= dueBefore,
    );
  },
});

// ---- the runner --------------------------------------------------------

export const run = action({
  args: {
    societyId: v.id("societies"),
    workflowId: v.id("workflows"),
    triggeredBy: v.optional(v.string()), // cron | manual | event
    actingUserId: v.optional(v.id("users")),
    input: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const wf: any = await ctx.runQuery(api.workflows.get, {
      id: args.workflowId,
    });
    if (!wf) throw new Error("Workflow not found");
    if (wf.societyId !== args.societyId) throw new Error("Workflow does not belong to this society.");
    if (wf.status !== "active") throw new Error(`Workflow is ${wf.status}; activate it before running.`);

    const provider = (wf.provider ?? "internal") as WorkflowProvider;
    const runId = await ctx.runMutation(internal.workflows._createRun, {
      societyId: args.societyId,
      workflowId: args.workflowId,
      recipe: wf.recipe,
      provider,
      nodePreview: wf.nodePreview,
      demo: provider === "internal",
      triggeredBy: args.triggeredBy ?? "manual",
      triggeredByUserId: args.actingUserId,
    });

    if (provider === "n8n") {
      return await runExternalWorkflow(ctx, wf, runId, args);
    }

    const rawIntake = normalizeWorkflowRunInput(wf, args.input);
    const steps = RECIPE_STEPS[wf.recipe as RecipeKey] ?? [];
    try {
      for (let i = 0; i < steps.length; i++) {
        await ctx.runMutation(internal.workflows._updateStep, {
          id: runId,
          stepIndex: i,
          status: "running",
        });
        await sleep(400);
        const note = await handleStep(ctx, wf, i, rawIntake);
        await ctx.runMutation(internal.workflows._updateStep, {
          id: runId,
          stepIndex: i,
          status: "ok",
          note,
        });
      }

      await ctx.runMutation(internal.workflows._completeRun, {
        id: runId,
        status: "success",
        output: { intake: rawIntake, fieldValues: rawIntake },
      });
      await ctx.runMutation(internal.workflows._touchSchedule, {
        id: args.workflowId,
      });
      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        kind: "bot",
        severity: "success",
        title: `Workflow finished: ${wf.name}`,
        body: `Recipe ${RECIPE_LABELS[wf.recipe as RecipeKey] ?? wf.recipe} completed ${steps.length} steps.`,
        linkHref: "/app/workflow-runs",
      });
      return { runId, status: "success" };
    } catch (err: any) {
      await ctx.runMutation(internal.workflows._completeRun, {
        id: runId,
        status: "failed",
        output: { error: err?.message ?? "unknown" },
      });
      await ctx.runMutation(api.notifications.create, {
        societyId: args.societyId,
        kind: "bot",
        severity: "err",
        title: `Workflow failed: ${wf.name}`,
        body: err?.message ?? "Unknown error",
        linkHref: "/app/workflow-runs",
      });
      throw err;
    }
  },
});

async function runExternalWorkflow(ctx: any, wf: any, runId: any, args: any) {
  if (wf.recipe === "ote_keycard_access_request" || wf.config?.workflowTemplateKey === "ote_keycard_access_request") {
    return await runExternalNotificationWorkflow(ctx, wf, runId, args);
  }

  const webhookUrl = wf.providerConfig?.externalWebhookUrl;
  const callbackSecret = env("SOCIETYER_WORKFLOW_CALLBACK_SECRET");
  const callbackUrl =
    env("SOCIETYER_WORKFLOW_CALLBACK_URL") ??
    "http://host.docker.internal:8787/api/v1/workflow-callbacks/n8n";
  const pdfTemplateKey = wf.config?.pdfTemplateKey ?? "unbc_affiliate_id";
  const pdfFillUrl = pdfFillUrlForWorkflow(wf, pdfTemplateKey);

  try {
    if (!webhookUrl) {
      throw new Error("n8n webhook URL is missing. Set N8N_WEBHOOK_BASE_URL or add providerConfig.externalWebhookUrl.");
    }
    if (!callbackSecret) {
      throw new Error("SOCIETYER_WORKFLOW_CALLBACK_SECRET is missing.");
    }

    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 0,
      status: "ok",
      note: "Manual launch accepted by Societyer.",
    });
    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 1,
      status: "ok",
      note: "Workflow intake payload prepared for n8n.",
    });
    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 2,
      status: "running",
      note: "Waiting for n8n PDF fill step.",
    });

    const rawIntake = normalizeWorkflowRunInput(wf, args.input);
    const normalizedInput = normalizeWorkflowPdfInput(wf, rawIntake);
    const resolved = await resolveFieldMappings(ctx, wf, args);
    // Resolved values take priority, falling back to form-supplied input
    // whenever the mapping is empty or skipped.
    const fieldValues: Record<string, any> = { ...rawIntake, ...normalizedInput, ...resolved };
    const templateDocumentId = findFillPdfNode(wf)?.config?.templateDocumentId;

    const payload = {
      workflowId: args.workflowId,
      runId,
      societyId: args.societyId,
      recipe: wf.recipe,
      callbackUrl,
      callbackSecret,
      pdfFillUrl,
      input: {
        intake: rawIntake,
        affiliate: fieldValues,
        fieldValues,
        mapping: resolved,
        pdfTemplateKey,
        pdfTemplateDocumentId: templateDocumentId,
      },
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`n8n webhook returned ${response.status}: ${text.slice(0, 240)}`);
    }
    const responseJson = safeJson(text);
    const externalRunId =
      responseJson?.executionId ??
      responseJson?.id ??
      responseJson?.data?.executionId ??
      undefined;

    await ctx.runMutation(internal.workflows._markExternalQueued, {
      id: runId,
      externalRunId,
      externalStatus: "webhook.accepted",
      output: {
        intake: rawIntake,
        fieldValues,
        n8n: {
          webhookUrl,
          response: responseJson ?? text.slice(0, 400),
        },
      },
    });
    await ctx.runMutation(internal.workflows._touchSchedule, {
      id: args.workflowId,
    });
    await ctx.runMutation(api.notifications.create, {
      societyId: args.societyId,
      kind: "bot",
      severity: "info",
      title: `Workflow queued in n8n: ${wf.name}`,
      body: "Societyer is waiting for n8n callbacks to update the run timeline.",
      linkHref: "/app/workflow-runs",
    });
    return { runId, status: "running", externalRunId };
  } catch (err: any) {
    await ctx.runMutation(internal.workflows._completeRun, {
      id: runId,
      status: "failed",
      output: { error: err?.message ?? "unknown" },
    });
    await ctx.runMutation(api.notifications.create, {
      societyId: args.societyId,
      kind: "bot",
      severity: "err",
      title: `Workflow failed: ${wf.name}`,
      body: err?.message ?? "Unknown error",
      linkHref: "/app/workflow-runs",
    });
    throw err;
  }
}

async function runExternalNotificationWorkflow(ctx: any, wf: any, runId: any, args: any) {
  const webhookUrl = wf.providerConfig?.externalWebhookUrl;
  const callbackSecret = env("SOCIETYER_WORKFLOW_CALLBACK_SECRET");
  const callbackUrl =
    env("SOCIETYER_WORKFLOW_CALLBACK_URL") ??
    "http://host.docker.internal:8787/api/v1/workflow-callbacks/n8n";

  try {
    if (!webhookUrl) {
      throw new Error("n8n webhook URL is missing. Set N8N_WEBHOOK_BASE_URL or add providerConfig.externalWebhookUrl.");
    }
    if (!callbackSecret) {
      throw new Error("SOCIETYER_WORKFLOW_CALLBACK_SECRET is missing.");
    }

    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 0,
      status: "ok",
      note: "Manual launch accepted by Societyer.",
    });
    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 1,
      status: "ok",
      note: "Individual access payload prepared for n8n.",
    });
    await ctx.runMutation(internal.workflows._updateStep, {
      id: runId,
      stepIndex: 2,
      status: "running",
      note: "Waiting for n8n to confirm the Facilities email draft.",
    });

    const rawIntake = normalizeWorkflowRunInput(wf, args.input);
    const emailDraft = await buildExternalEmailDraft(ctx, wf, runId, args, rawIntake);
    const payload = {
      workflowId: args.workflowId,
      runId,
      societyId: args.societyId,
      recipe: wf.recipe,
      callbackUrl,
      callbackSecret,
      input: {
        intake: rawIntake,
        fieldValues: rawIntake,
        emailDraft,
      },
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`n8n webhook returned ${response.status}: ${text.slice(0, 240)}`);
    }
    const responseJson = safeJson(text);
    const externalRunId =
      responseJson?.executionId ??
      responseJson?.id ??
      responseJson?.data?.executionId ??
      undefined;

    await ctx.runMutation(internal.workflows._markExternalQueued, {
      id: runId,
      externalRunId,
      externalStatus: "webhook.accepted",
      output: {
        intake: rawIntake,
        fieldValues: rawIntake,
        emailDraft,
        n8n: {
          webhookUrl,
          response: responseJson ?? text.slice(0, 400),
        },
      },
    });
    await ctx.runMutation(internal.workflows._touchSchedule, {
      id: args.workflowId,
    });
    await ctx.runMutation(api.notifications.create, {
      societyId: args.societyId,
      kind: "bot",
      severity: "info",
      title: `Workflow queued in n8n: ${wf.name}`,
      body: "Societyer is waiting for n8n to confirm the Facilities email draft.",
      linkHref: "/app/workflow-runs",
    });
    return { runId, status: "running", externalRunId };
  } catch (err: any) {
    await ctx.runMutation(internal.workflows._completeRun, {
      id: runId,
      status: "failed",
      output: { error: err?.message ?? "unknown" },
    });
    await ctx.runMutation(api.notifications.create, {
      societyId: args.societyId,
      kind: "bot",
      severity: "err",
      title: `Workflow failed: ${wf.name}`,
      body: err?.message ?? "Unknown error",
      linkHref: "/app/workflow-runs",
    });
    throw err;
  }
}

// Step handlers. In demo mode these just annotate the step; in live mode
// they chain into real mutations. Additive: adding a recipe means adding
// a case here, not a new action type.
async function handleStep(ctx: any, wf: any, stepIndex: number, intake: Record<string, any> = {}): Promise<string | undefined> {
  if (wf.recipe === "insurance_renewal" && stepIndex === 0) {
    const policies = await ctx.runQuery(api.insurance.list, {
      societyId: wf.societyId,
    });
    const soon = (policies ?? []).filter((p: any) => {
      if (!p.renewalDate) return false;
      const days = (new Date(p.renewalDate).getTime() - Date.now()) / 86_400_000;
      return days >= 0 && days <= 60;
    });
    return soon.length
      ? `${soon.length} policy/policies renewing within 60 days`
      : "No policies renewing in the next 60 days";
  }
  if (wf.recipe === "agm_prep" && stepIndex === 2) {
    return "Would dispatch notice via Communications (demo: skipped send).";
  }
  if (wf.recipe === "annual_report_filing" && stepIndex === 1) {
    return "Would invoke filingBot.run for the open AnnualReport filing.";
  }
  if (wf.recipe === "ote_keycard_access_request") {
    if (stepIndex === 0) {
      return "Manual launch accepted for the OTE Facilities keycard request.";
    }
    if (stepIndex === 1) {
      return `Prepared access request for ${intake.access_person_name ?? intake.access_person?.name ?? "selected individual"}.`;
    }
    if (stepIndex === 2) {
      return `Facilities email draft will be queued to ${intake.facilities_email ?? OTE_KEYCARD_EMAIL_DEFAULTS.to}.`;
    }
  }
  return undefined;
}

function nodePreviewForRecipe(recipe: RecipeKey) {
  return (
    RECIPE_NODE_PREVIEWS[recipe] ??
    RECIPE_STEPS[recipe].map((step, index) => ({
      key: step.key,
      type: index === 0 ? "manual_trigger" : "external_n8n",
      label: step.label,
      status: "ready",
    }))
  );
}

function slugifyFieldKey(label: string) {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || "field";
}

function inferIntakeFieldType(label: string) {
  const norm = label.toLowerCase();
  if (/check\s*box|yes\/no|true\/false/.test(norm)) return "checkbox";
  if (/e-?mail/.test(norm)) return "email";
  if (/phone|tel|mobile|cell/.test(norm)) return "phone";
  if (/date|birth/.test(norm)) return "date";
  if (/address|note|description|comment/.test(norm)) return "textarea";
  return "text";
}

function intakeFieldsForRecipe(fields: string[]) {
  const used = new Set<string>();
  return fields.map((label) => {
    const base = slugifyFieldKey(label);
    let key = base;
    let suffix = 2;
    while (used.has(key)) key = `${base}_${suffix++}`;
    used.add(key);
    return {
      key,
      label,
      type: inferIntakeFieldType(label),
      required: false,
    };
  });
}

function configForRecipe(recipe: RecipeKey) {
  if (recipe === "unbc_affiliate_id_request") {
    return {
      pdfTemplateKey: "unbc_affiliate_id",
      pdfFields: UNBC_AFFILIATE_FIELDS,
      intakeFields: intakeFieldsForRecipe(UNBC_AFFILIATE_FIELDS),
      documentCategory: UNBC_DOCUMENT_DEFAULTS.category,
      documentTags: UNBC_DOCUMENT_DEFAULTS.tags,
      documentRetentionYears: UNBC_DOCUMENT_DEFAULTS.retentionYears,
      documentTitleTemplate: UNBC_DOCUMENT_DEFAULTS.titleTemplate,
      documentChangeNote: UNBC_DOCUMENT_DEFAULTS.changeNote,
      emailTo: UNBC_EMAIL_DEFAULTS.to,
      emailSubject: UNBC_EMAIL_DEFAULTS.subject,
      emailBody: UNBC_EMAIL_DEFAULTS.body,
      sampleAffiliate: UNBC_SAMPLE_AFFILIATE,
    };
  }
  if (recipe === "unbc_key_access_request") {
    return {
      pdfTemplateKey: "unbc_key_access_request",
      pdfFields: UNBC_KEY_ACCESS_FIELDS,
      intakeFields: intakeFieldsForRecipe(UNBC_KEY_ACCESS_INTAKE_FIELDS),
      documentCategory: UNBC_KEY_DOCUMENT_DEFAULTS.category,
      documentTags: UNBC_KEY_DOCUMENT_DEFAULTS.tags,
      documentRetentionYears: UNBC_KEY_DOCUMENT_DEFAULTS.retentionYears,
      documentTitleTemplate: UNBC_KEY_DOCUMENT_DEFAULTS.titleTemplate,
      documentChangeNote: UNBC_KEY_DOCUMENT_DEFAULTS.changeNote,
      emailTo: UNBC_KEY_EMAIL_DEFAULTS.to,
      emailSubject: UNBC_KEY_EMAIL_DEFAULTS.subject,
      emailBody: UNBC_KEY_EMAIL_DEFAULTS.body,
      sampleInput: UNBC_SAMPLE_KEY_REQUEST,
    };
  }
  if (recipe === "ote_keycard_access_request") {
    return {
      workflowTemplateKey: "ote_keycard_access_request",
      defaultTriggerKind: "manual",
      intakeFields: OTE_KEYCARD_INTAKE_FIELDS,
      emailFromName: OTE_KEYCARD_EMAIL_DEFAULTS.fromName,
      emailFromEmail: OTE_KEYCARD_EMAIL_DEFAULTS.fromEmail,
      emailTo: OTE_KEYCARD_EMAIL_DEFAULTS.to,
      emailSubject: OTE_KEYCARD_EMAIL_DEFAULTS.subject,
      emailBody: OTE_KEYCARD_EMAIL_DEFAULTS.body,
      sampleInput: OTE_SAMPLE_KEYCARD_REQUEST,
    };
  }
  return {};
}

function providerConfigForRecipe(recipe: RecipeKey) {
  if (
    recipe !== "unbc_affiliate_id_request" &&
    recipe !== "unbc_key_access_request" &&
    recipe !== "ote_keycard_access_request"
  ) return undefined;
  const base = env("N8N_WEBHOOK_BASE_URL") ?? "http://127.0.0.1:5678/webhook";
  const webhookPath =
    recipe === "unbc_key_access_request"
      ? env("N8N_UNBC_KEY_REQUEST_WEBHOOK_PATH") ??
        "societyer-unbc-key-access-request/societyer%2520webhook/societyer/unbc-key-access-request"
      : recipe === "ote_keycard_access_request"
        ? env("N8N_OTE_KEYCARD_WEBHOOK_PATH") ??
          "societyer-ote-individual-access-request/societyer%2520webhook/societyer/ote-individual-access-request"
      : env("N8N_UNBC_AFFILIATE_WEBHOOK_PATH") ??
        "societyer-unbc-affiliate-id/societyer%2520webhook/societyer/unbc-affiliate-id";
  const externalEditUrl = env("N8N_BASE_URL")
    ? `${env("N8N_BASE_URL")}/workflow`
    : "http://127.0.0.1:5678/workflow";
  return {
    externalWorkflowId:
      recipe === "unbc_key_access_request"
        ? "societyer-unbc-key-access-request"
        : recipe === "ote_keycard_access_request"
          ? "societyer-ote-individual-access-request"
          : "societyer-unbc-affiliate-id",
    externalWebhookUrl: `${base.replace(/\/$/, "")}/${webhookPath}`,
    externalEditUrl,
  };
}

function stepsForRun(recipe: string, nodePreview?: NodePreview[]) {
  const previewSteps = Array.isArray(nodePreview) && nodePreview.length > 0
    ? nodePreview
    : nodePreviewForRecipe(recipe as RecipeKey);
  return previewSteps.map((node) => ({
    key: node.key,
    label: node.label,
    status: "pending",
    note: node.description,
  }));
}

function normalizeIntakeInput(input: any) {
  const source = typeof input === "object" && input ? input : {};
  return { ...source };
}

function normalizeWorkflowRunInput(wf: any, input: any) {
  const supplied = input?.intake ?? input?.affiliate ?? input;
  return normalizeWorkflowPdfInput(wf, supplied);
}

function normalizeAffiliateInput(input: any) {
  const source = normalizeIntakeInput(input);
  return {
    ...UNBC_SAMPLE_AFFILIATE,
    ...source,
    "Check Box0": Boolean(source["Check Box0"] ?? source.previousUnbcIdYes ?? UNBC_SAMPLE_AFFILIATE["Check Box0"]),
    "Check Box1": Boolean(source["Check Box1"] ?? source.previousUnbcIdNo ?? UNBC_SAMPLE_AFFILIATE["Check Box1"]),
  };
}

function normalizeWorkflowPdfInput(wf: any, input: any) {
  if (wf?.recipe === "unbc_affiliate_id_request" || wf?.config?.pdfTemplateKey === "unbc_affiliate_id") {
    return normalizeAffiliateInput(input);
  }
  const source = normalizeIntakeInput(input);
  const sample = wf?.config?.sampleInput && typeof wf.config.sampleInput === "object"
    ? wf.config.sampleInput
    : {};
  return { ...sample, ...source };
}

function pdfFillUrlForWorkflow(wf: any, pdfTemplateKey: string) {
  if (typeof wf?.config?.pdfFillUrl === "string" && wf.config.pdfFillUrl.trim()) {
    return wf.config.pdfFillUrl.trim();
  }
  if (pdfTemplateKey === "unbc_affiliate_id") {
    return env("SOCIETYER_WORKFLOW_PDF_FILL_URL") ??
      "http://host.docker.internal:8787/api/v1/workflow-pdf/unbc-affiliate-id/fill";
  }
  const envName = `SOCIETYER_${pdfTemplateKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_PDF_FILL_URL`;
  return env(envName) ??
    `http://host.docker.internal:8787/api/v1/workflow-pdf/${encodeURIComponent(pdfTemplateKey)}/fill`;
}

function safeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function env(name: string) {
  return (globalThis as any)?.process?.env?.[name] as string | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---- PDF template inspection ------------------------------------------

async function inspectPdfTemplateBytes(
  bytes: ArrayBuffer | Uint8Array,
  metadata: Record<string, any> = {},
) {
  const pdfDoc = await PDFDocument.load(bytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields().map((field) => inspectPdfField(field));
  const tables = detectRepeatedPdfFieldTables(fields);
  const normalizedTables = normalizePdfTableStructures({ fields, metadata });
  const importBundle = buildPdfTableImportBundle({
    tables: normalizedTables,
    metadata,
    source: {
      externalSystem: metadata.externalSystem ?? "societyer-documents",
      externalId: metadata.externalId ?? metadata.documentId,
      title: metadata.title,
      fileName: metadata.fileName,
      mimeType: "application/pdf",
    },
  });
  return {
    ...metadata,
    pageCount: pdfDoc.getPageCount(),
    fieldCount: fields.length,
    fields,
    tables,
    normalizedTables,
    recordTables: normalizedTables.map((table) => table.recordTable),
    importBundle,
    detectedAtISO: new Date().toISOString(),
  };
}

function inspectPdfField(field: any) {
  const widgets = field.acroField?.getWidgets?.() ?? [];
  const rects = widgets
    .map((widget: any) => widget.getRectangle?.())
    .filter(Boolean)
    .map((rect: any) => ({
      x: roundRectNumber(rect.x),
      y: roundRectNumber(rect.y),
      width: roundRectNumber(rect.width),
      height: roundRectNumber(rect.height),
    }));
  return {
    name: field.getName(),
    type: pdfFieldType(field),
    rects,
    value: pdfFieldValue(field),
  };
}

function pdfFieldType(field: any) {
  const ctor = field?.constructor?.name;
  if (ctor === "PDFTextField") return "text";
  if (ctor === "PDFCheckBox") return "checkbox";
  if (ctor === "PDFSignature") return "signature";
  if (ctor === "PDFDropdown") return "dropdown";
  if (ctor === "PDFOptionList") return "optionList";
  if (ctor === "PDFRadioGroup") return "radio";
  return ctor ?? "unknown";
}

function pdfFieldValue(field: any) {
  const ctor = field?.constructor?.name;
  try {
    if (ctor === "PDFTextField") return cleanPdfValue(field.getText?.());
    if (ctor === "PDFCheckBox") return Boolean(field.isChecked?.());
    if (ctor === "PDFDropdown" || ctor === "PDFOptionList") return field.getSelected?.();
    if (ctor === "PDFRadioGroup") return cleanPdfValue(field.getSelected?.());
  } catch {
    return undefined;
  }
  return undefined;
}

function cleanPdfValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function roundRectNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function detectRepeatedPdfFieldTables(fields: any[]) {
  const groups = new Map<string, Array<{ field: any; row: number }>>();
  for (const field of fields) {
    const parsed = parseRepeatedFieldName(field.name);
    if (!parsed) continue;
    const existing = groups.get(parsed.base) ?? [];
    existing.push({ field, row: parsed.row });
    groups.set(parsed.base, existing);
  }
  for (const field of fields) {
    if (parseRepeatedFieldName(field.name)) continue;
    const existing = groups.get(field.name);
    if (existing) existing.push({ field, row: 1 });
  }

  const tables: any[] = [];
  for (const [base, rows] of groups) {
    const uniqueRows = Array.from(new Set(rows.map((row) => row.row))).sort((a, b) => a - b);
    if (uniqueRows.length < 2) continue;
    const firstRect = rows[0]?.field?.rects?.[0];
    tables.push({
      kind: "repeatedField",
      label: base,
      confidence: "medium",
      rowCount: uniqueRows.length,
      columns: [
        {
          key: slugifyFieldKey(base),
          label: base,
          fieldNames: rows
            .sort((a, b) => a.row - b.row)
            .map((row) => row.field.name),
        },
      ],
      bounds: tableBounds(rows.map((row) => row.field.rects?.[0]).filter(Boolean)),
      notes: firstRect
        ? "Detected from repeated AcroForm field names and aligned widget positions."
        : "Detected from repeated AcroForm field names.",
    });
  }
  return tables;
}

function parseRepeatedFieldName(name: string) {
  const match = String(name).match(/^(.*?)(?:\s+(\d+))$/);
  if (!match) return null;
  const base = match[1].trim();
  const row = Number(match[2]);
  if (!base || !Number.isFinite(row) || row < 2) return null;
  return { base, row };
}

function tableBounds(rects: any[]) {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return {
    x: roundRectNumber(minX),
    y: roundRectNumber(minY),
    width: roundRectNumber(maxX - minX),
    height: roundRectNumber(maxY - minY),
  };
}

// ---- runtime mapping resolution ---------------------------------------

function findFillPdfNode(wf: any) {
  return findWorkflowNode(wf, "pdf_fill");
}

function findWorkflowNode(wf: any, type: string) {
  const nodes = Array.isArray(wf?.nodePreview) ? wf.nodePreview : [];
  return nodes.find((n: any) => n?.type === type);
}

async function buildExternalEmailDraft(ctx: any, wf: any, runId: any, args: any, intake: Record<string, any>) {
  const actor = args.actingUserId ? await ctx.runQuery(api.users.get, { id: args.actingUserId }) : null;
  const emailNode = findWorkflowNode(wf, "email");
  const cfg = effectiveEmailConfig(emailNode?.config ?? {}, wf.config ?? {});
  const templateContext = {
    today: new Date().toISOString().slice(0, 10),
    workflow: {
      id: String(wf?._id ?? ""),
      name: wf?.name ?? "",
      recipe: wf?.recipe ?? "",
    },
    run: {
      id: String(runId ?? ""),
      status: "running",
      startedAtISO: "",
      completedAtISO: "",
    },
    currentUser: {
      name: actor?.displayName ?? "",
      email: actor?.email ?? "",
    },
    intake,
    fieldValues: intake,
    document: {
      title: "",
      fileName: "",
      category: "",
    },
  };
  const subjectTemplate =
    typeof cfg.subject === "string" && cfg.subject.length > 0
      ? cfg.subject
      : emailNode?.label ?? "Workflow notification";
  return {
    fromName: typeof cfg.fromName === "string" ? renderWorkflowTemplate(cfg.fromName, templateContext).trim() : undefined,
    fromEmail: typeof cfg.fromEmail === "string" ? renderWorkflowTemplate(cfg.fromEmail, templateContext).trim() : undefined,
    replyTo: typeof cfg.replyTo === "string" ? renderWorkflowTemplate(cfg.replyTo, templateContext).trim() : undefined,
    to: typeof cfg.to === "string" ? renderWorkflowTemplate(cfg.to, templateContext).trim() : "",
    cc: typeof cfg.cc === "string" ? renderWorkflowTemplate(cfg.cc, templateContext).trim() : undefined,
    bcc: typeof cfg.bcc === "string" ? renderWorkflowTemplate(cfg.bcc, templateContext).trim() : undefined,
    subject: renderWorkflowTemplate(subjectTemplate, templateContext).trim(),
    body: renderWorkflowTemplate(typeof cfg.body === "string" ? cfg.body : "", templateContext),
  };
}

async function buildWorkflowTemplateContext(ctx: any, wf: any, run: any, extra: Record<string, any> = {}) {
  const actor = run?.triggeredByUserId ? await ctx.db.get(run.triggeredByUserId) : null;
  const output = run?.output ?? {};
  const document = extra.document ?? output.generatedDocument ?? {};
  const today = new Date().toISOString().slice(0, 10);
  return {
    today,
    workflow: {
      id: String(wf?._id ?? ""),
      name: wf?.name ?? "",
      recipe: wf?.recipe ?? "",
    },
    run: {
      id: String(run?._id ?? ""),
      status: run?.status ?? "",
      startedAtISO: run?.startedAtISO ?? "",
      completedAtISO: run?.completedAtISO ?? "",
    },
    currentUser: {
      name: actor?.displayName ?? "",
      email: actor?.email ?? "",
    },
    intake: output.intake ?? {},
    fieldValues: output.fieldValues ?? {},
    document: {
      title: document?.title ?? "",
      fileName: document?.fileName ?? "",
      category: document?.category ?? "",
    },
  };
}

function renderWorkflowTemplate(template: string, context: Record<string, any>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path) => {
    const value = resolveTemplatePath(context, path);
    return value == null ? "" : String(value);
  });
}

function resolveTemplatePath(source: Record<string, any>, path: string) {
  const parts = path.split(".");
  let cursor: any = source;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function dynamicValue(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const now = new Date();
  if (source === "today") return now.toISOString().slice(0, 10);
  if (source === "today:long") {
    return now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (source === "now") return now.toISOString();
  return undefined; // society.name / currentUser.* filled in via gathered context
}

function personFieldValue(person: any, source?: string): string | undefined {
  if (!person || !source) return undefined;
  if (source.startsWith("custom:")) return undefined; // handled separately
  if (source === "fullName") {
    const full = `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim();
    return full || undefined;
  }
  if (source === "mailingAddress") return person.address ?? person.mailingAddress ?? undefined;
  const v = person[source];
  return typeof v === "string" ? v : v == null ? undefined : String(v);
}

// Called from within the run() action — gathers everything we need for
// resolution in one round-trip.
export const _gatherMappingContext = internalQuery({
  args: {
    societyId: v.id("societies"),
    actingUserId: v.optional(v.id("users")),
    personRefs: v.array(v.object({ category: v.string(), personId: v.string() })),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, actingUserId, personRefs }) => {
    const society = await ctx.db.get(societyId);
    const actor = actingUserId ? await ctx.db.get(actingUserId) : null;

    const byKey: Record<
      string,
      { person: any; customValues: Record<string, any> }
    > = {};
    for (const ref of personRefs) {
      const key = `${ref.category}:${ref.personId}`;
      if (byKey[key]) continue;
      let person: any = null;
      try {
        person = await ctx.db.get(ref.personId as any);
      } catch {
        person = null;
      }
      const defs = await ctx.db
        .query("customFieldDefinitions")
        .withIndex("by_society_entity", (q) =>
          q.eq("societyId", societyId).eq("entityType", ref.category),
        )
        .collect();
      const defKeyById = new Map<string, string>(defs.map((d: any) => [String(d._id), d.key]));
      const values = await ctx.db
        .query("customFieldValues")
        .withIndex("by_entity", (q) =>
          q.eq("entityType", ref.category).eq("entityId", ref.personId),
        )
        .collect();
      const customValues: Record<string, any> = {};
      for (const v of values) {
        const k = defKeyById.get(String(v.definitionId));
        if (k) customValues[k] = v.value;
      }
      byKey[key] = { person, customValues };
    }
    return {
      societyName: society?.name ?? "",
      actingUser: actor
        ? { name: actor.displayName ?? "", email: actor.email ?? "" }
        : null,
      personRefs: byKey,
    };
  },
});

// Resolve each PDF field mapping into a flat {fieldName: string} map.
// Unmapped fields are left out so callers can fall back to form input.
async function resolveFieldMappings(
  ctx: any,
  wf: any,
  args: any,
): Promise<Record<string, string>> {
  const node = findFillPdfNode(wf);
  const mappings: Record<string, any> = node?.config?.fieldMappings ?? {};
  if (!mappings || Object.keys(mappings).length === 0) return {};

  const personRefs: Array<{ category: string; personId: string }> = [];
  for (const m of Object.values(mappings) as any[]) {
    if (m?.kind === "personRef" && m.category && m.personId) {
      personRefs.push({ category: m.category, personId: m.personId });
    }
  }

  const gathered: any = await ctx.runQuery(internal.workflows._gatherMappingContext, {
    societyId: wf.societyId,
    actingUserId: args.actingUserId,
    personRefs,
  });

  const intakeInput = args.input?.intake ?? args.input?.affiliate ?? args.input ?? {};
  const personInput = args.input?.person ?? args.input?.affiliate ?? intakeInput;
  const managerInput = args.input?.manager ?? {};

  const result: Record<string, string> = {};
  for (const [field, m] of Object.entries(mappings) as [string, any][]) {
    const value = computeMappingValue(m, gathered, intakeInput, personInput, managerInput);
    if (value !== undefined && value !== null && value !== "") {
      result[field] = String(value);
    }
  }
  return result;
}

function computeMappingValue(
  m: any,
  gathered: any,
  intakeInput: any,
  personInput: any,
  managerInput: any,
): string | undefined {
  if (!m) return undefined;
  switch (m.kind) {
    case "literal":
      return typeof m.value === "string" ? m.value : undefined;
    case "dynamic": {
      if (m.source === "society.name") return gathered?.societyName ?? undefined;
      if (m.source === "currentUser.name") return gathered?.actingUser?.name ?? undefined;
      if (m.source === "currentUser.email") return gathered?.actingUser?.email ?? undefined;
      return dynamicValue(m.source);
    }
    case "intake": {
      if (!m.source) return undefined;
      const value = intakeInput?.[m.source];
      return value == null || value === "" ? undefined : String(value);
    }
    case "person": {
      if (!m.source) return undefined;
      // Common aliases mapped from the form / affiliate payload.
      const keyMap: Record<string, string[]> = {
        firstName: ["firstName", "Legal First Name of Affiliate"],
        lastName: ["lastName", "Legal Last Name of Affiliate"],
        email: ["email", "Personal email address"],
        phone: ["phone", "ManagerPhone"],
        mailingAddress: ["mailingAddress", "address", "Current Mailing Address"],
        birthdate: ["birthdate", "Birthdate of Affiliate (MM/DD/YYYY)"],
      };
      const candidates = keyMap[m.source] ?? [m.source];
      for (const k of candidates) {
        const v = personInput?.[k];
        if (v != null && v !== "") return String(v);
      }
      return undefined;
    }
    case "manager": {
      if (!m.source) return undefined;
      const keyMap: Record<string, string[]> = {
        name: ["name", "Name of requesting Manager"],
        email: ["email", "Manager Email"],
        phone: ["phone", "ManagerPhone"],
        department: ["department", "UNBC Department/Organization"],
      };
      const candidates = keyMap[m.source] ?? [m.source];
      for (const k of candidates) {
        const v = managerInput?.[k];
        if (v != null && v !== "") return String(v);
      }
      return undefined;
    }
    case "personRef": {
      if (!m.category || !m.personId || !m.source) return undefined;
      const key = `${m.category}:${m.personId}`;
      const bundle = gathered?.personRefs?.[key];
      if (!bundle?.person) return undefined;
      if (typeof m.source === "string" && m.source.startsWith("custom:")) {
        const customKey = m.source.slice("custom:".length);
        const raw = bundle.customValues?.[customKey];
        return raw == null ? undefined : String(raw);
      }
      return personFieldValue(bundle.person, m.source);
    }
    case "empty":
    default:
      return undefined;
  }
}
