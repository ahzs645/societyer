import { useAction, useConvex, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { isDemoMode } from "../../lib/demoMode";
import { uploadDocumentVersion } from "../../lib/documentVersionUpload";
import { isLocalDataRuntime } from "../../lib/staticRuntime";
import { getDocumentStorageProvider } from "../../lib/runtimeMode";
import { useWorkspaceStoragePolicy } from "../../hooks/useWorkspaceStoragePolicy";
import { validateUploadMetadata } from "../../../shared/storage/uploadVerification";

export type ProfileDocumentUpload = { title: string; category: string; tags?: string[] };

/**
 * Uploads a file as a new document, the way receipts do: the configured
 * version store, or the deployment's own file storage. Returns the document id.
 * Every director can open what this uploads.
 */
export function useProfileDocumentUpload(societyId: string) {
  const convex = useConvex();
  const { nativeUploads } = useWorkspaceStoragePolicy();
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attachUploadedFile = useMutation(api.files.attachUploadedFileToDocument);

  return async (original: File, { title, category, tags = [] }: ProfileDocumentUpload): Promise<string> => {
    const file = /\.eml$/i.test(original.name) && original.type !== "message/rfc822"
      ? new File([original], original.name, { type: "message/rfc822", lastModified: original.lastModified })
      : original;
    validateUploadMetadata({ fileName: file.name, fileSizeBytes: file.size, mimeType: file.type });
    const metadata = { societyId, title, category, fileName: file.name, mimeType: file.type || undefined, tags };
    if (!isDemoMode() && !isLocalDataRuntime() && getDocumentStorageProvider() !== "local-filesystem" && nativeUploads) {
      const capabilities = await convex.query(api.documentVersions.storageCapabilities, { societyId }) as { deploymentConfigured: boolean };
      if (!capabilities.deploymentConfigured) {
        const uploadUrl = await generateUploadUrl({ societyId, purpose: "document" });
        const response = await fetch(uploadUrl, {
          method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
        });
        if (!response.ok) throw new Error(`Upload of ${file.name} failed (${response.status}).`);
        const { storageId } = await response.json() as { storageId: string };
        const documentId: string = await createDocument(metadata);
        await attachUploadedFile({ documentId, storageId, fileName: file.name });
        return documentId;
      }
    }
    const documentId: string = await createDocument(metadata);
    await uploadDocumentVersion({ societyId, documentId, file, createDemoVersion, beginUpload, recordUploadedVersion, completeUpload });
    return documentId;
  };
}
