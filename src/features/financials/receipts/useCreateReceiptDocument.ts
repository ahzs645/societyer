import { useAction, useConvex, useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { isDemoMode } from "../../../lib/demoMode";
import { uploadDocumentVersion } from "../../../lib/documentVersionUpload";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { getDocumentStorageProvider, isNativeFileStorageEnabled } from "../../../lib/runtimeMode";
import { validateUploadMetadata } from "../../../../shared/storage/uploadVerification";

/** A receipt uses the configured version store, or the deployment's existing workspace file storage. */
export function useCreateReceiptDocument(societyId: string) {
  const convex = useConvex();
  const createDocument = useMutation(api.documents.create);
  const createDemoVersion = useMutation(api.documentVersions.createDemoVersion);
  const beginUpload = useAction(api.documentVersions.beginUpload);
  const completeUpload = useAction(api.documentVersions.completeUpload);
  const recordUploadedVersion = useMutation(api.documentVersions.recordUploadedVersion);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attachUploadedFile = useMutation(api.files.attachUploadedFileToDocument);

  return async (original: File, title: string, tags: string[], retentionYears: number) => {
    const file = /\.eml$/i.test(original.name) && original.type !== "message/rfc822"
      ? new File([original], original.name, { type: "message/rfc822", lastModified: original.lastModified })
      : original;
    validateUploadMetadata({ fileName: file.name, fileSizeBytes: file.size, mimeType: file.type });
    const metadata = {
      societyId, title, category: "Receipt", fileName: file.name, mimeType: file.type || undefined, tags, retentionYears,
    };
    if (!isDemoMode() && !isLocalDataRuntime() && getDocumentStorageProvider() !== "local-filesystem" && isNativeFileStorageEnabled()) {
      const capabilities = await convex.query(api.documentVersions.storageCapabilities, { societyId }) as { deploymentConfigured: boolean };
      if (!capabilities.deploymentConfigured) {
        const uploadUrl = await generateUploadUrl({ societyId, purpose: "document" });
        const response = await fetch(uploadUrl, {
          method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
        });
        if (!response.ok) throw new Error(`Receipt upload failed (${response.status}).`);
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
