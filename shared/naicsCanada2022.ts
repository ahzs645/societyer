/** Official sector titles/codes; descriptions, examples and search terms are app guidance. */
export const NAICS_CANADA_VERSION = "2022 Version 1.0" as const;
export const NAICS_CANADA_SOURCE_URL = "https://www23.statcan.gc.ca/imdb/p3VD.pl?Function=getVD&TVD=1369825";

export const NAICS_ACTIVITY_GROUPS = [
  { id: "produce", label: "Grow, extract, make or build" },
  { id: "trade", label: "Sell, transport, store or rent" },
  { id: "business", label: "Information, finance or business services" },
  { id: "care", label: "Education, health or social support" },
  { id: "hospitality", label: "Arts, recreation, food or accommodation" },
  { id: "community", label: "Personal, community or government services" },
] as const;
export type NaicsActivityGroup = typeof NAICS_ACTIVITY_GROUPS[number]["id"];

export const NAICS_CANADA_SECTORS = [
  { code: "11", title: "Agriculture, forestry, fishing and hunting", group: "produce", description: "Grow crops, raise animals, harvest timber, or catch fish and wildlife.", examples: "Farms, greenhouses, logging and commercial fishing", terms: "farming farmer ranch livestock gardening nursery aquaculture agriculture forestry" },
  { code: "21", title: "Mining, quarrying, and oil and gas extraction", group: "produce", description: "Extract minerals, oil or gas, or provide support for extraction.", examples: "Mines, gravel quarries, oil wells and drilling services", terms: "mining quarry petroleum natural gas extraction exploration" },
  { code: "22", title: "Utilities", group: "produce", description: "Supply electricity, natural gas, steam, water or sewage services.", examples: "Electric utilities, water supply and sewage treatment", terms: "power electricity electric generation hydro renewable utility sewer" },
  { code: "23", title: "Construction", group: "produce", description: "Construct or renovate buildings and infrastructure, including specialty trades.", examples: "Builders, electricians, plumbers and road construction", terms: "contractor contracting renovation roofing plumbing electrical carpenter building" },
  { code: "31-33", title: "Manufacturing", group: "produce", description: "Transform materials or components into new products.", examples: "Food production, breweries, furniture makers and factories", terms: "manufacturer fabrication processing assembly bakery baking brewery printing clothing production" },
  { code: "41", title: "Wholesale trade", group: "trade", description: "Distribute goods mainly to businesses, institutions or other resellers.", examples: "Business suppliers, distributors and wholesale agents", terms: "wholesaler distributor distribution import export merchant b2b" },
  { code: "44-45", title: "Retail trade", group: "trade", description: "Sell goods mainly to the public, in stores or through the Internet.", examples: "Grocery stores, online shops, clothing stores and pharmacies", terms: "retailer ecommerce e commerce shop shopping grocery store consumer resale florist bakery" },
  { code: "48-49", title: "Transportation and warehousing", group: "trade", description: "Move passengers or goods, deliver packages, or store goods.", examples: "Trucking, taxis, couriers, transit and warehouses", terms: "transport logistics shipping delivery freight moving rideshare ride hailing storage airline" },
  { code: "51", title: "Information and cultural industries", group: "business", description: "Publish or distribute information and cultural products, or provide telecommunications and data services.", examples: "Software publishers, film production, streaming, telecom and hosting", terms: "publishing publisher saas software app newspaper media music video broadcasting internet data processing cloud computing library libraries" },
  { code: "52", title: "Finance and insurance", group: "business", description: "Provide financial services, manage investments, or insure risks.", examples: "Banks, credit unions, insurers and investment funds", terms: "banking lending loans mortgage brokerage insurance broker investing financial fintech" },
  { code: "53", title: "Real estate and rental and leasing", group: "trade", description: "Rent, lease, manage or broker real estate and other assets.", examples: "Landlords, real estate agents, property managers and equipment rentals", terms: "realtor property housing leasing rental car equipment leasing commercial residential" },
  { code: "54", title: "Professional, scientific and technical services", group: "business", description: "Provide specialized services based on professional or technical expertise.", examples: "Consultants, lawyers, accountants, engineers and custom software developers", terms: "consulting consultant legal accounting architecture design advertising research science veterinary veterinarian programming programmer software development developer it services web design" },
  { code: "55", title: "Management of companies and enterprises", group: "business", description: "Hold controlling interests in companies or manage affiliated enterprises as a head office.", examples: "Holding companies and corporate head offices", terms: "holding company parent company headquarters managing subsidiaries" },
  { code: "56", title: "Administrative and support, waste management and remediation services", group: "business", description: "Support other organizations' routine operations, or manage waste and environmental cleanup.", examples: "Cleaning, staffing, security, travel agencies and waste collection", terms: "janitorial cleaner employment recruitment call centre landscaping lawn care recycling garbage remediation pest control admin support" },
  { code: "61", title: "Educational services", group: "care", description: "Provide instruction, training or educational support.", examples: "Schools, colleges, tutoring and skills training", terms: "education teaching teacher course learning lessons school university vocational language instruction" },
  { code: "62", title: "Health care and social assistance", group: "care", description: "Provide health care, residential care, or individual and family support.", examples: "Clinics, counselling, childcare, shelters and food banks", terms: "healthcare doctor dentist dental medical nursing therapy therapist daycare child care disability seniors social work community support counselling counseling charity relief" },
  { code: "71", title: "Arts, entertainment and recreation", group: "hospitality", description: "Present artistic work, preserve cultural heritage, or provide recreation.", examples: "Performing arts, museums, sports clubs, gyms and amusement parks", terms: "artist theatre theater culture gallery heritage fitness athletic sport recreation entertainment musician festival gaming" },
  { code: "72", title: "Accommodation and food services", group: "hospitality", description: "Provide short-stay lodging or prepare meals and drinks for customers.", examples: "Hotels, restaurants, cafés, caterers and food trucks", terms: "motel camping campground hostel restaurant cafe coffee catering bar pub dining takeout takeaway meal" },
  { code: "81", title: "Other services (except public administration)", group: "community", description: "Provide repair, personal care, religious, membership or similar services.", examples: "Repair shops, salons, places of worship and membership associations", terms: "mechanic automotive hair beauty barber laundry funeral church religion religious union association advocacy foundation fundraising grantmaking nonprofit non profit not for profit charity" },
  { code: "91", title: "Public administration", group: "community", description: "Carry out governmental administration and public programs as a government body.", examples: "Federal, provincial, territorial, municipal and Indigenous government administration", terms: "government municipality municipal public administration first nation band council indigenous defence justice" },
] as const satisfies readonly { code: string; title: string; group: NaicsActivityGroup; description: string; examples: string; terms: string }[];

