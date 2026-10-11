import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { FileWarning } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";

/**
 * "N unsupported details" badge (finding A14). Drop it on any record page —
 * meeting, motion, person, committee, document — to show how many source
 * details for that record could not be represented natively. Renders nothing
 * when there are none or the viewer cannot read source evidence. Links to the
 * system-gap backlog filtered to the record.
 *
 *   <UnsupportedDetailsBadge table="meetings" id={meeting._id} />
 */
export function UnsupportedDetailsBadge({ table, id, showResolved = false }: { table: string; id: string | undefined | null; showResolved?: boolean }) {
  const society = useSociety();
  const { can } = usePermissions();
  const counts = useQuery(
    api.representationGaps.countForRecord,
    society && id && can("documents:read") ? { societyId: society._id, affectedTable: table, affectedId: String(id) } : "skip",
  ) as { total: number; open: number; keptAsText: number } | undefined;
  if (!counts || !counts.total) return null;
  const shown = showResolved ? counts.total : counts.open + counts.keptAsText;
  if (!shown) return null;
  const label = `${shown} unsupported detail${shown === 1 ? "" : "s"}`;
  return (
    <Link
      to={`/app/coverage?tab=system&affectedTable=${encodeURIComponent(table)}&affectedId=${encodeURIComponent(String(id))}`}
      className="badge badge--warn unsupported-details-badge"
      title={`${counts.open} open, ${counts.keptAsText} kept as text. Source details that Societyer cannot yet hold in a native field.`}
      aria-label={`${label}: review in Coverage and gaps`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
    >
      <FileWarning size={12} aria-hidden="true" />
      {label}
    </Link>
  );
}
