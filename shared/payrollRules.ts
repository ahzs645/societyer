import official from "./payrollRates/reviewed-2026.json";
import { payrollRateSetFor, type PayrollRateSet } from "./payrollRates";

export type PayrollRuleStatus = "draft" | "reviewed" | "published" | "retired";
export type PayrollRuleSource = {
  authority: string;
  title: string;
  url: string;
  reviewedOn: string;
  notes: string;
};
export type PayrollRuleDraft = {
  name: string;
  description?: string;
  rateSet: PayrollRateSet;
  sourceEvidence: PayrollRuleSource[];
};
export type PayrollRuleEdition = PayrollRuleDraft & {
  _id: string;
  societyId: string;
  libraryId: string;
  revision: number;
  status: PayrollRuleStatus;
  baseOfficialId: string;
  contentHash: string;
  createdAtISO: string;
  updatedAtISO: string;
  createdByUserId: string;
  reviewedByUserId?: string;
  reviewedAtISO?: string;
  reviewEvidence?: string;
  publishedByUserId?: string;
  publishedAtISO?: string;
  retiredAtISO?: string;
  retiredByUserId?: string;
  retirementReason?: string;
};
export type PayrollRuleProvenance = {
  id: string;
  libraryId: string;
  revision: number;
  version: number;
  name: string;
  status: "published";
  contentHash: string;
  sourceEvidence: PayrollRuleSource[];
  reviewedByUserId: string;
  reviewedAtISO: string;
  publishedAtISO: string;
  rateSet: PayrollRateSet;
};
export const OFFICIAL_PAYROLL_RULE_EDITIONS: readonly PayrollRateSet[] =
  official;
export const PAYROLL_RULE_SOURCE_CATALOG = [
  {
    authority: "Canada Revenue Agency",
    title: "T4127 payroll deductions formulas",
    url: "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html",
    guidance:
      "Use the edition effective on the payment date; check method-specific tables and the July update.",
  },
  {
    authority: "Canada Revenue Agency",
    title: "CPP contribution rates, maximums and exemptions",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html",
    guidance:
      "Confirm YMPE, YAMPE, basic exemption, base/enhanced CPP and CPP2 rates and maxima.",
  },
  {
    authority: "Canada Revenue Agency",
    title: "EI premium rates and maximums",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rate-maximum.html",
    guidance:
      "Confirm annual insurable maximum and employee premium. Employer reduced rates need actual employer approval.",
  },
  {
    authority: "British Columbia",
    title: "Employment Standards Act",
    url: "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/00_96113_01",
    guidance:
      "Employment policy, overtime, leave and wage timing are separate from deduction rate parameters.",
  },
  {
    authority: "British Columbia",
    title: "Employer health tax",
    url: "https://www2.gov.bc.ca/gov/content/taxes/employer-health-tax/employer-health-tax-overview",
    guidance:
      "Set the actual employer class, association, location qualifications and openings in Employer setup.",
  },
  {
    authority: "WorkSafeBC",
    title: "Industry premium rates",
    url: "https://www.worksafebc.com/en/insurance/know-coverage-costs/industry-premium-rates",
    guidance:
      "Use the employer’s actual annual net rate notice and assessable maximum in Employer setup.",
  },
] as const;

