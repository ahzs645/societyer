/**
 * Registry document parser (shared/registryDocuments): classification,
 * facts, secret handling, ISC privacy, version conflicts, duplicates and
 * apply args. Fixtures mimic the `extractBytes` text shape (pdf.js lines
 * with TABs, a blank-line run between pages, raw quoted-printable email
 * bodies) and use invented organizations, people and numbers only.
 */
import assert from "node:assert/strict";
import { extractBytes } from "../shared/intake/extract";
import { isUnofficialDocument } from "../shared/entitySetup";
import { emailHeaderDateISO } from "../shared/registryDocuments/parse";
import { parseClockTime } from "../shared/registryDocuments/text";
import { readRegistryFile } from "../src/features/organizationProfile/registryImport/extractCore";
import { buildImportFiles, importDocumentRows, restrictedWarning } from "../src/features/organizationProfile/registryImport/importModel";
import {
  buildRegistryImportProposal,
  classifyRegistryDocument,
  normalizeRegistryText,
  defaultRegistryImportSelection,
  emlAttachments,
  parseRegistryDocument,
  proposalToApplyArgs,
  withRegistryDocumentIds,
  type ParsedRegistryDocument,
  type RegistryImportProposal,
  type RegistryProposalField,
} from "../shared/registryDocuments";

const PAGE = "\n\n\n\n";
const KEY = "48151623";
const DOBS = ["1980-01-02", "1975-05-06"];
const HOME_STREET = "12 Private Lane";

const certificatePage = [
  "Certificate of Incorporation\tCertificat de constitution Canada Business Corporations Act\tLoi canadienne sur les sociétés par actions",
  "",
  "Northwind Example Inc.\nCorporate name / Dénomination sociale",
  "",
  "1234567-8\nCorporation number / Numéro de société",
  "",
  "I HEREBY CERTIFY that the above-named\tJE CERTIFIE que la société susmentionnée, dont corporation, the articles of incorporation of which les statuts constitutifs sont joints, est constituée are attached, is incorporated under the Canada\ten vertu de la Loi canadienne sur les sociétés par\nBusiness Corporations Act.\tactions.",
  "",
  "Sam Registrar\nDirector / Directeur\n2025-03-14\nDate of Incorporation (YYYY-MM-DD)\nDate de constitution (AAAA-MM-JJ)",
].join("\n");

const articlesPage = (signatureHeader: string) => [
  "Form 1\tFormulaire 1\nArticles of Incorporation\tStatuts constitutifs\nCanada Business Corporations\tLoi canadienne sur les sociétés Act (s. 6)\tpar actions (art. 6)",
  "",
  "1 Corporate name\nDénomination sociale\nNorthwind Example Inc.\n2 The province or territory in Canada where the registered office is situated\nLa province ou le territoire au Canada où est situé le siège social\nBC\n3 The classes and any maximum number of shares that the corporation is authorized to issue\nCatégories et le nombre maximal d’actions que la société est autorisée à émettre\nThe corporation is authorized to issue an unlimited number of common shares.\n4 Restrictions on share transfers\nRestrictions sur le transfert des actions\nSee attached schedule / Voir l'annexe ci-jointe\n5 Minimum and maximum number of directors\nNombre minimal et maximal d’administrateurs\nMin. 1\tMax. 7\n6 Restrictions on the business the corporation may carry on\nLimites imposées à l’activité commerciale de la société\nNone\n7 Other Provisions\nAutres dispositions\nSee attached schedule / Voir l'annexe ci-jointe\n8 Incorporator’s Declaration: I hereby certify that I am authorized to sign and submit this form.\nDéclaration des fondateurs : J’atteste que je suis autorisé à signer et à soumettre le présent formulaire.",
  "",
  `Name(s) - Nom(s)\t${signatureHeader}`,
  "",
  "JORDAN EXAMPLE\tJORDAN EXAMPLE\nJORDAN EXAMPLE",
  "",
  "Misrepresentation constitutes an offence and, on summary conviction, a person is liable to a fine.",
  "",
  "IC 3419 (2008/04)",
].join("\n");

const schedulePages = [
  "Schedule / Annexe\nRestrictions on Share Transfers / Restrictions sur le transfert des actions\n\nNo share may be transferred without the approval of the directors expressed by resolution.",
  "Other Provisions / Autres dispositions\n\nThe directors may appoint additional directors between annual meetings.",
].join(PAGE);

const form2Page = (options: { corporateNameLabel: boolean; corporateName: string; thirdDirector: string[] }) => [
  ...(options.corporateNameLabel ? ["Form 2\tFormulaire 2"] : []),
  "Initial Registered Office Address Siège social initial et premier and First Board of Directors\tconseil d’administration\nCanada Business Corporations Act\tLoi canadienne sur les sociétés par (CBCA) (s. 19 and 106)\tactions (LCSA) (art. 19 et 106)",
  "",
  `${options.corporateNameLabel ? "1 Corporate name\n" : ""}Dénomination sociale\n${options.corporateName}`,
  "",
  "2 Address of registered office\nAdresse du siège social\n100 Example Road\nSampletown BC V0V 0V0\n3 Additional address\nAutre adresse",
  "",
  "4 Members of the board of directors\nMembres du conseil d’administration\nResident Canadian Résident Canadien JORDAN EXAMPLE\t100 Example Road, Sampletown BC\tYes / Oui\nV0V 0V0, Canada\nPriya Sample\t100 Example Road, Sampletown BC\tYes / Oui\nV0V 0V0, Canada",
  options.thirdDirector.join("\n"),
  "",
  "5 Declaration: I certify that I have relevant knowledge and that I am authorized to sign this form.\nDéclaration : J’atteste que je possède une connaissance suffisante.",
  "",
  "JORDAN EXAMPLE\n555-010-0000",
  "",
  "IC 2904 (2008/04)",
].join("\n");

const FULL_THIRD = ["Alexandrina\t100 Example Road, Sampletown BC\tNo / Non", "Quillmarsh\tV0V 0V0, Canada"];
const SHORT_THIRD = ["Alex Quillmarsh\t100 Example Road, Sampletown BC\tNo / Non", "V0V 0V0, Canada"];

const CERTIFICATE_PACKAGE = [certificatePage, articlesPage("Original Signed by - Original signé par"), schedulePages, form2Page({ corporateNameLabel: false, corporateName: "Northwind Example Inc.", thirdDirector: FULL_THIRD })].join(PAGE);
const ARTICLES = [articlesPage("Signature"), schedulePages].join(PAGE);
const FORM2_FILED = form2Page({ corporateNameLabel: true, corporateName: "Northwind Example Inc.", thirdDirector: FULL_THIRD });
const FORM2_DRAFT = form2Page({ corporateNameLabel: true, corporateName: "Northwind Example Inc.", thirdDirector: SHORT_THIRD });

const INFORMATION_SHEET = [
  "Corporations Canada\tCorporations Canada 2025-03-14\tC. D. Howe Building\tÉdifice C.D.Howe\n235 Queen St\t235 rue Queen\nOttawa ON K1A 0H5\tOttawa ON K1A 0H5",
  "",
  "Corporation Information Sheet\tFiche de renseignements concernant la société\nCanada Business Corporations Act\tLoi canadienne sur les sociétés par actions",
  "",
  "Northwind Example Inc.",
  "",
  `Corporation number\t1234567-8\tNuméro de société\nCorporation key\tClé de société\nRequired for changes of\t${KEY}\tRequise pour mettre à jour en ligne l’adresse du siège\naddress or directors online\tsocial ou l’information concernant les administrateurs\nAnniversary date\t03-14\tDate anniversaire\nRequired to file annual return\t(mm-dd/mm-jj)\tRequise pour le dépôt du rapport annuel\nAnnual return filing period\t03-14 to/au 05-13\tPériode pour déposer le rapport annuel\nStarting in 2026\t(mm-dd/mm-jj)\tDébutant en 2026`,
  "",
  "Corporation key\tClé de société\nYour corporation key is, in fact, a password. Do not share your corporation key with any unauthorized person.",
].join("\n");

