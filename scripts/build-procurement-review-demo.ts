/**
 * Builds the demo workspace's published procurement snapshot: a bc-bid-monitor
 * catalog.sqlite with the schema Zoer's plugin catalog and procurement review
 * storage use (zoer/backend/src/plugin-catalog.ts, procurement/schema.ts), filled
 * with fictional notices from BC public buyers as of DEMO_TODAY, packaged exactly
 * as Zoer publishes it (zoer/docs/societyer-review-contract.md §3) into
 * public/demo/procurement-review/. The output is deterministic: the same inputs
 * always produce the same catalog rows, files and manifest.
 *
 *   tsx scripts/build-procurement-review-demo.ts           # write the snapshot
 *   tsx scripts/build-procurement-review-demo.ts --check   # the committed snapshot is intact and current
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { parseSnapshotManifest, snapshotFilePaths, SNAPSHOT_PART_BYTES, type SnapshotManifest } from "../shared/procurementReview/manifest";
import { DEMO_PROCUREMENT_REVIEW_DIRECTORY } from "../shared/procurementReview/demo";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type SqlParameter = string | number | null;

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "public", ...DEMO_PROCUREMENT_REVIEW_DIRECTORY.split("/").filter(Boolean));

/** "Today" for every relative date in the demo (America/Vancouver). */
const DEMO_TODAY = "2026-10-18";
const PUBLISHED_AT = "2026-10-18T15:00:00.000Z";
const PLUGIN_VERSION = "0.35.3";
const LATEST_RUN = "run-20261018-collect";
const PREVIOUS_RUN = "run-20261011-collect";
const COLLECTED_AT = "2026-10-18T13:40:12.000Z";
const PREVIOUS_COLLECTED_AT = "2026-10-11T13:38:47.000Z";
const MODEL = "claude-haiku-4-5";
const PROFILE_ID = "profile-riverside";
const PROFILE_VERSION_ID = "pv-riverside-1";
const OWNER = "Mina Patel";
const REVIEWER = "Avery Santos";

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const shortId = (...parts: string[]) => sha256(parts.join("\u0000")).slice(0, 16);
const json = (value: Json) => JSON.stringify(value);

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
const daysFromToday = (days: number) => addDays(DEMO_TODAY, days);
/** Pacific time: daylight time ends on 2026-11-01. */
const pacificOffset = (date: string) => (date >= "2026-11-01" ? "-08:00" : "-07:00");
const pacificZone = (date: string) => (date >= "2026-11-01" ? "PST" : "PDT");
function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}
function clock(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
const instant = (date: string, time: string) => `${date}T${time}:00${pacificOffset(date)}`;
/** A UTC timestamp `days` from DEMO_TODAY at a Pacific wall-clock time. */
const stamp = (days: number, time = "09:00") => new Date(instant(daysFromToday(days), time)).toISOString();

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

type SourceId = "bc-bid" | "canadabuys" | "bidsandtenders" | "municipal-sites";
type Place = { municipality: string | null; regionalDistrict: string | null; method: "portal" | "buyer" | "description" | "source-region" };
type Contact = { name: string; email: string; phone?: string; role?: string };

type NoticeSpec = {
  /** Short handle the rest of this file refers to the notice by. */
  key: string;
  source: SourceId;
  /** bids&tenders or municipal website portal id. */
  portal?: string;
  number: string;
  title: string;
  buyer: string;
  type: string;
  closesIn: number;
  closingTime?: string;
  status?: string;
  place?: Place;
  category: string;
  summary: string;
  contact?: Contact;
  /** Attachment names; null means attachment discovery hasn't run for the notice yet. */
  attachments?: string[] | null;
  publishedDaysAgo: number;
  starred?: boolean;
  /** Seen first by the latest collection run (otherwise also by the previous one). */
  isNew?: boolean;
};

const METRO = "Metro Vancouver Regional District";
const place = (municipality: string | null, regionalDistrict: string | null, method: Place["method"]): Place => ({ municipality, regionalDistrict, method });

const PORTALS: Record<string, { label: string; host: string; url: string; place: Place }> = {
  burnaby: { label: "City of Burnaby", host: "burnaby.bidsandtenders.ca", url: "https://burnaby.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Burnaby", METRO, "portal") },
  richmond: { label: "City of Richmond", host: "richmond.bidsandtenders.ca", url: "https://richmond.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Richmond", METRO, "portal") },
  surrey: { label: "City of Surrey", host: "surrey.bidsandtenders.ca", url: "https://surrey.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Surrey", METRO, "portal") },
  metrovancouver: { label: "Metro Vancouver", host: "metrovancouver.bidsandtenders.ca", url: "https://metrovancouver.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place(null, METRO, "portal") },
  coquitlam: { label: "City of Coquitlam", host: "coquitlam.bidsandtenders.ca", url: "https://coquitlam.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Coquitlam", METRO, "portal") },
  nanaimo: { label: "City of Nanaimo", host: "nanaimo.bidsandtenders.ca", url: "https://nanaimo.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Nanaimo", "Regional District of Nanaimo", "portal") },
  princegeorge: { label: "City of Prince George", host: "princegeorge.bidsandtenders.ca", url: "https://princegeorge.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Prince George", "Regional District of Fraser-Fort George", "portal") },
  abbotsford: { label: "City of Abbotsford", host: "abbotsford.bidsandtenders.ca", url: "https://abbotsford.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Abbotsford", "Fraser Valley Regional District", "portal") },
  dnv: { label: "District of North Vancouver", host: "dnv.bidsandtenders.ca", url: "https://dnv.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("North Vancouver (District)", METRO, "portal") },
  portmoody: { label: "City of Port Moody", host: "portmoody.bidsandtenders.ca", url: "https://portmoody.bidsandtenders.ca/Module/Tenders/en/Home/BidsHomepage", place: place("Port Moody", METRO, "portal") },
  penticton: { label: "City of Penticton", host: "www.penticton.ca", url: "https://www.penticton.ca/business-building/bid-opportunities/open-bid-opportunities", place: place("Penticton", "Regional District of Okanagan-Similkameen", "portal") },
  rdn: { label: "Regional District of Nanaimo", host: "rdn.bc.ca", url: "https://rdn.bc.ca/current-bid-opportunities", place: place(null, "Regional District of Nanaimo", "portal") },
  courtenay: { label: "City of Courtenay", host: "www.courtenay.ca", url: "https://www.courtenay.ca/business-and-building/business-resources/doing-business-city/bid-opportunities", place: place("Courtenay", "Comox Valley Regional District", "portal") },
  saanich: { label: "District of Saanich", host: "www.saanich.ca", url: "https://www.saanich.ca/EN/main/business/selling-to-saanich/bid-opportunities.html", place: place("Saanich", "Capital Regional District", "portal") },
  fvrd: { label: "Fraser Valley Regional District", host: "www.fvrd.ca", url: "https://www.fvrd.ca/EN/main/government/tenders-rfps.html", place: place(null, "Fraser Valley Regional District", "portal") },
  quesnel: { label: "City of Quesnel", host: "www.quesnel.ca", url: "https://www.quesnel.ca/business-services/doing-business-city/bid-opportunities", place: place("Quesnel", "Cariboo Regional District", "portal") },
  comox: { label: "Town of Comox", host: "www.comox.ca", url: "https://www.comox.ca/opportunities", place: place("Comox", "Comox Valley Regional District", "portal") },
};