function object(
  raw: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => !keys.includes(key))
  )
    throw new Error(`${label} contains unsupported fields or formula syntax.`);
  return raw as Record<string, unknown>;
}
function text(raw: unknown, label: string, max = 4000) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > max)
    throw new Error(`${label} is required (maximum ${max} characters).`);
  return raw.trim();
}
function cents(raw: unknown, label: string) {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    raw > 1_000_000_000_000
  )
    throw new Error(
      `${label} must be nonnegative integer cents within the supported range.`,
    );
  return raw;
}
function date(raw: unknown, label: string) {
  const value = text(raw, label, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be an exact calendar date.`);
  return value;
}
function rate(raw: unknown, label: string, maximum = 1) {
  const value = text(raw, label, 18);
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || Number(value) > maximum)
    throw new Error(
      `${label} must be a decimal rate from 0 to ${maximum}, with at most six decimal places (5.95% is 0.0595).`,
    );
  return value;
}
function roundRate(amount: number, value: string) {
  const [whole, fraction = ""] = value.split("."),
    denominator = 10n ** BigInt(fraction.length),
    numerator = BigInt(whole + fraction);
  return Number(
    (BigInt(amount) * numerator * 2n + denominator) / (2n * denominator),
  );
}
function moneyFields(raw: unknown, names: readonly string[], label: string) {
  const row = object(raw, names, label);
  return Object.fromEntries(
    names.map((name) => [name, cents(row[name], `${label} ${name}`)]),
  );
}
function brackets(raw: unknown, label: string) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 20)
    throw new Error(`${label} needs between one and twenty brackets.`);
  const result = raw.map((item) => {
    const row = object(
      item,
      ["thresholdCents", "rate", "constantCents"],
      label,
    );
    return {
      thresholdCents: cents(row.thresholdCents, `${label} threshold`),
      rate: rate(row.rate, `${label} rate`),
      constantCents: cents(row.constantCents, `${label} constant`),
    };
  });
  if (
    result[0].thresholdCents !== 0 ||
    result[0].constantCents !== 0 ||
    result.some(
      (row, index) =>
        index > 0 &&
        (row.thresholdCents <= result[index - 1].thresholdCents ||
          Number(row.rate) < Number(result[index - 1].rate)),
    )
  )
    throw new Error(
      `${label} must start at zero and have increasing thresholds and nondecreasing rates.`,
    );
  return result;
}
function archivedSources(raw: unknown, label: string) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40)
    throw new Error(`${label} needs one to forty source references.`);
  return raw.map((value) => {
    const row = object(value, ["file", "url", "sha256", "bytes"], label);
    const hash = text(row.sha256, "Archived SHA256", 64);
    if (!/^[a-f\d]{64}$/.test(hash))
      throw new Error(
        "Archived source SHA256 must be 64 lowercase hexadecimal characters.",
      );
    return {
      file: text(row.file, "Archived source filename", 300),
      url: payrollRuleUrl(row.url),
      sha256: hash,
      bytes: cents(row.bytes, "Archived source bytes"),
    };
  });
}
export function payrollRuleUrl(raw: unknown) {
  const value = text(raw, "Official source URL", 2048);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter an HTTPS official source URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Enter an HTTPS source URL without credentials.");
  return value;
}
/** Strict parameter schema only. This never evaluates imported formulas. */
export function cleanPayrollRuleRateSet(raw: unknown): PayrollRateSet {
  const row = object(
    raw,
    [
      "year",
      "province",
      "engineVersion",
      "federal",
      "cpp",
      "ei",
      "sources",
      "formulaSources",
      "rounding",
      "id",
      "method",
      "effectiveFrom",
      "effectiveTo",
      "provincial",
    ],
    "Rate edition",
  );
  const year = cents(row.year, "Rule year");
  if (year < 2026 || year > 2100)
    throw new Error("Rule year must be 2026 through 2100.");
  if (
    row.province !== "BC" ||
    !["option1", "option2"].includes(String(row.method))
  )
    throw new Error(
      "Only the ordinary British Columbia Option 1/Option 2 parameter schema is supported.",
    );
  if (row.engineVersion !== official[0].engineVersion)
    throw new Error(
      "A different formula engine requires a reviewed code extension; parameter imports cannot change the engine.",
    );
  const effectiveFrom = date(row.effectiveFrom, "Effective from"),
    effectiveTo = date(row.effectiveTo, "Effective to");
  if (
    effectiveTo < effectiveFrom ||
    !effectiveFrom.startsWith(`${year}-`) ||
    !effectiveTo.startsWith(`${year}-`)
  )
    throw new Error(
      "Effective dates must be ordered within the stated rule year.",
    );
  const federalRaw = object(
    row.federal,
    [
      "brackets",
      "basicPersonalMaximumCents",
      "basicPersonalMinimumCents",
      "basicPersonalPhaseOutFromCents",
      "basicPersonalPhaseOutToCents",
      "employmentAmountCents",
    ],
    "Federal rules",
  );
  const federal = {
    ...moneyFields(
      Object.fromEntries(
        Object.entries(federalRaw).filter(([key]) => key !== "brackets"),
      ),
      [
        "basicPersonalMaximumCents",
        "basicPersonalMinimumCents",
        "basicPersonalPhaseOutFromCents",
        "basicPersonalPhaseOutToCents",
        "employmentAmountCents",
      ],
      "Federal",
    ),
    brackets: brackets(federalRaw.brackets, "Federal brackets"),
  } as PayrollRateSet["federal"];
  if (
    federal.basicPersonalMaximumCents < federal.basicPersonalMinimumCents ||
    federal.basicPersonalPhaseOutToCents <=
      federal.basicPersonalPhaseOutFromCents
  )
    throw new Error(
      "Federal personal claim bounds and phase-out thresholds must be ordered.",
    );
  const provincialRaw = object(
    row.provincial,
    [
      "brackets",
      "basicPersonalCents",
      "reductionCents",
      "reductionStartsAtCents",
      "reductionEndsAtCents",
      "reductionRate",
    ],
    "BC rules",
  );
  const provincial = {
    ...moneyFields(
      Object.fromEntries(
        Object.entries(provincialRaw).filter(
          ([key]) => !["brackets", "reductionRate"].includes(key),
        ),
      ),
      [
        "basicPersonalCents",
        "reductionCents",
        "reductionStartsAtCents",
        "reductionEndsAtCents",
      ],
      "BC",
    ),
    brackets: brackets(provincialRaw.brackets, "BC brackets"),
    reductionRate: rate(provincialRaw.reductionRate, "BC reduction rate"),
  } as PayrollRateSet["provincial"];
  if (provincial.reductionEndsAtCents < provincial.reductionStartsAtCents)
    throw new Error("BC reduction thresholds must be ordered.");
  const cppRaw = object(
    row.cpp,
    [
      "rate",
      "baseRate",
      "additionalRate",
      "secondRate",
      "annualExemptionCents",
      "ympeCents",
      "yampeCents",
      "maximumCents",
      "baseMaximumCents",
      "additionalMaximumCents",
      "secondMaximumCents",
    ],
    "CPP",
  );
  const cpp = {
    ...moneyFields(
      Object.fromEntries(
        Object.entries(cppRaw).filter(
          ([key]) =>
            !["rate", "baseRate", "additionalRate", "secondRate"].includes(key),
        ),
      ),
      [
        "annualExemptionCents",
        "ympeCents",
        "yampeCents",
        "maximumCents",
        "baseMaximumCents",
        "additionalMaximumCents",
        "secondMaximumCents",
      ],
      "CPP",
    ),
    ...Object.fromEntries(
      ["rate", "baseRate", "additionalRate", "secondRate"].map((key) => [
        key,
        rate(cppRaw[key], `CPP ${key}`),
      ]),
    ),
  } as PayrollRateSet["cpp"];
  if (
    !Number(cpp.rate) ||
    Math.round(Number(cpp.rate) * 1e6) !==
      Math.round((Number(cpp.baseRate) + Number(cpp.additionalRate)) * 1e6) ||
    cpp.ympeCents < cpp.annualExemptionCents ||
    cpp.yampeCents < cpp.ympeCents
  )
    throw new Error(
      "CPP needs a positive total rate equal to base plus first enhancement, and ordered exemption/YMPE/YAMPE.",
    );
  for (const [maximum, value] of [
    [
      "maximumCents",
      roundRate(cpp.ympeCents - cpp.annualExemptionCents, cpp.rate),
    ],
    [
      "baseMaximumCents",
      roundRate(cpp.ympeCents - cpp.annualExemptionCents, cpp.baseRate),
    ],
    [
      "additionalMaximumCents",
      roundRate(cpp.ympeCents - cpp.annualExemptionCents, cpp.additionalRate),
    ],
    [
      "secondMaximumCents",
      roundRate(cpp.yampeCents - cpp.ympeCents, cpp.secondRate),
    ],
  ] as const)
    if (cpp[maximum] !== value)
      throw new Error(
        `CPP ${maximum} must reconcile to its rate and annual earnings bounds (${value} cents).`,
      );
  const eiRaw = object(
    row.ei,
    [
      "rate",
      "insurableMaximumCents",
      "maximumCents",
      "employerMultiplier",
      "employerMaximumCents",
    ],
    "EI",
  );
  const ei = {
    rate: rate(eiRaw.rate, "EI rate"),
    insurableMaximumCents: cents(
      eiRaw.insurableMaximumCents,
      "EI insurable maximum",
    ),
    maximumCents: cents(eiRaw.maximumCents, "EI maximum"),
    employerMultiplier: rate(
      eiRaw.employerMultiplier,
      "Standard EI employer multiplier",
      1.4,
    ),
    employerMaximumCents: cents(
      eiRaw.employerMaximumCents,
      "EI employer maximum",
    ),
  };
  if (Number(ei.employerMultiplier) !== 1.4)
    throw new Error(
      "The standard EI rule multiplier is 1.4; approved reduced employer coverage belongs in Employer setup.",
    );
  if (
    ei.maximumCents !== roundRate(ei.insurableMaximumCents, ei.rate) ||
    ei.employerMaximumCents !==
      roundRate(ei.maximumCents, ei.employerMultiplier)
  )
    throw new Error(
      "EI maxima must reconcile exactly to the insurable maximum, employee rate and standard employer multiplier.",
    );
  const sources = archivedSources(row.sources, "Archived rate sources"),
    formulaSources = archivedSources(row.formulaSources, "Formula sources");
  if (formulaSources.length < 2)
    throw new Error(
      "Retain both reviewed January and July formula-source references.",
    );
  return {
    year,
    province: "BC",
    engineVersion: String(row.engineVersion),
    federal,
    provincial,
    cpp,
    ei,
    sources,
    formulaSources,
    rounding: text(row.rounding, "Rounding policy", 2000),
    id: text(row.id, "Rate identifier", 300),
    method: String(row.method),
    effectiveFrom,
    effectiveTo,
  };
}
export function cleanPayrollRuleDraft(raw: unknown): PayrollRuleDraft {
  const row = object(
    raw,
    ["name", "description", "rateSet", "sourceEvidence"],
    "Rule draft",
  );
  if (
    !Array.isArray(row.sourceEvidence) ||
    !row.sourceEvidence.length ||
    row.sourceEvidence.length > 30
  )
    throw new Error("Retain one to thirty reviewed source references.");
  const sourceEvidence = row.sourceEvidence.map((source) => {
    const value = object(
      source,
      ["authority", "title", "url", "reviewedOn", "notes"],
      "Source evidence",
    );
    return {
      authority: text(value.authority, "Source authority", 200),
      title: text(value.title, "Source title", 300),
      url: payrollRuleUrl(value.url),
      reviewedOn: date(value.reviewedOn, "Source review date"),
      notes: text(value.notes, "Source review evidence", 4000),
    };
  });
  if (row.description !== undefined && typeof row.description !== "string")
    throw new Error("Description must be plain text.");
  const description = row.description?.trim() ?? "";
  if (description.length > 4000)
    throw new Error("Description must be at most 4000 characters.");
  return {
    name: text(row.name, "Edition name", 200),
    ...(description ? { description } : {}),
    rateSet: cleanPayrollRuleRateSet(row.rateSet),
    sourceEvidence,
  };
}
export function cloneOfficialPayrollRule(
  id: string,
  today = new Date().toISOString().slice(0, 10),
): PayrollRuleDraft {
  const found = official.find((edition) => edition.id === id);
  if (!found) throw new Error("Choose a reviewed official edition.");
  return cleanPayrollRuleDraft({
    name: `${id} working copy`,
    rateSet: structuredClone(found),
    sourceEvidence: [
      {
        authority: "Canada Revenue Agency",
        title: "Cloned reviewed T4127 edition",
        url: found.formulaSources[found.effectiveFrom >= "2026-07-01" ? 1 : 0]
          .url,
        reviewedOn: today,
        notes: `Cloned from archived ${id}. Verify every changed value against its official source before publication; archived hashes describe the baseline sources, not the edited values.`,
      },
    ],
  });
}
export function assertPayrollRuleApplicable(
  rateSet: PayrollRateSet,
  input: { payDate: string; province: string; method: string },
) {
  const clean = cleanPayrollRuleRateSet(rateSet);
  const baseline = payrollRateSetFor(
    input.payDate,
    input.province,
    input.method as "option1" | "option2",
  );
  if (
    clean.year !== baseline.year ||
    clean.province !== input.province ||
    clean.method !== input.method ||
    input.payDate < clean.effectiveFrom ||
    input.payDate > clean.effectiveTo
  )
    throw new Error(
      "The selected published edition does not cover this payment date, year, province and method.",
    );
  if (
    clean.effectiveFrom >= "2026-07-01" !==
    baseline.effectiveFrom >= "2026-07-01"
  )
    throw new Error(
      "This edition crosses an unsupported formula-policy boundary. Retain the separately reviewed January/July effective ranges.",
    );
  return clean;
}
export function payrollRuleCompatibility(rateSet: PayrollRateSet) {
  try {
    assertPayrollRuleApplicable(rateSet, {
      payDate: rateSet.effectiveFrom,
      province: rateSet.province,
      method: rateSet.method,
    });
    assertPayrollRuleApplicable(rateSet, {
      payDate: rateSet.effectiveTo,
      province: rateSet.province,
      method: rateSet.method,
    });
    return {
      supported: true,
      reason: "Compatible with the reviewed ordinary BC 2026 deduction engine.",
    };
  } catch (error) {
    return {
      supported: false,
      reason:
        error instanceof Error
          ? error.message
          : "A reviewed engine extension is required.",
    };
  }
}
export function stablePayrollRuleJson(raw: unknown): string {
  if (Array.isArray(raw))
    return `[${raw.map(stablePayrollRuleJson).join(",")}]`;
  if (raw && typeof raw === "object")
    return `{${Object.entries(raw)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, value]) =>
          `${JSON.stringify(key)}:${stablePayrollRuleJson(value)}`,
      )
      .join(",")}}`;
  return JSON.stringify(raw);
}
export async function payrollRuleHash(draft: PayrollRuleDraft) {
  const bytes = new TextEncoder().encode(
    stablePayrollRuleJson(cleanPayrollRuleDraft(draft)),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function comparePayrollRules(
  before: unknown,
  after: unknown,
  path = "",
): Array<{ path: string; before: unknown; after: unknown }> {
  if (stablePayrollRuleJson(before) === stablePayrollRuleJson(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .flatMap((key) =>
        comparePayrollRules(a[key], b[key], path ? `${path}.${key}` : key),
      );
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}
export function payrollPercentDisplay(decimal: string) {
  return String(Number((Number(decimal) * 100).toFixed(6)));
}
export function payrollPercentDecimal(percent: string) {
  if (!/^\d+(?:\.\d{1,4})?$/.test(percent) || Number(percent) > 100)
    throw new Error(
      "Enter a percentage from 0 through 100, with at most four decimal places.",
    );
  return (Number(percent) / 100)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}
