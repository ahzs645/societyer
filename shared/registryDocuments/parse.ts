/**
 * Registry document text → typed facts with provenance snippets.
 *
 * Each section of a file (a certificate package holds the certificate, the
 * articles with their schedules and Form 2) is read by its own extractor.
 * English labels come first in the bilingual federal forms; the first match
 * wins, so the French duplicate is ignored.
 */
import { INCORPORATION_ACTS, incorporationJurisdictionForCode } from "../incorporationActs";
import { classifySections, documentKindOf, type ClassifiedSection } from "./classify";
import {
  findLine,
  hashText,
  isEmailText,
  labelValue,
  matchKey,
  nextNonEmpty,
  normalizeRegistryText,
  parseAddressLines,
  parseClockTime,
  parseRegistryDate,
  previousNonEmpty,
  provinceCode,
  snippetOf,
} from "./text";
import type {
  ParsedRegistryDocument,
  RegistryAddress,
  RegistryDirector,
  RegistryDocumentCategory,
  RegistryDocumentKind,
  RegistryFacts,
  RegistrySecret,
  RegistrySectionKind,
} from "./types";

export const SECRET_MASK = "••••••••";
const PACIFIC = "America/Vancouver";

type Context = {
  facts: RegistryFacts;
  section: RegistrySectionKind;
  secrets: RegistrySecret[];
  warnings: string[];
};

type FactValue<K extends keyof RegistryFacts> = NonNullable<RegistryFacts[K]>["value"];

/** First value wins: English precedes the French duplicate. */
function put<K extends keyof RegistryFacts>(ctx: Context, key: K, value: FactValue<K> | undefined, snippet: string) {
  if (value === undefined || value === "" || ctx.facts[key] !== undefined) return;
  if (Array.isArray(value) && !value.length) return;
  ctx.facts[key] = { value, snippet: snippetOf(snippet), section: ctx.section } as RegistryFacts[K];
}

function sectionLines(section: ClassifiedSection): string[] {
  return section.pages.flatMap((page) => [...page.lines, ""]);
}

function flatText(lines: string[]): string {
  return lines.join(" ").replace(/\s+/g, " ");
}

function cells(line: string): string[] {
  return line.split("\t").map((cell) => cell.trim()).filter(Boolean);
}

/** A value on the label's own line only ("Fee:\t$350.00"); never the next line. */
function sameLineValue(lines: string[], label: RegExp): { value: string; snippet: string } | undefined {
  const index = findLine(lines, label);
  if (index < 0) return undefined;
  const value = lines[index].replace(label, "").replace(/^[\s:\t]+/, "").trim();
  return value ? { value, snippet: lines[index] } : undefined;
}

function money(value?: string): string | undefined {
  const match = /\$?\s*([\d,]+\.\d{2})/.exec(value ?? "");
  return match ? match[1].replace(/,/g, "") : undefined;
}

function federalAct(flat: string): { actFormedUnder: string; jurisdictionCode: string; officialName: string } | undefined {
  const federal = INCORPORATION_ACTS.filter((act) => act.jurisdiction === "CA");
  const lower = flat.toLowerCase();
  const act = federal.find((candidate) => lower.includes(candidate.officialName.toLowerCase()));
  return act ? { actFormedUnder: act.actFormedUnder, jurisdictionCode: act.jurisdictionCode, officialName: act.officialName } : undefined;
}

function jurisdictionCodeFor(label: string): string | undefined {
  if (/federal|canada/i.test(label)) return "CA-FED";
  const code = provinceCode(label);
  return incorporationJurisdictionForCode(code ?? label)?.code;
}

// ---------------------------------------------------------------------------
// Federal

function readCertificate(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const flat = flatText(lines);
  const nameIndex = findLine(lines, /^Corporate name\b/i);
  const name = nameIndex >= 0 ? previousNonEmpty(lines, nameIndex) : undefined;
  if (name && !/Certificate|Act\b/.test(name)) put(ctx, "legalName", name, `${name} · Corporate name`);
  const numberIndex = findLine(lines, /^Corporation number\b/i);
  const number = (numberIndex >= 0 ? /\b\d{7}-\d\b/.exec(previousNonEmpty(lines, numberIndex) ?? "")?.[0] : undefined) ?? /\b\d{7}-\d\b/.exec(flat)?.[0];
  if (number) put(ctx, "corporationNumber", number, `${number} · Corporation number`);
  const dateIndex = findLine(lines, /^Date of Incorporation/i);
  const date = dateIndex >= 0 ? parseRegistryDate(previousNonEmpty(lines, dateIndex) ?? "") : undefined;
  if (date) put(ctx, "incorporationDate", date, `${date} · Date of Incorporation`);
  const act = federalAct(flat);
  if (act) {
    put(ctx, "actFormedUnder", act.actFormedUnder, `incorporated under the ${act.officialName}`);
    put(ctx, "jurisdictionCode", act.jurisdictionCode, `incorporated under the ${act.officialName}`);
  }
  return [number ?? "", matchKey(name ?? ""), date ?? ""];
}