const ISC = [
  "Initial individuals with significant control\nCanada Business Corporations Act (CBCA) (sect. 21.21)",
  "",
  "Received date (YYYY-MM-DD): 2025-03-14",
  "",
  "The following is the initial information about individuals with significant control for Northwind Example Inc.:",
  "",
  "Jordan Example",
  "",
  `DATE OF BIRTH (YYYY-MM-DD):\n${DOBS[0]}`,
  "",
  "COUNTRIES OF CITIZENSHIP:\nCanada",
  "",
  `RESIDENTIAL ADDRESS:\n${HOME_STREET}, Sampletown, British Columbia, V0V 0V1, Canada`,
  "",
  "TYPE OF INTEREST OR CONTROL:\nOwns, controls or directs 25% or more of shares",
  "",
  "START DATE (YYYY-MM-DD):\n2025-03-14",
  "",
  "END DATE (YYYY-MM-DD):\nNot applicable",
  PAGE,
  "Priya Sample",
  "",
  DOBS[1],
  "",
  "COUNTRIES WHERE THE INDIVIDUAL IS CONSIDERED A RESIDENT FOR TAX PURPOSES:\nCanada, Freedonia",
  "",
  "RESIDENTIAL ADDRESS:\n14 Private Lane, Sampletown, British Columbia, V0V 0V1, Canada",
  "",
  "START DATE (YYYY-MM-DD):\n2025-03-14",
  PAGE,
  "Particuliers ayant un contrôle important initiaux",
  "",
  `DATE DE NAISSANCE (AAAA-MM-JJ):\n${DOBS[0]}`,
].join("\n");

const INCORPORATED_EMAIL = [
  "From: <ic.corporationscanada.ic@ised-isde.gc.ca>",
  "",
  "To: <records@northwind.example>",
  "",
  "Subject: =?UTF-8?Q?You're_incorporated...what's_next=3F/Vous?= =?UTF-8?Q?_=C3=AAtes_constitu=C3=A9_en_soci=C3=A9t=C3=A9?=",
  "",
  "Date: Fri, 14 Mar 2025 14:05:00 -0400",
  "",
  "------=_Part_1_2.3\nContent-Type: text/plain; charset=\"UTF-8\"\nContent-Transfer-Encoding: quoted-printable",
  "",
  "Corporations Canada",
  "",
  "Congratulations Northwind Example Inc. on incorporating with Corporations Canada! Y=\nour Certificate of Incorporation was sent in a previous email from us.",
  "",
  "Business number",
  "",
  "Your business number with the Canada Revenue Agency (CRA) is 123456789=C2=\n=A0RC0001.  For more information visit Canada Revenue Agency.",
].join("\n");

const INCORPORATION_EMAIL = [
  "From: <ic.corporationscanada.ic@ised-isde.gc.ca>",
  "",
  "To: <records@northwind.example>",
  "",
  "Subject: Incorporation/Constitution",
  "",
  "Date: Fri, 14 Mar 2025 13:45:00 -0400",
  "",
  "------=_Part_9_8.7\nContent-Type: text/plain; charset=\"UTF-8\"\nContent-Transfer-Encoding: quoted-printable",
  "",
  "Corporations Canada\n\n(le fran=C3=A7ais suit)\n=09\nNorthwind Example Inc. has just incorporated with Corporations Canada.\n=09\nWe have included the following documents:",
  "",
  "=09* Certificate of Incorporation\n=09* Form 1 - Articles of Incorporation\n=09* Form 2 - Initial Registered Office Address and First Board of Director=\ns\n=09* Corporate Information Sheet\n   =20\nKeep these documents; they are important.",
  "",
  "Your corporate information is now available to the public on Search for a F=\nederal Corporation (http://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?cor=\npId=3D12345678&locale=3Den_CA), which explains how to keep this information=\n up-to-date.",
  "",
  "Reminder emails",
  "",
  "You have subscribed to receive annual return reminder emails. If your email=\n address changes, let us know.",
  "",
  "------=_Part_9_8.7\nContent-Type: text/html; charset=\"UTF-8\"\nContent-Transfer-Encoding: quoted-printable",
  "",
  "<html><head><style type=3D\"text/css\">body { font-size: 10pt; }</style></head><body><p>Northwind Example Inc. has just incorporated.</p></body></html>",
].join("\n");

const PAYMENT_EMAIL = [
  "From: donotreply-nepasrepondre@ecomcpp.ised-isde.canada.ca",
  "",
  "To: records@northwind.example",
  "",
  "Subject: Transaction Invoice: Corporations",
  "",
  "Date: Fri, 14 Mar 2025 17:30:00 +0000",
  "",
  "------=_Part_5_6.7\nContent-Type: text/html;charset=UTF-8\nContent-Transfer-Encoding: 7bit",
  "",
  "<h2>Transaction approved </h2><p>This transaction is now complete.  Your payment  was approved.<br/><header><h2>Transaction record</h2></header><table><tr><td>Merchant:</td><td>Corporations</td></tr><tr><td>Transaction amount:</td><td>$200.00 (CAD)</td></tr><tr><td>Account type:</td><td>MasterCard</td></tr><tr><td>Card number:</td><td>5555***9876</td></tr><tr><td>Date / Time: </td><td>2025-03-14 01:30:00</td></tr><td><tr>Reference number:</td><td>111122223333444455</td></tr><tr><td>Authorization code:</td><td>ZQ71XK</td></tr><tr><td>Transaction Id:</td><td>99887766</td></tr></table>",
  "------=_Part_5_6.7--",
].join("\n");

const ACCESS_EMAIL = [
  "From: donotreply-nepasrepondre@idm.ised-isde.canada.ca",
  "",
  "To: records@northwind.example",
  "",
  "Subject: =?utf-8?Q?Access_type_updated:_Northwind_Example_Inc._/_T?= =?utf-8?Q?ype_d'acc=C3=A8s_mis_=C3=A0_jour?=",
  "",
  "Date: Fri, 14 Mar 2025 18:00:00 +0000",
  "",
  "<p><strong><em>(Le fran=C3=A7ais suit l'anglais)</em></strong></p><p>This i=\ns a notification that your access to Northwind Example Inc. within the Online Filin=\ng Centre has been updated by an Access Manager.</p><p>Thank you.<=\n/p><p>Ceci est une notification que votre acc=C3=A8s =C3=A0 Northwind Example Inc. a =C3=\n=A9t=C3=A9 mis =C3=A0 jour.</p>",
].join("\n");

const BC_HEADER = "Mailing Address:\tLocation:\nPO Box 9431 Stn Prov Govt\t2nd Floor - 940 Blanshard Street\nVictoria BC V8W 9V3\tVictoria BC\nwww.corporateonline.gov.bc.ca\t1 877 526-1526";

