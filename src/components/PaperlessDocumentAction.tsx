import { useAction, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "./Toast";
import { Badge } from "./ui";
import { ExternalLink, RefreshCw, UploadCloud } from "lucide-react";
import { useState } from "react";
import { isLocalDataRuntime, isStaticDemoRuntime } from "../lib/staticRuntime";
import { openableExternalUrl } from "../lib/externalUrl";

export function PaperlessDocumentAction({
  documentId,
  societyId,
  disabled,
}: {
  documentId: Id<"documents">;
  societyId?: Id<"societies">;
  disabled?: boolean;
}) {
  const society = useSociety();
  const resolvedSocietyId = societyId ?? society?._id;
  const sync = useQuery(api.paperless.syncForDocument, { documentId });
  const syncDocument = useAction(api.paperless.syncDocument);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const permissions = usePermissions();
  const localOnly = isLocalDataRuntime() && !isStaticDemoRuntime();
  const canEdit = permissions.loaded && permissions.can("documents:write") && !localOnly;
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!resolvedSocietyId || !canEdit || busy) return;
    setBusy(true);
    try {
      const result = await syncDocument({
        societyId: resolvedSocietyId,
        documentId,
      });
      toast.success(
        result.status === "complete"
          ? "Synced to Paperless-ngx"
          : "Sent to Paperless-ngx for consumption",
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Paperless-ngx sync failed");
    } finally {
      setBusy(false);
    }
  };

  const paperlessUrl = openableExternalUrl(sync?.paperlessDocumentUrl);

  return (
    <>
      {paperlessUrl && (
        <a
          className="btn btn--ghost btn--sm"
          href={paperlessUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in Paperless-ngx"
        >
          <ExternalLink size={12} /> Paperless
        </a>
      )}
      {sync && !paperlessUrl && (
        <span title={sync.lastError ?? `Paperless status: ${sync.status}`}>
          <Badge tone={sync.status === "failed" ? "danger" : "info"}>
            {sync.status ? sync.status.charAt(0).toUpperCase() + sync.status.slice(1) : sync.status}
          </Badge>
        </span>
      )}
      <button
        className="btn btn--ghost btn--sm"
        disabled={busy || disabled || !resolvedSocietyId || !canEdit}
        onClick={run}
        title={localOnly ? "Paperless synchronization requires a connected workspace" : "Send the current document file to Paperless-ngx with Societyer tags"}
      >
        {busy ? <RefreshCw size={12} /> : <UploadCloud size={12} />}
        {busy ? "Syncing" : "Sync"}
      </button>
    </>
  );
}
