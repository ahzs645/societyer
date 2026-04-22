export type StarterTemplateSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type StarterPolicyTemplate = {
  key: string;
  name: string;
  policyNumber: string;
  templateType?: "policy" | "document";
  documentTag?: string;
  sourceFile: string;
  sourceSha256: string;
  summary: string;
  signatureRequired?: boolean;
  includeBoardAcceptance?: boolean;
  requiredDataFields?: string[];
  optionalDataFields?: string[];
  reviewDataFields?: string[];
  sections: StarterTemplateSection[];
};

const COMMON_REQUIRED_FIELDS = [
  "CorporationName",
  "PolicyName",
  "PolicyNumber",
  "PolicyEffectiveDate",
  "ReviewDate",
  "EffectiveDate",
  "VotingDirectors",
];

export const STARTER_POLICY_TEMPLATES: StarterPolicyTemplate[] = [
  {
    key: "authorization-policy",
    name: "Authorization Policy",
    policyNumber: "AUTH-001",
    documentTag: "other",
    sourceFile: "AuthorizationPolicy.pdf",
    sourceSha256: "2f2286966c17267df80e076115eb04ff2582574d23755cf40a8001d1ef0821a3",
    summary: "Signing authority, cheque controls, invoice approval, legal document execution, gift agreement approval, and receipt authority.",
    sections: [
      {
        heading: "Authority",
        paragraphs: [
          "Two authorized signers are required for cheques, banking instructions, and other banking documents unless the bylaws or board resolution require a stricter rule.",
          "Invoices must be reviewed before payment. Non-budgeted invoices above {NonBudgetedApprovalLimit} require approval by the board chair, treasurer, or another board-approved officer.",
        ],
      },
      {
        heading: "Legal and Fund Documents",
        paragraphs: [
          "Legal documents may be signed only after the board has approved the transaction or delegated authority for that class of document.",
          "Fund agreements, deeds of gift, and comparable donor agreements require the approvals and signatures listed in the signing authority schedule.",
        ],
      },
      {
        heading: "Receipts",
        paragraphs: [
          "Donation receipts may be signed or issued by the role designated by the board, subject to the organization's receipting controls and charity registration obligations.",
        ],
      },
    ],
  },
  {
    key: "code-of-ethics",
    name: "Code of Ethics",
    policyNumber: "ETH-001",
    documentTag: "other",
    sourceFile: "CodeofEthics.pdf",
    sourceSha256: "f4d1c9e490576f9e00d47ead91eae0b84563e3c6dfd0fb388c240d2365112a2f",
    summary: "Ethical standards for directors, staff, volunteers, transparency, stewardship, inclusion, and conflicts.",
    sections: [
      {
        heading: "Purpose",
        paragraphs: [
          "The organization expects directors, officers, staff, committee members, and volunteers to act with integrity, honesty, impartiality, openness, respect, and responsibility.",
        ],
      },
      {
        heading: "Standards",
        bullets: [
          "Act in the best interests of the organization and its purposes.",
          "Use organizational resources carefully and for approved purposes.",
          "Communicate truthfully and maintain appropriate transparency.",
          "Respect privacy, confidentiality, and records access rules.",
          "Declare and manage conflicts of interest promptly.",
          "Promote inclusive participation and respectful conduct.",
        ],
      },
    ],
  },
  {
    key: "committee-formation-procedure",
    name: "Committee Formation and Procedure Policy",
    policyNumber: "GOV-001",
    documentTag: "sub_committee_records",
    sourceFile: "CommitteeFormationAndProcedure.pdf",
    sourceSha256: "ccf57ad5f200328c72980cc7119e54011746828a90e497b7b9efaf17554456d0",
    summary: "Board committee creation, composition, reporting, terms of reference, chairing, evaluation, and renewal.",
    sections: [
      {
        heading: "Committee Authority",
        paragraphs: [
          "Committees are created by board resolution and operate under board-approved terms of reference. Unless expressly delegated, committees are advisory and report recommendations to the board.",
        ],
      },
      {
        heading: "Membership and Terms",
        bullets: [
          "The board approves committee chairs and members.",
          "Committee members may include directors and non-director community members with relevant skills.",
          "Committee terms, renewal rules, and vacancies are recorded in the committee register.",
        ],
      },
      {
        heading: "Reporting",
        paragraphs: [
          "Committee reports, minutes, and material recommendations must be provided to the board and retained in the organization's records.",
        ],
      },
    ],
  },
  {
    key: "complaints",
    name: "Complaints Policy",
    policyNumber: "OPS-001",
    documentTag: "other",
    sourceFile: "Complaints.pdf",
    sourceSha256: "3851139a8f177df5426de471e7c05a2f060f21a59df5962d78b2395d1be8c5c4",
    summary: "Complaint intake, acknowledgement, escalation, confidentiality, timelines, board review, and learning loop.",
    sections: [
      {
        heading: "Purpose",
        paragraphs: [
          "Complaints are treated as an opportunity to resolve concerns fairly and improve the organization's services, conduct, and stakeholder relationships.",
        ],
      },
      {
        heading: "Receiving Complaints",
        bullets: [
          "Complaints may be received verbally or in writing.",
          "Written complaints should be acknowledged within {ComplaintAcknowledgementDays} business days.",
          "The responsible person records the complainant, issue, facts, requested remedy, response owner, and timeline.",
        ],
      },
      {
        heading: "Resolution and Escalation",
        paragraphs: [
          "The organization will try to resolve complaints promptly and respectfully. Matters involving directors, committee members, the executive director, or unresolved concerns are escalated under the board-approved escalation path.",
        ],
      },
    ],
  },
  {
    key: "confidentiality-privacy",
    name: "Confidentiality and Privacy Policy",
    policyNumber: "PRI-001",
    documentTag: "other",
    sourceFile: "ConfidentialityAndPrivacy.pdf",
    sourceSha256: "d3dec7598559f497216bb4c12b04a2e81318ccfdeeabec48db9b330283cac9f5",
    summary: "Confidential handling of stakeholder, donor, grant, contract, personnel, meeting, and personal information.",
    sections: [
      {
        heading: "General Commitment",
        paragraphs: [
          "The organization protects personal, donor, member, employee, volunteer, applicant, and stakeholder information through limited access, appropriate safeguards, and clear accountability.",
        ],
      },
      {
        heading: "Confidential Information",
        bullets: [
          "Donor identity, gift level, donor intent, and anonymity requests.",
          "Grant application, recipient, and assessment information.",
          "Personnel, contract, litigation, legal, property, and meeting materials.",
          "Any personal information collected for organizational purposes.",
        ],
      },
      {
        heading: "Access and Safeguards",
        paragraphs: [
          "Access is limited to people who need the information for authorized duties. Paper and electronic records must be protected against unauthorized access, loss, and improper disclosure.",
        ],
      },
    ],
  },
  {
    key: "conflict-of-interest",
    name: "Conflict of Interest Policy",
    policyNumber: "GOV-002",
    documentTag: "director_consents__resignations__and_indemnifications",
    sourceFile: "ConflictOfInterest.pdf",
    sourceSha256: "fa85333eea4d5f2653cc1deef3f3dd330fae95946cacb9cb1a6e67474b3fc959",
    summary: "Conflict declaration, meeting procedure, abstention, gifts, grant conflicts, business relationships, and records.",
    sections: [
      {
        heading: "Policy",
        paragraphs: [
          "Directors, officers, committee members, staff, and volunteers must avoid actual, potential, and perceived conflicts of interest and must disclose conflicts as soon as they are known.",
        ],
      },
      {
        heading: "Meeting Procedure",
        bullets: [
          "Conflict declarations are requested at the start of meetings and before affected agenda items.",
          "The minutes record the declaration and the person's recusal, abstention, or other management step.",
          "A conflicted person does not participate in discussion, recommendation, or vote unless the board determines a different lawful process applies.",
        ],
      },
      {
        heading: "Gifts and Benefits",
        paragraphs: [
          "Personal gifts, benefits, or preferential treatment from current or prospective suppliers, grantees, donors, or partners must be declined unless permitted by board-approved rules.",
        ],
      },
    ],
  },
  {
    key: "cost-recovery-fees",
    name: "Cost Recovery Fees Policy",
    policyNumber: "FIN-001",
    documentTag: "other",
    sourceFile: "CostRecoveryFees.pdf",
    sourceSha256: "4529e19269bdc9fcfc3f41692aaab8331d9c8b4c5730cd21a676410269149312",
    summary: "Fund administration fees, donor disclosure, calculation basis, extraordinary costs, and transaction fees.",
    sections: [
      {
        heading: "Fee Approval",
        paragraphs: [
          "Cost recovery or administration fees charged to funds must be recommended by the finance committee or treasurer and approved by the board.",
        ],
      },
      {
        heading: "Disclosure and Calculation",
        bullets: [
          "Fee provisions are included in fund agreements or donor communications where applicable.",
          "Donors are informed of the current fee and any material changes.",
          "Fees are calculated using the board-approved basis, such as fund capital and undistributed earnings at a specified date.",
        ],
      },
      {
        heading: "Extraordinary Costs",
        paragraphs: [
          "Extraordinary costs and electronic transaction fees may be charged to the applicable fund if permitted by the board-approved fee schedule and donor documentation.",
        ],
      },
    ],
  },
  {
    key: "disaster-preparedness",
    name: "Disaster Preparedness and Recovery Policy",
    policyNumber: "OPS-002",
    documentTag: "other",
    sourceFile: "DisasterPreparedness.pdf",
    sourceSha256: "e20465644ec53dccb34e93693350c535c8055dcc8c5d3afb3f1d2b36326e9cbe",
    summary: "Continuity planning, records backup, emergency roles, communications, service restoration, and review.",
    sections: [
      {
        heading: "Continuity Objective",
        paragraphs: [
          "The organization maintains practical plans to protect people, records, systems, funds, and essential services during and after emergencies.",
        ],
      },
      {
        heading: "Preparedness",
        bullets: [
          "Identify emergency contacts, decision makers, and backup authorities.",
          "Maintain secure offsite or cloud backups for critical records.",
          "Document alternate communications, banking, payroll, and donor-service procedures.",
          "Review insurance, facility access, and key supplier continuity arrangements.",
        ],
      },
      {
        heading: "Recovery",
        paragraphs: [
          "After an incident, the responsible officers document the event, immediate actions, service gaps, restoration plan, and lessons learned for board review.",
        ],
      },
    ],
  },
  {
    key: "donation-recording-receipting",
    name: "Donation Recording and Receipting Policy",
    policyNumber: "DON-001",
    documentTag: "tax_numbers",
    sourceFile: "DonationRecordingAndReceipting.pdf",
    sourceSha256: "b8e1853b32d80217b227a1c4eb9f057cab239a8c1bdf327c5fc0276ccafc22b5",
    summary: "Gift ownership, official donation receipt content, fund designation evidence, securities valuation, retention, and special events.",
    sections: [
      {
        heading: "Receipt Authority",
        paragraphs: [
          "Official donation receipts are issued only after the gift has become the legal property of the organization and the required gift information is complete.",
        ],
      },
      {
        heading: "Receipt Information",
        bullets: [
          "Donor name and address.",
          "Organization legal name, address, and charitable registration number where applicable.",
          "Date received and eligible amount.",
          "Description and valuation support for gifts in kind.",
          "Any required regulatory statements or website references.",
        ],
      },
      {
        heading: "Records",
        paragraphs: [
          "Receipt copies, designation evidence, valuation support, and special event calculations are retained for the required retention period and linked to the applicable fund or donor record.",
        ],
      },
    ],
  },
  {
    key: "donor-rights-stewardship",
    name: "Donor Rights and Stewardship Policy",
    policyNumber: "DON-002",
    documentTag: "other",
    sourceFile: "DonorRecognitionAndStewardship.pdf",
    sourceSha256: "ea0446a19bd748216d805462f11b4e69f1aa13b96fa2e969cbf7a0e7c2859a36",
    summary: "Donor information rights, stewardship expectations, financial access, gift-use assurance, privacy, recognition, anonymity, and receipts.",
    sections: [
      {
        heading: "Donor Rights",
        bullets: [
          "Receive truthful information about the organization's mission, governance, and use of donated resources.",
          "Access recent financial statements, annual reports, and publicly available charity information.",
          "Expect gifts to be used for their stated purposes.",
          "Have donor records handled under privacy and confidentiality rules.",
          "Ask questions and receive prompt, accurate answers.",
          "Receive appropriate acknowledgement, recognition, anonymity, and receipts where applicable.",
        ],
      },
      {
        heading: "Stewardship",
        paragraphs: [
          "The organization reports to donors in a manner that respects donor intent, privacy, restrictions, and board-approved recognition practices.",
        ],
      },
    ],
  },
  {
    key: "executive-director-ceo-appointment",
    name: "Executive Director or CEO Appointment Policy",
    policyNumber: "HR-001",
    documentTag: "other",
    sourceFile: "ExecutiveDirectorCEOAppointment.pdf",
    sourceSha256: "bd40655e834fe2ea22aac84cdc3b53b5dc0be3545452e3e777cd5b3cd082eed6",
    summary: "CEO vacancy planning, search committee, position description, board approval, contract negotiation, and renewal.",
    sections: [
      {
        heading: "Vacancy Planning",
        paragraphs: [
          "When an executive director or CEO vacancy is expected, the board determines organizational needs, timeline, search process, and interim authority.",
        ],
      },
      {
        heading: "Search Committee",
        bullets: [
          "The board appoints a committee with a chair, vice chair, and at least one additional board member or other approved participant.",
          "The committee prepares timelines, comparator research, a position description, candidate process, and recommendations.",
          "Final appointment requires board approval under the voting threshold set by the board or bylaws.",
        ],
      },
      {
        heading: "Contract",
        paragraphs: [
          "Only board-authorized people may negotiate employment or contractor terms, and the final agreement is reported to or approved by the board as required.",
        ],
      },
    ],
  },
  {
    key: "expense-reimbursement",
    name: "Expense Reimbursement Policy",
    policyNumber: "FIN-002",
    documentTag: "other",
    sourceFile: "ExpenseReimbursement.pdf",
    sourceSha256: "2e7e4bdca17f970e9035c996c58bfa249fec3552b8e96bc76522ccbd152dcef7",
    summary: "Pre-approval, receipts, mileage, meals, staff and volunteer reimbursements, and executive expense review.",
    sections: [
      {
        heading: "Eligibility",
        paragraphs: [
          "Approved staff, directors, committee members, and volunteers may be reimbursed for reasonable expenses incurred for authorized organizational business.",
        ],
      },
      {
        heading: "Approval and Documentation",
        bullets: [
          "Expenses should be approved before they are incurred unless the board has approved another process.",
          "Receipts or equivalent support must be attached to reimbursement requests.",
          "Mileage, meals, travel, and special expenses follow the board-approved rates and limits.",
          "Executive director or CEO expenses are reviewed by the treasurer or another board-designated person.",
        ],
      },
    ],
  },
  {
    key: "financial-accountability",
    name: "Financial Accountability Policy",
    policyNumber: "FIN-003",
    documentTag: "other",
    sourceFile: "FinancialAccountability.pdf",
    sourceSha256: "2dad4da071b878c2b3fa68aa7305d2b78830c652df20176938068bd2c603fd1f",
    summary: "Financial stewardship, restricted gifts, receipting, statements, disclosure, annual reporting, and charity disbursement obligations.",
    sections: [
      {
        heading: "Stewardship",
        paragraphs: [
          "The organization's financial affairs are conducted responsibly, consistently with stewardship duties, governing documents, donor restrictions, and legal requirements.",
        ],
      },
      {
        heading: "Restricted Funds and Receipts",
        paragraphs: [
          "Donations are used for the purposes for which they were given. If a restriction can no longer be met, the board follows the donor, legal, and regulatory process before changing the use of funds.",
        ],
      },
      {
        heading: "Reporting",
        bullets: [
          "Financial statements are prepared and approved within the board-approved timeline.",
          "The annual report discloses financial information required by law, funders, regulators, and board policy.",
          "Payments to directors or related organizations are disclosed as required.",
        ],
      },
    ],
  },
  {
    key: "financial-operations",
    name: "Financial Operations Policy",
    policyNumber: "FIN-004",
    documentTag: "other",
    sourceFile: "FinancialOperations.pdf",
    sourceSha256: "d0c46970f09dc78dd1a86ecabd8dff62f65d40d6786c5571eb7aaf3816b75d90",
    summary: "Signing officers, accounts payable, monthly accounting, financial statements, remittances, banking, petty cash, authority limits, travel, audit, receipting, and budget.",
    sections: [
      {
        heading: "Signing Officers and Payments",
        paragraphs: [
          "The board designates signing officers and approves changes to signing authority. Payments require the authorizations set out in the signing authority schedule.",
        ],
      },
      {
        heading: "Accounting and Reporting",
        bullets: [
          "Accounts payable is processed within the board-approved payment timeline.",
          "Monthly accounting, bank deposits, government remittances, and journal entries are completed and reviewed.",
          "Quarterly or periodic financial statements are provided to the board.",
          "The budget is prepared annually and approved by the board.",
        ],
      },
      {
        heading: "Controls",
        paragraphs: [
          "Petty cash, credit cards, deposits, travel advances, audit preparation, and donation receipts are handled using documented controls and retained evidence.",
        ],
      },
    ],
  },
  {
    key: "fund-purpose",
    name: "Fund Purpose Policy",
    policyNumber: "DON-003",
    documentTag: "other",
    sourceFile: "FundPurpose.pdf",
    sourceSha256: "6fa830336f3c6a3437acc52427aa9465a2280a518e69475c8818c8d3153f5375",
    summary: "Charitable fund purposes, qualified donee grants, CRA-approved purposes, and allocation of salaries and operating costs.",
    sections: [
      {
        heading: "Purpose of Funds",
        paragraphs: [
          "Funds are received, maintained, and applied to the organization's charitable or nonprofit purposes as described in the governing documents and applicable fund agreements.",
        ],
      },
      {
        heading: "Eligible Uses",
        paragraphs: [
          "Fund principal and income may be used for approved programs, grants, qualified donee gifts, or other lawful activities that advance the stated purposes.",
        ],
      },
      {
        heading: "Allocation",
        paragraphs: [
          "Salary, benefit, fundraising, management, and operating allocations are documented using a reasonable board-approved allocation basis and provided to the auditor or reviewer when required.",
        ],
      },
    ],
  },
  {
    key: "personal-information-electronic-communications",
    name: "Personal Information and Electronic Communications Policy",
    policyNumber: "PRI-002",
    documentTag: "other",
    sourceFile: "PersonalInformationPrivacy.pdf",
    sourceSha256: "9c4fab23e2a34fee3e9f5d0856283aaeb2d34d542aab092fe5fa1d722e7e3568",
    summary: "Personal information, electronic communications, consent, unsubscribe handling, complaints, and privacy contact information.",
    sections: [
      {
        heading: "Compliance",
        paragraphs: [
          "The organization follows applicable privacy, anti-spam, charity, and communications laws for collecting, using, disclosing, storing, and communicating personal information.",
        ],
      },
      {
        heading: "Electronic Communications",
        bullets: [
          "Commercial or fundraising electronic messages are sent only when consent or another lawful basis applies.",
          "Unsubscribe and removal requests are honoured promptly.",
          "Electronic records and contact lists are safeguarded against unauthorized access or misuse.",
        ],
      },
      {
        heading: "Questions and Complaints",
        paragraphs: [
          "Questions, correction requests, privacy complaints, and communication complaints are directed to {PrivacyOfficerName} at {PrivacyOfficerEmail}.",
        ],
      },
    ],
  },
  {
    key: "spokesperson",
    name: "Spokesperson Policy",
    policyNumber: "COM-001",
    documentTag: "other",
    sourceFile: "Spokesperson.pdf",
    sourceSha256: "62dc1a46c3373f37956c74e0d76575b63beaab60551678267db5f0ea38f37ffc",
    summary: "Official spokesperson roles for board policy/community leadership and operational matters.",
    sections: [
      {
        heading: "Official Spokespersons",
        paragraphs: [
          "The board chair is the official spokesperson for board policy, governance, and community leadership matters unless the board delegates otherwise.",
          "The executive director, CEO, or another board-approved person is the official spokesperson for operational matters.",
        ],
      },
      {
        heading: "Delegation",
        paragraphs: [
          "Delegated public statements must be consistent with board policy, approved messaging, confidentiality obligations, and the organization's communications plan.",
        ],
      },
    ],
  },
  {
    key: "meeting-minutes-guide",
    name: "Meeting Minutes Examples and Drafting Guide",
    policyNumber: "GOV-DOC-001",
    templateType: "document",
    documentTag: "members_meetings_and_resolutions0",
    sourceFile: "How to Take Meeting Minutes Examples.pdf",
    sourceSha256: "214314c915dce094675bb63511ddf7ce313d97f5b91fa1d146554218c86b6556",
    summary: "Good and bad meeting-minutes examples, with a usable structure for concise, resolution-focused minutes.",
    signatureRequired: false,
    includeBoardAcceptance: false,
    requiredDataFields: ["OrganizationName", "MeetingDate", "MeetingType", "ChairName", "Attendees", "Regrets", "Motions"],
    sections: [
      {
        heading: "Good Minutes Structure",
        bullets: [
          "Organization name, meeting type, date, attendance, regrets, chair, and recorder.",
          "Call to order, agenda adoption, previous minutes approval, decisions, motions, and adjournment.",
          "For each motion, record the exact resolution, mover, seconder if used, and result.",
        ],
      },
      {
        heading: "Avoid",
        bullets: [
          "Verbatim transcript-style discussion.",
          "Personal comments, side conversations, or informal notes to self.",
          "Unnecessary detail that does not support the legal record of decisions.",
          "Omitting attachments, conflicts, abstentions, or failed motions where they matter.",
        ],
      },
      {
        heading: "Template",
        paragraphs: [
          "MOTION: Be it resolved that {MotionText}. Moved by {MovedBy}. Seconded by {SecondedBy}. {Outcome}.",
        ],
      },
    ],
  },
];

