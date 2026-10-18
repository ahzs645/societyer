import { format, isThisYear, isToday, isYesterday } from "date-fns";
import type { ReaderCatalog } from "./source";

/** "today, 10:02 AM", "yesterday, 10:02 AM", "Oct 18, 10:02 AM", or "Oct 18, 2025" in another year. */
function publishedWhen(published: Date): string {
  if (isToday(published)) return `today, ${format(published, "h:mm a")}`;
  if (isYesterday(published)) return `yesterday, ${format(published, "h:mm a")}`;
  return format(published, isThisYear(published) ? "MMM d, h:mm a" : "MMM d, yyyy");
}

/** "3,752 opportunities · 21,877 awards · published today, 10:02 AM · read only" */
export function publishedSummary(catalog: ReaderCatalog): string {
  const parts = [["opportunity", "opportunity", "opportunities"], ["award", "award", "awards"]]
    .filter(([kind]) => (catalog.counts[kind] ?? 0) > 0)
    .map(([kind, one, many]) => `${catalog.counts[kind].toLocaleString()} ${catalog.counts[kind] === 1 ? one : many}`);
  const published = new Date(catalog.publishedAt);
  if (!Number.isNaN(published.getTime())) parts.push(`published ${publishedWhen(published)}`);
  return [...parts, "read only"].join(" · ");
}
