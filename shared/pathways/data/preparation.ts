export type IncorporationPreparationGuide = {
  id: string;
  title: string;
  entityType: string;
  jurisdictionCode: string;
  statute: string;
  filingChannel: {
    summary: string;
    onlineUrl: string;
    mailSummary: string;
    verificationStatus: "requires_current_registry_check";
  };
  requirements: { key: string; title: string; detail: string; sourceUrl: string }[];
  sources: {
    label: string;
    url: string;
    evidenceDate?: string;
    evidenceBasis: "repository_source" | "verification_link";
  }[];
  retainedDocuments: string[];
};

const BC_BCA = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/02057_00";
const BC_SOCIETIES = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01";
const BC_MODEL_BYLAWS = "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/216_2015";
const CBCA = "https://laws-lois.justice.gc.ca/eng/acts/C-44/FullText.html";
const ISED = "https://ised-isde.canada.ca/site/corporations-canada/en";
const BC_COMPANY_PORTAL = "https://www.corporateonline.gov.bc.ca/";
const BC_SOCIETY_PORTAL = "https://www.bcregistry.ca/societies/";

/**
 * Preparation checklists, not filing forms or a filing service. Evidence dates refer
 * to existing repository guide packs; current registry channels, fees, and forms
 * have not been reverified by creating this model. Keep that distinction visible.
 */
