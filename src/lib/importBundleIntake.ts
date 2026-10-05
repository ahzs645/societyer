import { recordsFromBundle } from "../../shared/functions/importSessionHelpers/importSessionRecordKinds";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalizedName = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Inspect only declared ownership. Folder names, vendors and attendees are not ownership evidence. */
export function inspectImportBundle(bundle: any, destination: { _id: string; name: string }) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("Choose a JSON bundle object containing supported records.");
  }
  const records = recordsFromBundle(bundle);
  if (!records.length) throw new Error("Import bundle did not contain any supported records.");
  const metadata = bundle.metadata ?? {};
  const declarations = [
    text(metadata.organizationName || metadata.sourceOrganizationName),
    ...(Array.isArray(metadata.organizations) ? metadata.organizations.map((item: any) => text(typeof item === "string" ? item : item?.name)) : []),
    ...Object.values(bundle).flatMap((items: any) => Array.isArray(items) ? items.map((item: any) => text(item?.sourceOrganizationName)) : []),
  ].filter(Boolean);
  const organizations = [...new Map(declarations.map((name) => [normalizedName(name), name])).values()];
  const declaredId = text(metadata.organizationId || metadata.societyId);
  const nameMatches = organizations.length === 1 && normalizedName(organizations[0]) === normalizedName(destination.name);
  const matches = declaredId
    ? declaredId === String(destination._id) && (!organizations.length || nameMatches)
    : nameMatches;
  const byKind: Record<string, number> = {};
  for (const record of records) byKind[record.recordKind] = (byKind[record.recordKind] ?? 0) + 1;
  const sources = records.filter((record) => record.recordKind === "source");
  const missingEvidence = records.filter((record) => !record.sourceExternalIds.length).length;
  return {
    total: records.length,
    byKind,
    organizations,
    mixedOrganizations: organizations.length > 1,
    ownershipMatches: matches,
    missingEvidence,
    sourceCount: sources.length,
    linkedSources: sources.filter((record) => text(record.payload.url)).length,
    needsReview: !matches || missingEvidence > 0 || metadata.organizationOwnershipVerified === false,
  };
}

export function prepareImportBundle(bundle: any, destination: { _id: string; name: string }, reviewed: boolean, fileName?: string) {
  const preview = inspectImportBundle(bundle, destination);
  if (preview.mixedOrganizations) throw new Error("This bundle declares multiple organizations. Split it into one bundle per organization before importing.");
  if (preview.needsReview && !reviewed) throw new Error("Review the source ownership and evidence for the selected destination before creating this session.");
  return {
    ...bundle,
    metadata: {
      ...bundle.metadata,
      intakeReview: {
        societyId: String(destination._id),
        societyName: destination.name,
        sourceOrganizations: preview.organizations,
        ownershipMatched: preview.ownershipMatches,
        missingEvidence: preview.missingEvidence,
        explicitlyReviewed: reviewed,
        reviewedAt: new Date().toISOString(),
        ...(fileName ? { fileName } : {}),
      },
    },
  };
}