export function starterTemplateMarker(template: StarterPolicyTemplate) {
  return `starter-policy-template:${template.key}`;
}

export function starterTemplateHtml(template: StarterPolicyTemplate) {
  const body = template.sections.map(renderSection).join("\n");
  const acceptance = template.includeBoardAcceptance === false ? "" : renderBoardAcceptance();
  return [
    `<h1>{PolicyName}</h1>`,
    `<p><strong>Organization:</strong> {CorporationName}</p>`,
    `<p><strong>Policy number:</strong> {PolicyNumber}</p>`,
    `<p><strong>Effective date:</strong> {PolicyEffectiveDate}</p>`,
    `<p><em>This is a Societyer starter template remade from imported source material. Review it for your jurisdiction, bylaws, funder requirements, charity status, and actual operations before adoption.</em></p>`,
    body,
    `<h2>Monitoring</h2>`,
    `<p>This ${template.templateType === "document" ? "template" : "policy"} will be reviewed on or around {ReviewDate} and whenever legal, operational, funding, or governance requirements materially change.</p>`,
    acceptance,
    `<p><small>Source: ${template.sourceFile}; SHA-256 ${template.sourceSha256}</small></p>`,
  ].filter(Boolean).join("\n\n");
}

export function starterTemplateRequiredFields(template: StarterPolicyTemplate) {
  if (template.requiredDataFields) return template.requiredDataFields;
  return COMMON_REQUIRED_FIELDS;
}

function renderSection(section: StarterTemplateSection) {
  const paragraphs = (section.paragraphs ?? []).map((paragraph) => `<p>${paragraph}</p>`).join("\n");
  const bullets = section.bullets?.length
    ? `<ul>\n${section.bullets.map((bullet) => `  <li>${bullet}</li>`).join("\n")}\n</ul>`
    : "";
  return [`<h2>${section.heading}</h2>`, paragraphs, bullets].filter(Boolean).join("\n");
}

function renderBoardAcceptance() {
  return [
    `<h2>Board Acceptance</h2>`,
    `<p>This policy was approved by resolution of the board of directors of {CorporationName} on {EffectiveDate}.</p>`,
    `<p>{#SoleVotDir}Approved by the sole voting director.{/SoleVotDir}{#MultiVotDir}Approved by counterpart signatures of the voting directors.{/MultiVotDir}</p>`,
    `<p>{#VotingDirectors}{SignerTag}<br />_________________________________________<br />{Director-Name}{/VotingDirectors}</p>`,
  ].join("\n");
}