const NOTICES: NoticeSpec[] = [
  // BC Bid: provincial ministries, Crown corporations and agencies.
  { key: "sdpr-engagement", source: "bc-bid", number: "SDPR-2026-RFP-0147", title: "Community Engagement and Facilitation Services for Poverty Reduction Strategy Renewal", buyer: "Ministry of Social Development and Poverty Reduction", type: "Request for Proposals", closesIn: 12, closingTime: "14:00", category: "Consulting Services - Public Engagement", publishedDaysAgo: 16, starred: true,
    summary: "The Ministry is seeking a qualified proponent to design and deliver in-person and online engagement sessions with people with lived experience of poverty, community organizations and local governments across four regions. Work includes accessible session design, facilitation, honoraria administration and a what-we-heard report.",
    contact: { name: "Priya Natarajan", email: "procurement.sdpr@example.gov.bc.ca", role: "Procurement Specialist" }, attachments: ["RFP SDPR-2026-RFP-0147.pdf", "Appendix C - Pricing Form.pdf"] },
  { key: "mcfd-mentorship", source: "bc-bid", number: "MCFD-2026-RFP-0312", title: "Youth Mentorship Program Delivery - Lower Mainland", buyer: "Ministry of Children and Family Development", type: "Request for Proposals", closesIn: 2, closingTime: "14:00", category: "Social Services - Youth Programs", publishedDaysAgo: 24, starred: true,
    place: place(null, METRO, "description"),
    summary: "Delivery of a one-to-one and group mentorship program for youth aged 12 to 18 in the Lower Mainland, including mentor recruitment, screening, training and match support, with quarterly outcome reporting to the Ministry.",
    contact: { name: "Daniel Oduya", email: "mcfd.contracts@example.gov.bc.ca" }, attachments: ["RFP MCFD-2026-RFP-0312.pdf"] },
  { key: "bch-tenant-support", source: "bc-bid", number: "BCH-2026-0588", title: "Tenant Support Services - Mount Pleasant Supportive Housing", buyer: "BC Housing Management Commission", type: "Request for Proposals", closesIn: 9, closingTime: "15:00", category: "Social Services - Housing Supports", publishedDaysAgo: 20,
    place: place("Vancouver", METRO, "description"),
    summary: "BC Housing invites proposals from non-profit operators to provide 24/7 tenant support services at a 52-unit supportive housing building in Mount Pleasant, Vancouver. Services include meal programs, life-skills support, referrals and community integration activities.",
    contact: { name: "Helena Brandt", email: "bchousing.procurement@example.ca", phone: "604-555-0148" }, attachments: ["RFP BCH-2026-0588.pdf", "Addendum 1.pdf"] },
  { key: "educ-language", source: "bc-bid", number: "ECC-2026-RFP-0091", title: "Indigenous Language Revitalization Learning Resource Development", buyer: "Ministry of Education and Child Care", type: "Request for Proposals", closesIn: 25, closingTime: "14:00", category: "Consulting Services - Curriculum Development", publishedDaysAgo: 9, isNew: true,
    summary: "Development of K-12 learning resources supporting Indigenous language revitalization, co-developed with First Nations language authorities. The successful proponent will coordinate community review and produce print and digital materials." },
  { key: "moti-hwy99", source: "bc-bid", number: "MOTI-2026-ITT-4471", title: "Highway 99 Shoulder Widening - Squamish Section", buyer: "Ministry of Transportation and Transit", type: "Invitation to Tender", closesIn: 6, closingTime: "11:00", category: "Construction - Highways", publishedDaysAgo: 30,
    place: place("Squamish", "Squamish-Lillooet Regional District", "description"),
    summary: "Shoulder widening, drainage improvements and guardrail replacement on 3.2 km of Highway 99 near Squamish. Bidders must hold a valid prequalification with the Ministry for highway construction.",
    attachments: ["Tender Documents.pdf", "Drawings Set.pdf"] },
  { key: "for-wildfire", source: "bc-bid", number: "FOR-2026-RFQ-2203", title: "Wildfire Risk Reduction Community Outreach - Cariboo", buyer: "Ministry of Forests", type: "Request for Quotations", closesIn: 1, closingTime: "14:00", category: "Consulting Services - Public Engagement", publishedDaysAgo: 12,
    place: place(null, "Cariboo Regional District", "description"),
    summary: "Plan and deliver FireSmart neighbourhood outreach events in five Cariboo communities, including printed materials, volunteer coordination and an attendance and feedback summary." },
  { key: "dbc-visitor-survey", source: "bc-bid", number: "DBC-2026-RFP-0033", title: "Regional Tourism Visitor Survey 2027", buyer: "Destination BC", type: "Request for Proposals", closesIn: 18, closingTime: "14:00", category: "Research Services - Surveys", publishedDaysAgo: 11,
    summary: "Design, field and analyze an intercept and online visitor survey across six tourism regions during the 2027 summer season, with regional dashboards and a provincial summary report." },
  { key: "hlth-peer-eval", source: "bc-bid", number: "HLTH-2026-RFP-0219", title: "Peer Support Network Evaluation Services", buyer: "Ministry of Health", type: "Request for Proposals", closesIn: -5, closingTime: "14:00", status: "Closed", category: "Research Services - Program Evaluation", publishedDaysAgo: 40,
    summary: "A developmental evaluation of the provincial peer support network, including interviews with peer workers, a survey of participating agencies and recommendations for sustainable funding." },
  { key: "transit-rider", source: "bc-bid", number: "BCT-2026-RFP-1102", title: "Accessible Transit Rider Engagement Sessions", buyer: "BC Transit", type: "Request for Proposals", closesIn: 0, closingTime: "14:00", category: "Consulting Services - Public Engagement", publishedDaysAgo: 21,
    summary: "Facilitated engagement sessions with riders who use mobility aids, are blind or partially sighted, or are Deaf or hard of hearing, to inform BC Transit's accessibility plan update." },
  { key: "cits-digital", source: "bc-bid", number: "CITZ-2026-RFQ-0457", title: "Digital Literacy Workshops for Seniors - Pilot", buyer: "Ministry of Citizens' Services", type: "Request for Quotations", closesIn: 3, closingTime: "14:00", category: "Training Services - Community Education", publishedDaysAgo: 14,
    summary: "Deliver twelve hands-on digital literacy workshops for seniors at public libraries and community centres, covering online safety, government services online and video calling with family." },
  { key: "ag-justice", source: "bc-bid", number: "AG-2026-RFP-0628", title: "Community Justice Program Facilitation - Northern BC", buyer: "Ministry of Attorney General", type: "Request for Proposals", closesIn: 30, closingTime: "14:00", category: "Social Services - Restorative Justice", publishedDaysAgo: 5, isNew: true,
    place: place("Prince George", "Regional District of Fraser-Fort George", "description"),
    summary: "Facilitation of restorative justice circles and volunteer training for community justice programs serving Prince George and surrounding communities." },
  { key: "emcr-prep", source: "bc-bid", number: "EMCR-2026-RFP-0074", title: "Neighbourhood Emergency Preparedness Training Delivery", buyer: "Ministry of Emergency Management and Climate Readiness", type: "Request for Proposals", closesIn: 14, closingTime: "14:00", category: "Training Services - Emergency Preparedness", publishedDaysAgo: 10, starred: true,
    summary: "Deliver neighbourhood-level emergency preparedness workshops for renters, seniors and newcomers in urban centres, in at least three languages besides English, with take-home preparedness kits.",
    contact: { name: "Grace Liu", email: "emcr.procurement@example.gov.bc.ca" }, attachments: ["RFP EMCR-2026-RFP-0074.pdf", "Appendix B - Workshop Curriculum Outline.pdf"] },
  { key: "moti-janitorial", source: "bc-bid", number: "MOTI-2026-ITQ-3390", title: "Janitorial Services - Burnaby District Office", buyer: "Ministry of Transportation and Transit", type: "Invitation to Quote", closesIn: -12, closingTime: "11:00", status: "Closed", category: "Facility Services - Janitorial", publishedDaysAgo: 41,
    place: place("Burnaby", METRO, "description"),
    summary: "Nightly janitorial services for the Burnaby district office, approximately 1,800 square metres, for a two-year term with one optional one-year extension." },
  { key: "sdpr-navigator", source: "bc-bid", number: "SDPR-2026-RFP-0139", title: "Income Assistance Navigator Services - Surrey", buyer: "Ministry of Social Development and Poverty Reduction", type: "Request for Proposals", closesIn: -2, closingTime: "14:00", status: "Closed", category: "Social Services - Community Navigation", publishedDaysAgo: 33,
    place: place("Surrey", METRO, "description"),
    summary: "Community-based navigators who help people apply for income and disability assistance and connect with other services, delivered from two Surrey community hubs." },
  { key: "rbcm-codesign", source: "bc-bid", number: "RBCM-2026-RFP-0012", title: "Community Exhibit Co-Design Facilitation", buyer: "Royal BC Museum", type: "Request for Proposals", closesIn: 40, closingTime: "14:00", category: "Consulting Services - Public Engagement", publishedDaysAgo: 3, isNew: true,
    place: place("Victoria", "Capital Regional District", "buyer"),
    summary: "Facilitate a co-design process with community groups across the province for a travelling exhibit about neighbourhood histories, including workshops, story collection and consent management." },
  { key: "hma-plain-language", source: "bc-bid", number: "HMA-2026-RFQ-0215", title: "Tenant Rights Education Materials - Plain Language and Translation", buyer: "Ministry of Housing and Municipal Affairs", type: "Request for Quotations", closesIn: 8, closingTime: "14:00", category: "Communications Services - Plain Language", publishedDaysAgo: 13,
    summary: "Rewrite residential tenancy education materials in plain language and translate them into Punjabi, Simplified Chinese, Traditional Chinese, Tagalog, Arabic and Spanish, with community testing of the drafts." },

  // CanadaBuys: federal buyers delivering in British Columbia.
  { key: "esdc-seniors", source: "canadabuys", number: "cb-411-72330145", title: "New Horizons for Seniors Program - Community Outreach Facilitation (BC/Yukon)", buyer: "Employment and Social Development Canada", type: "Request for Proposal", closesIn: 21, closingTime: "14:00", category: "Services", publishedDaysAgo: 15, starred: true,
    summary: "ESDC requires facilitation services to deliver information sessions for seniors' organizations in British Columbia and Yukon about the New Horizons for Seniors Program, and to collect feedback on application barriers.",
    contact: { name: "Marc-André Pelletier", email: "nc-solicitations-gd@example.gc.ca" }, attachments: ["Statement of Work.pdf"] },
  { key: "pch-events", source: "canadabuys", number: "cb-207-72411893", title: "Official Languages Community Event Coordination - Vancouver", buyer: "Canadian Heritage", type: "Request for Quotation", closesIn: 5, closingTime: "14:00", category: "Services", publishedDaysAgo: 18,
    summary: "Coordinate three bilingual community events in Vancouver celebrating official language minority communities, including venue logistics, accessibility, volunteer coordination and post-event reporting." },
  { key: "phac-mental-health", source: "canadabuys", number: "cb-389-72298874", title: "Community-Based Mental Health Promotion Evaluation - Pacific Region", buyer: "Public Health Agency of Canada", type: "Request for Proposal", closesIn: 11, closingTime: "14:00", category: "Services", publishedDaysAgo: 19,
    summary: "Evaluate five community-based mental health promotion projects funded in the Pacific Region, using mixed methods that centre the experience of participants and community partners." },
  { key: "ircc-settlement", source: "canadabuys", number: "cb-152-72450021", title: "Settlement Services Needs Assessment - Lower Mainland", buyer: "Immigration, Refugees and Citizenship Canada", type: "Request for Proposal", closesIn: 2, closingTime: "14:00", category: "Services", publishedDaysAgo: 26,
    summary: "Assess unmet settlement service needs of newcomers in the Lower Mainland, including focus groups in at least five languages and a gap analysis against current funded services." },
  { key: "pspc-interpretation", source: "canadabuys", number: "cb-063-72401177", title: "Interpretation Services (Punjabi, Mandarin, Cantonese) - Pacific Region Standing Offer", buyer: "Public Services and Procurement Canada", type: "Request for Standing Offer", closesIn: 33, closingTime: "14:00", category: "Services", publishedDaysAgo: 8, isNew: true,
    summary: "Regional individual standing offers for consecutive and simultaneous interpretation in Punjabi, Mandarin and Cantonese for federal departments in British Columbia. Interpreters must hold accreditation from a recognized body." },
  { key: "pc-interpretive", source: "canadabuys", number: "cb-298-72177340", title: "Pacific Rim Visitor Centre Interpretive Programming", buyer: "Parks Canada", type: "Request for Proposal", closesIn: -9, closingTime: "14:00", status: "Expired", category: "Services", publishedDaysAgo: 44,
    summary: "Seasonal interpretive programming at the Pacific Rim visitor centre, co-developed with the Nuu-chah-nulth Nations, for the 2027 and 2028 seasons." },
  { key: "dfo-shoreline", source: "canadabuys", number: "cb-341-72366702", title: "Community Shoreline Cleanup Coordination - Fraser River Estuary", buyer: "Fisheries and Oceans Canada", type: "Request for Quotation", closesIn: 16, closingTime: "14:00", category: "Services", publishedDaysAgo: 12,
    summary: "Recruit and coordinate volunteer shoreline cleanups along the Fraser River estuary, including safety briefings, waste sorting and data collection on debris types." },
  { key: "isc-land-based", source: "canadabuys", number: "cb-176-72420559", title: "Youth Land-Based Learning Program Evaluation - BC Region", buyer: "Indigenous Services Canada", type: "Request for Proposal", closesIn: 27, closingTime: "14:00", category: "Services", publishedDaysAgo: 7, isNew: true,
    summary: "Evaluate land-based learning programs for First Nations youth in British Columbia, working with participating communities on culturally grounded evaluation methods." },

  // bids&tenders: municipalities and regional districts.
  { key: "burnaby-instructors", source: "bidsandtenders", portal: "burnaby", number: "RFQ-26-147", title: "Community Centre Program Instructors - Winter 2027 Session", buyer: "City of Burnaby", type: "Request for Quotation", closesIn: 4, closingTime: "15:00", category: "Recreation Services", publishedDaysAgo: 17,
    summary: "Contract instructors for arts, fitness and life-skills programs at Burnaby community centres for the January to March 2027 session. Proponents may quote on one or more program streams.",
    attachments: ["RFQ-26-147 Document.pdf", "Program Schedule Drawings.pdf"] },
  { key: "richmond-food", source: "bidsandtenders", portal: "richmond", number: "RFP-26-0412", title: "Food Security Strategy Engagement Consultant", buyer: "City of Richmond", type: "Request for Proposal", closesIn: 13, closingTime: "15:00", category: "Consulting Services", publishedDaysAgo: 15, starred: true,
    summary: "The City of Richmond requires a consultant to lead community engagement for its first Food Security Strategy, including pop-up engagement at food banks and markets, a community survey and a summary of what was heard.",
    contact: { name: "Kevin Choi", email: "purchasing@example.richmond.ca", role: "Buyer" }, attachments: ["RFP-26-0412 Food Security Strategy.pdf"] },
  { key: "surrey-dropin", source: "bidsandtenders", portal: "surrey", number: "1220-030-2026-061", title: "Youth Drop-In Program Operator - Guildford", buyer: "City of Surrey", type: "Request for Proposal", closesIn: 19, closingTime: "15:00", category: "Recreation Services", publishedDaysAgo: 10,
    summary: "Operate an after-school youth drop-in program three evenings a week at the Guildford recreation centre, including staffing, programming and monthly attendance reporting." },
  { key: "metro-housing-survey", source: "bidsandtenders", portal: "metrovancouver", number: "RFP 26-189", title: "Regional Affordable Housing Survey Fieldwork", buyer: "Metro Vancouver", type: "Request for Proposal", closesIn: 10, closingTime: "15:00", category: "Research Services", publishedDaysAgo: 16,
    summary: "Field a regional household survey on housing affordability, with intercept sampling in under-represented neighbourhoods and translation into six languages." },
  { key: "coquitlam-seniors", source: "bidsandtenders", portal: "coquitlam", number: "RFQ 26-58", title: "Seniors' Wellness Program Delivery", buyer: "City of Coquitlam", type: "Request for Quotation", closesIn: 1, closingTime: "14:00", category: "Recreation Services", publishedDaysAgo: 22,
    summary: "Deliver weekly wellness programs for seniors, including gentle fitness, social lunches and health talks, at two Coquitlam community centres from January to June 2027." },
  { key: "nanaimo-outreach", source: "bidsandtenders", portal: "nanaimo", number: "4422", title: "Downtown Outreach Services", buyer: "City of Nanaimo", type: "Request for Proposal", closesIn: 7, closingTime: "15:00", category: "Social Services", publishedDaysAgo: 19,
    summary: "Street outreach services in downtown Nanaimo connecting people experiencing homelessness with housing, health and income supports, coordinated with the City's community safety team." },
  { key: "pg-warming", source: "bidsandtenders", portal: "princegeorge", number: "RFP-2026-118", title: "Winter Warming Centre Operations 2026-2027", buyer: "City of Prince George", type: "Request for Proposal", closesIn: -3, closingTime: "14:00", status: "Closed", category: "Social Services", publishedDaysAgo: 35,
    summary: "Operate an overnight winter warming centre from November 2026 to March 2027, including staffing, meals and coordination with local shelters." },
  { key: "abbotsford-paving", source: "bidsandtenders", portal: "abbotsford", number: "ITT-26-071", title: "Asphalt Paving Program 2027", buyer: "City of Abbotsford", type: "Invitation to Tender", closesIn: 23, closingTime: "14:00", category: "Construction", publishedDaysAgo: 6, isNew: true,
    summary: "Supply and placement of asphalt for the City's 2027 road rehabilitation program, approximately 38,000 tonnes across 22 locations." },
  { key: "dnv-gardens", source: "bidsandtenders", portal: "dnv", number: "RFQ-2026-44", title: "Community Garden Coordination Services", buyer: "District of North Vancouver", type: "Request for Quotation", closesIn: 15, closingTime: "15:00", category: "Parks Services", publishedDaysAgo: 9,
    summary: "Coordinate plot allocation, volunteer work parties and gardening workshops at four community gardens for the 2027 growing season." },
  { key: "portmoody-grants", source: "bidsandtenders", portal: "portmoody", number: "RFP-26-09", title: "Arts and Culture Grant Program Review", buyer: "City of Port Moody", type: "Request for Proposal", closesIn: -15, closingTime: "15:00", status: "Closed", category: "Consulting Services", publishedDaysAgo: 48,
    summary: "Review the City's arts and culture grant programs, benchmark against comparable municipalities and recommend changes to eligibility, intake and reporting." },

  // Municipal websites outside BC Bid and bids&tenders.
  { key: "penticton-safety", source: "municipal-sites", portal: "penticton", number: "RFP 2026-PRS-17", title: "Community Safety Plan Engagement Services", buyer: "City of Penticton", type: "RFP", closesIn: 6, closingTime: "14:00", category: "Consulting", publishedDaysAgo: 18,
    summary: "Engagement services to inform the City's community safety plan, including sessions with residents, businesses, service providers and people with lived experience." },
  { key: "rdn-transit", source: "municipal-sites", portal: "rdn", number: "RFQ No. 26-031", title: "Rural Transit Rider Survey", buyer: "Regional District of Nanaimo", type: "RFQ", closesIn: 12, closingTime: "15:00", category: "Research", publishedDaysAgo: 14,
    summary: "Design and conduct an on-board and online survey of rural transit riders in Electoral Areas A, B and H, with a short findings report." },
  { key: "courtenay-pit", source: "municipal-sites", portal: "courtenay", number: "RFP 2026-12", title: "Homelessness Point-in-Time Count Coordination", buyer: "City of Courtenay", type: "RFP", closesIn: 3, closingTime: "14:00", category: "Social Services", publishedDaysAgo: 20,
    summary: "Coordinate the Comox Valley point-in-time homelessness count, including volunteer recruitment and training, survey logistics and a community report." },
  { key: "saanich-placemaking", source: "municipal-sites", portal: "saanich", number: "RFP 26-0137", title: "Neighbourhood Placemaking Facilitation", buyer: "District of Saanich", type: "RFP", closesIn: 28, closingTime: "14:00", category: "Consulting", publishedDaysAgo: 4, isNew: true,
    summary: "Facilitate resident-led placemaking projects in three neighbourhoods, from idea workshops to small installations, with a toolkit the District can reuse." },
  { key: "fvrd-ess", source: "municipal-sites", portal: "fvrd", number: "FVRD-RFQ-2026-19", title: "Emergency Support Services Volunteer Training", buyer: "Fraser Valley Regional District", type: "RFQ", closesIn: -7, closingTime: "14:00", status: "Closed", category: "Training", publishedDaysAgo: 38,
    summary: "Deliver Emergency Support Services volunteer training sessions in Hope, Boston Bar and Harrison Hot Springs." },
  { key: "quesnel-youth", source: "municipal-sites", portal: "quesnel", number: "2026-RFP-09", title: "Youth Employment Skills Program", buyer: "City of Quesnel", type: "RFP", closesIn: 17, closingTime: "14:00", category: "Social Services", publishedDaysAgo: 6, isNew: true, attachments: null,
    summary: "Deliver a ten-week employment skills program for youth aged 16 to 24, including job readiness workshops, employer site visits and paid work placements." },
  { key: "comox-janitorial", source: "municipal-sites", portal: "comox", number: "2026-T-08", title: "Facility Janitorial Services", buyer: "Town of Comox", type: "Tender", closesIn: 9, closingTime: "14:00", category: "Facility Services", publishedDaysAgo: 11, attachments: null,
    summary: "Janitorial services for the Town hall, community centre and public works yard for a three-year term." },
];

const recordIdOf = new Map<string, string>();
const specOf = new Map<string, NoticeSpec>();

function bidsAndTendersClosing(date: string, time: string) {
  const { year, month, day, weekday } = parts(date);
  return `${WEEKDAYS[weekday]} ${MONTHS[month - 1].slice(0, 3)} ${day}, ${year} ${clock(time)} (${pacificZone(date)})`;
}
function municipalClosing(date: string, time: string) {
  const { year, month, day } = parts(date);
  return `${MONTHS[month - 1]} ${day}, ${year} at ${clock(time)}`;
}