const statementBody = (upper: boolean) => [
  "Filing Details:\tStatement of Registration for:\nNorthwind Example Inc.",
  "",
  "Registration Number: A0999999",
  "",
  "Filed Date and Time:\tRegistered in British Columbia on March 14, 2025 01:45 PM Pacific Time",
  "",
  "Name Reservation Number:\tName in Federal Jurisdiction:\nFederal Company\tNorthwind Example Inc.",
  "",
  "FOREIGN JURISDICTION INFORMATION\nCorporate number assigned to the foreign entity by Foreign entity's name in the foreign jurisdiction:\nits current jurisdiction:\n12345678\tNorthwind Example Inc.",
  "",
  "Foreign entity's date of incorporation, organization Foreign entity's current jurisdiction of incorporation, or most recent date of amalgamation or\torganization, amalgamation or continuation:\ncontinuation:\nMarch 14, 2025\t" + (upper ? "FEDERAL" : "Federal"),
  "",
  upper
    ? "HEAD OFFICE ADDRESS\nMailing Address:\tDelivery Address:\n100 EXAMPLE ROAD\t100 EXAMPLE ROAD\nSAMPLETOWN BC V0V 0V0\tSAMPLETOWN BC V0V 0V0\nCANADA\tCANADA"
    : "HEAD OFFICE INFORMATION\nMailing Address:\tDelivery Address:\n100 Example Road\t100 Example Road\nSampletown BC V0V0V0\tSampletown BC V0V0V0",
].join("\n");

const BC_STATEMENT = [
  ["Date and Time: March 14, 2025 01:45 PM Pacific Time", "", BC_HEADER, "", "Registration Statement\nForm 33\nBUSINESS CORPORATIONS ACT\nSection 376", "", statementBody(false), "", "A0999999 Page: 1 of 2"].join("\n"),
  "CANADA\tCANADA\n\nA0999999 Page: 2 of 2",
].join(PAGE);

const certificateOfRegistration = (duplicate: boolean) => [
  ...(duplicate ? ["DUPLICATE", ""] : []),
  "Number: A0999999",
  "",
  "CERTIFICATE\nOF",
  "",
  "REGISTRATION",
  "",
  "BUSINESS CORPORATIONS ACT",
  "",
  "I Hereby Certify that Northwind Example Inc. has been registered as an extraprovincial company under the Business Corporations Act on March 14, 2025 at 01:45 PM Pacific Time.",
  "",
  "Issued under my hand at Victoria, British Columbia On March 14, 2025",
  "",
  "PAT REGISTRAR\nRegistrar of Companies\nProvince of British Columbia\nCanada",
].join("\n");

const BC_RECEIPT = [
  BC_HEADER,
  "",
  "RECEIPT\nThis is confirmation of payment for filing.",
  "",
  "Form Filed:\tRegistration Statement\nRegistration Number:\tA0999999\nBusiness Number:\tNot Available\nExtraprovincial Company Name:\tNorthwind Example Inc.\nFiling Date and Time:\tMarch 14, 2025 01:45 PM Pacific Time\nNotification Method:\tEMAIL\nSubmitting Party Name:",
  "",
  "Fee:\t$350.00\nService Charge:\t$1.50\nSubtotal:\t$351.50\nService Charge GST:\nTotal:\t$351.50",
  "",
  "Payment Invoice Number:\tCOLIN000000000001\nTransaction ID:\t10101010\nPayment Method:\tCredit Card\nYour Contact Name is:\tJordan Example\nYour Contact Telephone Number is: 555-010-0000\nCredit Card Type:\tVISA\nCredit Card Number:\tXXXXXXXXXXXXXXXX\nAuthorization Number:\tAB12CD",
  "",
  "A0999999 Page: 1 of 1",
].join("\n");

const BC_PACKAGE = [
  [BC_HEADER, "", "Cover Sheet\nNorthwind Example Inc.", "", "Confirmation of Service\nForm Filed:\tRegistration Statement\nDate and Time of Filing:\tMarch 14, 2025 01:45 PM Pacific Time\nName of Company:\tNorthwind Example Inc.\nRegistration Number:\tA0999999", "", "This package contains:\n• Certified Copy of the Statement of Registration\n• Certificate of Registration", "", "Page: 1 of 1"].join("\n"),
  ["Statement of\tCERTIFIED COPY\nOf a Document filed with the Province of British Columbia Registrar of Companies Registration\nForm 33\nBUSINESS CORPORATIONS ACT\nSection 376\tPAT REGISTRAR", "", statementBody(true), "", "NAME OF ATTORNEY(S)", "", "No attorney information to display", "", "A0999999 Page: 1 of 1"].join("\n"),
  [certificateOfRegistration(false), "", "ELECTRONIC CERTIFICATE"].join("\n"),
].join(PAGE);

/** pdftotext -layout shape: space-aligned columns and form feeds. */
const PLAIN_CERTIFICATE = [
  "  Certificate of Incorporation                              Certificat de constitution\n        Canada Business Corporations Act                    Loi canadienne sur les sociétés par actions\n\n\n\n                                           Northwind Example Inc.\n                                    Corporate name / Dénomination sociale\n\n\n\n                                               1234567-8\n                                    Corporation number / Numéro de société\n\n\nI HEREBY CERTIFY that the above-named                   JE CERTIFIE que la société susmentionnée, dont\nare attached, is incorporated under the Canada          en vertu de la Loi canadienne sur les sociétés par\nBusiness Corporations Act.                              actions.\n\n\n\n\n                                               2025-03-14\n                                    Date of Incorporation (YYYY-MM-DD)",
  "   4 Members of the board of directors\n  Membres du conseil d’administration\n   Form 2   Initial Registered Office Address\n                                                                       Resident Canadian\n   JORDAN EXAMPLE                                 100 Example Road, Sampletown BC                     Yes / Oui\n                                                  V0V 0V0, Canada\n   Alexandrina                                    100 Example Road, Sampletown BC                     No / Non\n   Quillmarsh                                     V0V 0V0, Canada\n\n5 Declaration: I certify that I have relevant knowledge.",
].join("\f");

let checks = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  checks += 1;
};
const fieldById = (proposal: RegistryImportProposal, id: string): RegistryProposalField | undefined =>
  proposal.groups.flatMap((group) => group.fields).find((field) => field.id === id);

// --- Classification by content, never by file name ---------------------------------
const expectations: Array<[string, string, string]> = [
  [CERTIFICATE_PACKAGE, "ColinReport (9).pdf", "federal_certificate_of_incorporation"],
  [ARTICLES, "certificate.pdf", "federal_articles_of_incorporation"],
  [FORM2_FILED, "x.pdf", "federal_initial_office_and_directors"],
  [INFORMATION_SHEET, "y.pdf", "federal_corporation_information_sheet"],
  [ISC, "z.pdf", "federal_initial_isc"],
  [INCORPORATED_EMAIL, "a.eml", "federal_incorporated_email"],
  [INCORPORATION_EMAIL, "b.eml", "federal_incorporation_email"],
  [PAYMENT_EMAIL, "c.eml", "federal_payment_email"],
  [ACCESS_EMAIL, "d.eml", "federal_access_updated_email"],
  [BC_STATEMENT, "ColinReport.pdf", "bc_statement_of_registration"],
  [certificateOfRegistration(true), "ColinReport (2).pdf", "bc_certificate_of_registration"],
  [BC_RECEIPT, "ColinReport (1).pdf", "bc_filing_receipt"],
  [BC_PACKAGE, "CompanyDocuments.pdf", "bc_cover_sheet"],
  [PLAIN_CERTIFICATE, "plain.txt", "federal_certificate_of_incorporation"],
  ["Minutes of the board meeting held on March 1.", "Certificate of Incorporation.pdf", "unknown"],
];
for (const [text, fileName, kind] of expectations) {
  const classification = classifyRegistryDocument(text, fileName);
  check(classification.kind === kind, `${fileName}: expected ${kind}, got ${classification.kind}`);
  if (kind !== "unknown") check(classification.confidence >= 0.7, `${fileName}: confidence ${classification.confidence}`);
}
check(classifyRegistryDocument(CERTIFICATE_PACKAGE).sections.map((section) => section.kind).join(",") === "federal_certificate_of_incorporation,federal_articles_of_incorporation,federal_initial_office_and_directors", "certificate package sections");
check(classifyRegistryDocument(BC_PACKAGE).sections.map((section) => section.kind).join(",") === "bc_cover_sheet,bc_statement_of_registration,bc_certificate_of_registration", "BC package splits per page section");

