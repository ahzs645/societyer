import { projectedListRow } from "../../shared/procurementAnalyticsArtifacts";
import type { ListRow } from "../../shared/procurementListRow";
import type { CatalogRow } from "./database";

/** Only the facts needed for local list filtering; full analytics stay on the server. */
export function browserListRow(row: CatalogRow): ListRow {
  const result = projectedListRow(row);
  const metadata = row.analyticsJson ? JSON.parse(row.analyticsJson) : {};
  const fields = ["closingAt", "closingDate", "sourceRevision", "sourceId", "opportunityTypeGroupCode", "industryCategories", "sourceRegionPath", "historicalTypeReferenceId", "taxonomyReleaseId", "classificationCodes"];
  const compact = Object.fromEntries(fields.filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]]));
  return { ...result, ...(Object.keys(compact).length ? { analyticsJson: JSON.stringify(compact) } : { analyticsJson: undefined }) };
}