const ARTICLE_ITEMS = [
  { key: "name", label: /^(?:1\s*)?Corporate name\b/i },
  { key: "province", label: /^(?:2\s*)?The province or territory in Canada where the registered office/i },
  { key: "shares", label: /^(?:3\s*)?The classes and any maximum number of shares/i },
  { key: "transfer", label: /^(?:4\s*)?Restrictions on share transfers/i },
  { key: "directors", label: /^(?:5\s*)?Minimum and maximum number of directors/i },
  { key: "business", label: /^(?:6\s*)?Restrictions on the business/i },
  { key: "other", label: /^(?:7\s*)?Other Provisions\s*$/i },
  { key: "declaration", label: /^(?:8\s*)?Incorporator.s Declaration/i },
] as const;
type ArticleKey = (typeof ARTICLE_ITEMS)[number]["key"];

const FRENCH_LABEL = /^(?:Dénomination sociale|La province ou le territoire|Catégories et le nombre|Restrictions sur le transfert|Nombre minimal et maximal|Limites imposées|Autres dispositions|Déclaration des fondateurs)/i;
const SEE_SCHEDULE = /See attached schedule|Voir l.annexe/i;

/** Schedule headings: "Restrictions on Share Transfers / Restrictions sur le transfert des actions". */
function scheduleKey(line: string): ArticleKey | undefined {
  if (line.length > 140 || !/\S\s*\/\s*\S/.test(line)) return undefined;
  const english = line.split("/")[0];
  if (/share transfers?|transfer of shares/i.test(english)) return "transfer";
  if (/other provisions/i.test(english)) return "other";
  if (/restrictions on the business|business restrictions/i.test(english)) return "business";
  if (/classes|share capital|shares/i.test(english)) return "shares";
  return undefined;
}

function readArticles(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const positions: Array<{ key: ArticleKey; index: number }> = [];
  let from = 0;
  for (const item of ARTICLE_ITEMS) {
    const index = findLine(lines, item.label, from);
    if (index < 0) continue;
    positions.push({ key: item.key, index });
    from = index + 1;
  }
  const declaration = positions.find((position) => position.key === "declaration");
  const formEnd = declaration ? findLine(lines, /^Misrepresentation|^IC \d{4}/i, declaration.index) : -1;
  const values = new Map<ArticleKey, { text: string; snippet: string }>();
  positions.forEach((position, order) => {
    if (position.key === "declaration") return;
    const end = positions[order + 1]?.index ?? lines.length;
    const body = lines.slice(position.index + 1, end).map((line) => line.trim()).filter((line) => line && !FRENCH_LABEL.test(line));
    if (body.length) values.set(position.key, { text: body.join("\n"), snippet: `${lines[position.index]}: ${body.join(" ")}` });
  });

  // Schedule pages after the form: heading, then text until the next heading.
  const schedule = new Map<ArticleKey, { text: string; snippet: string }>();
  const scheduleStart = formEnd >= 0 ? formEnd : 0;
  let current: { key: ArticleKey; heading: string; body: string[] } | undefined;
  const flush = () => {
    if (current && current.body.length && !schedule.has(current.key)) schedule.set(current.key, { text: current.body.join("\n"), snippet: `${current.heading}: ${current.body.join(" ")}` });
  };
  for (const raw of lines.slice(scheduleStart)) {
    const line = raw.trim();
    if (!line || /^Schedule\b/i.test(line)) continue;
    const key = scheduleKey(line);
    if (key) {
      flush();
      current = { key, heading: line.split("/")[0].trim(), body: [] };
    } else if (current) current.body.push(line);
  }
  flush();

  const text = (key: ArticleKey) => {
    const own = values.get(key);
    if (own && SEE_SCHEDULE.test(own.text)) return schedule.get(key) ?? own;
    return own ?? schedule.get(key);
  };
  const english = (value: string) => value.replace(/\s*\/\s*Voir l.annexe.*$/i, "").trim();

  const name = values.get("name")?.text.split("\n")[0];
  if (name) put(ctx, "legalName", name, `Corporate name: ${name}`);
  const provinceText = values.get("province")?.text.split("\n")[0] ?? "";
  put(ctx, "registeredOfficeProvince", provinceCode(provinceText), `Registered office province: ${provinceText}`);
  const shares = text("shares");
  if (shares) put(ctx, "shareClasses", english(shares.text), shares.snippet);
  const transfer = text("transfer");
  if (transfer) put(ctx, "shareTransferRestrictions", english(transfer.text), transfer.snippet);
  const directors = values.get("directors");
  const range = /Min(?:imum)?\.?\s*:?\s*(\d+)[\s\S]*?Max(?:imum)?\.?\s*:?\s*(\d+)/i.exec(directors?.text ?? "");
  if (range && directors) {
    put(ctx, "minDirectors", Number(range[1]), directors.snippet);
    put(ctx, "maxDirectors", Number(range[2]), directors.snippet);
  }
  const business = text("business");
  if (business) put(ctx, "businessRestrictions", english(business.text), business.snippet);
  const other = text("other");
  if (other) put(ctx, "otherProvisions", english(other.text), other.snippet);

  const namesIndex = findLine(lines, /^Name\(s\)\s*-\s*Nom\(s\)/i, declaration?.index ?? 0);
  if (namesIndex >= 0) {
    const names: string[] = [];
    for (let index = namesIndex + 1; index < lines.length && (formEnd < 0 || index < formEnd); index++) {
      const first = cells(lines[index])[0];
      if (!first || /Original sign|Signature|^\d/i.test(first)) continue;
      if (!names.some((name) => matchKey(name) === matchKey(first))) names.push(first);
    }
    put(ctx, "incorporators", names, `Incorporators: ${names.join(", ")}`);
  }
  return [matchKey(name ?? ""), range?.[1] ?? "", range?.[2] ?? "", matchKey(transfer?.text ?? ""), matchKey(business?.text ?? ""), matchKey(other?.text ?? ""), matchKey(shares?.text ?? "")];
}