// --- Facts per kind -------------------------------------------------------------------
const certificate = parseRegistryDocument(CERTIFICATE_PACKAGE, "ColinReport (9).pdf");
const facts = certificate.facts;
check(facts.legalName?.value === "Northwind Example Inc.", "certificate name");
check(facts.corporationNumber?.value === "1234567-8", "corporation number");
check(facts.incorporationDate?.value === "2025-03-14", "incorporation date");
check(facts.actFormedUnder?.value === "canada_business_corporations_act" && facts.jurisdictionCode?.value === "CA-FED-CBCA", "Act and jurisdiction code");
check(facts.registeredOfficeProvince?.value === "BC", "registered office province");
check(facts.shareClasses?.value === "The corporation is authorized to issue an unlimited number of common shares.", "share classes");
check(facts.shareTransferRestrictions?.value === "No share may be transferred without the approval of the directors expressed by resolution.", "transfer restrictions read from the schedule");
check(facts.otherProvisions?.value === "The directors may appoint additional directors between annual meetings.", "other provisions read from the schedule");
check(facts.minDirectors?.value === 1 && facts.maxDirectors?.value === 7, "min/max directors");
check(facts.businessRestrictions?.value === "None", "business restrictions");
check(JSON.stringify(facts.incorporators?.value) === JSON.stringify(["JORDAN EXAMPLE"]), "incorporators deduplicated");
check(facts.registeredOfficeAddress?.value.street === "100 Example Road" && facts.registeredOfficeAddress.value.postalCode === "V0V 0V0" && facts.registeredOfficeAddress.value.city === "Sampletown", "registered office address");
check(JSON.stringify(facts.directors?.value) === JSON.stringify([{ name: "JORDAN EXAMPLE", residentCanadian: true }, { name: "Priya Sample", residentCanadian: true }, { name: "Alexandrina Quillmarsh", residentCanadian: false }]), "directors with wrapped name and resident flags");
check(certificate.suggestedCategory === "CertificateOfIncorporation" && /Certificate of incorporation with articles and Form 2 – Northwind Example Inc\./.test(certificate.suggestedTitle), "certificate title and category");
check(facts.corporationNumber?.snippet.includes("1234567-8"), "provenance snippet");

const plain = parseRegistryDocument(PLAIN_CERTIFICATE);
check(plain.facts.corporationNumber?.value === "1234567-8" && plain.facts.incorporationDate?.value === "2025-03-14" && plain.facts.legalName?.value === "Northwind Example Inc.", "plain-text layout certificate");
check(plain.facts.directors?.value.map((director) => director.name).join("|") === "JORDAN EXAMPLE|Alexandrina Quillmarsh", "plain-text layout directors");

const sheet = parseRegistryDocument(INFORMATION_SHEET, "Information-Sheet.pdf");
check(sheet.restricted, "information sheet is restricted");
check(sheet.facts.corporationNumber?.value === "1234567-8", "sheet corporation number");
check(sheet.facts.anniversaryMonthDay?.value === "03-14", "anniversary");
check(JSON.stringify(sheet.facts.annualReturnWindow?.value) === JSON.stringify({ start: "03-14", end: "05-13", firstYear: 2026 }), "annual return window");
check(sheet.secrets.length === 1 && sheet.secrets[0].reveal() === KEY && sheet.secrets[0].kind === "corporation_key", "corporation key held as a secret");
check(!JSON.stringify(sheet).includes(KEY), "corporation key absent from the parsed document JSON");
check(!/\d/.test(sheet.secrets[0].masked), "mask carries no digits");

const isc = parseRegistryDocument(ISC, "Initial-ISC.pdf");
check(isc.restricted, "ISC is restricted");
check(isc.facts.iscReceivedDate?.value === "2025-03-14", "ISC received date");
check(JSON.stringify(isc.facts.iscIndividualNames?.value) === JSON.stringify(["Jordan Example", "Priya Sample"]), "ISC names only");
const iscJson = JSON.stringify(isc);
for (const dob of DOBS) check(!iscJson.includes(dob), `ISC DOB ${dob} not held`);
check(!iscJson.includes("Private Lane") && !iscJson.includes("Freedonia"), "ISC addresses and tax residence not held");

const incorporated = parseRegistryDocument(INCORPORATED_EMAIL, "incorporated.eml");
check(incorporated.facts.businessNumber?.value === "123456789", "BN");
check(JSON.stringify(incorporated.facts.programAccounts?.value) === JSON.stringify(["RC0001"]), "RC program account");
check(incorporated.facts.notificationEmail?.value === "records@northwind.example", "registry notification email");

const incorporation = parseRegistryDocument(INCORPORATION_EMAIL, "Incorporation_Constitution.eml");
check(incorporation.facts.enclosedDocuments?.value.length === 4 && incorporation.facts.enclosedDocuments.value[2] === "Form 2 - Initial Registered Office Address and First Board of Directors", "enclosed documents with soft line breaks decoded");
check(incorporation.facts.reminderEmailsSubscribed?.value === true, "reminder emails subscribed");
check(incorporation.facts.publicRecordUrl?.value === "http://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=12345678&locale=en_CA", "public record URL");
check(incorporation.restricted, "an email enclosing the information sheet is restricted");

const payment = parseRegistryDocument(PAYMENT_EMAIL, "Transaction Invoice.eml");
check(payment.facts.payment?.value.amount === "200.00" && payment.facts.payment.value.date === "2025-03-14" && payment.facts.payment.value.reference === "111122223333444455" && payment.facts.payment.value.transactionId === "99887766", "payment amount, date, reference");
check(!JSON.stringify(payment).includes("ZQ71XK") && !JSON.stringify(payment).includes("9876"), "card number and authorization code not read");

const access = parseRegistryDocument(ACCESS_EMAIL, "Access type updated.eml");
check(access.facts.portalAccess?.value.organizationName === "Northwind Example Inc." && access.facts.portalAccess.value.updatedAtISO === "2025-03-14T18:00:00+00:00", "portal access hint");

const statement = parseRegistryDocument(BC_STATEMENT, "ColinReport.pdf");
check(statement.facts.bcRegistrationNumber?.value === "A0999999", "BC registration number");
check(statement.facts.bcRegistrationDate?.value === "2025-03-14" && statement.facts.bcRegistrationTime?.value === "13:45" && statement.facts.bcRegistrationTimeZone?.value === "America/Vancouver", "BC registration date and Pacific time");
check(statement.facts.homeCorporationNumber?.value === "12345678" && statement.facts.nameInHomeJurisdiction?.value === "Northwind Example Inc.", "home number and name");
check(statement.facts.homeIncorporationDate?.value === "2025-03-14" && statement.facts.homeJurisdictionCode?.value === "CA-FED", "home incorporation date and jurisdiction");
check(statement.facts.headOfficeMailing?.value.postalCode === "V0V 0V0" && statement.facts.headOfficeDelivery?.value.country === "Canada", "head office addresses");
check(!statement.facts.attorney, "no attorney fact without the attorney section");

