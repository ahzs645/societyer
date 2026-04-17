import { useAction, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { useToast } from "./Toast";
import { Badge } from "./ui";
import { ExternalLink, RefreshCw, UploadCloud } from "lucide-react";
import { useState } from "react";

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
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!resolvedSocietyId) return;
    setBusy(true);
    try {
      const result = await syncDocument({
        societyId: resolvedSocietyId,
        documentId,
        actingUserId,
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

  return (
    <>
      {sync?.paperlessDocumentUrl && (
        <a
          className="btn btn--ghost btn--sm"
          href={sync.paperlessDocumentUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in Paperless-ngx"
        >
          <ExternalLink size={12} /> Paperless
        </a>
      )}
      {sync && !sync.paperlessDocumentUrl && (
        <span title={sync.lastError ?? `Paperless status: ${sync.status}`}>
          <Badge tone={sync.status === "failed" ? "danger" : "info"}>
            {sync.status}
          </Badge>
        </span>
      )}
      <button
        className="btn btn--ghost btn--sm"
        disabled={busy || disabled || !resolvedSocietyId}
        onClick={run}
        title="Send the current document file to Paperless-ngx with Societyer tags"
      >
        {busy ? <RefreshCw size={12} /> : <UploadCloud size={12} />}
        {busy ? "Syncing" : "Sync"}
      </button>
    </>
  );
}