export const INCORPORATION_PREPARATION_GUIDES: IncorporationPreparationGuide[] = [
  {
    id: "bc_society",
    title: "Prepare a BC society",
    entityType: "society",
    jurisdictionCode: "CA-BC",
    statute: "Societies Act (BC)",
    filingChannel: {
      summary: "Use BC Societies Online for the society incorporation route. Follow the registry's current incorporation instructions and name-approval process.",
      onlineUrl: BC_SOCIETY_PORTAL,
      mailSummary: "A mail filing route has not been verified here. If online filing is unsuitable, ask BC Registry Services which assisted or alternative filing service applies before sending documents.",
      verificationStatus: "requires_current_registry_check",
    },
    requirements: [
      { key: "name", title: "Choose and approve the society name", detail: "Prepare the proposed name and obtain the registry's required name approval before completing the incorporation application.", sourceUrl: BC_SOCIETIES },
      { key: "constitution", title: "Prepare the constitution", detail: "Record the society's name and purposes. A BC society uses a constitution and bylaws rather than a business corporation's share structure.", sourceUrl: BC_SOCIETIES },
      { key: "bylaws", title: "Prepare the bylaws", detail: "Use the official model bylaws as a starting point or prepare suitable custom bylaws. Decide whether member-funded society provisions apply before selecting directors and governance terms.", sourceUrl: BC_MODEL_BYLAWS },
      { key: "directors", title: "Confirm the first directors", detail: "Collect directors' names, contact details, and consents, and check the applicable number, qualifications, and residency rules for the society subtype.", sourceUrl: BC_SOCIETIES },
      { key: "office", title: "Choose the registered office", detail: "Prepare the BC registered office delivery and mailing addresses and the contact information requested by the registry.", sourceUrl: BC_SOCIETIES },
      { key: "application", title: "Review the application and submit at the registry", detail: "Review the constitution, bylaws, directors, registered office, name approval, and current fee in the official service. Creating a Societyer workspace does not incorporate the society or grant charitable status.", sourceUrl: BC_SOCIETY_PORTAL },
    ],
    sources: [
      { label: "BC Societies Act", url: BC_SOCIETIES, evidenceDate: "2026-04-14", evidenceBasis: "repository_source" },
      { label: "Official model bylaws (Societies Regulation)", url: BC_MODEL_BYLAWS, evidenceDate: "2026-04-14", evidenceBasis: "repository_source" },
      { label: "Societies Online: confirm current filing instructions", url: BC_SOCIETY_PORTAL, evidenceBasis: "verification_link" },
    ],
    retainedDocuments: ["Certificate of incorporation", "Filed constitution and bylaws", "Director consents and director register", "Registry receipt and confirmation", "Initial member register and organizational resolutions"],
  },
  {
    id: "bc_company",
    title: "Prepare a BC business company",
    entityType: "corporation__business_",
    jurisdictionCode: "CA-BC",
    statute: "Business Corporations Act (BC)",
    filingChannel: {
      summary: "Start with BC Corporate Online / BC Registry Services for a BC business company. Confirm the current incorporation service for the company subtype before filing.",
      onlineUrl: BC_COMPANY_PORTAL,
      mailSummary: "A mail filing route has not been verified here. Ask BC Registry Services about an assisted or alternative filing route; do not assume mailing the worksheet creates a company.",
      verificationStatus: "requires_current_registry_check",
    },
    requirements: [
      { key: "name", title: "Choose a named or numbered company", detail: "Prepare the proposed name and required approval for a named company, or select the numbered-company route. Confirm naming requirements in the current registry service.", sourceUrl: BC_BCA },
      { key: "agreement", title: "Prepare and sign the incorporation agreement", detail: "Identify the incorporator or incorporators and the shares each agrees to take. Keep the signed agreement with the company's records.", sourceUrl: BC_BCA },
      { key: "articles", title: "Prepare the company's articles and share structure", detail: "Define share classes and their rights and restrictions, transfer restrictions, and governance provisions. A BC business company uses articles and a notice of articles, not a society constitution.", sourceUrl: BC_BCA },
      { key: "directors", title: "Confirm the initial directors", detail: "Collect each initial director's details and consent and check director qualifications and the company's articles before filing.", sourceUrl: BC_BCA },
      { key: "offices", title: "Choose the registered and records offices", detail: "Prepare the required BC delivery and mailing addresses for both offices and confirm where the company's corporate records will be held.", sourceUrl: BC_BCA },
      { key: "application", title: "Prepare the incorporation application and notice of articles", detail: "Reconcile the legal name, offices, directors, and share structure with the signed incorporation agreement and articles, then complete the official filing and fee payment. Societyer does not submit this application.", sourceUrl: BC_BCA },
      { key: "ownership", title: "Plan ownership records and post-incorporation registrations", detail: "Prepare shareholder and beneficial-ownership information, a central securities register, and a transparency register where applicable. Review CRA accounts and registrations in other provinces where the company will operate.", sourceUrl: BC_BCA },
    ],
    sources: [
      { label: "BC Business Corporations Act (formation and company records)", url: BC_BCA, evidenceDate: "2026-06-05", evidenceBasis: "repository_source" },
      { label: "BC Corporate Online: confirm current incorporation service", url: BC_COMPANY_PORTAL, evidenceBasis: "verification_link" },
    ],
    retainedDocuments: ["Certificate of incorporation", "Notice of articles", "Company articles", "Signed incorporation agreement", "Director consents", "Registry receipt and confirmation", "Initial resolutions, share issuance records, and applicable ownership registers"],
  },
  {
    id: "federal_cbca",
    title: "Prepare a federal business corporation",
    entityType: "corporation__business_",
    jurisdictionCode: "CA-FED-CBCA",
    statute: "Canada Business Corporations Act (CBCA)",
    filingChannel: {
      summary: "Use the Corporations Canada incorporation service for the federal CBCA business corporation route. Review its current online steps, name selection, required information, and fees.",
      onlineUrl: `${ISED}/business-corporations/how-incorporate-business`,
      mailSummary: "Current paper or mail availability has not been verified here. Consult Corporations Canada's current filing instructions before selecting a paper route or mailing forms; no mailing address or paper fee is assumed.",
      verificationStatus: "requires_current_registry_check",
    },
    requirements: [
      { key: "name", title: "Choose a word name or numbered corporation", detail: "Prepare the proposed corporate name or use a numbered name. Follow the current federal name-search and name-approval requirements for the chosen route.", sourceUrl: CBCA },
      { key: "articles", title: "Prepare the articles of incorporation", detail: "Specify the corporation name, province or territory of the registered office, share classes and rights, share-transfer restrictions, number of directors, and any business restrictions or other provisions.", sourceUrl: CBCA },
      { key: "office-directors", title: "Prepare registered-office and initial-director information", detail: "Collect the registered-office address, first directors' names and addresses, consents, and qualification information. Check current CBCA director requirements for the business and corporation type.", sourceUrl: CBCA },
      { key: "isc", title: "Prepare individuals-with-significant-control information", detail: "Identify the individuals with significant control and collect the information required for the register and current incorporation filing, or document why an exception applies. Review which information is made public.", sourceUrl: `${ISED}/individuals-significant-control` },
      { key: "application", title: "Review and submit through Corporations Canada", detail: "Review articles, registered-office and director information, required ISC information, name approval, and the current fee in the official service. A Societyer draft or workspace does not incorporate the business.", sourceUrl: `${ISED}/business-corporations/how-incorporate-business` },
      { key: "provincial-registration", title: "Plan provincial registrations and the minute book", detail: "Federal incorporation does not remove provincial or territorial registration obligations. Check where the company will carry on business, then organize bylaws, directors' resolutions, share records, and CRA accounts after incorporation.", sourceUrl: `${ISED}/register-federal-corporation-province-or-territory` },
    ],
    sources: [
      { label: "Canada Business Corporations Act (articles and corporate records)", url: CBCA, evidenceDate: "2026-06-02", evidenceBasis: "repository_source" },
      { label: "Corporations Canada: confirm current incorporation instructions", url: `${ISED}/business-corporations/how-incorporate-business`, evidenceBasis: "verification_link" },
      { label: "Official business corporation model bylaws", url: `${ISED}/business-corporations/model-laws-business-corporations`, evidenceBasis: "verification_link" },
    ],
    retainedDocuments: ["Certificate and articles of incorporation", "Registered-office and first-director filing", "Director consents", "Registry receipt and confirmation", "ISC information and filing evidence where applicable", "Organizational resolutions, bylaws, and share records"],
  },
];
