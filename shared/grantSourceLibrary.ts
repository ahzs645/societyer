import { GENERATED_BUILT_IN_GRANT_SOURCES } from "./generatedGrantSourceLibrary";

export type BuiltInGrantSourceProfile = {
  libraryKey: string;
  profileKind: string;
  listSelector?: string;
  itemSelector?: string;
  detailUrlPattern?: string;
  fieldMappings: Record<string, string>;
  detailFieldMappings?: Record<string, string>;
  dateFormat?: string;
  currency?: string;
  pagination?: Record<string, unknown>;
  requiresAuth?: boolean;
  connectorId?: string;
  notes?: string;
};

export type BuiltInGrantSourceExtractionPlan = {
  status: string;
  detailPagesReviewed?: string[];
  listPageNotes?: string;
  detailPageNotes?: string;
};

export type BuiltInGrantSource = {
  libraryKey: string;
  name: string;
  url: string;
  sourceType: string;
  jurisdiction?: string;
  funderType?: string;
  eligibilityTags: string[];
  topicTags: string[];
  scrapeCadence: string;
  trustLevel: string;
  status: string;
  notes?: string;
  extractionPlan?: BuiltInGrantSourceExtractionPlan;
  profile?: Omit<BuiltInGrantSourceProfile, "libraryKey">;
};

export const BUILT_IN_GRANT_SOURCES = GENERATED_BUILT_IN_GRANT_SOURCES as BuiltInGrantSource[];

export const BUILT_IN_GRANT_SOURCE_PROFILES = BUILT_IN_GRANT_SOURCES.flatMap((source) =>
  source.profile ? [{ libraryKey: source.libraryKey, ...source.profile }] : [],
);
