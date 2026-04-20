import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Link } from "react-router-dom";
import { UserCog, Users } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { initials } from "../lib/format";

/** Renders a parsed @mention with avatar + type icon + link to the detail
 * page. Resolves the id against members and directors; falls back to plain
 * chip when the id isn't found (e.g. deleted record). */
export function MentionChip({ id, label }: { id: string; label: string }) {
  const society = useSociety();
  const members = useQuery(
    api.members.list,
    society ? { societyId: society._id } : "skip",
  ) as any[] | undefined;
  const directors = useQuery(
    api.directors.list,
    society ? { societyId: society._id } : "skip",
  ) as any[] | undefined;

  const member = members?.find((m) => String(m._id) === id);
  const director = !member ? directors?.find((d) => String(d._id) === id) : undefined;
  const resolved = member ?? director;
  const kind: "member" | "director" | "unknown" = member ? "member" : director ? "director" : "unknown";
  const displayLabel = resolved
    ? `${resolved.firstName} ${resolved.lastName}`.trim()
    : label;
  const to =
    kind === "member" ? `/app/members` : kind === "director" ? `/app/directors` : null;
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
    return (
      <Link className="mention-chip mention-chip--linked" to={to} title={`Open ${kind}`}>
        {inner}
      </Link>
    );
  }
  return <span className="mention-chip" title={kind === "unknown" ? "No matching record" : undefined}>{inner}</span>;
}
