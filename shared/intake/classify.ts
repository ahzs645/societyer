/** Stage 4 (deterministic priors): document class, body, date and record status
 * from the path, file name and the first part of the text. An LLM classifier
 * refines these; the priors are also the no-key fallback. */
import { versionMarker } from "./cluster";
import { bodyFromText } from "./minutes/extractMinutes";
import { findDates } from "./parse";
import type { DocClass } from "./schemas/common";

export type ClassificationPrior = {
  docClass: DocClass;
  confidence: number;
  body?: string;
  bodyLabel?: string;
  date?: { iso: string; precision: "day" | "month" | "year"; source: "filename" | "path" | "text" };
  recordStatus: "draft" | "approved" | "signed" | "template" | "script" | "agenda" | "recorded" | "unknown";
  restricted: boolean;
  restrictedReason?: string;
  rationale: string[];
};

type Rule = { docClass: DocClass; re: RegExp; weight: number; where: "name" | "path" | "text" };
// Name rules are ordered by priority (the first matching name rule breaks ties). Names are
// matched with underscores as spaces; CamelCase joins ("BoardPackage", "PGAIRBudget") are
// matched without a leading word boundary.
const RULES: Rule[] = [
  // Strong negatives first: blank forms and third-party bylaws are not governance records.
  { docClass: "formTemplate", re: /\b(?:blank|template|fillable)\b|\bform[ _-]?blank\b/i, weight: 0.92, where: "name" },
  { docClass: "report", re: /^bl\s?\d{3,}|\bbylaw[ -]no\.?\s*\d|\bmodel (?:wood|bylaw)|\bbylaw\b.*\b(?:consolidated|adopted)\b.*\(\d\)|\bocp\b/i, weight: 0.9, where: "name" },
  { docClass: "agmMaterial", re: /\b(?:agm|annual general meeting)\b.*\b(?:script|notice|package|report|press release|media release)\b|\bscript\b|\bnotice of (?:the )?(?:annual )?general meeting\b/i, weight: 0.88, where: "name" },
  { docClass: "meetingPackage", re: /package|\bboard book\b|\bbinder\b|\bconsent agenda\b|\bbusiness agenda\b/i, weight: 0.9, where: "name" },
  { docClass: "agenda", re: /agenda\b/i, weight: 0.9, where: "name" },
  { docClass: "meetingMinutes", re: /\bminutes?\b|minutes?(?=[_ .-])|\bmtg notes\b|\bmeeting notes\b|\bmeeting summary\b|\bnotes from\b|\b(?:committee|board|meeting|mtg|working group)\b.*\bnotes\b/i, weight: 0.85, where: "name" },
  { docClass: "registryFiling", re: /\bannual report\b.*\b(?:filed|filing|confirmation|registry|bc registr|receipt)|\b(?:confirmation|receipt)\b.*\bannual report\b|\b(?:19|20)\d{2}\s+annual report\b|\bstatement of directors\b|\btransition application\b|\bnotice of (?:change|articles)\b|\bsocieties online\b|\bbc ?registr|\bsocietal filing\b|\bfiling receipt\b/i, weight: 0.88, where: "name" },
  { docClass: "bylaws", re: /by-?laws?(?![a-z])|\bconstitution\b/i, weight: 0.85, where: "name" },
  { docClass: "directorConsent", re: /\bconsent(?: to act)?\b|\bdirector(?:'s)? consent\b/i, weight: 0.85, where: "name" },
  { docClass: "proxy", re: /\bprox(?:y|ies)\b/i, weight: 0.82, where: "name" },
  { docClass: "roster", re: /\broster\b|\bcontact list\b|\bmember(?:ship)? list\b|\bdirectory\b|\bdirector(?:s)? (?:full )?list\b|\bfull list\b|\bstaff list\b|\bregister of (?:members|directors)\b|\brepresentative(?!s? form)\b|\bdirectors and staff\b/i, weight: 0.82, where: "name" },
  { docClass: "correspondence", re: /\bletter\b(?! of (?:agreement|understanding|intent))(?!.*\bfunding\b)|\bltr\b|\bmemo\b|\bcorrespondence\b/i, weight: 0.8, where: "name" },
  { docClass: "policy", re: /\bpolic(?:y|ies)\b|\bterms of reference\b|\btor\b|\bprocedures?\b|\bprotocol\b|\bcode of conduct\b|\bguidelines\b|\bcharter\b|\bsigning authority\b|\bdelegation of\b|\brules of order\b|\bterms and conditions\b/i, weight: 0.78, where: "name" },
  { docClass: "financialStatement", re: /\bfinancial statements?\b|\bfinancials?\b|\bbalance sheet\b|\bincome statement\b|\bstatement of (?:operations|financial position)\b|\baudit(?:ed)?\b|\breview engagement\b|\bprofit (?:and|&) loss\b|\bp&l\b|\byear[ -]?end\b/i, weight: 0.82, where: "name" },
  { docClass: "budget", re: /budget(?![a-z])/i, weight: 0.8, where: "name" },
  { docClass: "insurance", re: /\binsurance\b|\bcertificate of (?:insurance|liability)\b|\bcoi\b|\bendorsement\b|\bdeclarations? page\b|\bpolicy wording\b|\bd\s?&\s?o\b|\be\s?&\s?o\b|\b(?:dno|mc)\d{4,}/i, weight: 0.82, where: "name" },
  { docClass: "agreement", re: /\bagreement\b|\bcontract\b|\bmou\b|\bmemorandum of understanding\b|\bletter of (?:understanding|agreement)\b|\bservice proposal\b|\bgsa\b/i, weight: 0.78, where: "name" },
  { docClass: "grant", re: /\bgrants?\b|\bfunding\b|\bproposal\b|\bapplication\b(?!.*\bform\b)|\b[A-Z]{2}\d{2}[A-Z]{3}\d{4}\b|\bfunder report\b/i, weight: 0.72, where: "name" },
  { docClass: "invoice", re: /\binvoices?\b|\breceipts?\b|\bcheque\b|\bbank statement\b|\breconciliation\b|\bpayables?\b|\bexpense claim\b/i, weight: 0.78, where: "name" },
  { docClass: "correspondence", re: /\.msg$|\.eml$|\bemail\b/i, weight: 0.6, where: "name" },
  { docClass: "plan", re: /\b(?:strategic|work|action|business|communications?|operational) ?plan\b|\bworkplan\b|\baqmp\b/i, weight: 0.7, where: "name" },
  { docClass: "report", re: /\breport\b|\bupdate\b|\bbriefing note\b|\bsummary\b/i, weight: 0.55, where: "name" },
  { docClass: "formTemplate", re: /\btemplate\b|\bblank\b|\bform\b/i, weight: 0.6, where: "name" },
  { docClass: "presentation", re: /\.(?:pptx?|key|odp)$/i, weight: 0.7, where: "name" },
  { docClass: "image", re: /\.(?:jpe?g|png|gif|bmp|tiff?|heic|webp|svg)$/i, weight: 0.9, where: "name" },
  { docClass: "audioVideo", re: /\.(?:mp3|m4a|wav|mp4|mov|avi|wmv)$/i, weight: 0.9, where: "name" },
  { docClass: "archive", re: /\.(?:zip|rar|7z|tar|gz)$/i, weight: 0.9, where: "name" },
  { docClass: "outreach", re: /\b(?:poster|flyer|brochure|newsletter|media release|press release|social media|facebook|graphic)\b/i, weight: 0.6, where: "name" },
  // Folder names are weaker evidence.
  { docClass: "meetingMinutes", re: /\bminutes\b/i, weight: 0.45, where: "path" },
  { docClass: "financialStatement", re: /\bfinanc/i, weight: 0.35, where: "path" },
  { docClass: "insurance", re: /\binsurance\b/i, weight: 0.45, where: "path" },
  { docClass: "agreement", re: /\bagreements?\b|\bcontracts?\b/i, weight: 0.4, where: "path" },
  { docClass: "grant", re: /\bfunder reports?\b|\bproposals?\b|\bgrants?\b/i, weight: 0.45, where: "path" },
  { docClass: "policy", re: /\bpolic(?:y|ies)\b|\bbylaws?\b/i, weight: 0.35, where: "path" },
  { docClass: "correspondence", re: /\bcorrespondence\b/i, weight: 0.35, where: "path" },
  { docClass: "roster", re: /\bcontact (?:lists?|information)\b|\bdirectors? and prox/i, weight: 0.45, where: "path" },
  { docClass: "registryFiling", re: /\bannual society records\b/i, weight: 0.5, where: "path" },
  { docClass: "invoice", re: /\binvoices?\b|\breceipts?\b|\bpayables?\b/i, weight: 0.45, where: "path" },
  // Text evidence (first ~3k characters).
  { docClass: "meetingMinutes", re: /\bminutes\b[\s\S]{0,800}\b(?:present|regrets|in attendance|called to order|quorum)\b|\b(?:moved|seconded)\b[\s\S]{0,200}\bcarried\b/i, weight: 0.8, where: "text" },
  { docClass: "meetingMinutes", re: /\bmeeting\b[\s\S]{0,400}\b(?:present|in attendance|attendees|participants)\s*:[\s\S]{0,3000}\b(?:adjourn|called to order|regrets|motion|quorum)/i, weight: 0.75, where: "text" },
  { docClass: "agenda", re: /^\s*(?:[\w ]{0,60}\n)?\s*agenda\b|\bsubject\s*:\s*agenda\b/i, weight: 0.6, where: "text" },
  { docClass: "financialStatement", re: /\btotal (?:revenue|expenses|assets|liabilities)\b|\bnet assets\b|\bexcess of revenue\b|\bstatement of financial position\b/i, weight: 0.7, where: "text" },
  { docClass: "insurance", re: /\bpolicy (?:number|period)\b|\binsured\b.*\blimit\b|\bdeclarations page\b|\bcertificate of insurance\b/i, weight: 0.7, where: "text" },
  { docClass: "directorConsent", re: /\bconsent to act as (?:a )?director\b/i, weight: 0.9, where: "text" },
  { docClass: "proxy", re: /\bhereby appoints?\b[\s\S]{0,200}\bproxy\b|\bproxy form\b/i, weight: 0.85, where: "text" },
  { docClass: "registryFiling", re: /\bBC SOCIETY ANNUAL REPORT\b|\bSTATEMENT OF DIRECTORS AND REGISTERED OFFICE\b|\bconfirmation of filing\b|\bform filed\s*:|\bbc registr(?:y|ies)\b[\s\S]{0,400}\b(?:annual report|filed|filing)|\bincorporation number\b.*\bS-?\d+/i, weight: 0.85, where: "text" },
  { docClass: "invoice", re: /^\s*(?:[\w .,&-]{0,80}\n){0,6}\s*invoice\b|\binvoice\s*(?:#|no\.?|number)\s*:?\s*\w|\bbalance due\b|\bbill to\b/i, weight: 0.75, where: "text" },
  { docClass: "agreement", re: /\bbetween\s*:?[\s\S]{0,600}\band\s*:?[\s\S]{0,800}\b(?:agree|agreement|contract)\b|\bthe parties agree\b|\bgeneral service agreement\b/i, weight: 0.75, where: "text" },
  { docClass: "bylaws", re: /\bthe name of the society is\b|\bbylaws of the\b[\s\S]{0,120}\bsociety\b/i, weight: 0.8, where: "text" },
  { docClass: "formTemplate", re: /\bfillable (?:application )?form\b|_{8,}[\s\S]{0,200}_{8,}[\s\S]{0,200}_{8,}/i, weight: 0.65, where: "text" },
  { docClass: "report", re: /\bcity of [a-z ]+\bbylaw no\.?\s*\d|\bcouncil of the city\b/i, weight: 0.85, where: "text" },
];

const RESTRICTED = [
  { re: /\bpayroll\b|\bpaystub\b|\bpay stub\b|\bsalar(?:y|ies)\b|\bt4\b|\broe\b|\btd1\b|\bsin\b/i, reason: "Payroll or HR" },
  { re: /\bresume\b|\brésumé\b|\bcv\b|\bcover letter\b|\breference check\b/i, reason: "Applicant personal information" },
  { re: /\bbank statement\b|\bcheque\b|\bvoid cheque\b|\bdeposit slip\b|\bdirect deposit\b/i, reason: "Banking details" },
  { re: /\bcontact list\b|\bphone list\b|\bmailing list\b|\bemergency contacts?\b/i, reason: "Personal contact details" },
  { re: /\bconsent to act\b|\bdirector consent\b|\bconsent form\b/i, reason: "Director consent forms (home addresses)" },
  { re: /\.msg$|\.eml$|\bmailbox\b/i, reason: "Email mailbox" },
];

export function classifyPrior(file: { name: string; path?: string; headText?: string }): ClassificationPrior {
  const name = file.name.replace(/_/g, " ");
  const folder = (file.path ?? "").replace(/_/g, " ").replace(/[^/]*$/, "");
  const head = (file.headText ?? "").slice(0, 3000);
  const scores = new Map<DocClass, number>();
  const rationale: string[] = [];
  // A file NAMED as an agenda/package/script carries embedded minutes text: the name decides.
  const namedAgendaLike = /agenda\b|package|\bscript\b|\bnotice\b/i.test(name);
  for (const rule of RULES) {
    const subject = rule.where === "name" ? name : rule.where === "path" ? folder : head;
    if (!subject || !rule.re.test(subject)) continue;
    const weight = rule.where === "text" && rule.docClass === "meetingMinutes" && namedAgendaLike ? rule.weight * 0.4 : rule.weight;
    const previous = scores.get(rule.docClass) ?? 0;
    // Combine independent evidence: 1 - (1-a)(1-b).
    scores.set(rule.docClass, 1 - (1 - previous) * (1 - weight));
    rationale.push(`${rule.where} matches ${rule.docClass}`);
  }
  // Name rules are ordered by priority: the first matching name rule breaks ties.
  const firstNameRule = RULES.find((rule) => rule.where === "name" && rule.re.test(name));
  let best: [DocClass, number] = ["unclassified", 0.2];
  for (const [docClass, score] of scores) {
    const bonus = firstNameRule?.docClass === docClass ? 0.05 : 0;
    if (score + bonus > best[1]) best = [docClass, Math.min(0.97, score + bonus)];
  }
  const marker = versionMarker(file.name);
  const recordStatus: ClassificationPrior["recordStatus"] = /\bscript\b/i.test(name) ? "script"
    : /\btemplate\b|\bblank\b/i.test(name) ? "template"
      : best[0] === "agenda" || best[0] === "meetingPackage" ? "agenda"
        : marker === "draft" ? "draft" : marker === "approved" ? "approved" : marker === "signed" ? "signed"
          : best[0] === "meetingMinutes" ? "recorded" : "unknown";
  const body = bodyFromText(`${name} ${head.slice(0, 400)}`) ?? bodyFromText(folder);
  const nameDates = findDates(name, { allowNumericShortYear: true, allowMonthPrecision: true });
  const pathDates = findDates(folder, { allowMonthPrecision: true });
  const day = nameDates.find((date) => date.precision === "day");
  const date = day ? { iso: day.iso, precision: "day" as const, source: "filename" as const }
    : nameDates[0] ? { iso: nameDates[0].iso, precision: nameDates[0].precision, source: "filename" as const }
      : pathDates[0] ? { iso: pathDates[0].iso, precision: pathDates[0].precision, source: "path" as const } : undefined;
  const restrictedRule = RESTRICTED.find((rule) => rule.re.test(name) || rule.re.test(folder));
  return {
    docClass: best[0],
    confidence: Number(best[1].toFixed(2)),
    ...(body ? { body: body.body, bodyLabel: body.label } : {}),
    ...(date ? { date } : {}),
    recordStatus,
    restricted: Boolean(restrictedRule),
    ...(restrictedRule ? { restrictedReason: restrictedRule.reason } : {}),
    rationale,
  };
}

/** Classes that carry governance facts worth structured extraction in the MVP. */
export const EXTRACTION_CLASSES: ReadonlySet<DocClass> = new Set(["meetingMinutes", "agenda", "meetingPackage", "agmMaterial", "bylaws", "policy", "directorConsent", "proxy", "roster", "financialStatement", "budget", "insurance", "agreement", "grant", "registryFiling", "correspondence", "invoice"]);
