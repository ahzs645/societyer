import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { ArrowLeft, BadgeDollarSign, Globe2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { GrantSourceLibrarySection } from "../features/grants/components/GrantSourceLibrary";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";

export function GrantSourcesPage() {
  const society = useSociety();
  const actingUserId = useCurrentUserId() ?? undefined;
  const sourceLibrary = useQuery(
    api.grantSources.listWithLibrary,
    society ? { societyId: society._id } : "skip",
  );

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Grant sources"
        icon={<Globe2 size={16} />}
        iconColor="green"
        subtitle="Built-in and workspace grant discovery sources, extraction notes, and source profiles."
        actions={
          <>
            <Link className="btn-action" to="/app/grants">
              <ArrowLeft size={12} /> Grants
            </Link>
            <Link className="btn-action" to="/app/grants">
              <BadgeDollarSign size={12} /> Grant pipeline
            </Link>
          </>
        }
      />

      <GrantSourceLibrarySection
        actingUserId={actingUserId}
        societyId={society._id}
        sourceLibrary={sourceLibrary}
      />
    </div>
  );
}
