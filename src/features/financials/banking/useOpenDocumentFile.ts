import { useAction, useConvex } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../../components/Toast";
import { openDocumentFile, type OpenableDocument } from "../../../lib/documentOpen";
import type { DocumentDownloadTarget } from "../../../lib/documentStorage";
import { errorMessage } from "./types";

/**
 * Download a document's file (a statement, a receipt) the way the Documents
 * page does: a restored original first, then the latest version, a legacy
 * file or its external link.
 */
export function useOpenDocumentFile() {
  const convex = useConvex();
  const getDownloadTarget = useAction(api.documentVersions.getDownloadTarget);
  const toast = useToast();
  return async (documentId: string) => {
    try {
      const doc = (await convex.query(api.documents.get, { id: documentId })) as OpenableDocument | null;
      if (!doc) {
        toast.info("That document isn't available");
        return;
      }
      const result = await openDocumentFile(doc, {
        getDownloadTarget: async (args) => (await getDownloadTarget(args)) as DocumentDownloadTarget | null,
        getLegacyUrl: async (storageId) => (await convex.query(api.files.getUrl, { storageId })) as string | null,
      });
      if (result === "simulated") toast.info("Demo mode — no real file is stored, so the download is simulated.");
      else if (result === "none") toast.info("No file is attached to this document yet.");
    } catch (error: unknown) {
      toast.error("Could not open the file", errorMessage(error));
    }
  };
}