const bcPackage = parseRegistryDocument(BC_PACKAGE, "CompanyDocuments.pdf");
check(JSON.stringify(bcPackage.facts.attorney?.value) === JSON.stringify({ status: "not_required", reason: "Head office is in British Columbia" }), "attorney not required when the head office is in BC");
check(bcPackage.facts.headOfficeMailing?.value.street === "100 Example Road" && bcPackage.facts.headOfficeMailing.value.city === "Sampletown", "upper-case address tidied");
check(bcPackage.facts.packageContents?.value.length === 2, "package contents");

const duplicateCertificate = parseRegistryDocument(certificateOfRegistration(true), "ColinReport (2).pdf");
check(duplicateCertificate.facts.duplicateCopy?.value === true && duplicateCertificate.facts.bcRegistrationTime?.value === "13:45", "BC certificate (duplicate copy)");

const receipt = parseRegistryDocument(BC_RECEIPT, "ColinReport (1).pdf");
check(receipt.facts.filingReceipt?.value.amount === "351.50" && receipt.facts.filingReceipt.value.invoiceNumber === "COLIN000000000001" && receipt.facts.filingReceipt.value.transactionId === "10101010", "BC receipt totals");
check(JSON.stringify(receipt.facts.filingReceipt?.value.breakdown) === JSON.stringify([{ label: "Fee", amount: "350.00" }, { label: "Service charge", amount: "1.50" }]), "BC receipt breakdown");
check(!JSON.stringify(receipt).includes("AB12CD") && !JSON.stringify(receipt).includes("VISA"), "card details not read");

// --- Proposal: everything together ------------------------------------------------------
const files: Array<[string, string]> = [
  [CERTIFICATE_PACKAGE, "ColinReport (9).pdf"],
  [CERTIFICATE_PACKAGE, "Incorporation-Constitution (1).pdf"],
  [ARTICLES, "Articles of Incorporation.pdf"],
  [FORM2_DRAFT, "Registered Office and Directors.pdf"],
  [FORM2_FILED, "Registered Office and Directors (1).pdf"],
  [FORM2_FILED, "Form-2-Corrected.pdf"],
  [INFORMATION_SHEET, "Information-Sheet.pdf"],
  [ISC, "Initial-ISC.pdf"],
  [INCORPORATED_EMAIL, "incorporated.eml"],
  [INCORPORATION_EMAIL, "Incorporation_Constitution.eml"],
  [PAYMENT_EMAIL, "Transaction Invoice.eml"],
  [ACCESS_EMAIL, "Access type updated.eml"],
  [BC_STATEMENT, "ColinReport.pdf"],
  [certificateOfRegistration(true), "ColinReport (2).pdf"],
  [BC_RECEIPT, "ColinReport (1).pdf"],
  [BC_PACKAGE, "CompanyDocuments.pdf"],
];
const parsed: ParsedRegistryDocument[] = files.map(([text, fileName]) => parseRegistryDocument(text, fileName));
const proposal = buildRegistryImportProposal(parsed, {
  profile: { name: "Northwind Example Inc.", craBnStatus: "unknown" },
  addresses: [{ type: "registered_office", status: "current", street: "100 EXAMPLE ROAD", city: "Sampletown", provinceState: "BC", postalCode: "V0V0V0", country: "Canada" }],
  directors: [{ name: "Jordan Example" }],
});

// Duplicates, package copies, superseded versions
const status = (fileName: string) => proposal.documents.find((document) => document.fileName === fileName);
check(parsed[0].fingerprint === parsed[1].fingerprint, "identical files share a fingerprint");
check(status("Incorporation-Constitution (1).pdf")?.status === "duplicate" && status("Incorporation-Constitution (1).pdf")?.relatedFingerprint === parsed[0].fingerprint, "duplicate certificate package");
check(status("Form-2-Corrected.pdf")?.status === "duplicate", "identical Form 2 is a duplicate");
check(status("Registered Office and Directors (1).pdf")?.status === "contained", "filed Form 2 matches the package copy");
check(status("Registered Office and Directors.pdf")?.status === "superseded", "draft Form 2 is superseded");
check(status("Articles of Incorporation.pdf")?.status === "contained", "articles match the package copy");
check(status("ColinReport.pdf")?.status === "contained" && status("ColinReport (2).pdf")?.status === "contained", "BC statement and certificate are in the BC package");
check(status("ColinReport (9).pdf")?.status === "primary" && status("ColinReport (9).pdf")?.selectedByDefault === true, "package is primary");
check(proposal.documents.filter((document) => document.restricted).map((document) => document.fileName).sort().join(",") === "Incorporation_Constitution.eml,Information-Sheet.pdf,Initial-ISC.pdf", "restricted documents");

// Form 2 name variance is a conflict, not a silent pick
const variance = proposal.directorsCheck?.nameVariances.find((item) => item.subject === "director");
check(variance?.preferred === "Alexandrina Quillmarsh" && variance.other === "Alex Quillmarsh" && variance.preferredSource.fileName === "ColinReport (9).pdf", "director name variance reported, package copy preferred");
check(proposal.conflicts.some((conflict) => conflict.includes("Alex Quillmarsh") && conflict.includes("Alexandrina Quillmarsh")), "name variance listed as a conflict");
check(proposal.directorsCheck?.meetsResidencyRule === true && proposal.directorsCheck.residentCount === 2 && proposal.directorsCheck.total === 3, "25% rule check");
check(proposal.directorsCheck?.comparison.find((entry) => entry.name === "JORDAN EXAMPLE")?.inRegister === true, "directors compared with the register");

// Field defaults
const name = fieldById(proposal, "profile.name");
check(name?.equalsCurrent === true && name.selectedByDefault === false, "unchanged name not selected");
check(fieldById(proposal, "address.registered_office")?.equalsCurrent === true && fieldById(proposal, "address.registered_office")?.selectedByDefault === false, "same address in a different case is unchanged");
const craBn = fieldById(proposal, "profile.craBnStatus");
check(craBn?.selectedByDefault === true && craBn.replacesCurrent === true, "BN status replaces unknown");
const numberSources = fieldById(proposal, "profile.incorporationNumber")?.sources.map((source) => source.fileName) ?? [];
check(fieldById(proposal, "profile.incorporationNumber")?.display === "1234567-8" && ["ColinReport (9).pdf", "Information-Sheet.pdf", "CompanyDocuments.pdf"].every((fileName) => numberSources.includes(fileName)), "corporation number from certificate, sheet and BC home number");
check(fieldById(proposal, "profile.anniversaryDate")?.display === "2025-03-14", "anniversary date from the information sheet");
check(fieldById(proposal, "info.shareClasses")?.selectedByDefault === false, "info fields are never selected");
check(proposal.isc?.count === 2 && proposal.isc.receivedDate === "2025-03-14", "ISC summary");
check(proposal.fees.length === 2 && proposal.fees.some((fee) => fee.amount === "351.50") && proposal.fees.some((fee) => fee.amount === "200.00"), "fees");
check(proposal.secrets.length === 1 && proposal.secrets[0].selectedByDefault, "corporation key offered");