export type NaicsSectorCode = typeof NAICS_CANADA_SECTORS[number]["code"];
export type NaicsSectorSelection = { code: NaicsSectorCode; version: typeof NAICS_CANADA_VERSION };

export function getNaicsSector(code?: string | null) {
  return NAICS_CANADA_SECTORS.find((sector) => sector.code === code);
}

/** Uses the prefix only: this does not validate a detailed industry code or its edition. */
export function sectorForNaicsCode(code?: string | null) {
  const value = code?.trim();
  if (!value) return undefined;
  const exact = getNaicsSector(value);
  if (exact) return exact;
  if (!/^\d{2,6}$/.test(value)) return undefined;
  const prefix = value.slice(0, 2);
  const grouped = ["31", "32", "33"].includes(prefix) ? "31-33"
    : ["44", "45"].includes(prefix) ? "44-45"
    : ["48", "49"].includes(prefix) ? "48-49" : prefix;
  return getNaicsSector(grouped);
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** A transparent keyword filter, not an official classification or an AI inference. */
export function searchNaicsSectors(query: string, group?: NaicsActivityGroup | "") {
  const normalized = normalize(query);
  const codeMatch = sectorForNaicsCode(query);
  const ignored = new Set(["a", "an", "and", "are", "as", "at", "business", "charity", "for", "i", "in", "is", "it", "my", "non", "nonprofit", "not", "of", "on", "online", "our", "profit", "the", "to", "we", "with"]);
  const tokens = normalized.split(" ").filter((token) => token && !ignored.has(token));
  return NAICS_CANADA_SECTORS.filter((sector) => {
    if (group && sector.group !== group) return false;
    if (!normalized) return true;
    if (codeMatch) return codeMatch.code === sector.code;
    // Legal form and digital delivery alone do not identify an economic activity.
    if (!tokens.length) return true;
    const searchable = normalize(`${sector.title} ${sector.description} ${sector.examples} ${sector.terms}`);
    return tokens.some((token) => searchable.includes(token));
  });
}

/** Shared by hosted and local writes; older records may omit the selection. */
export function validateNaicsSectorSelection(value: unknown): asserts value is NaicsSectorSelection | null | undefined {
  if (value == null) return;
  if (typeof value !== "object" || !("code" in value) || typeof value.code !== "string" || !getNaicsSector(value.code)
    || !("version" in value) || value.version !== NAICS_CANADA_VERSION) {
    throw new Error("Choose a sector from NAICS Canada 2022 Version 1.0, or leave it unselected.");
  }
}