/** One opportunity record's `data`, shaped like the collector for its source writes it. */
function noticeData(spec: NoticeSpec): { sourceKey: string; data: JsonObject; updatedAt: string } {
  const closingDay = daysFromToday(spec.closesIn);
  const time = spec.closingTime ?? "14:00";
  const status = spec.status ?? "Open";
  const publishedDay = daysFromToday(-spec.publishedDaysAgo);
  const contacts: Json = spec.contact ? [{ ...spec.contact, source: spec.source === "canadabuys" ? "csv" : "detail-field" }] : [];
  const retrievedAt = COLLECTED_AT;
  const common: JsonObject = { description: spec.title, descriptionText: spec.summary, status, type: spec.type, issuedBy: spec.buyer, starred: spec.starred === true, lastRunId: LATEST_RUN };
  const placeFields = (value: Place | undefined): JsonObject => {
    if (!value) return {};
    const label = value.municipality ?? value.regionalDistrict;
    return { place: value, ...(label ? { region: label.replace(/^Regional District of /, "").replace(/ Regional District$/, "") } : {}) };
  };
  const attachmentsFor = (detailUrl: string): Json[] => (spec.attachments ?? []).map((name, index) => ({ name, url: `${detailUrl}/documents/${index + 1}/${encodeURIComponent(name)}` }));

  if (spec.source === "bc-bid") {
    const processId = String(210000 + Number.parseInt(sha256(spec.number).slice(0, 6), 16) % 40000);
    const detailUrl = `https://bcbid.gov.bc.ca/page.aspx/en/bpm/process_manage_extranet/${processId}`;
    const detailFields: Json[] = [
      { label: "Opportunity ID", value: spec.number },
      { label: "Status", value: status },
      { label: "Opportunity Type", value: spec.type },
      { label: "Issued by", value: spec.buyer },
      { label: "Issue Date", value: `${publishedDay} 9:00:00 AM (Pacific)` },
      { label: "Closing Date", value: `${closingDay} ${clock(time).replace(" ", ":00 ")} (Pacific)` },
      { label: "Commodities", value: spec.category },
    ];
    return {
      sourceKey: processId,
      updatedAt: retrievedAt,
      data: {
        ...common,
        sourceKey: processId, processId, opportunityId: spec.number,
        listingUrl: "https://bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public", detailUrl,
        commodities: [spec.category], mainCommodity: spec.category, issueDate: publishedDay, closingDate: closingDay,
        endsIn: spec.closesIn > 0 ? `${spec.closesIn} day${spec.closesIn === 1 ? "" : "s"}` : null,
        amendments: spec.key === "bch-tenant-support" ? 1 : 0, lastUpdated: daysFromToday(spec.key === "bch-tenant-support" ? -2 : -spec.publishedDaysAgo),
        issuedFor: spec.buyer, interestedVendorList: false, sourceCapturedAt: retrievedAt,
        detailFields, addenda: spec.key === "bch-tenant-support" ? [{ title: "Addendum 1 - Insurance requirements and site visit", date: daysFromToday(-2), link: `${detailUrl}/documents/2/Addendum%201.pdf` }] : [],
        attachments: attachmentsFor(detailUrl),
        searchText: [spec.number, spec.title, spec.summary, spec.buyer, status, spec.type, spec.category].join(" "),
        ...placeFields(spec.place), ...(spec.place ? { regionFromPlace: true } : {}),
        ...(spec.contact ? { contacts } : {}),
      },
    };
  }

  if (spec.source === "canadabuys") {
    const sourceKey = `canadabuys:tender:${encodeURIComponent(spec.number)}:000`;
    // The CSV's closing date is a zone-less local time ("2026-10-20T14:00:00");
    // Zoer's collector keeps it as the source value and adds `closingAt` in the
    // dataset's documented UTC-05:00 (canadaBuysClosingAt in source-adapters.ts).
    const closingDate = `${closingDay}T${time}:00`;
    const sourceFileName = "openTenderNotice-ouvertAvisAppelOffres.csv";
    const sourceFields: Json[] = [
      { label: "Source", value: "CanadaBuys" }, { label: "Reference", value: spec.number }, { label: "Amendment", value: "000" },
      { label: "Issued by", value: spec.buyer }, { label: "Status", value: status }, { label: "Type", value: spec.type },
      { label: "Closing date (source value)", value: closingDate }, { label: "Published (source value)", value: publishedDay },
      { label: "Regions", value: "British Columbia" }, { label: "Category", value: spec.category },
    ];
    return {
      sourceKey,
      updatedAt: "2026-10-18T13:05:00.000Z",
      data: {
        ...common,
        sourceId: "canadabuys", sourceKey, processId: sourceKey, opportunityId: sourceKey, externalId: spec.number,
        closingDate, closingAt: `${closingDate}-05:00`, detailUrl: `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${spec.number}`,
        sourceUrl: "https://canadabuys.canada.ca/en/tender-opportunities",
        sourceFileName, sourceFileSha256: sha256(`${sourceFileName}:2026-10-18`), importedAt: "2026-10-18T13:05:00.000Z",
        sourceRetrievedAt: "2026-10-18T13:05:00.000Z", sourceLastModified: "Sun, 18 Oct 2026 11:02:00 GMT",
        sourceClosingTimezone: "UTC-05:00", sourceTimezoneDocumentation: "https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/soutien-support-eng.html",
        region: "British Columbia", category: spec.category, sourceCategory: spec.category,
        classificationCodes: [{ scheme: "GSIN", code: spec.key === "pspc-interpretation" ? "R109C" : "R019BF" }],
        detailFields: sourceFields, sourceFields, sourceDescriptionText: spec.summary,
        attachments: attachmentsFor(`https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${spec.number}`), addenda: [], commodities: [],
        searchText: [spec.number, spec.title, spec.summary, spec.buyer, status, spec.type, "British Columbia", spec.category].join(" "),
        ...(spec.contact ? { contacts } : {}),
      },
    };
  }

  const portal = PORTALS[spec.portal ?? ""];
  if (!portal) throw new Error(`Unknown portal for ${spec.key}`);
  const noticeId = shortId(spec.source, spec.portal ?? "", spec.number);
  const sourceKey = `${spec.source}:${spec.portal}:${noticeId}`;
  const bidsAndTenders = spec.source === "bidsandtenders";
  const closingDate = bidsAndTenders ? bidsAndTendersClosing(closingDay, time) : municipalClosing(closingDay, time);
  const detailUrl = bidsAndTenders
    ? `https://${portal.host}/Module/Tenders/en/Tender/Detail/${noticeId}`
    : `${portal.url}#${encodeURIComponent(spec.number)}`;
  const sourceFields: Json[] = [
    { label: "Source", value: bidsAndTenders ? "bids&tenders" : `${portal.label} website` },
    { label: bidsAndTenders ? "Bid number" : "Notice number", value: spec.number },
    { label: "Status", value: status },
    ...(bidsAndTenders ? [{ label: "Bid scope", value: spec.summary.split(". ")[0] }] : [{ label: "Type", value: spec.type }]),
    { label: "Closing date (source value)", value: closingDate },
    { label: "Posted (source value)", value: bidsAndTenders ? bidsAndTendersClosing(publishedDay, "09:00") : municipalClosing(publishedDay, "09:00") },
  ];
  return {
    sourceKey,
    updatedAt: retrievedAt,
    data: {
      ...common,
      sourceId: spec.source, sourceKey, processId: sourceKey, opportunityId: sourceKey, portalId: spec.portal ?? "",
      externalId: spec.number, sourceDescriptionText: spec.summary,
      closingDate, closingAt: instant(closingDay, time), publishedAt: instant(publishedDay, "09:00"),
      detailUrl, sourceUrl: portal.url, region: portal.place.municipality ?? portal.place.regionalDistrict, place: portal.place,
      category: spec.category, sourceCategory: spec.category,
      sourceFields, documentsCount: spec.attachments?.length ?? 0, addendaCount: 0, sourceRetrievedAt: retrievedAt,
      rawSourceData: { id: noticeId, number: spec.number, title: spec.title, status },
      searchText: [spec.number, spec.title, spec.summary, portal.label, status, spec.type, portal.place.municipality ?? portal.place.regionalDistrict, spec.category].join(" "),
      ...(spec.attachments === null ? {} : { attachments: attachmentsFor(detailUrl), addenda: [] }),
      detailFields: [], commodities: [],
      ...(spec.contact ? { contacts } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Contract awards (BC Bid award history)
// ---------------------------------------------------------------------------

type AwardSpec = { opportunityId: string | null; description: string; type: string; organization: string; location: string; contractNumber: string; value: number; supplier: string; supplierAddress: string; awardedDaysAgo: number; justification?: string };

const AWARDS: AwardSpec[] = [
  { opportunityId: "HLTH-2026-RFP-0219", description: "Peer Support Network Evaluation Services", type: "Request for Proposals", organization: "Ministry of Health", location: "Victoria", contractNumber: "C26HLTH0418", value: 148500, supplier: "Cedar & Main Consulting Ltd.", supplierAddress: "Vancouver, BC", awardedDaysAgo: 2 },
  { opportunityId: "MOTI-2026-ITQ-3390", description: "Janitorial Services - Burnaby District Office", type: "Invitation to Quote", organization: "Ministry of Transportation and Transit", location: "Burnaby", contractNumber: "C26MOTI1177", value: 96240, supplier: "Brightline Building Maintenance Inc.", supplierAddress: "Burnaby, BC", awardedDaysAgo: 4 },
  { opportunityId: "SDPR-2025-RFP-0102", description: "Community Food Access Mapping - Downtown Eastside", type: "Request for Proposals", organization: "Ministry of Social Development and Poverty Reduction", location: "Vancouver", contractNumber: "C25SDPR0931", value: 64800, supplier: "Riverside Community Society", supplierAddress: "Vancouver, BC", awardedDaysAgo: 210 },
  { opportunityId: "MCFD-2025-RFP-0277", description: "Youth Mentorship Program Delivery - Fraser Region", type: "Request for Proposals", organization: "Ministry of Children and Family Development", location: "Surrey", contractNumber: "C25MCFD0544", value: 412000, supplier: "Fraser Youth Collective Society", supplierAddress: "Surrey, BC", awardedDaysAgo: 160 },
  { opportunityId: "MCFD-2025-RFP-0281", description: "Youth Mentorship Program Delivery - Vancouver Island", type: "Request for Proposals", organization: "Ministry of Children and Family Development", location: "Nanaimo", contractNumber: "C25MCFD0560", value: 298750, supplier: "Island Pathways Mentoring Association", supplierAddress: "Nanaimo, BC", awardedDaysAgo: 152 },
  { opportunityId: "EMCR-2025-RFP-0049", description: "Neighbourhood Emergency Preparedness Pilot - Metro Vancouver", type: "Request for Proposals", organization: "Ministry of Emergency Management and Climate Readiness", location: "Vancouver", contractNumber: "C25EMCR0207", value: 87500, supplier: "Northshore Facilitation Group", supplierAddress: "North Vancouver, BC", awardedDaysAgo: 290 },
  { opportunityId: "BCH-2025-0491", description: "Tenant Support Services - Hastings Sunrise Supportive Housing", type: "Request for Proposals", organization: "BC Housing Management Commission", location: "Vancouver", contractNumber: "C25BCH0712", value: 1240000, supplier: "Lantern Housing Society", supplierAddress: "Vancouver, BC", awardedDaysAgo: 120 },
  { opportunityId: "CITZ-2025-RFQ-0388", description: "Plain Language Review of Online Service Guides", type: "Request for Quotations", organization: "Ministry of Citizens' Services", location: "Victoria", contractNumber: "C25CITZ0305", value: 38900, supplier: "Clearword Communications Inc.", supplierAddress: "Victoria, BC", awardedDaysAgo: 95 },
  { opportunityId: "HMA-2025-RFQ-0177", description: "Tenancy Information Translation - Six Languages", type: "Request for Quotations", organization: "Ministry of Housing and Municipal Affairs", location: "Victoria", contractNumber: "C25HMA0119", value: 27350, supplier: "Mosaic Language Services Ltd.", supplierAddress: "Richmond, BC", awardedDaysAgo: 230 },
  { opportunityId: "AG-2025-RFP-0533", description: "Restorative Justice Volunteer Training - Interior", type: "Request for Proposals", organization: "Ministry of Attorney General", location: "Kamloops", contractNumber: "C25AG0841", value: 72400, supplier: "Circle Path Restorative Justice Society", supplierAddress: "Kamloops, BC", awardedDaysAgo: 180 },
  { opportunityId: "DBC-2025-RFP-0021", description: "Regional Tourism Visitor Survey 2026", type: "Request for Proposals", organization: "Destination BC", location: "Vancouver", contractNumber: "C25DBC0066", value: 186000, supplier: "Pacific Insight Research Corp.", supplierAddress: "Vancouver, BC", awardedDaysAgo: 330 },
  { opportunityId: "FOR-2025-RFQ-1980", description: "FireSmart Community Outreach - Thompson-Okanagan", type: "Request for Quotations", organization: "Ministry of Forests", location: "Kamloops", contractNumber: "C25FOR1433", value: 54600, supplier: "Interior Community Resilience Co-op", supplierAddress: "Kelowna, BC", awardedDaysAgo: 260 },
  { opportunityId: "BCT-2025-RFP-0987", description: "Transit Accessibility Survey and Focus Groups", type: "Request for Proposals", organization: "BC Transit", location: "Victoria", contractNumber: "C25BCT0420", value: 69900, supplier: "Cedar & Main Consulting Ltd.", supplierAddress: "Vancouver, BC", awardedDaysAgo: 140 },
  { opportunityId: null, description: "Direct Award - Emergency Warming Centre Staffing (Extreme Cold)", type: "Direct Award", organization: "BC Housing Management Commission", location: "Prince George", contractNumber: "C26BCH0033", value: 45000, supplier: "Northern Shelter Partners Society", supplierAddress: "Prince George, BC", awardedDaysAgo: 255, justification: "Urgent and unforeseeable need during an extreme cold warning." },
  { opportunityId: "ECC-2025-RFP-0064", description: "Early Learning Family Engagement Resources", type: "Request for Proposals", organization: "Ministry of Education and Child Care", location: "Victoria", contractNumber: "C25ECC0251", value: 118300, supplier: "Riverside Community Society", supplierAddress: "Vancouver, BC", awardedDaysAgo: 75 },
];

function awardData(spec: AwardSpec): { importKey: string; data: JsonObject; updatedAt: string } {
  const awardDate = daysFromToday(-spec.awardedDaysAgo);
  const contractValueText = `$${spec.value.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`;
  const importKey = [spec.opportunityId ?? "", spec.contractNumber.toLowerCase(), spec.supplier, awardDate, spec.organization, spec.description].map((part) => part.toLowerCase()).join("::");
  const importedAt = Date.parse(stamp(-1, "18:30"));
  return {
    importKey,
    updatedAt: stamp(-1, "18:30"),
    data: {
      opportunityId: spec.opportunityId, opportunityDescription: spec.description, opportunityType: spec.type,
      issuingOrganization: spec.organization, issuingLocation: spec.location, contractNumber: spec.contractNumber,
      contactEmail: "procurement@example.gov.bc.ca", contractValueText, currency: "CAD", successfulSupplier: spec.supplier,
      supplierAddress: spec.supplierAddress, awardDate, justification: spec.justification ?? null,
      _id: importKey, _creationTime: importedAt, importKey, contractValue: spec.value,
      searchText: [spec.opportunityId, spec.description, spec.type, spec.organization, spec.location, spec.contractNumber, spec.supplier, awardDate].filter(Boolean).join(" "),
      sourceFileName: null, sourceUrl: "https://bcbid.gov.bc.ca/page.aspx/en/ctr/contract_browse_public",
      createdAt: importedAt, updatedAt: importedAt, starred: spec.supplier === "Riverside Community Society",
      attachmentLookup: spec.opportunityId ? { kind: "opportunity", field: "opportunityId", value: spec.opportunityId } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Documents: small text PDFs, stored content-addressed like Zoer's files/.
// ---------------------------------------------------------------------------

/** A minimal one-or-more page PDF of plain text (Helvetica, ASCII). */
function textPdf(title: string, paragraphs: string[]): Uint8Array {
  const wrap = (text: string, width: number) => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      if (line && line.length + word.length + 1 > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines;
  };
  const body = paragraphs.flatMap((paragraph, index) => [...(index ? [""] : []), ...wrap(paragraph, 92)]);
  const pages: string[][] = [];
  for (let index = 0; index < body.length; index += 46) pages.push(body.slice(index, index + 46));
  if (!pages.length) pages.push([]);
  const escape = (text: string) => text.replace(/[\\()]/g, (character) => `\\${character}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, index) => {
    const heading = index === 0 ? [`/F1 15 Tf (${escape(title)}) Tj`, "/F1 10 Tf 0 -30 Td"] : ["/F1 10 Tf"];
    const stream = ["BT", "72 730 Td", "14 TL", ...heading, ...lines.map((line) => `(${escape(line)}) Tj T*`), "ET"].join("\n");
    objects[pageIds[index]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`;
    objects[pageIds[index] + 1] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

type DocumentSpec = { notice: string; name: string; title: string; paragraphs: string[]; noText?: boolean };

const DOCUMENTS: DocumentSpec[] = [
  { notice: "sdpr-engagement", name: "RFP SDPR-2026-RFP-0147.pdf", title: "Request for Proposals SDPR-2026-RFP-0147",
    paragraphs: [
      "Community Engagement and Facilitation Services for Poverty Reduction Strategy Renewal. Ministry of Social Development and Poverty Reduction.",
      "1. Purpose. The Province is renewing its poverty reduction strategy and requires a proponent to plan and deliver engagement with people with lived experience of poverty, community organizations and local governments in four regions: Vancouver Coastal, Fraser, Vancouver Island and the North.",
      "2. Scope of services. The proponent will design accessible in-person and online sessions, facilitate a minimum of 16 sessions, administer participant honoraria, and deliver a what-we-heard report within six weeks of the final session.",
      "3. Mandatory requirements. The proponent must be a legal entity registered to do business in British Columbia. The proponent must carry commercial general liability insurance of not less than $5,000,000 per occurrence. The proponent must provide a WorkSafeBC clearance letter before contract award.",
      "4. Desirable experience. Proponents should demonstrate at least three engagement projects with people with lived experience of poverty completed in the last five years. Facilitators should have trauma-informed practice training.",
      "5. Budget and term. The estimated budget for this contract is $180,000 to $220,000, exclusive of GST. The contract term is from January 5, 2027 to September 30, 2027.",
      "6. Questions and closing. Questions must be submitted by October 23, 2026. Proposals must be received by 2:00 PM Pacific Time on October 30, 2026 through the BC Bid e-bidding system.",
    ] },
  { notice: "sdpr-engagement", name: "Appendix C - Pricing Form.pdf", title: "Appendix C - Pricing Form",
    paragraphs: [
      "Proponents must complete this pricing form and submit it with the proposal. Prices are in Canadian dollars, exclusive of GST.",
      "Line 1: Session design and materials. Line 2: Facilitation, per session. Line 3: Honoraria administration fee. Line 4: What-we-heard report. Line 5: Travel, at the rates in the Province's group 2 travel policy.",
    ] },
  { notice: "mcfd-mentorship", name: "RFP MCFD-2026-RFP-0312.pdf", title: "Request for Proposals MCFD-2026-RFP-0312",
    paragraphs: [
      "Youth Mentorship Program Delivery - Lower Mainland. Ministry of Children and Family Development.",
      "1. Services. Deliver one-to-one and group mentorship for at least 60 youth aged 12 to 18, including mentor recruitment, screening, training, match support and closure.",
      "2. Mandatory requirements. All staff and volunteers working with youth must complete a criminal record check for work with vulnerable populations. The proponent must carry commercial general liability insurance of not less than $2,000,000 per occurrence.",
      "3. Reporting. The proponent will report quarterly on matches made, match duration and youth-reported outcomes using the Ministry's template.",
      "4. Budget. The maximum annual budget is $240,000, inclusive of all costs, for a two-year term with an option to extend for one further year.",
      "5. Closing. Proposals must be received by 2:00 PM Pacific Time on October 20, 2026.",
    ] },
  { notice: "bch-tenant-support", name: "RFP BCH-2026-0588.pdf", title: "Request for Proposals BCH-2026-0588",
    paragraphs: [
      "Tenant Support Services - Mount Pleasant Supportive Housing. BC Housing Management Commission.",
      "1. Services. Provide 24/7 tenant support at a 52-unit supportive housing building, including two meals a day, life-skills support, referrals to health and income services, and community integration activities.",
      "2. Mandatory requirements. The proponent must be a registered non-profit society in good standing. The proponent must carry commercial general liability insurance of not less than $2,000,000 per occurrence. Staff must hold current first aid and naloxone training.",
      "3. Operating budget. Annual operating funding of approximately $1,300,000 will be provided under a three-year operating agreement.",
      "4. Closing. Proposals must be received by 3:00 PM Pacific Time on October 27, 2026.",
    ] },
  { notice: "bch-tenant-support", name: "Addendum 1.pdf", title: "Addendum 1 - BCH-2026-0588",
    paragraphs: [
      "This addendum forms part of the RFP. Section 2 is amended: the proponent must carry commercial general liability insurance of not less than $5,000,000 per occurrence.",
      "An optional site visit will be held on October 22, 2026 at 10:00 AM. Proponents who attend must register by email two days in advance.",
    ] },
  { notice: "richmond-food", name: "RFP-26-0412 Food Security Strategy.pdf", title: "RFP-26-0412 Food Security Strategy Engagement Consultant",
    paragraphs: [
      "City of Richmond. The City requires a consultant to lead community engagement for its first Food Security Strategy.",
      "Scope. Pop-up engagement at food banks, farmers markets and community centres; a community survey available in English, Simplified Chinese, Traditional Chinese, Punjabi and Tagalog; two stakeholder workshops; and a summary of what was heard.",
      "Mandatory requirements. The consultant must hold a valid City of Richmond business licence or obtain one before contract award. The consultant must carry commercial general liability insurance of not less than $2,000,000 per occurrence.",
      "Budget. The upset limit for this assignment is $85,000, exclusive of GST.",
      "Closing. Proposals are due by 3:00 PM Pacific Time on October 31, 2026 through bids&tenders.",
    ] },
  { notice: "esdc-seniors", name: "Statement of Work.pdf", title: "Statement of Work - New Horizons for Seniors Program Outreach",
    paragraphs: [
      "Employment and Social Development Canada requires facilitation services to deliver information sessions for seniors' organizations in British Columbia and Yukon.",
      "Deliverables. A minimum of 20 information sessions, at least eight of them in person outside the Lower Mainland; a feedback summary on application barriers; and session materials in English and French.",
      "Mandatory requirements. The bidder must propose at least one facilitator able to deliver sessions in French. The bidder must hold a valid security screening at the reliability level for all personnel before work starts.",
      "Period of the contract. From contract award to March 31, 2027.",
    ] },
  { notice: "burnaby-instructors", name: "Program Schedule Drawings.pdf", title: "", paragraphs: [], noText: true },
];

// ---------------------------------------------------------------------------
// Review workspace content
// ---------------------------------------------------------------------------

type Relevance = "strong" | "possible" | "weak" | "unknown";
type Action = "investigate" | "needs_information" | "consider_partner" | "ready_for_human_decision" | "decline" | "archive_or_monitor";
type AssessmentSpec = {
  notice: string; relevance: Relevance; eligibility: string; delivery: string; response: string; commercial: string; action: Action;
  reasons: string[]; unknowns?: string[]; stale?: boolean;
};

const TRIAGE: Record<string, { relevance: Relevance; classification: string; workCategory: string; summary: string; missing?: string[] }> = {
  "sdpr-engagement": { relevance: "strong", classification: "potentially_relevant", workCategory: "Community engagement", summary: "Engagement with people with lived experience of poverty across four regions; matches the society's core engagement work." },
  "mcfd-mentorship": { relevance: "strong", classification: "potentially_relevant", workCategory: "Youth programs", summary: "Lower Mainland youth mentorship delivery, close to the society's current youth program." },
  "bch-tenant-support": { relevance: "possible", classification: "potentially_relevant", workCategory: "Housing supports", summary: "24/7 supportive housing operations; larger operational scope than the society usually runs.", missing: ["Staffing model expected for overnight shifts"] },
  "educ-language": { relevance: "weak", classification: "outside_stated_preferences", workCategory: "Curriculum development", summary: "Curriculum resource development led with language authorities; outside the society's service lines." },
  "moti-hwy99": { relevance: "weak", classification: "outside_stated_preferences", workCategory: "Highway construction", summary: "Civil construction; excluded by the society's stated preferences." },
  "for-wildfire": { relevance: "possible", classification: "potentially_relevant", workCategory: "Community outreach", summary: "Outreach events in the Cariboo; outside the society's usual geography." },
  "dbc-visitor-survey": { relevance: "weak", classification: "outside_stated_preferences", workCategory: "Market research", summary: "Large tourism survey program; research-firm scope." },
  "transit-rider": { relevance: "strong", classification: "potentially_relevant", workCategory: "Community engagement", summary: "Accessible engagement sessions with riders with disabilities.", missing: ["Number of sessions and locations"] },
  "cits-digital": { relevance: "strong", classification: "potentially_relevant", workCategory: "Seniors programs", summary: "Digital literacy workshops for seniors at libraries and community centres." },
  "ag-justice": { relevance: "possible", classification: "potentially_relevant", workCategory: "Restorative justice", summary: "Facilitation in Northern BC; the society has no presence there yet." },
  "emcr-prep": { relevance: "strong", classification: "potentially_relevant", workCategory: "Community education", summary: "Multilingual neighbourhood preparedness workshops for renters, seniors and newcomers." },
  "rbcm-codesign": { relevance: "possible", classification: "potentially_relevant", workCategory: "Community engagement", summary: "Province-wide co-design facilitation for a travelling exhibit." },
  "hma-plain-language": { relevance: "strong", classification: "potentially_relevant", workCategory: "Plain language and translation", summary: "Plain-language rewriting and community testing of tenancy materials in six languages." },
  "esdc-seniors": { relevance: "strong", classification: "potentially_relevant", workCategory: "Seniors programs", summary: "Information sessions for seniors' organizations; French delivery required.", missing: ["Whether sessions may be delivered online"] },
  "pch-events": { relevance: "possible", classification: "potentially_relevant", workCategory: "Event coordination", summary: "Bilingual community events in Vancouver." },
  "phac-mental-health": { relevance: "possible", classification: "potentially_relevant", workCategory: "Program evaluation", summary: "Mixed-methods evaluation of five community projects." },
  "ircc-settlement": { relevance: "strong", classification: "potentially_relevant", workCategory: "Research and engagement", summary: "Newcomer needs assessment with multilingual focus groups in the Lower Mainland." },
  "pspc-interpretation": { relevance: "possible", classification: "potentially_relevant", workCategory: "Interpretation", summary: "Accredited interpreters required; the society would need a language-services partner." },
  "dfo-shoreline": { relevance: "possible", classification: "potentially_relevant", workCategory: "Volunteer coordination", summary: "Volunteer cleanup coordination on the Fraser River estuary." },
  "burnaby-instructors": { relevance: "possible", classification: "potentially_relevant", workCategory: "Recreation programs", summary: "Contract instructors for community centre programs." },
  "richmond-food": { relevance: "strong", classification: "potentially_relevant", workCategory: "Food security", summary: "Food security strategy engagement; the society led similar work in 2024." },
  "surrey-dropin": { relevance: "possible", classification: "potentially_relevant", workCategory: "Youth programs", summary: "Evening youth drop-in operations in Guildford." },
  "metro-housing-survey": { relevance: "possible", classification: "potentially_relevant", workCategory: "Survey fieldwork", summary: "Regional survey fieldwork with multilingual intercepts." },
  "coquitlam-seniors": { relevance: "strong", classification: "potentially_relevant", workCategory: "Seniors programs", summary: "Weekly seniors' wellness programs at two community centres." },
  "nanaimo-outreach": { relevance: "possible", classification: "potentially_relevant", workCategory: "Street outreach", summary: "Downtown street outreach; outside the society's region." },
  "abbotsford-paving": { relevance: "weak", classification: "outside_stated_preferences", workCategory: "Paving", summary: "Road paving; excluded by the society's stated preferences." },
  "dnv-gardens": { relevance: "strong", classification: "potentially_relevant", workCategory: "Food security", summary: "Community garden coordination and workshops." },
  "penticton-safety": { relevance: "possible", classification: "potentially_relevant", workCategory: "Community engagement", summary: "Community safety plan engagement in the Okanagan." },
  "courtenay-pit": { relevance: "possible", classification: "insufficient_information", workCategory: "Research and engagement", summary: "Point-in-time count coordination; timing and budget not stated.", missing: ["Count date", "Budget"] },
  "saanich-placemaking": { relevance: "strong", classification: "potentially_relevant", workCategory: "Community engagement", summary: "Resident-led placemaking facilitation." },
  "comox-janitorial": { relevance: "weak", classification: "outside_stated_preferences", workCategory: "Janitorial", summary: "Facility janitorial services; excluded by stated preferences." },
};

const gate = (requirementId: string, status: string, rationale: string, remediable: boolean | null = null): JsonObject => ({
  requirementId, origin: "buyer_mandatory", status, reviewed: status !== "unknown", remediable, applicabilityVerified: false, requiredBy: null,
  requirementEvidenceIds: [], companyEvidenceIds: status === "supported" ? ["ev-cgl"] : [], rationale, taskId: null,
});

const PROFILE_ASSESSMENTS: AssessmentSpec[] = [
  { notice: "sdpr-engagement", relevance: "strong", eligibility: "unresolved", delivery: "feasible", response: "sufficient", commercial: "assessable", action: "investigate",
    reasons: ["Strong fit with community engagement service line.", "Insurance requirement of $5,000,000 exceeds the society's current $2,000,000 policy; the broker can raise it before award.", "Capacity available from January 2027."], unknowns: [] },
  { notice: "mcfd-mentorship", relevance: "strong", eligibility: "supported_for_reviewed_requirements", delivery: "feasible", response: "tight", commercial: "assessable", action: "ready_for_human_decision",
    reasons: ["Every reviewed mandatory requirement is supported by profile evidence.", "Closes in two days; response time is tight."] },
  { notice: "bch-tenant-support", relevance: "possible", eligibility: "unresolved", delivery: "conditional", response: "sufficient", commercial: "information_needed", action: "needs_information", stale: true,
    reasons: ["Addendum 1 raised the insurance requirement after the last assessment.", "24/7 staffing would need new hires."], unknowns: ["Overnight staffing model"] },
  { notice: "transit-rider", relevance: "strong", eligibility: "unresolved", delivery: "feasible", response: "insufficient", commercial: "information_needed", action: "needs_information",
    reasons: ["Closes today; the notice does not state the number of sessions."], unknowns: ["Number of sessions", "Budget"] },
  { notice: "cits-digital", relevance: "strong", eligibility: "supported_for_reviewed_requirements", delivery: "feasible", response: "tight", commercial: "assessable", action: "ready_for_human_decision",
    reasons: ["Matches the seniors programs service line; workshop format the society already runs."] },
  { notice: "emcr-prep", relevance: "strong", eligibility: "unresolved", delivery: "feasible", response: "sufficient", commercial: "information_needed", action: "needs_information",
    reasons: ["RFP package not downloaded yet; mandatory requirements unknown."], unknowns: ["Mandatory requirements", "Budget"] },
  { notice: "hma-plain-language", relevance: "strong", eligibility: "supported_for_reviewed_requirements", delivery: "feasible", response: "sufficient", commercial: "assessable", action: "ready_for_human_decision",
    reasons: ["Plain-language and multilingual outreach is a core service line.", "Community testing matches past work."] },
  { notice: "esdc-seniors", relevance: "strong", eligibility: "unresolved", delivery: "conditional", response: "sufficient", commercial: "information_needed", action: "consider_partner",
    reasons: ["French-language facilitation is required; the society has no French-speaking facilitator.", "A confirmed partner could cover French sessions."], unknowns: ["Reliability screening timelines"] },
  { notice: "ircc-settlement", relevance: "strong", eligibility: "unresolved", delivery: "feasible", response: "tight", commercial: "information_needed", action: "needs_information",
    reasons: ["Closes in two days; focus groups in five languages need confirmed facilitators."], unknowns: ["Languages required"] },
  { notice: "pspc-interpretation", relevance: "possible", eligibility: "blocker", delivery: "not_feasible", response: "sufficient", commercial: "assessable", action: "consider_partner",
    reasons: ["Accredited interpreters required; only a partner could meet this."] },
  { notice: "richmond-food", relevance: "strong", eligibility: "supported_for_reviewed_requirements", delivery: "feasible", response: "sufficient", commercial: "assessable", action: "ready_for_human_decision",
    reasons: ["Every reviewed mandatory requirement is supported.", "The society led the 2024 community food strategy engagement."] },
  { notice: "coquitlam-seniors", relevance: "strong", eligibility: "unresolved", delivery: "feasible", response: "insufficient", commercial: "information_needed", action: "needs_information",
    reasons: ["Closes tomorrow; program locations not confirmed."], unknowns: ["Budget"] },
  { notice: "dnv-gardens", relevance: "strong", eligibility: "supported_for_reviewed_requirements", delivery: "feasible", response: "sufficient", commercial: "assessable", action: "investigate",
    reasons: ["Good fit; check whether the District requires a horticulture certificate."] },
  { notice: "saanich-placemaking", relevance: "strong", eligibility: "unresolved", delivery: "conditional", response: "sufficient", commercial: "information_needed", action: "investigate",
    reasons: ["Vancouver Island delivery would need travel budget."] },
  { notice: "metro-housing-survey", relevance: "possible", eligibility: "unresolved", delivery: "conditional", response: "sufficient", commercial: "information_needed", action: "consider_partner",
    reasons: ["Survey sampling design needs the confirmed research partner."] },
  { notice: "burnaby-instructors", relevance: "possible", eligibility: "unresolved", delivery: "feasible", response: "sufficient", commercial: "information_needed", action: "needs_information",
    reasons: ["Saved drawings have no readable text; program streams unclear."] },
  { notice: "moti-hwy99", relevance: "weak", eligibility: "blocker", delivery: "not_feasible", response: "sufficient", commercial: "outside_policy", action: "decline",
    reasons: ["Highway construction prequalification required; construction is an exclusion in the profile."] },
  { notice: "abbotsford-paving", relevance: "weak", eligibility: "blocker", delivery: "not_feasible", response: "sufficient", commercial: "outside_policy", action: "decline",
    reasons: ["Paving is an exclusion in the profile."] },
  { notice: "comox-janitorial", relevance: "weak", eligibility: "not_assessed", delivery: "not_assessed", response: "not_assessed", commercial: "not_assessed", action: "archive_or_monitor",
    reasons: ["Janitorial services are an exclusion in the profile."] },
  { notice: "dbc-visitor-survey", relevance: "weak", eligibility: "unresolved", delivery: "not_feasible", response: "sufficient", commercial: "assessable", action: "archive_or_monitor",
    reasons: ["Scale of fieldwork is beyond the society's capacity."] },
  { notice: "pch-events", relevance: "possible", eligibility: "unresolved", delivery: "feasible", response: "tight", commercial: "information_needed", action: "needs_information",
    reasons: ["Bilingual delivery required; check French-language capacity."] },
];

/** Requirements extracted from a notice's documents: [document name, quote, strength, category, match for the profile]. */
type RequirementSpec = { document: string; quote: string; strength: "mandatory" | "preferred" | "conditional" | "informational"; category: string; match?: { status: "supported" | "remediable_gap" | "unmet" | "unknown" | "not_applicable"; rationale: string; evidence?: string[] }; accepted?: boolean };

const REQUIREMENTS: Record<string, RequirementSpec[]> = {
  "sdpr-engagement": [
    { document: "RFP SDPR-2026-RFP-0147.pdf", quote: "The proponent must be a legal entity registered to do business in British Columbia.", strength: "mandatory", category: "eligibility", accepted: true, match: { status: "supported", rationale: "Registered BC society (S-0076543).", evidence: ["ev-society"] } },
    { document: "RFP SDPR-2026-RFP-0147.pdf", quote: "The proponent must carry commercial general liability insurance of not less than $5,000,000 per occurrence.", strength: "mandatory", category: "insurance", accepted: true, match: { status: "remediable_gap", rationale: "Current policy is $2,000,000; broker confirmed an increase is available before award.", evidence: ["ev-cgl"] } },
    { document: "RFP SDPR-2026-RFP-0147.pdf", quote: "The proponent must provide a WorkSafeBC clearance letter before contract award.", strength: "mandatory", category: "credential", accepted: true, match: { status: "supported", rationale: "Clearance letter on file, valid to December 2026.", evidence: ["ev-worksafe"] } },
    { document: "RFP SDPR-2026-RFP-0147.pdf", quote: "Proponents should demonstrate at least three engagement projects with people with lived experience of poverty completed in the last five years.", strength: "preferred", category: "experience", match: { status: "supported", rationale: "Three qualifying projects listed in the profile references.", evidence: ["ev-ref-engage"] } },
    { document: "RFP SDPR-2026-RFP-0147.pdf", quote: "Facilitators should have trauma-informed practice training.", strength: "preferred", category: "personnel", match: { status: "unknown", rationale: "Training records not in the profile yet." } },
    { document: "RFP SDPR-2026-RFP-0147.pdf", quote: "Questions must be submitted by October 23, 2026.", strength: "informational", category: "schedule" },
  ],
  "mcfd-mentorship": [
    { document: "RFP MCFD-2026-RFP-0312.pdf", quote: "All staff and volunteers working with youth must complete a criminal record check for work with vulnerable populations.", strength: "mandatory", category: "credential", accepted: true, match: { status: "supported", rationale: "Vulnerable-sector checks are part of onboarding.", evidence: ["ev-crc"] } },
    { document: "RFP MCFD-2026-RFP-0312.pdf", quote: "The proponent must carry commercial general liability insurance of not less than $2,000,000 per occurrence.", strength: "mandatory", category: "insurance", accepted: true, match: { status: "supported", rationale: "Current CGL policy meets the limit.", evidence: ["ev-cgl"] } },
    { document: "RFP MCFD-2026-RFP-0312.pdf", quote: "The proponent will report quarterly on matches made, match duration and youth-reported outcomes using the Ministry's template.", strength: "mandatory", category: "submission", accepted: true, match: { status: "supported", rationale: "Current youth program already reports these measures.", evidence: ["ev-ref-youth"] } },
  ],
  "bch-tenant-support": [
    { document: "RFP BCH-2026-0588.pdf", quote: "The proponent must be a registered non-profit society in good standing.", strength: "mandatory", category: "eligibility", accepted: true, match: { status: "supported", rationale: "Society in good standing.", evidence: ["ev-society"] } },
    { document: "Addendum 1.pdf", quote: "the proponent must carry commercial general liability insurance of not less than $5,000,000 per occurrence.", strength: "mandatory", category: "insurance", match: { status: "unknown", rationale: "New limit from Addendum 1; not yet checked with the broker." } },
    { document: "RFP BCH-2026-0588.pdf", quote: "Staff must hold current first aid and naloxone training.", strength: "mandatory", category: "personnel", match: { status: "remediable_gap", rationale: "Two of five program staff need naloxone training; a course is available in November." } },
  ],
  "richmond-food": [
    { document: "RFP-26-0412 Food Security Strategy.pdf", quote: "The consultant must hold a valid City of Richmond business licence or obtain one before contract award.", strength: "mandatory", category: "credential", accepted: true, match: { status: "supported", rationale: "Inter-municipal business licence covers Richmond.", evidence: ["ev-licence"] } },
    { document: "RFP-26-0412 Food Security Strategy.pdf", quote: "The consultant must carry commercial general liability insurance of not less than $2,000,000 per occurrence.", strength: "mandatory", category: "insurance", accepted: true, match: { status: "supported", rationale: "Current CGL policy meets the limit.", evidence: ["ev-cgl"] } },
    { document: "RFP-26-0412 Food Security Strategy.pdf", quote: "a community survey available in English, Simplified Chinese, Traditional Chinese, Punjabi and Tagalog", strength: "mandatory", category: "technical", match: { status: "supported", rationale: "Translation partners on the society's roster cover all five languages." } },
  ],
  "esdc-seniors": [
    { document: "Statement of Work.pdf", quote: "The bidder must propose at least one facilitator able to deliver sessions in French.", strength: "mandatory", category: "personnel", match: { status: "remediable_gap", rationale: "No French-speaking facilitator on staff; a partner could provide one.", evidence: [] } },
    { document: "Statement of Work.pdf", quote: "The bidder must hold a valid security screening at the reliability level for all personnel before work starts.", strength: "mandatory", category: "credential", match: { status: "unknown", rationale: "Reliability screening not yet requested." } },
    { document: "Statement of Work.pdf", quote: "A minimum of 20 information sessions, at least eight of them in person outside the Lower Mainland", strength: "mandatory", category: "schedule" },
  ],
};

const FACTS: Record<string, { field: string; type: string; status: string; value: Json; document?: string; quote?: string }[]> = {
  "sdpr-engagement": [
    { field: "closing_date", type: "date", status: "stated", value: { raw: "2:00 PM Pacific Time on October 30, 2026", precision: "instant", iso: instant("2026-10-30", "14:00") }, document: "RFP SDPR-2026-RFP-0147.pdf", quote: "2:00 PM Pacific Time on October 30, 2026" },
    { field: "estimated_value", type: "money:buyer_estimated_value", status: "stated", value: { currency: "CAD", lower: 180000, upper: 220000, basis: "total_contract", tax: "exclusive", raw: "$180,000 to $220,000, exclusive of GST" }, document: "RFP SDPR-2026-RFP-0147.pdf", quote: "$180,000 to $220,000, exclusive of GST" },
    { field: "insurance_limit", type: "money:insurance_limit", status: "stated", value: { currency: "CAD", lower: 5000000, upper: 5000000, basis: "unknown", raw: "$5,000,000 per occurrence" }, document: "RFP SDPR-2026-RFP-0147.pdf", quote: "$5,000,000 per occurrence" },
    { field: "contract_duration", type: "duration", status: "stated", value: "January 5, 2027 to September 30, 2027", document: "RFP SDPR-2026-RFP-0147.pdf", quote: "from January 5, 2027 to September 30, 2027" },
    { field: "questions_deadline", type: "date", status: "stated", value: { raw: "October 23, 2026", precision: "date" }, document: "RFP SDPR-2026-RFP-0147.pdf", quote: "October 23, 2026" },
    { field: "bid_security", type: "money:bid_security", status: "not_found_in_reviewed_material", value: null },
    { field: "site_visit", type: "text", status: "not_found_in_reviewed_material", value: null },
  ],
  "mcfd-mentorship": [
    { field: "closing_date", type: "date", status: "stated", value: { raw: "2:00 PM Pacific Time on October 20, 2026", precision: "instant", iso: instant("2026-10-20", "14:00") }, document: "RFP MCFD-2026-RFP-0312.pdf", quote: "2:00 PM Pacific Time on October 20, 2026" },
    { field: "budget", type: "money:buyer_budget", status: "stated", value: { currency: "CAD", lower: 240000, upper: 240000, basis: "annual", tax: "inclusive", raw: "$240,000, inclusive of all costs" }, document: "RFP MCFD-2026-RFP-0312.pdf", quote: "$240,000, inclusive of all costs" },
    { field: "insurance_limit", type: "money:insurance_limit", status: "stated", value: { currency: "CAD", lower: 2000000, upper: 2000000, basis: "unknown", raw: "$2,000,000 per occurrence" }, document: "RFP MCFD-2026-RFP-0312.pdf", quote: "$2,000,000 per occurrence" },
    { field: "contract_duration", type: "duration", status: "stated", value: "Two years, with an option to extend for one year", document: "RFP MCFD-2026-RFP-0312.pdf", quote: "two-year term with an option to extend for one further year" },
  ],
  "bch-tenant-support": [
    { field: "closing_date", type: "date", status: "stated", value: { raw: "3:00 PM Pacific Time on October 27, 2026", precision: "instant", iso: instant("2026-10-27", "15:00") }, document: "RFP BCH-2026-0588.pdf", quote: "3:00 PM Pacific Time on October 27, 2026" },
    { field: "budget", type: "money:buyer_budget", status: "stated", value: { currency: "CAD", lower: 1300000, upper: 1300000, basis: "annual", raw: "approximately $1,300,000" }, document: "RFP BCH-2026-0588.pdf", quote: "approximately $1,300,000" },
    { field: "insurance_limit", type: "money:insurance_limit", status: "conflicting", value: { currency: "CAD", lower: 5000000, upper: 5000000, basis: "unknown", raw: "$5,000,000 per occurrence (Addendum 1; RFP said $2,000,000)" }, document: "Addendum 1.pdf", quote: "$5,000,000 per occurrence" },
    { field: "site_visit", type: "text", status: "stated", value: "Optional, October 22, 2026 at 10:00 AM; register two days in advance", document: "Addendum 1.pdf", quote: "An optional site visit will be held on October 22, 2026 at 10:00 AM." },
  ],
  "richmond-food": [
    { field: "closing_date", type: "date", status: "stated", value: { raw: "3:00 PM Pacific Time on October 31, 2026", precision: "instant", iso: instant("2026-10-31", "15:00") }, document: "RFP-26-0412 Food Security Strategy.pdf", quote: "3:00 PM Pacific Time on October 31, 2026" },
    { field: "budget", type: "money:buyer_budget", status: "stated", value: { currency: "CAD", lower: 85000, upper: 85000, basis: "total_contract", tax: "exclusive", raw: "$85,000, exclusive of GST" }, document: "RFP-26-0412 Food Security Strategy.pdf", quote: "$85,000, exclusive of GST" },
    { field: "insurance_limit", type: "money:insurance_limit", status: "stated", value: { currency: "CAD", lower: 2000000, upper: 2000000, basis: "unknown", raw: "$2,000,000 per occurrence" }, document: "RFP-26-0412 Food Security Strategy.pdf", quote: "$2,000,000 per occurrence" },
  ],
  "esdc-seniors": [
    { field: "contract_duration", type: "duration", status: "stated", value: "Contract award to March 31, 2027", document: "Statement of Work.pdf", quote: "From contract award to March 31, 2027." },
    { field: "budget", type: "money:buyer_budget", status: "not_found_in_reviewed_material", value: null },
  ],
};

const PROFILE_DRAFT: JsonObject = {
  schemaVersion: 1,
  scenario: "partner",
  team: [{ name: "Mina Patel", role: "Executive Director" }, { name: "Avery Santos", role: "Programs and Privacy Lead" }, { name: "Jordan Lee", role: "Treasurer" }],
  partners: [{ name: "Cedar & Main Consulting Ltd.", confirmed: true, responsibilities: ["Survey sampling design", "Statistical analysis"] }],
  serviceLines: ["Community engagement and facilitation", "Youth and seniors programs", "Food security programs", "Plain-language and multilingual outreach", "Program evaluation"],
  exclusions: ["Construction and paving", "Janitorial services", "Interpretation requiring accreditation"],
  geography: ["Metro Vancouver", "Fraser Valley", "Sea to Sky"],
  evidence: [
    { id: "ev-society", capability: "Registered BC society in good standing (S-0076543)", kind: "credential", holder: "Riverside Community Society", verification: "reviewed", verifiedAt: "2026-04-21", expiresAt: null, sourceRef: "BC Registries certificate of good standing, April 2026" },
    { id: "ev-cgl", capability: "Commercial general liability insurance", kind: "insurance", holder: "Riverside Community Society", verification: "reviewed", verifiedAt: "2026-04-01", expiresAt: "2027-03-31", sourceRef: "Insurance binder 2026-27", limit: 2000000, currency: "CAD" },
    { id: "ev-worksafe", capability: "WorkSafeBC clearance letter", kind: "credential", holder: "Riverside Community Society", verification: "reviewed", verifiedAt: "2026-09-30", expiresAt: "2026-12-31", sourceRef: "WorkSafeBC clearance, September 2026" },
    { id: "ev-crc", capability: "Criminal record checks for work with vulnerable people", kind: "credential", holder: "All program staff and volunteers", verification: "self_declared", verifiedAt: null, expiresAt: null, sourceRef: "Volunteer onboarding policy" },
    { id: "ev-licence", capability: "Metro West inter-municipal business licence", kind: "credential", holder: "Riverside Community Society", verification: "reviewed", verifiedAt: "2026-01-12", expiresAt: "2026-12-31", sourceRef: "Licence IMBL-2026-0412" },
    { id: "ev-ref-youth", capability: "Youth mentorship program, 2022-2026", kind: "reference", holder: null, verification: "reviewed", verifiedAt: "2026-06-30", expiresAt: null, sourceRef: "City of Vancouver community services grant reports" },
    { id: "ev-ref-engage", capability: "Community food strategy engagement, 2024", kind: "reference", holder: null, verification: "reviewed", verifiedAt: "2025-02-15", expiresAt: null, sourceRef: "Final report and client reference letter" },
  ],
  capacity: [{ from: "2026-11-01", to: "2027-03-31", hours: 900 }, { from: "2027-04-01", to: "2027-09-30", hours: 1200 }],
  responseHours: 60,
  commercial: { origin: "internal_policy", currency: "CAD", rateBasis: "hourly", rateLow: 85, rateHigh: 120, minContractValue: 15000, notes: "Contracts under $15,000 only for existing partners." },
};

// ---------------------------------------------------------------------------
// Schema (zoer/backend/src/plugin-catalog.ts and procurement/schema.ts, verbatim)
// ---------------------------------------------------------------------------

const CATALOG_SCHEMA = `
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,media_type TEXT,sha256 TEXT,content BLOB,text TEXT,status TEXT NOT NULL,error TEXT,updated_at TEXT NOT NULL,byte_length INTEGER NOT NULL DEFAULT 0,UNIQUE(record_id,url));
      CREATE INDEX IF NOT EXISTS documents_record ON documents(record_id);
      CREATE TABLE IF NOT EXISTS prompts(id TEXT PRIMARY KEY,name TEXT NOT NULL,prompt TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,prompt_id TEXT NOT NULL,prompt_version INTEGER NOT NULL,fingerprint TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reviews_fingerprint ON reviews(fingerprint,status);
      CREATE TABLE IF NOT EXISTS tags(record_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(record_id,value));
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,input TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL,error TEXT,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_tasks(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS research_tasks_record ON research_tasks(record_id,kind,status);
      CREATE TABLE IF NOT EXISTS workspace_state(key TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS record_history(run_id TEXT NOT NULL,record_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,record_id));`;

const PROCUREMENT_JOURNAL = "CREATE TABLE IF NOT EXISTS procurement_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL);";
const PROCUREMENT_MIGRATIONS: { version: number; name: string; sql: string }[] = [{ version: 1, name: "review-workspace", sql: `
CREATE TABLE procurement_extractions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,document_id TEXT,source_kind TEXT NOT NULL,-- 'notice'|'document'
  sha256 TEXT NOT NULL,-- notice: digest of notice view text; document: file sha256
  name TEXT NOT NULL,extractor_version TEXT NOT NULL,text TEXT NOT NULL,text_sha256 TEXT NOT NULL,code_points INTEGER NOT NULL,
  status TEXT NOT NULL,-- not_attempted|readable|partial|unreadable|unsupported
  blocks TEXT NOT NULL DEFAULT '[]',limitations TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,
  UNIQUE(record_id,source_kind,sha256,extractor_version));
CREATE INDEX procurement_extractions_record ON procurement_extractions(record_id);
CREATE TABLE procurement_bundles(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,purpose TEXT NOT NULL,manifest TEXT NOT NULL,coverage TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX procurement_bundles_record ON procurement_bundles(record_id,created_at);
CREATE TABLE procurement_stage_runs(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,record_id TEXT NOT NULL,stage TEXT NOT NULL,-- triage|extract|assess|changes|question
  stage_key TEXT NOT NULL,bundle_id TEXT,template_id TEXT NOT NULL,template_version INTEGER NOT NULL,model TEXT,
  status TEXT NOT NULL,-- queued|running|succeeded|failed|cancelled|superseded
  quality TEXT,-- valid|needs_review|unsupported|stale
  is_current INTEGER NOT NULL DEFAULT 0,summary TEXT,output TEXT,coverage TEXT,usage TEXT,issues TEXT NOT NULL DEFAULT '[]',rejected_raw TEXT,error TEXT,started_at TEXT NOT NULL,finished_at TEXT);
CREATE INDEX procurement_stage_runs_record ON procurement_stage_runs(record_id,stage,is_current);
CREATE INDEX procurement_stage_runs_key ON procurement_stage_runs(stage_key,status);
CREATE TABLE procurement_requirements(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,
  strength TEXT NOT NULL,-- mandatory|preferred|conditional|informational
  category TEXT NOT NULL,actor TEXT,required_by TEXT,condition_text TEXT,grounding TEXT NOT NULL,-- exact|normalized_mapped|unverified
  supersedes TEXT NOT NULL DEFAULT '[]',conflicts TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
CREATE INDEX procurement_requirements_record ON procurement_requirements(record_id,stage_run_id);
CREATE TABLE procurement_facts(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,stage_run_id TEXT NOT NULL,field_key TEXT NOT NULL,semantic_type TEXT NOT NULL,
  status TEXT NOT NULL,-- stated|explicitly_absent|not_found_in_reviewed_material|not_reviewed|conflicting|not_applicable
  value TEXT,grounding TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX procurement_facts_record ON procurement_facts(record_id,stage_run_id);
CREATE TABLE procurement_spans(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,target_type TEXT NOT NULL,-- requirement|fact|stage_run
  target_id TEXT NOT NULL,extraction_id TEXT NOT NULL,text_sha256 TEXT NOT NULL,start_cp INTEGER,end_cp INTEGER,quote TEXT NOT NULL,page INTEGER,heading TEXT,alignment TEXT NOT NULL);
CREATE INDEX procurement_spans_target ON procurement_spans(target_type,target_id);
CREATE TABLE procurement_review_events(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,event TEXT NOT NULL,-- accept|reject|correct|request_clarification|reconfirm
  reason TEXT NOT NULL,correction TEXT,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,occurred_at TEXT NOT NULL);
CREATE INDEX procurement_review_events_target ON procurement_review_events(target_type,target_id,revision);
CREATE TABLE procurement_review_state(target_type TEXT NOT NULL,target_id TEXT NOT NULL,record_id TEXT NOT NULL,state TEXT NOT NULL,-- accepted|corrected|rejected|needs_clarification
  value TEXT,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(target_type,target_id));
CREATE TABLE procurement_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,draft TEXT NOT NULL,draft_version INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE procurement_profile_versions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,published_at TEXT NOT NULL,published_by TEXT NOT NULL,UNIQUE(profile_id,version));
CREATE TABLE procurement_matches(requirement_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,record_id TEXT NOT NULL,status TEXT NOT NULL,-- supported|remediable_gap|unmet|unknown|not_applicable
  origin TEXT NOT NULL,company_evidence TEXT NOT NULL DEFAULT '[]',rationale TEXT NOT NULL,remediable INTEGER,reviewed INTEGER NOT NULL DEFAULT 1,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(requirement_id,profile_version_id));
CREATE TABLE procurement_assessments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,lot_id TEXT,bundle_id TEXT,profile_version_id TEXT,policy_version TEXT NOT NULL,as_of TEXT NOT NULL,
  freshness TEXT NOT NULL,-- current|stale|unknown
  relevance TEXT NOT NULL,eligibility TEXT NOT NULL,delivery TEXT NOT NULL,response TEXT NOT NULL,commercial TEXT NOT NULL,suggested_action TEXT NOT NULL,
  gates TEXT NOT NULL,critical_unknowns TEXT NOT NULL,reasons TEXT NOT NULL,is_current INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
CREATE INDEX procurement_assessments_record ON procurement_assessments(record_id,profile_version_id,is_current);
CREATE TABLE procurement_decisions(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,assessment_id TEXT,decision TEXT NOT NULL,-- pursue|no_bid|monitor|defer
  note TEXT NOT NULL,actor TEXT NOT NULL,needs_reconfirmation INTEGER NOT NULL DEFAULT 0,stale_reason TEXT,created_at TEXT NOT NULL);
CREATE INDEX procurement_decisions_record ON procurement_decisions(record_id,created_at);
CREATE TABLE procurement_tasks(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,-- acquire_evidence|resolve_gap|reconfirm_change|decide|other
  linked_type TEXT,linked_id TEXT,owner TEXT,due_at TEXT,status TEXT NOT NULL,-- open|done|cancelled
  completion_note TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX procurement_tasks_record ON procurement_tasks(record_id,status);
CREATE TABLE procurement_changes(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,kind TEXT NOT NULL,-- document_added|document_modified|document_missing_in_check|notice_modified|profile_published
  detail TEXT NOT NULL,detected_at TEXT NOT NULL,acknowledged_at TEXT,acknowledged_by TEXT);
CREATE INDEX procurement_changes_record ON procurement_changes(record_id,acknowledged_at);
` }, { version: 2, name: "reviewer-judgements", sql: `
CREATE TABLE procurement_judgements(record_id TEXT NOT NULL,profile_version_id TEXT NOT NULL,dimension TEXT NOT NULL,-- delivery|response|commercial|partner_scenario
  value TEXT NOT NULL,note TEXT NOT NULL,reviewer TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(record_id,profile_version_id,dimension));
` }];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

type Built = { catalog: Uint8Array; files: Map<string, Uint8Array>; counts: Record<string, number> };

function insert(db: DatabaseSync, table: string, row: Record<string, SqlParameter>) {
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]));
}

const codePoints = (text: string) => Array.from(text).length;
function span(text: string, quote: string) {
  const index = text.indexOf(quote);
  if (index < 0) throw new Error(`Quote not found in its source: ${quote}`);
  return { start: codePoints(text.slice(0, index)), end: codePoints(text.slice(0, index)) + codePoints(quote) };
}

function buildCatalog(path: string): Built {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=DELETE;${CATALOG_SCHEMA}`);
  db.exec(PROCUREMENT_JOURNAL);
  for (const migration of PROCUREMENT_MIGRATIONS) {
    db.exec(migration.sql);
    insert(db, "procurement_migrations", { version: migration.version, name: migration.name, checksum: sha256(migration.sql), applied_at: "2026-09-02T17:12:05.000Z" });
  }
  db.exec("BEGIN");

  const record = (id: string, kind: string, title: string, data: JsonObject, updatedAt: string) => {
    insert(db, "records", { id, kind, title, data: json(data), hash: sha256(json([kind, title, data])), updated_at: updatedAt });
  };

  // Notices and their collection history.
  for (const spec of NOTICES) {
    const { sourceKey, data, updatedAt } = noticeData(spec);
    const id = `opportunity:${sourceKey}`;
    if (recordIdOf.has(spec.key)) throw new Error(`Duplicate notice key ${spec.key}`);
    recordIdOf.set(spec.key, id);
    specOf.set(spec.key, spec);
    record(id, "opportunity", spec.title, data, updatedAt);
    insert(db, "record_history", { run_id: LATEST_RUN, record_id: sourceKey, data: json(data) });
    if (!spec.isNew) insert(db, "record_history", { run_id: PREVIOUS_RUN, record_id: sourceKey, data: json({ ...data, lastRunId: PREVIOUS_RUN, sourceCapturedAt: PREVIOUS_COLLECTED_AT }) });
  }
  for (const spec of AWARDS) {
    const { importKey, data, updatedAt } = awardData(spec);
    record(`award:${importKey}`, "award", spec.description, data, updatedAt);
  }
  const notice = (key: string) => {
    const id = recordIdOf.get(key);
    if (!id) throw new Error(`Unknown notice ${key}`);
    return id;
  };

  // Downloaded documents, content-addressed.
  const files = new Map<string, Uint8Array>();
  const documentIds = new Map<string, { id: string; sha256: string; text: string }>();
  for (const doc of DOCUMENTS) {
    const recordId = notice(doc.notice);
    const row = db.prepare("SELECT data FROM records WHERE id=?").get(recordId);
    const data = JSON.parse(String(row?.data)) as { attachments?: { name: string; url: string }[] };
    const attachment = data.attachments?.find((entry) => entry.name === doc.name);
    if (!attachment) throw new Error(`${doc.name} isn't an attachment of ${doc.notice}`);
    const bytes = doc.noText ? textPdf(" ", []) : textPdf(doc.title, doc.paragraphs);
    const digest = sha256(bytes);
    files.set(digest, bytes);
    const text = doc.noText ? "" : [doc.title, ...doc.paragraphs].join("\n\n");
    const id = `doc-${shortId(recordId, attachment.url)}`;
    documentIds.set(`${doc.notice}|${doc.name}`, { id, sha256: digest, text });
    insert(db, "documents", { id, record_id: recordId, url: attachment.url, name: doc.name, media_type: "application/pdf", sha256: digest, content: digest, text, status: "downloaded", error: null, updated_at: stamp(-1, "21:" + String(10 + documentIds.size).padStart(2, "0")), byte_length: bytes.byteLength });
  }

  // Prompts and AI reviews (the AI workbench's Analysis view).
  const prompt = "Is this notice a fit for a Vancouver community services society? Label the work area and summarize the fit in two sentences.";
  insert(db, "prompts", { id: "prompt-community-fit", name: "Community services fit", prompt, version: 1, updated_at: "2026-09-12T18:00:00.000Z" });
  const REVIEWED: [string, string[], string][] = [
    ["sdpr-engagement", ["community-engagement", "lived-experience"], "Province-wide engagement with people with lived experience of poverty. Strong fit; insurance limit needs attention."],
    ["mcfd-mentorship", ["youth-programs"], "Youth mentorship in the Lower Mainland. Strong fit with the society's current program."],
    ["richmond-food", ["food-security", "community-engagement"], "Food security strategy engagement in Richmond. Strong fit and a comparable past project."],
    ["coquitlam-seniors", ["seniors-programs"], "Weekly seniors' wellness programs. Good fit; tight timeline."],
    ["moti-hwy99", ["construction"], "Highway construction. Not a fit for the society."],
    ["hma-plain-language", ["plain-language", "multilingual-outreach"], "Plain-language rewriting and translation with community testing. Strong fit."],
  ];
  for (const [key, labels, summary] of REVIEWED) {
    insert(db, "reviews", { id: `review-${shortId(key)}`, run_id: "run-20261017-review", record_id: notice(key), prompt_id: "prompt-community-fit", prompt_version: 1, fingerprint: sha256(`prompt-community-fit:1:${key}`), model: MODEL, status: "succeeded",
      result: json({ summary, labels, fields: {}, evidence: [], coverage: null, unverifiedEvidenceCount: 0, prompt: { id: "prompt-community-fit", version: 1, instructions: prompt } }), error: null, created_at: "2026-10-17T22:41:00.000Z" });
  }

  // Batch history (Home "Source health"). Nothing is left running in a published copy.
  const BATCHES: [string, string, string, number, number, number, string | null, string][] = [
    ["batch-download-1017", "download", "succeeded", 8, 0, 8, null, "2026-10-18T04:22:00.000Z"],
    ["batch-review-1017", "review", "succeeded", 6, 0, 6, null, "2026-10-18T05:41:00.000Z"],
    ["batch-triage-1017", "procurement-triage", "succeeded", Object.keys(TRIAGE).length, 0, Object.keys(TRIAGE).length, null, "2026-10-18T06:05:00.000Z"],
    ["batch-extract-1017", "procurement-extract", "partial", 5, 1, 6, "1 notice failed: the RFP package for EMCR-2026-RFP-0074 has not been downloaded.", "2026-10-18T06:31:00.000Z"],
    ["batch-download-1010", "download", "failed", 0, 3, 3, "bcbid.gov.bc.ca answered 503 Service Unavailable; retry later.", "2026-10-11T04:15:00.000Z"],
  ];
  for (const [id, kind, status, completed, failed, total, error, updatedAt] of BATCHES) {
    insert(db, "batches", { id, kind, status, input: json({ recordIds: total }), completed, failed, total, error, updated_at: updatedAt });
  }

  // Workspace state: revision, pursuits, saved searches, a hidden notice.
  const state = (key: string, value: Json | string, updatedAt = PUBLISHED_AT) => insert(db, "workspace_state", { key, data: typeof value === "string" ? value : json(value), updated_at: updatedAt });
  state("_revision", "48");
  state("_primary", "true");
  const pursuit = (key: string, stage: string, notes: string, updatedAt: string, version: number): JsonObject => {
    const spec = specOf.get(key);
    return { recordId: notice(key), sourceId: spec?.source ?? "bc-bid", title: spec?.title ?? key, stage, notes, version, updatedAt, lastRunId: `run-pursuit-${shortId(key, stage)}` };
  };
  state("procurement:pursuits", { schemaVersion: 1, items: [
    pursuit("mcfd-mentorship", "Preparing", "Draft due to Mina Monday. Reuse the 2025 Fraser outcomes table.", stamp(-1, "16:20"), 4),
    pursuit("richmond-food", "Reviewing", "Ask Cedar & Main about survey translation costs.", stamp(-3, "11:05"), 2),
    pursuit("bch-tenant-support", "Reviewing", "Board to discuss whether 24/7 operations fit our strategy.", stamp(-2, "10:00"), 3),
    pursuit("esdc-seniors", "Watching", "Need a French-speaking facilitator partner.", stamp(-19, "14:30"), 1),
    pursuit("pg-warming", "Submitted", "Submitted with Northern Shelter Partners as lead.", stamp(-4, "13:45"), 5),
    pursuit("sdpr-navigator", "Closed", "Did not bid: timeline clashed with AGM preparation.", stamp(-8, "09:30"), 2),
  ] });
  const filters = (overrides: JsonObject): JsonObject => ({ source: "", kind: "opportunity", search: "", region: "", category: "", classification: "", buyer: "", supplier: "", deadline: "all", shortlist: false, exclude: "", place: "", ...overrides });
  state("procurement:searches", { schemaVersion: 1, items: [
    { id: "engagement-lower-mainland", name: "Engagement - Metro Vancouver", filters: filters({ search: "engagement", place: `rd:${METRO}`, exclude: "construction, paving" }), archived: false, version: 1, updatedAt: "2026-09-20T17:00:00.000Z", lastRunId: "run-search-1" },
    { id: "seniors-and-youth", name: "Seniors and youth programs", filters: filters({ search: "seniors" }), archived: false, version: 2, updatedAt: "2026-10-02T17:00:00.000Z", lastRunId: "run-search-2" },
    { id: "closing-this-week", name: "Closing this week", filters: filters({ deadline: "week" }), archived: false, version: 1, updatedAt: "2026-10-05T17:00:00.000Z", lastRunId: "run-search-3" },
  ] });
  const hidden = notice("abbotsford-paving");
  state(`procurement:hidden:${sha256(hidden)}`, { schemaVersion: 1, recordId: hidden, hidden: true, updatedAt: stamp(-2, "15:10"), lastRunId: "run-hide-1" });

  // Company profile, published once.
  insert(db, "procurement_profiles", { id: PROFILE_ID, name: "Riverside Community Society", draft: json(PROFILE_DRAFT), draft_version: 3, updated_at: "2026-10-02T18:30:00.000Z" });
  insert(db, "procurement_profile_versions", { id: PROFILE_VERSION_ID, profile_id: PROFILE_ID, version: 1, data: json(PROFILE_DRAFT), published_at: "2026-10-02T18:30:00.000Z", published_by: OWNER });

  // Triage from the saved notice, for every triaged notice.
  const triagedAt = (index: number) => new Date(Date.parse("2026-10-18T05:50:00.000Z") + index * 23_000).toISOString();
  Object.entries(TRIAGE).forEach(([key, triage], index) => {
    const recordId = notice(key);
    insert(db, "procurement_stage_runs", { id: `sr-triage-${shortId(key)}`, run_id: "run-20261018-triage", record_id: recordId, stage: "triage", stage_key: sha256(`triage:${key}`), bundle_id: null,
      template_id: "procurement.triage", template_version: 1, model: MODEL, status: "succeeded", quality: "valid", is_current: 1, summary: triage.summary,
      output: json({ classification: triage.classification, relevance: triage.relevance, workCategory: triage.workCategory, summary: triage.summary, missingInformation: triage.missing ?? [] }),
      coverage: json({ scope: "notice" }), usage: json({ inputTokens: 1800 + (index * 37) % 400, outputTokens: 210 + (index * 13) % 90, calls: 1 }), issues: "[]", rejected_raw: null, error: null,
      started_at: triagedAt(index), finished_at: new Date(Date.parse(triagedAt(index)) + 9_000).toISOString() });
  });

  // Requirement extraction: notice text plus every readable document.
  let extractIndex = 0;
  for (const [key, requirements] of Object.entries(REQUIREMENTS)) {
    const recordId = notice(key);
    const spec = specOf.get(key);
    const started = new Date(Date.parse("2026-10-18T06:10:00.000Z") + extractIndex++ * 180_000).toISOString();
    const finished = new Date(Date.parse(started) + 95_000).toISOString();
    const runId = `sr-extract-${shortId(key)}`;
    const noticeText = [spec?.title ?? "", spec?.summary ?? ""].join("\n\n");
    const extractions = new Map<string, { id: string; text: string; sha: string }>();
    const noticeExtraction = { id: `ex-${shortId(key, "notice")}`, text: noticeText, sha: sha256(noticeText) };
    insert(db, "procurement_extractions", { id: noticeExtraction.id, record_id: recordId, document_id: null, source_kind: "notice", sha256: sha256(noticeText), name: "Saved notice", extractor_version: "notice-view-v1",
      text: noticeText, text_sha256: noticeExtraction.sha, code_points: codePoints(noticeText), status: "readable", blocks: "[]", limitations: "[]", created_at: started });
    const docs = DOCUMENTS.filter((doc) => doc.notice === key && !doc.noText);
    for (const doc of docs) {
      const stored = documentIds.get(`${key}|${doc.name}`);
      if (!stored) continue;
      const extraction = { id: `ex-${shortId(key, doc.name)}`, text: stored.text, sha: sha256(stored.text) };
      extractions.set(doc.name, extraction);
      insert(db, "procurement_extractions", { id: extraction.id, record_id: recordId, document_id: stored.id, source_kind: "document", sha256: stored.sha256, name: doc.name, extractor_version: "host-text-v1",
        text: stored.text, text_sha256: extraction.sha, code_points: codePoints(stored.text), status: "readable", blocks: "[]", limitations: "[]", created_at: started });
    }
    const attachments = spec?.attachments?.length ?? 0;
    insert(db, "procurement_stage_runs", { id: runId, run_id: "run-20261018-extract", record_id: recordId, stage: "extract", stage_key: sha256(`extract:${key}`), bundle_id: null,
      template_id: "procurement.extract", template_version: 1, model: MODEL, status: "succeeded", quality: key === "bch-tenant-support" ? "needs_review" : "valid", is_current: 1,
      summary: `${requirements.length} requirements and ${(FACTS[key] ?? []).length} facts from the notice and ${docs.length} document${docs.length === 1 ? "" : "s"}.`,
      output: json({ requirements: requirements.length, facts: (FACTS[key] ?? []).length }),
      coverage: json({ discovered: attachments, downloaded: docs.length, usableText: docs.length, processed: docs.length + 1, sourceCompleteness: "checked_public_scope", missing: [] }),
      usage: json({ inputTokens: 9400 + extractIndex * 611, outputTokens: 1350 + extractIndex * 97, calls: docs.length + 1 }),
      issues: key === "bch-tenant-support" ? json(["Insurance limit differs between the RFP and Addendum 1."]) : "[]", rejected_raw: null, error: null, started_at: started, finished_at: finished });

    requirements.forEach((requirement, ordinal) => {
      const extraction = extractions.get(requirement.document);
      if (!extraction) throw new Error(`No extraction for ${requirement.document}`);
      const id = `rq-${shortId(key, String(ordinal))}`;
      insert(db, "procurement_requirements", { id, record_id: recordId, lot_id: null, stage_run_id: runId, ordinal: ordinal + 1, text: requirement.quote.replace(/^the /, "The "), strength: requirement.strength, category: requirement.category,
        actor: requirement.strength === "informational" ? null : "Proponent", required_by: null, condition_text: null, grounding: "exact", supersedes: "[]", conflicts: "[]", created_at: finished });
      const { start, end } = span(extraction.text, requirement.quote);
      insert(db, "procurement_spans", { id: `sp-${shortId(id)}`, record_id: recordId, target_type: "requirement", target_id: id, extraction_id: extraction.id, text_sha256: extraction.sha, start_cp: start, end_cp: end, quote: requirement.quote, page: 1, heading: null, alignment: "exact" });
      if (requirement.accepted) {
        insert(db, "procurement_review_state", { target_type: "requirement", target_id: id, record_id: recordId, state: "accepted", value: null, revision: 1, updated_at: stamp(-1, "10:15") });
        insert(db, "procurement_review_events", { id: `re-${shortId(id)}`, record_id: recordId, target_type: "requirement", target_id: id, event: "accept", reason: "Matches the RFP wording.", correction: null, reviewer: REVIEWER, revision: 1, occurred_at: stamp(-1, "10:15") });
      }
      if (requirement.match) {
        insert(db, "procurement_matches", { requirement_id: id, profile_version_id: PROFILE_VERSION_ID, record_id: recordId, status: requirement.match.status, origin: "buyer_mandatory", company_evidence: json(requirement.match.evidence ?? []),
          rationale: requirement.match.rationale, remediable: requirement.match.status === "remediable_gap" ? 1 : null, reviewed: requirement.match.status === "unknown" ? 0 : 1, reviewer: REVIEWER, revision: 1, updated_at: stamp(-1, "11:00") });
      }
    });

    (FACTS[key] ?? []).forEach((fact, index) => {
      const id = `fa-${shortId(key, fact.field, String(index))}`;
      insert(db, "procurement_facts", { id, record_id: recordId, lot_id: null, stage_run_id: runId, field_key: fact.field, semantic_type: fact.type, status: fact.status, value: fact.value === null ? null : json(fact.value), grounding: fact.quote ? "exact" : "unverified", created_at: finished });
      if (fact.document && fact.quote) {
        const extraction = extractions.get(fact.document);
        if (!extraction) throw new Error(`No extraction for ${fact.document}`);
        const { start, end } = span(extraction.text, fact.quote);
        insert(db, "procurement_spans", { id: `sp-${shortId(id)}`, record_id: recordId, target_type: "fact", target_id: id, extraction_id: extraction.id, text_sha256: extraction.sha, start_cp: start, end_cp: end, quote: fact.quote, page: 1, heading: null, alignment: "exact" });
      }
    });
  }
  // The extraction that failed in the partial batch: retried later, nothing current.
  insert(db, "procurement_stage_runs", { id: `sr-extract-${shortId("emcr-prep")}`, run_id: "run-20261018-extract", record_id: notice("emcr-prep"), stage: "extract", stage_key: sha256("extract:emcr-prep"), bundle_id: null,
    template_id: "procurement.extract", template_version: 1, model: MODEL, status: "failed", quality: null, is_current: 0, summary: null, output: null,
    coverage: json({ discovered: 2, downloaded: 0, usableText: 0, processed: 1, sourceCompleteness: "unknown", missing: [{ name: "RFP EMCR-2026-RFP-0074.pdf", reason: "not downloaded", critical: true }] }),
    usage: json({ known: false }), issues: "[]", rejected_raw: null, error: "The RFP package has not been downloaded; only the notice text was available.", started_at: "2026-10-18T06:28:00.000Z", finished_at: "2026-10-18T06:29:10.000Z" });

  // Assessments: the no-profile one from triage, and one for the published profile.
  const asOf = "2026-10-18T06:40:00.000Z";
  for (const assessment of PROFILE_ASSESSMENTS) {
    const recordId = notice(assessment.notice);
    const triage = TRIAGE[assessment.notice];
    const relevance = triage?.relevance ?? assessment.relevance;
    insert(db, "procurement_assessments", { id: `as-none-${shortId(assessment.notice)}`, record_id: recordId, lot_id: null, bundle_id: null, profile_version_id: null, policy_version: "procurement-policy-v1", as_of: asOf, freshness: "current",
      relevance, eligibility: "not_assessed", delivery: "not_assessed", response: "not_assessed", commercial: "not_assessed", suggested_action: relevance === "weak" ? "archive_or_monitor" : "needs_information",
      gates: "[]", critical_unknowns: json(["No company profile selected"]), reasons: json([triage?.summary ?? "Assessed from the saved notice only."]), is_current: 1, created_at: asOf });
    const gates = (REQUIREMENTS[assessment.notice] ?? []).filter((requirement) => requirement.strength === "mandatory" && requirement.match)
      .map((requirement) => gate(`rq-${shortId(assessment.notice, String((REQUIREMENTS[assessment.notice] ?? []).indexOf(requirement)))}`, requirement.match?.status ?? "unknown", requirement.match?.rationale ?? "", requirement.match?.status === "remediable_gap" ? true : null));
    insert(db, "procurement_assessments", { id: `as-pv1-${shortId(assessment.notice)}`, record_id: recordId, lot_id: null, bundle_id: null, profile_version_id: PROFILE_VERSION_ID, policy_version: "procurement-policy-v1", as_of: asOf,
      freshness: assessment.stale ? "stale" : "current", relevance: assessment.relevance, eligibility: assessment.eligibility, delivery: assessment.delivery, response: assessment.response, commercial: assessment.commercial,
      suggested_action: assessment.action, gates: json(gates), critical_unknowns: json(assessment.unknowns ?? []), reasons: json(assessment.reasons), is_current: 1, created_at: asOf });
  }

  // Human decisions, tasks, changes and judgements.
  const decision = (key: string, value: string, note: string, createdAt: string, reconfirm: string | null = null) => insert(db, "procurement_decisions", {
    id: `de-${shortId(key, value)}`, record_id: notice(key), assessment_id: `as-pv1-${shortId(key)}`, decision: value, note, actor: OWNER, needs_reconfirmation: reconfirm ? 1 : 0, stale_reason: reconfirm, created_at: createdAt,
  });
  decision("mcfd-mentorship", "pursue", "Strong fit and we meet every mandatory requirement. Jordan to confirm budget.", stamp(-2, "16:00"));
  decision("bch-tenant-support", "pursue", "Worth pursuing if the board agrees to 24/7 operations.", stamp(-6, "15:30"), "Addendum 1 raised the insurance requirement to $5,000,000 after this decision.");
  decision("moti-hwy99", "no_bid", "Construction is outside our mandate.", stamp(-5, "09:10"));
  decision("abbotsford-paving", "no_bid", "Paving; not our work.", stamp(-2, "15:05"));
  decision("dbc-visitor-survey", "monitor", "Watch for a smaller regional lot next year.", stamp(-4, "12:00"));
  const task = (key: string, title: string, kind: string, owner: string, dueIn: number) => insert(db, "procurement_tasks", {
    id: `tk-${shortId(key, title)}`, record_id: notice(key), title, kind, linked_type: null, linked_id: null, owner, due_at: daysFromToday(dueIn), status: "open", completion_note: null, version: 1, created_at: stamp(-1, "11:20"), updated_at: stamp(-1, "11:20"),
  });
  task("sdpr-engagement", "Ask the broker to quote a $5,000,000 CGL limit", "resolve_gap", "Jordan Lee", 4);
  task("bch-tenant-support", "Reconfirm the pursue decision after Addendum 1", "reconfirm_change", OWNER, 2);
  task("emcr-prep", "Download the RFP package from BC Bid", "acquire_evidence", REVIEWER, 1);
  task("esdc-seniors", "Find a French-speaking facilitator partner", "resolve_gap", OWNER, 10);
  const addendum = documentIds.get("bch-tenant-support|Addendum 1.pdf");
  insert(db, "procurement_changes", { id: `ch-${shortId("bch-tenant-support", "addendum")}`, record_id: notice("bch-tenant-support"), kind: "document_added", detail: json({ documentId: addendum?.id ?? "", name: "Addendum 1.pdf", sha256: addendum?.sha256 ?? "" }), detected_at: stamp(-1, "21:15"), acknowledged_at: null, acknowledged_by: null });
  insert(db, "procurement_changes", { id: `ch-${shortId("transit-rider", "notice")}`, record_id: notice("transit-rider"), kind: "notice_modified", detail: json({ previousSha256: sha256("transit-rider:before"), sha256: sha256("transit-rider:after") }), detected_at: stamp(0, "06:40"), acknowledged_at: null, acknowledged_by: null });
  insert(db, "procurement_judgements", { record_id: notice("sdpr-engagement"), profile_version_id: PROFILE_VERSION_ID, dimension: "delivery", value: "feasible", note: "Avery and two contract facilitators can cover 16 sessions between January and May.", reviewer: REVIEWER, revision: 1, updated_at: stamp(-1, "11:40") });
  insert(db, "procurement_judgements", { record_id: notice("esdc-seniors"), profile_version_id: PROFILE_VERSION_ID, dimension: "partner_scenario", value: "needed", note: "French sessions only with a partner.", reviewer: OWNER, revision: 1, updated_at: stamp(-3, "14:00") });

  db.exec("COMMIT");
  const counts: Record<string, number> = {};
  for (const row of db.prepare("SELECT kind, count(*) AS count FROM records GROUP BY kind ORDER BY kind").all()) counts[String(row.kind)] = Number(row.count);
  db.close();
  return { catalog: new Uint8Array(readFileSync(path)), files, counts };
}

/** A consistent, compact copy, as the publisher makes with VACUUM INTO. */
function build(): Built {
  const scratch = mkdtempSync(join(tmpdir(), "procurement-review-demo-"));
  try {
    const built = buildCatalog(join(scratch, "live.sqlite"));
    const db = new DatabaseSync(join(scratch, "live.sqlite"));
    db.exec(`VACUUM INTO '${join(scratch, "catalog.sqlite").replace(/'/g, "''")}'`);
    db.close();
    return { ...built, catalog: new Uint8Array(readFileSync(join(scratch, "catalog.sqlite"))) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function packageSnapshot(built: Built): { manifest: SnapshotManifest; outputs: Map<string, Uint8Array> } {
  const catalogSha = sha256(built.catalog);
  const snapshotId = `${PUBLISHED_AT.slice(0, 19).replace(/[-:]/g, "")}Z-${catalogSha.slice(0, 12)}`;
  const compressed = gzipSync(built.catalog, { level: 9 });
  const outputs = new Map<string, Uint8Array>();
  const catalogParts: SnapshotManifest["catalog"]["parts"] = [];
  for (let offset = 0, index = 0; offset < compressed.byteLength; offset += SNAPSHOT_PART_BYTES, index++) {
    const part = compressed.subarray(offset, offset + SNAPSHOT_PART_BYTES);
    const path = `snapshots/${snapshotId}/catalog.part-${String(index).padStart(3, "0")}`;
    outputs.set(path, part);
    catalogParts.push({ path, bytes: part.byteLength, sha256: sha256(part) });
  }
  const files: SnapshotManifest["files"] = {};
  for (const [digest, bytes] of [...built.files].sort(([left], [right]) => left.localeCompare(right))) {
    if (bytes.byteLength > SNAPSHOT_PART_BYTES) throw new Error("Demo documents must stay under one part.");
    outputs.set(`files/${digest}`, bytes);
    files[digest] = { bytes: bytes.byteLength, parts: 0 };
  }
  const manifest: SnapshotManifest = {
    format: "zoer-plugin-snapshot", formatVersion: 1, pluginId: "bc-bid-monitor", pluginVersion: PLUGIN_VERSION, snapshotId, publishedAt: PUBLISHED_AT,
    publisher: { zoerVersion: "demo", host: "Societyer demo" },
    catalog: { encoding: "gzip", sha256: catalogSha, bytes: built.catalog.byteLength, parts: catalogParts },
    files, counts: built.counts,
  };
  outputs.set("manifest.json", new TextEncoder().encode(`${JSON.stringify(parseSnapshotManifest(manifest), null, 2)}\n`));
  return { manifest, outputs };
}

/** Every table's rows in a fixed order: equal dumps mean the same catalog content, whatever SQLite build wrote the file. */
function dumpCatalog(bytes: Uint8Array): string {
  const scratch = mkdtempSync(join(tmpdir(), "procurement-review-demo-check-"));
  try {
    const path = join(scratch, "catalog.sqlite");
    writeFileSync(path, bytes);
    const db = new DatabaseSync(path, { readOnly: true });
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const lines = tables.map((table) => `${String(table.name)}: ${String(table.sql)}`);
    for (const table of tables.filter((entry) => String(entry.sql).startsWith("CREATE TABLE"))) {
      for (const row of db.prepare(`SELECT * FROM "${String(table.name)}" ORDER BY 1, 2`).all()) lines.push(`${String(table.name)} ${JSON.stringify(row)}`);
    }
    db.close();
    return lines.join("\n");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const fresh = packageSnapshot(build());

if (process.argv.includes("--check")) {
  const fail = (message: string): never => {
    console.error(`build-procurement-review-demo: ${message} Run tsx scripts/build-procurement-review-demo.ts to rebuild it.`);
    process.exit(1);
  };
  const manifestPath = join(outputDirectory, "manifest.json");
  if (!existsSync(manifestPath)) fail("The demo snapshot isn't built.");
  const committed = parseSnapshotManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const parts = committed.catalog.parts.map((part) => {
    const bytes = new Uint8Array(readFileSync(join(outputDirectory, part.path)));
    if (bytes.byteLength !== part.bytes || sha256(bytes) !== part.sha256) fail(`${part.path} doesn't match the manifest.`);
    return bytes;
  });
  const catalog = new Uint8Array(gunzipSync(Buffer.concat(parts)));
  if (catalog.byteLength !== committed.catalog.bytes || sha256(catalog) !== committed.catalog.sha256) fail("The committed catalog doesn't match the manifest.");
  for (const [digest, file] of Object.entries(committed.files)) {
    const bytes = Buffer.concat(snapshotFilePaths(digest, file).map((path) => readFileSync(join(outputDirectory, path))));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== digest) fail(`files/${digest} doesn't match the manifest.`);
  }
  const freshCatalog = new Uint8Array(gunzipSync(Buffer.concat(fresh.manifest.catalog.parts.map((part) => fresh.outputs.get(part.path) ?? new Uint8Array()))));
  if (dumpCatalog(catalog) !== dumpCatalog(freshCatalog)) fail("The committed catalog is out of date with this script.");
  if (JSON.stringify(Object.keys(committed.files).sort()) !== JSON.stringify(Object.keys(fresh.manifest.files).sort())) fail("The committed documents are out of date with this script.");
  if (JSON.stringify(committed.counts) !== JSON.stringify(fresh.manifest.counts)) fail("The committed record counts are out of date with this script.");
  console.log(`build-procurement-review-demo: the committed demo snapshot ${committed.snapshotId} is intact and current.`);
  process.exit(0);
}

rmSync(outputDirectory, { recursive: true, force: true });
let total = 0;
for (const [path, bytes] of fresh.outputs) {
  const target = join(outputDirectory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  total += bytes.byteLength;
}
console.log(`build-procurement-review-demo: wrote snapshot ${fresh.manifest.snapshotId} (${Object.entries(fresh.manifest.counts).map(([kind, count]) => `${count} ${kind}`).join(", ")}; ${fresh.outputs.size} files, ${Math.round(total / 1024)} KB) to public/${DEMO_PROCUREMENT_REVIEW_DIRECTORY}`);