const RESIDENT_FLAG = /\b(Yes|No)\s*(?:\/\s*(?:Oui|Non))?\s*$/i;

function readInitialOffice(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const nameLabel = findLine(lines, /^(?:1\s*)?Corporate name\b|^Dénomination sociale\s*$/i);
  let name: string | undefined;
  for (let cursor = nameLabel; nameLabel >= 0 && cursor < lines.length; ) {
    const next = nextNonEmpty(lines, cursor);
    if (!next) break;
    if (!FRENCH_LABEL.test(next.line)) {
      name = next.line;
      break;
    }
    cursor = next.index;
  }
  if (name && !/^(?:2\s*)?Address of registered office/i.test(name)) put(ctx, "legalName", name, `Corporate name: ${name}`);
  else name = undefined;

  const addressLabel = findLine(lines, /^(?:2\s*)?Address of registered office/i);
  let address: RegistryAddress | undefined;
  if (addressLabel >= 0) {
    const end = findLine(lines, /^(?:3\s*)?Additional address|^Autre adresse|Members of the board/i, addressLabel + 1);
    const block = lines.slice(addressLabel + 1, end < 0 ? addressLabel + 6 : end).filter((line) => line.trim() && !/^Adresse du siège social/i.test(line));
    address = parseAddressLines(block);
    if (address) put(ctx, "registeredOfficeAddress", address, `Address of registered office: ${block.join(", ")}`);
  }

  const membersLabel = findLine(lines, /Members of the board of directors/i);
  const directors: RegistryDirector[] = [];
  if (membersLabel >= 0) {
    const end = findLine(lines, /^(?:5\s*)?Declaration\b|^Déclaration\b/i, membersLabel + 1);
    for (const raw of lines.slice(membersLabel + 1, end < 0 ? lines.length : end)) {
      const line = raw.replace(/^Membres du conseil d.administration\s*/i, "").replace(/^Resident Canadian\s*/i, "").replace(/^Résident Canadien\s*/i, "").trim();
      if (!line) continue;
      const row = cells(line);
      const flag = RESIDENT_FLAG.exec(line);
      if (flag) {
        const first = row.length > 1 ? row[0] : row[0].replace(RESIDENT_FLAG, "").trim();
        if (first && !/\d/.test(first)) directors.push({ name: first, residentCanadian: flag[1].toLowerCase() === "yes" });
        continue;
      }
      // A wrapped name continues in the first column; address overflow has digits.
      const last = directors[directors.length - 1];
      if (last && row.length >= 2 && !/\d/.test(row[0])) last.name = `${last.name} ${row[0]}`;
    }
  }
  put(ctx, "directors", directors, `Directors: ${directors.map((director) => `${director.name} (${director.residentCanadian ? "resident Canadian" : "not resident Canadian"})`).join("; ")}`);
  return [matchKey(name ?? ""), ...directors.map((director) => `${matchKey(director.name)}:${director.residentCanadian}`), address ? matchKey(`${address.street} ${address.postalCode}`) : ""];
}

function readInformationSheet(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const flat = flatText(lines);
  const numberIndex = findLine(lines, /^Corporation number\b/i);
  const number = /Corporation number\s*(\d{7}-\d)/i.exec(flat)?.[1] ?? /\b\d{7}-\d\b/.exec(flat)?.[0];
  const name = numberIndex >= 0 ? previousNonEmpty(lines, numberIndex) : undefined;
  if (name && !/\bAct\b|Loi\b|Sheet/i.test(name)) put(ctx, "legalName", name, `${name} · Corporation Information Sheet`);
  if (number) put(ctx, "corporationNumber", number, `Corporation number ${number}`);

  // The key sits between its label and the anniversary date. It never goes into a snippet.
  const keyLabel = findLine(lines, /^Corporation key\b/i);
  if (keyLabel >= 0) {
    const end = findLine(lines, /^Anniversary date\b/i, keyLabel);
    const window = lines.slice(keyLabel, end > keyLabel ? end : keyLabel + 3).join("\t");
    const numberDigits = (number ?? "").replace(/\D/g, "");
    const key = window.split(/[\t ]+/).map((token) => token.replace(/^[:(]+|[:).,]+$/g, "")).find((token) => /^[A-Za-z0-9]{6,16}$/.test(token) && /\d/.test(token) && token.replace(/\D/g, "") !== numberDigits);
    if (key) ctx.secrets.push({ kind: "corporation_key", label: "Corporation key", masked: SECRET_MASK, reveal: () => key });
    else ctx.warnings.push("The corporation key label was found but no key could be read.");
  }

  const anniversary = /Anniversary date\s*(\d{2}-\d{2})/i.exec(flat)?.[1];
  if (anniversary) put(ctx, "anniversaryMonthDay", anniversary, `Anniversary date ${anniversary}`);
  const window = /(\d{2}-\d{2})\s*to(?:\s*\/\s*au)?\s*(\d{2}-\d{2})/i.exec(flat);
  const firstYear = /Starting in\s*(\d{4})/i.exec(flat)?.[1];
  if (window) put(ctx, "annualReturnWindow", { start: window[1], end: window[2], ...(firstYear ? { firstYear: Number(firstYear) } : {}) }, `Annual return filing period ${window[1]} to ${window[2]}${firstYear ? `, starting in ${firstYear}` : ""}`);
  return [number ?? "", anniversary ?? ""];
}