// Secret and ISC privacy across the proposal
const proposalJson = JSON.stringify(proposal);
check(!proposalJson.includes(KEY), "corporation key absent from the proposal JSON");
check(!JSON.stringify(parsed).includes(KEY), "corporation key absent from every parsed document");
for (const dob of DOBS) check(!proposalJson.includes(dob), `DOB ${dob} absent from the proposal`);
check(!proposalJson.includes(HOME_STREET), "ISC home address absent from the proposal");

// Apply args
const selection = defaultRegistryImportSelection(proposal);
const plan = proposalToApplyArgs(proposal, selection);
const { args } = plan;
check(args.corporationKey?.value === KEY && args.corporationKey.label.startsWith("Corporation key"), "corporation key apply arg");
const withoutKey = JSON.stringify({ ...plan, args: { ...args, corporationKey: { ...args.corporationKey, value: "" } } });
check(!withoutKey.includes(KEY), "key appears only in the corporationKey apply arg");
check(args.profile?.name === undefined, "unselected fields are left out");
check(args.profile?.incorporationNumber === "1234567-8" && args.profile.incorporationDate === "2025-03-14" && args.profile.actFormedUnder === "canada_business_corporations_act" && args.profile.jurisdictionCode === "CA-FED-CBCA", "profile identity args");
check(args.profile?.articlesMinDirectors === 1 && args.profile.articlesMaxDirectors === 7 && args.profile.articlesBusinessRestrictions === "None", "articles args");
check(args.profile?.craBnStatus === "confirmed" && args.profile.craRcStatus === "confirmed" && args.profile.officialEmail === "records@northwind.example", "tax status and notification email args");
const home = args.registrations?.find((registration) => registration.registrationType === "home");
const bc = args.registrations?.find((registration) => registration.registrationType === "extra_provincial");
check(home?.jurisdiction === "CA-FED-CBCA" && home.registrationNumber === "1234567-8" && home.reminderEmailsSubscribed === true && home.publicRecordUrl?.includes("corpId=12345678"), "home registration args");
check(home?.portalAccess === undefined, "portal access needs a name from the UI");
check(bc?.jurisdiction === "CA-BC" && bc.homeJurisdiction === "CA-FED-CBCA" && bc.registrationNumber === "A0999999" && bc.registrationTime === "13:45" && bc.registrationTimeZone === "America/Vancouver", "BC registration args");
check(bc?.homeCorporationNumber === "12345678" && bc.nameInHomeJurisdiction === "Northwind Example Inc." && bc.attorneyStatus === "not_required" && bc.attorneyNotRequiredReason === "Head office is in British Columbia", "BC home and attorney args");
check(args.addresses?.map((address) => address.type).join(",") === "head_office_mailing,head_office_delivery", "unchanged registered office left out; head office addresses in");
check(args.addresses?.[0].effectiveFrom === "2025-03-14" && args.addresses[0].status === "current" && args.addresses[0].country === "Canada", "address args");
check(JSON.stringify(args.identifiers) === JSON.stringify([
  { kind: "business_number", number: "123456789", registeredAt: "2025-03-14", status: "active", accessLevel: "restricted" },
  { kind: "income_tax", number: "123456789RC0001", registeredAt: "2025-03-14", status: "active", accessLevel: "restricted" },
]), "identifier args");
const allowedTop = new Set(["profile", "registrations", "addresses", "identifiers", "corporationKey"]);
check(Object.keys(args).every((key) => allowedTop.has(key)), "apply args carry only applyRegistryImport keys");

const withName = proposalToApplyArgs(proposal, { ...selection, portalAccessName: "Records Owner" });
check(withName.args.registrations?.find((registration) => registration.registrationType === "home")?.portalAccess?.[0].name === "Records Owner", "portal access with the mailbox owner's name");

// Document ids
const packageFingerprint = parsed[0].fingerprint;
const bcPackageFingerprint = parsed[15].fingerprint;
check(plan.documentRefs[packageFingerprint]?.some((ref) => ref.target === "profile.articlesSourceDocumentId"), "articles source is the certificate package");
const ids = Object.fromEntries(parsed.map((document, index) => [document.fingerprint, `doc_${index}`]));
const filled = withRegistryDocumentIds(plan, ids);
const homeIndex = args.registrations!.findIndex((registration) => registration.registrationType === "home");
const bcIndex = args.registrations!.findIndex((registration) => registration.registrationType === "extra_provincial");
check(filled.profile?.articlesSourceDocumentId === ids[packageFingerprint], "articlesSourceDocumentId filled");
check(filled.registrations?.[homeIndex].certificateDocumentId === ids[packageFingerprint], "home certificate document");
check(filled.registrations?.[bcIndex].certificateDocumentId === ids[bcPackageFingerprint], "BC certificate document is the package");
check((filled.registrations?.[bcIndex].sourceDocumentIds ?? []).includes(ids[bcPackageFingerprint]), "BC source documents");
check(plan.args.registrations?.[0].certificateDocumentId === undefined, "the plan itself is not mutated");

// --- Conflicting standalone versions without a package ---------------------------------
const otherName = FORM2_FILED.replace("Dénomination sociale\nNorthwind Example Inc.", "Dénomination sociale\nNorthwind Example");
const loose = buildRegistryImportProposal([parseRegistryDocument(FORM2_FILED, "a.pdf"), parseRegistryDocument(otherName, "b.pdf")]);
const looseName = fieldById(loose, "profile.name");
check(looseName?.conflict?.options.length === 2 && looseName.selectedByDefault === false, "corporate name conflict between standalone versions");
check(loose.directorsCheck?.nameVariances.some((item) => item.subject === "corporate_name"), "corporate name variance reported");
const picked = proposalToApplyArgs(loose, { selected: { "profile.name": true }, choices: { "profile.name": 1 } });
check(picked.args.profile?.name === "Northwind Example", "reviewer can pick the other version");
check(proposalToApplyArgs(loose, { selected: {} }).args.profile === undefined, "nothing selected, nothing applied");

// Two different keys are never selected by default
const otherKey = INFORMATION_SHEET.replace(KEY, "62738495");
const twoKeys = buildRegistryImportProposal([parseRegistryDocument(INFORMATION_SHEET), parseRegistryDocument(otherKey)]);
check(twoKeys.secrets.length === 2 && twoKeys.secrets.every((secret) => !secret.selectedByDefault) && twoKeys.conflicts.some((conflict) => conflict.includes("corporation keys")), "conflicting corporation keys");
check(buildRegistryImportProposal([parseRegistryDocument(INFORMATION_SHEET)], { hasCorporationKey: true }).secrets[0].selectedByDefault === false, "existing vault key is not replaced by default");


