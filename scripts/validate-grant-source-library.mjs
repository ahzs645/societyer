import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcesDir = path.join(rootDir, "shared", "data", "grantSources");
const manifestPath = path.join(sourcesDir, "manifest.json");

const stringFields = [
  "libraryKey",
  "name",
  "url",
  "sourceType",
  "scrapeCadence",
  "trustLevel",
  "status",
];

const optionalStringFields = ["jurisdiction", "funderType", "notes"];
const sourceTypes = new Set([
  "authenticated_portal",
  "funder_site",
  "government_portal",
  "rss",
  "pdf",
  "airtable",
  "spreadsheet",
  "custom",
]);
const scrapeCadences = new Set(["manual", "daily", "weekly", "monthly"]);
const trustLevels = new Set(["official", "partner", "aggregator", "unknown"]);
const statuses = new Set(["active", "inactive", "watchlist"]);
const profileKinds = new Set(["manual_mapping", "html_selectors", "rss_feed", "api", "pdf_index"]);
const extractionStatuses = new Set([
  "source-verified-detail-structure-pending",
  "representative-detail-page-reviewed",
  "list-and-detail-profile-started",
]);

const errors = [];
const warnings = [];
const sourceFiles = readdirSync(sourcesDir)
  .filter((file) => file.endsWith(".json") && file !== "manifest.json")
  .sort((a, b) => a.localeCompare(b));

const manifest = readJson(manifestPath, "manifest.json");
if (Array.isArray(manifest)) {
  const manifestSet = new Set(manifest);
  for (const file of sourceFiles) {
    if (!manifestSet.has(file)) errors.push(`manifest.json does not include ${file}`);
  }
  for (const file of manifest) {
    if (!sourceFiles.includes(file)) errors.push(`manifest.json references missing file ${file}`);
  }
} else {
  errors.push("manifest.json must be an array of source filenames");
}

const keys = new Map();
for (const file of sourceFiles) {
  const source = readJson(path.join(sourcesDir, file), file);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push(`${file}: root must be an object`);
    continue;
  }

  for (const field of stringFields) {
    if (!isNonEmptyString(source[field])) errors.push(`${file}: ${field} must be a non-empty string`);
  }
  for (const field of optionalStringFields) {
    if (source[field] !== undefined && typeof source[field] !== "string") {
      errors.push(`${file}: ${field} must be a string when present`);
    }
  }

  if (isNonEmptyString(source.libraryKey)) {
    const expectedFile = `${source.libraryKey}.json`;
    if (file !== expectedFile) warnings.push(`${file}: filename differs from libraryKey convention (${expectedFile})`);
    if (keys.has(source.libraryKey)) {
      errors.push(`${file}: duplicate libraryKey also used by ${keys.get(source.libraryKey)}`);
    }
    keys.set(source.libraryKey, file);
  }

  validateUrl(source.url, `${file}: url`);
  validateEnum(source.sourceType, sourceTypes, `${file}: sourceType`);
  validateEnum(source.scrapeCadence, scrapeCadences, `${file}: scrapeCadence`);
  validateEnum(source.trustLevel, trustLevels, `${file}: trustLevel`);
  validateEnum(source.status, statuses, `${file}: status`);
  validateStringArray(source.eligibilityTags, `${file}: eligibilityTags`);
  validateStringArray(source.topicTags, `${file}: topicTags`);

  if (source.profile !== undefined) validateProfile(source.profile, file);
  if (source.extractionPlan !== undefined) validateExtractionPlan(source.extractionPlan, file);
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  process.exit(1);
}

console.log(`Validated ${sourceFiles.length} grant source JSON files.`);

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateEnum(value, allowed, label) {
  if (isNonEmptyString(value) && !allowed.has(value)) {
    errors.push(`${label} must be one of ${Array.from(allowed).join(", ")}`);
  }
}

function validateUrl(value, label) {
  if (!isNonEmptyString(value)) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) errors.push(`${label} must be http(s)`);
  } catch {
    errors.push(`${label} must be a valid URL`);
  }
}

function validateStringArray(value, label) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      errors.push(`${label}[${index}] must be a non-empty string`);
      continue;
    }
    const key = item.toLowerCase();
    if (seen.has(key)) errors.push(`${label} contains duplicate tag ${item}`);
    seen.add(key);
  }
}

function validateProfile(profile, file) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    errors.push(`${file}: profile must be an object`);
    return;
  }
  validateEnum(profile.profileKind, profileKinds, `${file}: profile.profileKind`);
  validateOptionalString(profile.listSelector, `${file}: profile.listSelector`);
  validateOptionalString(profile.itemSelector, `${file}: profile.itemSelector`);
  validateOptionalString(profile.detailUrlPattern, `${file}: profile.detailUrlPattern`);
  validateOptionalString(profile.dateFormat, `${file}: profile.dateFormat`);
  validateOptionalString(profile.currency, `${file}: profile.currency`);
  validateOptionalString(profile.connectorId, `${file}: profile.connectorId`);
  validateOptionalString(profile.notes, `${file}: profile.notes`);
  if (profile.requiresAuth !== undefined && typeof profile.requiresAuth !== "boolean") {
    errors.push(`${file}: profile.requiresAuth must be boolean when present`);
  }
  validateMapping(profile.fieldMappings, `${file}: profile.fieldMappings`, true);
  validateMapping(profile.detailFieldMappings, `${file}: profile.detailFieldMappings`, false);
  if (profile.pagination !== undefined && (!profile.pagination || typeof profile.pagination !== "object" || Array.isArray(profile.pagination))) {
    errors.push(`${file}: profile.pagination must be an object when present`);
  }
}

function validateExtractionPlan(plan, file) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    errors.push(`${file}: extractionPlan must be an object`);
    return;
  }
  validateEnum(plan.status, extractionStatuses, `${file}: extractionPlan.status`);
  validateOptionalString(plan.listPageNotes, `${file}: extractionPlan.listPageNotes`);
  validateOptionalString(plan.detailPageNotes, `${file}: extractionPlan.detailPageNotes`);
  if (plan.detailPagesReviewed !== undefined) {
    validateStringArray(plan.detailPagesReviewed, `${file}: extractionPlan.detailPagesReviewed`);
    for (const [index, url] of (plan.detailPagesReviewed ?? []).entries()) {
      validateUrl(url, `${file}: extractionPlan.detailPagesReviewed[${index}]`);
    }
  }
}

function validateMapping(mapping, label, required) {
  if (mapping === undefined) {
    if (required) errors.push(`${label} is required`);
    return;
  }
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (required && Object.keys(mapping).length === 0) errors.push(`${label} must not be empty`);
  for (const [field, selector] of Object.entries(mapping)) {
    if (!isNonEmptyString(field) || !isNonEmptyString(selector)) {
      errors.push(`${label}.${field} must map to a non-empty string`);
    }
  }
}

function validateOptionalString(value, label) {
  if (value !== undefined && typeof value !== "string") errors.push(`${label} must be a string when present`);
}