const ISC_LABEL = /:\s*$|^(?:DATE OF BIRTH|COUNTRIES|RESIDENTIAL ADDRESS|ADDRESS FOR SERVICE|TYPE OF INTEREST|THIS INDIVIDUAL|START DATE|END DATE)\b/i;
const ISC_VALUE = /^(?:not applicable|directly|indirectly|individually|jointly|canada|none)$/i;

function isPersonName(line: string): boolean {
  return /^[\p{L}][\p{L}'’.\- ]{1,80}$/u.test(line) && line.split(/\s+/).length <= 6 && !ISC_LABEL.test(line) && !ISC_VALUE.test(line);
}

/** Names and the received date only. Birth dates, addresses, citizenship and tax residence are skipped, never stored. */
function readInitialIsc(section: ClassifiedSection, ctx: Context): string[] {
  const all = sectionLines(section);
  const frenchStart = findLine(all, /^Particuliers ayant un contr/i);
  const lines = frenchStart > 0 ? all.slice(0, frenchStart) : all;
  const received = /Received date[^:]*:\s*(\d{4}-\d{2}-\d{2})/i.exec(flatText(lines))?.[1];
  if (received) put(ctx, "iscReceivedDate", received, `Received date ${received}`);
  const introIndex = findLine(lines, /initial information about individuals with significant control/i);
  const corporation = introIndex >= 0 ? /significant control for (.+?):?\s*$/i.exec(lines[introIndex])?.[1] : undefined;
  if (corporation) put(ctx, "legalName", corporation, `individuals with significant control for ${corporation}`);

  const names: string[] = [];
  const add = (name: string) => {
    if (!names.some((existing) => matchKey(existing) === matchKey(name))) names.push(name);
  };
  let expectName = introIndex >= 0;
  for (let index = Math.max(0, introIndex + 1); index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^(?:START|END) DATE\b/i.test(line)) {
      const value = nextNonEmpty(lines, index);
      if (value && !ISC_LABEL.test(value.line)) index = value.index;
      expectName = true;
      continue;
    }
    // A name directly followed by the birth-date label also counts (pdf.js can drop other labels).
    const followedByBirthLabel = /^DATE OF BIRTH/i.test(nextNonEmpty(lines, index)?.line ?? "");
    if ((expectName || followedByBirthLabel) && isPersonName(line)) {
      add(line);
      expectName = false;
    } else if (!ISC_LABEL.test(line)) expectName = false;
  }
  put(ctx, "iscIndividualNames", names, `Individuals with significant control: ${names.join(", ")}`);
  return [received ?? "", ...names.map(matchKey)];
}

// ---------------------------------------------------------------------------
// Email

function emailHeader(lines: string[], name: string): string | undefined {
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line?.slice(name.length + 1).trim();
}

const HEADER_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * An RFC 5322 Date header as an ISO timestamp in the sender's own offset
 * ("Fri, 14 Mar 2025 19:45:00 -0400" → "2025-03-14T19:45:00-04:00"), so its
 * first ten characters are the calendar date the email was sent, not the UTC one.
 */