// --- Email attachments (.eml) ------------------------------------------------------------
// Synthetic MIME: a multipart/alternative body, a base64 PDF, a quoted-printable PDF with an
// RFC 2231 file name, an attached message carrying its own PDF, and an image that is skipped.
// The "PDFs" are stand-ins (a %PDF- header and the fixture text); the injected extractor reads
// them back, so pdf.js isn't needed here.
const FAKE_PDF_HEADER = "%PDF-1.4 stand-in\n";
const fakePdf = (text: string) => new TextEncoder().encode(`${FAKE_PDF_HEADER}${text}`);
const base64Lines = (bytes: Uint8Array) => (Buffer.from(bytes).toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
const quotedPrintable = (bytes: Uint8Array) => {
  let line = "";
  const lines: string[] = [];
  for (const byte of bytes) {
    const piece = byte === 10 ? "\n" : (byte >= 33 && byte <= 126 && byte !== 61) || byte === 32 ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    if (piece === "\n") {
      lines.push(`${line}=0A=`);
      line = "";
      continue;
    }
    if (line.length + piece.length > 72) {
      lines.push(`${line}=`);
      line = "";
    }
    line += piece;
  }
  lines.push(line);
  return lines.join("\r\n");
};
const PLAIN_BODY = "Corporations Canada\r\n\r\nNorthwind Example Inc. has just incorporated with Corporations Canada.\r\n\r\nWe have included the following documents:\r\n\r\n* Certificate of Incorporation\r\n* Form 1 - Articles of Incorporation\r\n* Form 2 - Initial Registered Office Address and First Board of Directors\r\n* Corporate Information Sheet\r\n\r\nYour corporate information is now available to the public on Search for a Federal Corporation (http://ised-isde.canada.ca/cc/lgcy/fdrlCrpDtls.html?corpId=3D12345678&locale=3Den_CA).\r\n\r\nYou have subscribed to receive annual return reminder emails.";
const ATTACHED_MESSAGE = [
  "From: Jordan Example <jordan@northwind.example>",
  "Subject: Fwd: Certificate",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="inner-b"',
  "",
  "--inner-b",
  "Content-Type: text/plain",
  "",
  "See attached.",
  "--inner-b",
  'Content-Type: application/pdf; name="certificate.pdf"',
  'Content-Disposition: attachment; filename="certificate.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  base64Lines(fakePdf(CERTIFICATE_PACKAGE)),
  "--inner-b--",
  "",
].join("\r\n");
const EML_WITH_ATTACHMENTS = [
  "From: <ic.corporationscanada.ic@ised-isde.gc.ca>",
  "To: <records@northwind.example>",
  "Subject: Incorporation/Constitution",
  "Date: Fri, 14 Mar 2025 13:45:00 -0400",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer-b"',
  "",
  "This is a multi-part message in MIME format.",
  "--outer-b",
  'Content-Type: multipart/alternative; boundary="alt-b"',
  "",
  "--alt-b",
  'Content-Type: text/plain; charset="UTF-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  PLAIN_BODY,
  "--alt-b",
  'Content-Type: text/html; charset="UTF-8"',
  "",
  "<html><body><p>Northwind Example Inc. has just incorporated.</p></body></html>",
  "--alt-b--",
  "",
  "--outer-b",
  'Content-Type: application/pdf; name="=?utf-8?Q?Corporate_Information_Sheet.pdf?="',
  'Content-Disposition: attachment; filename="Corporate Information Sheet.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  base64Lines(fakePdf(INFORMATION_SHEET)),
  "--outer-b",
  "Content-Type: application/octet-stream",
  "Content-Disposition: attachment;",
  " filename*0*=UTF-8''Initial%20ISC%20%E2%80%93%20;",
  " filename*1=filing.pdf",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  quotedPrintable(fakePdf(ISC)),
  "--outer-b",
  "Content-Type: message/rfc822",
  "Content-Disposition: attachment",
  "",
  ATTACHED_MESSAGE,
  "--outer-b",
  'Content-Type: image/png; name="logo.png"',
  "Content-Disposition: inline",
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--outer-b--",
  "",
].join("\r\n");

const emlBytes = new TextEncoder().encode(EML_WITH_ATTACHMENTS);
const attachments = emlAttachments(emlBytes);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
check(attachments.map((attachment) => attachment.name).join("|") === "Corporate Information Sheet.pdf|Initial ISC – filing.pdf|Fwd Certificate.eml", `attachment names: ${attachments.map((attachment) => attachment.name).join("|")}`);
check(attachments.map((attachment) => attachment.contentType).join(",") === "application/pdf,application/pdf,message/rfc822", "PDF and message attachments only; the image is skipped");
check(decode(attachments[0].bytes) === `${FAKE_PDF_HEADER}${INFORMATION_SHEET}`, "base64 attachment decoded byte for byte");
check(decode(attachments[1].bytes) === `${FAKE_PDF_HEADER}${ISC}`, "quoted-printable attachment decoded byte for byte");
const nested = emlAttachments(attachments[2].bytes);
check(nested.length === 1 && nested[0].name === "certificate.pdf" && decode(nested[0].bytes) === `${FAKE_PDF_HEADER}${CERTIFICATE_PACKAGE}`, "attached message keeps its own PDF");
check(emlAttachments(INCORPORATION_EMAIL).length === 0, "an email without attachments yields none");
check(emlAttachments("Subject: hi\r\n\r\nNo MIME here.").length === 0, "plain message yields none");

const fakeExtract = async (name: string, bytes: Uint8Array) => {
  if (/\.pdf$/i.test(name)) {
    const text = decode(bytes);
    assert.ok(text.startsWith(FAKE_PDF_HEADER), `${name} is a stand-in PDF`);
    return { text: text.slice(FAKE_PDF_HEADER.length), warnings: [] };
  }
  const extract = await extractBytes(name, bytes);
  return { text: extract.text, warnings: extract.warnings };
};
const readTexts = await readRegistryFile({ id: "f0", name: "Incorporation_Constitution.eml", bytes: emlBytes }, fakeExtract);
check(readTexts.map((text) => `${text.id}<${text.parentId ?? ""}`).join(" ") === "f0< f0.1<f0 f0.2<f0 f0.3<f0 f0.3.1<f0.3", `email then its attachments, nested in order: ${readTexts.map((text) => text.id).join(" ")}`);
check(readTexts.every((text) => text.sourceId === "f0"), "every part traces back to the chosen file");
check(!readTexts[0].attachment && readTexts.slice(1).every((text) => text.attachment?.bytes.byteLength), "attachments carry their bytes for upload; the email itself doesn't");
const readKinds = readTexts.map((text) => parseRegistryDocument(text.text, text.name).kind);
check(readKinds.join(",") === "federal_incorporation_email,federal_corporation_information_sheet,federal_initial_isc,unknown,federal_certificate_of_incorporation", `attachment kinds: ${readKinds.join(",")}`);

// The review model: attachments become documents; restricted ones start un-uploaded with the warning.
const chosenEmail = new File([emlBytes], "Incorporation_Constitution.eml", { type: "message/rfc822" });
const importFiles = buildImportFiles([{ id: "f0", file: chosenEmail }], readTexts);
check(importFiles.length === 5 && importFiles[1].file.name === "Corporate Information Sheet.pdf" && importFiles[1].file.type === "application/pdf", "attachments rebuilt as files");
check(!importFiles[0].parsed.warnings.some((warning) => /attachments are not read/i.test(warning)), "no 'attachments not read' warning once they are read");
const importProposal = buildRegistryImportProposal(importFiles.map((file) => file.parsed));
const rows = importDocumentRows(importProposal, importFiles, []);
const rowFor = (name: string) => rows.find((row) => row.file.name === name)!;
check(rowFor("Incorporation_Constitution.eml").reasons.join("|") === "the corporation key|personal information" && !rowFor("Incorporation_Constitution.eml").defaultUpload, "the email carrying the sheet and ISC is restricted and not uploaded by default");
check(rowFor("Corporate Information Sheet.pdf").reasons.join("|") === "the corporation key" && !rowFor("Corporate Information Sheet.pdf").defaultUpload, "information sheet holds the key");
check(rowFor("Initial ISC – filing.pdf").reasons.join("|") === "personal information" && !rowFor("Initial ISC – filing.pdf").defaultUpload, "ISC holds personal information");
check(rowFor("certificate.pdf").reasons.length === 0 && rowFor("certificate.pdf").defaultUpload, "the certificate uploads by default");
check(restrictedWarning(["the corporation key"]) === "Every director can open uploaded documents. This one contains the corporation key.", "restricted warning copy");
check(importProposal.secrets.length === 1 && !JSON.stringify(importProposal).includes(KEY) && !JSON.stringify(rows.map((row) => row.entry)).includes(KEY), "the key read from an attachment stays out of the proposal and rows");
const existingCopy = importDocumentRows(importProposal, importFiles, [{ _id: "doc_existing", title: rowFor("certificate.pdf").entry.suggestedTitle, category: "CertificateOfIncorporation" }]);
check(existingCopy.find((row) => row.file.name === "certificate.pdf")?.existing?._id === "doc_existing" && !existingCopy.find((row) => row.file.name === "certificate.pdf")?.defaultUpload, "a copy already in Documents is linked, not uploaded again");

// --- Review fixes ------------------------------------------------------------------------
// The CBCA window is the anniversary plus 60 days (03-14 → 05-13), shown for reference.
check(fieldById(proposal, "info.annualReturnWindow")?.display === "03-14 to 05-13, first in 2026", "parsed annual return window shown");

// Email dates are the sender's calendar date, not UTC's.
check(emailHeaderDateISO("Fri, 14 Mar 2025 21:30:00 -0700") === "2025-03-14T21:30:00-07:00", "evening email keeps its own date");
check(emailHeaderDateISO("Fri, 14 Mar 2025 18:00 +0000") === "2025-03-14T18:00:00+00:00", "seconds optional");
check(emailHeaderDateISO("not a date") === undefined, "unreadable date");
const lateEmail = parseRegistryDocument(PAYMENT_EMAIL.replace("Date: Fri, 14 Mar 2025 17:30:00 +0000", "Date: Fri, 14 Mar 2025 21:30:00 -0700").replace("<td>2025-03-14 01:30:00</td>", "<td></td>"), "late.eml");
check(lateEmail.facts.emailDateISO?.value.slice(0, 10) === "2025-03-14", "an evening Pacific email is dated that day");

// Clock times: optional seconds; AM/PM hours are 1–12.
check(parseClockTime("1:05:30 PM") === "13:05" && parseClockTime("12:00 AM") === "00:00" && parseClockTime("11:59 a.m.") === "11:59", "clock times");
check(parseClockTime("13:45 PM") === undefined && parseClockTime("0:30 AM") === undefined, "impossible AM/PM hours rejected");

// Quoted-printable in either hex case, and encoded words in their own charset.
check(normalizeRegistryText("Content-Transfer-Encoding: quoted-printable\n\nLe fran=c3=a7ais suit").includes("Le français suit"), "lowercase quoted-printable hex");
check(normalizeRegistryText("Subject: =?iso-8859-1?Q?D=E9p=F4t?=").includes("Dépôt"), "ISO-8859-1 encoded word");
check(normalizeRegistryText("Subject: =?utf-8?B?Q2zDqSBkZSBzb2Npw6l0w6k=?=").includes("Clé de société"), "base64 encoded word");

// A filed (submitted) organization: the number and date are for reference, left to Record incorporation.
const filed = buildRegistryImportProposal(parsed, { formationStatus: "submitted", profile: { name: "Northwind Example Inc." } });
const filedNumber = fieldById(filed, "profile.incorporationNumber");
check(filedNumber?.target.scope === "info" && !filedNumber.selectedByDefault && /Record incorporation/.test(filedNumber.note ?? ""), "number is reference-only while filed");
check(fieldById(filed, "profile.incorporationDate")?.target.scope === "info", "date is reference-only while filed");
const filedArgs = proposalToApplyArgs(filed, defaultRegistryImportSelection(filed)).args;
check(filedArgs.profile?.incorporationNumber === undefined && filedArgs.profile?.incorporationDate === undefined && filedArgs.profile?.articlesMaxDirectors === 7, "default selection leaves the number and date out");

// An older filing never replaces a newer current address by default.
const newerOffice = buildRegistryImportProposal(parsed, { addresses: [{ type: "registered_office", status: "current", effectiveFrom: "2025-09-01", street: "9 Later Street", city: "Sampletown", provinceState: "BC", postalCode: "V0V 0V9", country: "Canada" }] });
const olderOffice = fieldById(newerOffice, "address.registered_office");
check(olderOffice?.replacesCurrent === true && olderOffice.selectedByDefault === false && /Older than the current address/.test(olderOffice.note ?? ""), "older Form 2 address not pre-selected");
const sameDayOffice = buildRegistryImportProposal(parsed, { addresses: [{ type: "registered_office", status: "current", effectiveFrom: "2025-01-01", street: "9 Earlier Street", city: "Sampletown", postalCode: "V0V 0V9", country: "Canada" }] });
check(fieldById(sameDayOffice, "address.registered_office")?.selectedByDefault === true, "a newer filing still replaces an older address");

// The rows the review compared against travel to the apply args.
const withIds = buildRegistryImportProposal(parsed, {
  registrations: [{ id: "reg_bc", registrationType: "extra_provincial", jurisdiction: "CA-BC", registrationNumber: "A0000001" }],
  identifiers: [{ id: "idn_bn", kind: "business_number", number: "987654321" }],
});
const idArgs = proposalToApplyArgs(withIds, defaultRegistryImportSelection(withIds)).args;
check(idArgs.registrations?.find((registration) => registration.registrationType === "extra_provincial")?.id === "reg_bc", "registration args carry the compared row's id");
check(idArgs.registrations?.find((registration) => registration.registrationType === "home")?.id === undefined, "no id without a compared row");
check(idArgs.identifiers?.find((identifier) => identifier.kind === "business_number")?.id === "idn_bn", "identifier args carry the compared row's id");
check(fieldById(withIds, "registration.bc.registrationNumber")?.currentId === "reg_bc", "the field names the row it replaces");

// Addresses and identifiers keep their source documents too.
check((filled.addresses ?? []).every((address) => (address.sourceDocumentIds ?? []).length > 0), "address source documents");
check((filled.identifiers ?? []).every((identifier) => (identifier.sourceDocumentIds ?? []).includes(ids[parsed[8].fingerprint])), "identifier source documents (the BN email)");
check(plan.args.addresses?.every((address) => !("sourceDocumentIds" in address)), "plan addresses untouched");

// A generated draft never stands in for the certificate.
const certificateRow = rows.find((row) => row.file.name === "certificate.pdf")!;
const draftCopy = { _id: "doc_draft", title: certificateRow.entry.suggestedTitle, category: "CertificateOfIncorporation", importRecordKind: "generated_legal_document" };
check(isUnofficialDocument(draftCopy) && isUnofficialDocument({ sourcePayloadJson: JSON.stringify({ templateProvenance: { documentState: "draft" } }) }) && !isUnofficialDocument({ title: "x" }), "unofficial document markers");
const withDraft = importDocumentRows(importProposal, importFiles, [draftCopy]);
check(!withDraft.find((row) => row.file.name === "certificate.pdf")?.existing && withDraft.find((row) => row.file.name === "certificate.pdf")?.defaultUpload === true, "a generated draft with the same title is not reused");

console.log(`registry documents: ${checks} checks passed`);
