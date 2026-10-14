import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Link } from "react-router-dom";
import { UserCog, Users } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { initials } from "../lib/format";
import { EntityHoverCard } from "./HoverCard/EntityHoverCard";
import { entityHref } from "./HoverCard/entityRefs";

/** Renders a parsed @mention with avatar + type icon + link to the detail
 * page. Resolves the id against members and directors; falls back to plain
 * chip when the id isn't found (e.g. deleted record). */
export function MentionChip({ id, label }: { id: string; label: string }) {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const members = useQuery(
    api.members.list,
    society && loaded && can("members:read") ? { societyId: society._id } : "skip",
  ) as any[] | undefined;
  const directors = useQuery(
    api.directors.list,
    society && loaded && can("directors:read") ? { societyId: society._id } : "skip",
  ) as any[] | undefined;

  const member = members?.find((m) => String(m._id) === id);
  const director = !member ? directors?.find((d) => String(d._id) === id) : undefined;
  const resolved = member ?? director;
  const kind: "member" | "director" | "unknown" = member ? "member" : director ? "director" : "unknown";
  const displayLabel = resolved
    ? `${resolved.firstName} ${resolved.lastName}`.trim()
    : label;
  const to = kind === "unknown" ? null : entityHref({ kind, id });
  const Icon = kind === "director" ? UserCog : Users;

  const inner = (
    <>
      <span className="mention-chip__avatar" aria-hidden="true">
        {resolved ? initials(resolved.firstName, resolved.lastName) : label.slice(0, 2).toUpperCase()}
      </span>
      <span className="mention-chip__icon" aria-hidden="true">
        <Icon size={10} />
      </span>
      <span className="mention-chip__label">@{displayLabel}</span>
    </>
  );

  if (to) {
    // Hovering (or keyboard focus) previews the person; the link opens them.
    return (
      <EntityHoverCard entity={kind === "unknown" ? null : { kind, id, name: displayLabel }}>
        <Link className="mention-chip mention-chip--linked" to={to} aria-label={`Open ${kind} ${displayLabel}`}>
          {inner}
        </Link>
      </EntityHoverCard>
    );
  }
  return <span className="mention-chip" title={kind === "unknown" ? "No matching record" : undefined}>{inner}</span>;
}