export function emailHeaderDateISO(header: string): string | undefined {
  const match = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|GMT|UTC?|Z)?/i.exec(header);
  const month = match ? HEADER_MONTHS.indexOf(match[2].toLowerCase()) : -1;
  if (match && month >= 0) {
    const pad = (value: string | number) => String(value).padStart(2, "0");
    const zone = match[7] && /^[+-]\d{4}$/.test(match[7]) ? `${match[7].slice(0, 3)}:${match[7].slice(3)}` : "+00:00";
    const iso = `${match[3]}-${pad(month + 1)}-${pad(match[1])}T${pad(match[4])}:${match[5]}:${match[6] ?? "00"}${zone}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  const parsed = new Date(header);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function readEmailHeaders(lines: string[], ctx: Context) {
  const from = emailHeader(lines, "From") ?? "";
  const date = emailHeader(lines, "Date");
  const dateISO = date ? emailHeaderDateISO(date) : undefined;
  if (dateISO) put(ctx, "emailDateISO", dateISO, `Date: ${date}`);
  if (/ised-isde|corporationscanada|ic\.gc\.ca|gov\.bc\.ca/i.test(from)) {
    const to = emailHeader(lines, "To") ?? "";
    const address = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(to)?.[0];
    if (address) put(ctx, "notificationEmail", address.toLowerCase(), `To: ${address}`);
  }
}

function lineWith(lines: string[], pattern: RegExp): string {
  return lines.find((line) => pattern.test(line)) ?? "";
}

function readIncorporatedEmail(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  readEmailHeaders(lines, ctx);
  const flat = flatText(lines);
  const bn = /\b(\d{9})\s*(RC\d{4})\b/.exec(flat) ?? /business number[^.]*?\b(\d{9})\b/i.exec(flat);
  const sentence = lineWith(lines, /\b\d{9}\b/);
  if (bn) {
    put(ctx, "businessNumber", bn[1], sentence);
    if (bn[2]) put(ctx, "programAccounts", [bn[2]], sentence);
  }
  const name = /Congratulations (.+?) on incorporating/i.exec(flat)?.[1];
  if (name) put(ctx, "legalName", name, `Congratulations ${name} on incorporating`);
  return [bn?.[1] ?? ""];
}

function readIncorporationEmail(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  readEmailHeaders(lines, ctx);
  const flat = flatText(lines);
  const nameLine = lineWith(lines, /has just incorporated with Corporations Canada/i);
  const name = /^(.+?) has just incorporated/i.exec(nameLine)?.[1];
  if (name) put(ctx, "legalName", name, nameLine);
  const listIndex = findLine(lines, /We have included the following documents/i);
  if (listIndex >= 0) {
    const documents: string[] = [];
    for (let index = listIndex + 1; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;
      const bullet = /^[*•\-–]\s*(.+)$/.exec(line);
      if (!bullet) break;
      documents.push(bullet[1].trim());
    }
    put(ctx, "enclosedDocuments", documents, `We have included the following documents: ${documents.join("; ")}`);
  }
  const reminder = lineWith(lines, /subscribed to receive annual return reminder emails/i);
  if (reminder) put(ctx, "reminderEmailsSubscribed", !/not subscribed|unsubscribed/i.test(reminder), reminder);
  const url = /(https?:\/\/[^\s)>"]*fdrlCrpDtls\.html\?corpId=\d+[^\s)>"]*)/i.exec(flat)?.[1];
  if (url) put(ctx, "publicRecordUrl", url, `Search for a Federal Corporation (${url})`);
  return [matchKey(name ?? ""), url ?? ""];
}

function readPaymentEmail(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  readEmailHeaders(lines, ctx);
  const amountLine = labelValue(lines, /^Transaction amount:/i);
  const amount = money(amountLine?.value);
  const dateLine = labelValue(lines, /^Date\s*\/\s*Time:/i);
  const date = parseRegistryDate(dateLine?.value ?? "") ?? ctx.facts.emailDateISO?.value.slice(0, 10);
  const reference = /^\w+$/.exec(labelValue(lines, /^Reference number:/i)?.value ?? "")?.[0];
  const transactionId = /^\w+$/.exec(labelValue(lines, /^Transaction Id:/i)?.value ?? "")?.[0];
  const merchant = labelValue(lines, /^Merchant:/i)?.value;
  if (!/Transaction approved/i.test(flatText(lines))) ctx.warnings.push("The payment email does not say the transaction was approved.");
  if (amount) {
    put(ctx, "payment", {
      payee: merchant && /^Corporations$/i.test(merchant) ? "Corporations Canada" : merchant ?? "Corporations Canada",
      description: "Corporations Canada online payment",
      amount,
      currency: "CAD",
      ...(date ? { date } : {}),
      ...(reference ? { reference } : {}),
      ...(transactionId ? { transactionId } : {}),
    }, `Transaction amount: $${amount} (CAD)${reference ? ` · Reference number: ${reference}` : ""}`);
  }
  return [reference ?? "", transactionId ?? "", amount ?? ""];
}

function readAccessEmail(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  readEmailHeaders(lines, ctx);
  const sentence = lineWith(lines, /within the Online Filing Centre has been updated/i);
  const organization = /your access to (.+?) within the Online Filing Centre/i.exec(flatText(lines))?.[1];
  if (organization) put(ctx, "legalName", organization.replace(/\.\.$/, "."), sentence);
  put(ctx, "portalAccess", {
    ...(organization ? { organizationName: organization } : {}),
    portal: "Online Filing Centre",
    ...(ctx.facts.emailDateISO ? { updatedAtISO: ctx.facts.emailDateISO.value } : {}),
    notes: /Access Manager/i.test(sentence) ? "Access type updated by an Access Manager." : "Access type updated.",
  }, sentence || "Access type updated");
  return [organization ?? "", ctx.facts.emailDateISO?.value ?? ""];
}

// ---------------------------------------------------------------------------
// British Columbia

function readBcStatement(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const flat = flatText(lines);
  const forIndex = findLine(lines, /Statement of Registration for:/i);
  const name = forIndex >= 0 ? (lines[forIndex].split(/for:/i)[1]?.trim() || nextNonEmpty(lines, forIndex)?.line) : undefined;
  if (name) put(ctx, "legalName", name, `Statement of Registration for: ${name}`);
  const number = /Registration Number:\s*(A\d{7})\b/i.exec(flat)?.[1];
  if (number) put(ctx, "bcRegistrationNumber", number, `Registration Number: ${number}`);
  const filed = /Registered in British Columbia on\s+([A-Za-z]+\.? \d{1,2},? \d{4})(?:\s+(?:at\s+)?(\d{1,2}:\d{2}\s*[AP]\.?M\.?))?\s*(Pacific)?/i.exec(flat);
  if (filed) {
    const snippet = `Registered in British Columbia on ${filed[1]}${filed[2] ? ` ${filed[2]}` : ""}${filed[3] ? " Pacific Time" : ""}`;
    put(ctx, "bcRegistrationDate", parseRegistryDate(filed[1]), snippet);
    put(ctx, "bcRegistrationTime", filed[2] ? parseClockTime(filed[2]) : undefined, snippet);
    if (filed[2]) put(ctx, "bcRegistrationTimeZone", PACIFIC, snippet);
  }

  const foreignIndex = findLine(lines, /FOREIGN JURISDICTION INFORMATION/i);
  if (foreignIndex >= 0) {
    for (let index = foreignIndex + 1; index < lines.length && !/HEAD OFFICE/i.test(lines[index]); index++) {
      const row = cells(lines[index]);
      if (row.length >= 2 && /^[A-Z0-9-]{5,15}$/i.test(row[0]) && /\d/.test(row[0])) {
        put(ctx, "homeCorporationNumber", row[0].replace(/[^A-Za-z0-9]/g, ""), `Corporate number assigned by its current jurisdiction: ${row[0]}`);
        put(ctx, "nameInHomeJurisdiction", row.slice(1).join(" "), `Name in the foreign jurisdiction: ${row.slice(1).join(" ")}`);
      }
      const dated = row.length >= 2 ? parseRegistryDate(row[0]) : undefined;
      if (dated && /^[A-Za-z]+\.? \d{1,2},? \d{4}$/.test(row[0])) {
        const label = row.slice(1).join(" ");
        put(ctx, "homeIncorporationDate", dated, `Date of incorporation: ${row[0]}`);
        put(ctx, "homeJurisdictionCode", jurisdictionCodeFor(label), `Current jurisdiction of incorporation: ${label}`);
      }
    }
  }
  if (!ctx.facts.nameInHomeJurisdiction) {
    const homeName = findLine(lines, /Name in (?:Federal|Home|Foreign) Jurisdiction:/i);
    const row = homeName >= 0 ? cells(nextNonEmpty(lines, homeName)?.line ?? "") : [];
    if (row.length) put(ctx, "nameInHomeJurisdiction", row[row.length - 1], `Name in home jurisdiction: ${row[row.length - 1]}`);
  }

  const headIndex = findLine(lines, /HEAD OFFICE (?:INFORMATION|ADDRESS)/i);
  let mailing: RegistryAddress | undefined;
  let delivery: RegistryAddress | undefined;
  if (headIndex >= 0) {
    const mailingLines: string[] = [];
    const deliveryLines: string[] = [];
    for (let index = headIndex + 1; index < lines.length; index++) {
      const line = lines[index].trim();
      if (/Mailing Address:|Delivery Address:/i.test(line)) continue;
      if (!line) {
        if (mailingLines.length) break;
        continue;
      }
      if (/NAME OF ATTORNEY|Page:\s*\d/i.test(line)) break;
      const row = cells(line);
      mailingLines.push(row[0]);
      deliveryLines.push(row[1] ?? row[0]);
    }
    mailing = parseAddressLines(mailingLines);
    delivery = parseAddressLines(deliveryLines);
    if (mailing) put(ctx, "headOfficeMailing", mailing, `Head office mailing address: ${mailingLines.join(", ")}`);
    if (delivery) put(ctx, "headOfficeDelivery", delivery, `Head office delivery address: ${deliveryLines.join(", ")}`);
  }

  const attorneyIndex = findLine(lines, /NAME OF ATTORNEY/i);
  if (attorneyIndex >= 0) {
    const noAttorney = lineWith(lines, /No attorney information/i);
    const headOfficeInBc = [mailing, delivery].some((address) => address?.provinceState === "BC");
    if (noAttorney) {
      put(ctx, "attorney", headOfficeInBc ? { status: "not_required", reason: "Head office is in British Columbia" } : { status: "required" }, noAttorney);
    } else {
      const names: string[] = [];
      for (let index = attorneyIndex + 1; index < lines.length; index++) {
        const line = lines[index].trim();
        if (/Page:\s*\d/i.test(line)) break;
        const first = cells(line)[0];
        if (first && !/address/i.test(first) && !/\d/.test(first)) names.push(first);
      }
      if (names.length) put(ctx, "attorney", { status: "appointed", names }, `Attorney: ${names.join(", ")}`);
    }
  }
  return [number ?? "", matchKey(name ?? ""), mailing ? matchKey(`${mailing.street} ${mailing.postalCode}`) : "", delivery ? matchKey(`${delivery.street} ${delivery.postalCode}`) : ""];
}

function readBcCertificate(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const flat = flatText(lines);
  const number = /Number:\s*(A\d{7})\b/.exec(flat)?.[1];
  if (number) put(ctx, "bcRegistrationNumber", number, `Number: ${number}`);
  const certify = /certify that (.+?) has been registered as an extraprovincial company under the Business Corporations Act on ([A-Za-z]+\.? \d{1,2},? \d{4})(?: at (\d{1,2}:\d{2}\s*[AP]\.?M\.?))?\s*(Pacific)?/i.exec(flat);
  if (certify) {
    const snippet = certify[0];
    put(ctx, "legalName", certify[1], snippet);
    put(ctx, "bcRegistrationDate", parseRegistryDate(certify[2]), snippet);
    if (certify[3]) {
      put(ctx, "bcRegistrationTime", parseClockTime(certify[3]), snippet);
      put(ctx, "bcRegistrationTimeZone", PACIFIC, snippet);
    }
  }
  if (lines.some((line) => /^DUPLICATE$/i.test(line.trim()))) put(ctx, "duplicateCopy", true, "DUPLICATE");
  return [number ?? "", certify ? parseRegistryDate(certify[2]) ?? "" : "", certify?.[3] ?? ""];
}

function readBcReceipt(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const value = (label: RegExp) => sameLineValue(lines, label)?.value;
  const formFiled = value(/^Form Filed:/i);
  const number = /^A\d{7}$/.exec(value(/^Registration Number:/i) ?? "")?.[0];
  if (number) put(ctx, "bcRegistrationNumber", number, `Registration Number: ${number}`);
  const name = value(/^(?:Extraprovincial )?Company Name:/i);
  if (name) put(ctx, "legalName", name, `Company Name: ${name}`);
  const filed = value(/^Filing Date and Time:/i) ?? "";
  const date = parseRegistryDate(filed);
  if (date) {
    put(ctx, "bcRegistrationDate", date, `Filing Date and Time: ${filed}`);
    put(ctx, "bcRegistrationTime", parseClockTime(filed), `Filing Date and Time: ${filed}`);
    if (/Pacific/i.test(filed)) put(ctx, "bcRegistrationTimeZone", PACIFIC, `Filing Date and Time: ${filed}`);
  }
  const fee = money(value(/^Fee:/i));
  const serviceCharge = money(value(/^Service Charge:/i));
  const gst = money(value(/^Service Charge GST:/i));
  const total = money(value(/^Total:/i)) ?? money(value(/^Subtotal:/i)) ?? fee;
  const invoiceNumber = value(/^Payment Invoice Number:/i);
  const transactionId = value(/^Transaction ID:/i);
  if (total) {
    put(ctx, "filingReceipt", {
      payee: "BC Registries",
      description: formFiled ? `${formFiled} filing` : "BC Registries filing",
      amount: total,
      currency: "CAD",
      ...(date ? { date } : {}),
      ...(invoiceNumber ? { invoiceNumber } : {}),
      ...(transactionId ? { transactionId } : {}),
      breakdown: [
        ...(fee ? [{ label: "Fee", amount: fee }] : []),
        ...(serviceCharge ? [{ label: "Service charge", amount: serviceCharge }] : []),
        ...(gst && Number(gst) > 0 ? [{ label: "Service charge GST", amount: gst }] : []),
      ],
    }, `Total: $${total}${invoiceNumber ? ` · Payment Invoice Number: ${invoiceNumber}` : ""}`);
  }
  return [invoiceNumber ?? "", transactionId ?? "", total ?? ""];
}

function readBcCoverSheet(section: ClassifiedSection, ctx: Context): string[] {
  const lines = sectionLines(section);
  const value = (label: RegExp) => sameLineValue(lines, label)?.value;
  const name = value(/^Name of Company:/i);
  if (name) put(ctx, "legalName", name, `Name of Company: ${name}`);
  const number = /^A\d{7}$/.exec(value(/^Registration Number:/i) ?? "")?.[0];
  if (number) put(ctx, "bcRegistrationNumber", number, `Registration Number: ${number}`);
  const filed = value(/^Date and Time of Filing:/i) ?? "";
  const date = parseRegistryDate(filed);
  if (date) {
    put(ctx, "bcRegistrationDate", date, `Date and Time of Filing: ${filed}`);
    put(ctx, "bcRegistrationTime", parseClockTime(filed), `Date and Time of Filing: ${filed}`);
    if (/Pacific/i.test(filed)) put(ctx, "bcRegistrationTimeZone", PACIFIC, `Date and Time of Filing: ${filed}`);
  }
  const listIndex = findLine(lines, /This package contains/i);
  const contents: string[] = [];
  for (let index = listIndex + 1; listIndex >= 0 && index < lines.length; index++) {
    const bullet = /^[•*\-–]\s*(.+)$/.exec(lines[index].trim());
    if (bullet) contents.push(bullet[1]);
    else if (lines[index].trim() && contents.length) break;
  }
  put(ctx, "packageContents", contents, `This package contains: ${contents.join("; ")}`);
  return [number ?? "", ...contents.map(matchKey)];
}

const READERS: Record<RegistrySectionKind, (section: ClassifiedSection, ctx: Context) => string[]> = {
  federal_certificate_of_incorporation: readCertificate,
  federal_articles_of_incorporation: readArticles,
  federal_initial_office_and_directors: readInitialOffice,
  federal_corporation_information_sheet: readInformationSheet,
  federal_initial_isc: readInitialIsc,
  federal_incorporated_email: readIncorporatedEmail,
  federal_incorporation_email: readIncorporationEmail,
  federal_payment_email: readPaymentEmail,
  federal_access_updated_email: readAccessEmail,
  bc_statement_of_registration: readBcStatement,
  bc_certificate_of_registration: readBcCertificate,
  bc_filing_receipt: readBcReceipt,
  bc_cover_sheet: readBcCoverSheet,
};

// ---------------------------------------------------------------------------
// Document

const CATEGORY: Record<RegistryDocumentKind, RegistryDocumentCategory> = {
  federal_certificate_of_incorporation: "CertificateOfIncorporation",
  federal_articles_of_incorporation: "ArticlesOfIncorporation",
  federal_initial_office_and_directors: "Filing",
  federal_corporation_information_sheet: "Filing",
  federal_initial_isc: "Filing",
  federal_incorporated_email: "Correspondence",
  federal_incorporation_email: "Correspondence",
  federal_payment_email: "Receipt",
  federal_access_updated_email: "Correspondence",
  bc_statement_of_registration: "Filing",
  bc_certificate_of_registration: "Filing",
  bc_filing_receipt: "Receipt",
  bc_cover_sheet: "Filing",
  unknown: "Other",
};

function suggestedTitle(kind: RegistryDocumentKind, sections: RegistrySectionKind[], facts: RegistryFacts, fileName?: string): string {
  const name = facts.legalName?.value ?? facts.nameInHomeJurisdiction?.value ?? facts.portalAccess?.value.organizationName;
  const suffix = name ? ` – ${name}` : "";
  const date = facts.payment?.value.date ?? facts.emailDateISO?.value.slice(0, 10);
  switch (kind) {
    case "federal_certificate_of_incorporation": {
      const extras = [sections.includes("federal_articles_of_incorporation") ? "articles" : "", sections.includes("federal_initial_office_and_directors") ? "Form 2" : ""].filter(Boolean);
      return `Certificate of incorporation${extras.length ? ` with ${extras.join(" and ")}` : ""}${suffix}`;
    }
    case "federal_articles_of_incorporation": return `Articles of incorporation (Form 1)${suffix}`;
    case "federal_initial_office_and_directors": return `Initial registered office and first directors (Form 2)${suffix}`;
    case "federal_corporation_information_sheet": return `Corporation information sheet${suffix}`;
    case "federal_initial_isc": return `Initial individuals with significant control${suffix}`;
    case "federal_incorporated_email": return `Business number confirmation email${suffix}`;
    case "federal_incorporation_email": return `Incorporation email from Corporations Canada${suffix}`;
    case "federal_payment_email": return `Corporations Canada payment receipt${date ? ` – ${date}` : ""}`;
    case "federal_access_updated_email": return `Online Filing Centre access update${suffix}`;
    case "bc_statement_of_registration": return `BC statement of registration (Form 33)${suffix}`;
    case "bc_certificate_of_registration": return `BC certificate of registration${facts.duplicateCopy ? " (duplicate copy)" : ""}${suffix}`;
    case "bc_filing_receipt": return `BC Registries filing receipt${suffix}`;
    case "bc_cover_sheet": return `BC extra-provincial registration package${suffix}`;
    case "unknown": return fileName?.replace(/\.[^.]+$/, "") || "Registry document";
  }
}

/** Replace any secret value that slipped into a string (defence in depth for snippets). */
function scrub<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value;
  if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join(SECRET_MASK), value as string) as T;
  if (Array.isArray(value)) return value.map((item) => scrub(item, secrets)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "function" ? item : scrub(item, secrets)])) as T;
  }
  return value;
}

/**
 * Read one registry document's extracted text into typed facts.
 *
 * `text` is `IntakeExtract.text` from `extractBytes` (or any plain text of the
 * document). `fileName` is only echoed back and used as a title fallback.
 * The corporation key comes back only through `secrets[].reveal()`.
 */
export function parseRegistryDocument(text: string, fileName?: string): ParsedRegistryDocument {
  const normalized = normalizeRegistryText(text);
  const classified = classifySections(normalized);
  const facts: RegistryFacts = {};
  const secrets: RegistrySecret[] = [];
  const warnings: string[] = [];
  const sections = classified.map((section) => {
    const parts = READERS[section.kind](section, { facts, section: section.kind, secrets, warnings });
    return { kind: section.kind, confidence: section.confidence, pages: section.pages.map((page) => page.number), signature: hashText(`${section.kind}|${parts.join("|")}`) };
  });
  const { kind, confidence } = documentKindOf(classified);
  if (kind === "unknown") warnings.push("Not recognised as a Corporations Canada or BC Registries document.");
  if (facts.enclosedDocuments && isEmailText(normalized)) warnings.push("Email attachments are not read here. Add the attached PDFs as separate files to import their facts.");

  const secretValues = secrets.map((secret) => secret.reveal());
  const cleanFacts = scrub(facts, secretValues);
  const fingerprintSource = secretValues.reduce((value, secret) => value.split(secret).join(""), normalized).toLowerCase().replace(/\s+/g, " ").trim();
  const sectionKinds = sections.map((section) => section.kind);
  const restricted = sectionKinds.some((section) => section === "federal_corporation_information_sheet" || section === "federal_initial_isc")
    || Boolean(facts.enclosedDocuments?.value.some((document) => /information sheet|significant control/i.test(document)));

  return {
    ...(fileName ? { fileName } : {}),
    kind,
    confidence,
    sections,
    facts: cleanFacts,
    secrets,
    suggestedTitle: scrub(suggestedTitle(kind, sectionKinds, cleanFacts, fileName), secretValues),
    suggestedCategory: CATEGORY[kind],
    restricted,
    fingerprint: `rd-${hashText(fingerprintSource)}`,
    warnings,
  };
}
