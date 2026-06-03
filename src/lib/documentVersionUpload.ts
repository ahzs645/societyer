import { isDemoMode } from "./demoMode";
import { writeLocalDocumentVersion } from "./documentStorage";
import { getDocumentStorageProvider } from "./runtimeMode";

export async function uploadDocumentVersion({
  societyId,
  documentId,
  file,
  nextVersion,
  changeNote,
  actingUserId,
  createDemoVersion,
  beginUpload,
  recordUploadedVersion,
}: {
  societyId: any;
  documentId: any;
  file: File;
  nextVersion: number;
  changeNote?: string;
  actingUserId?: any;
  createDemoVersion: (args: any) => Promise<any>;
  beginUpload: (args: any) => Promise<any>;
  recordUploadedVersion: (args: any) => Promise<any>;
}) {
  const storageProvider = getDocumentStorageProvider();
  if (storageProvider === "local-filesystem") {
    const ref = await writeLocalDocumentVersion({
      societyId,
      documentId,
      version: nextVersion,
      file,
    });
    const versionId = await recordUploadedVersion({
      societyId,
      documentId,
      version: nextVersion,
      storageProvider: ref.provider,
      storageKey: ref.key,
      fileName: ref.fileName,
      mimeType: ref.mimeType,
      fileSizeBytes: ref.byteLength ?? file.size,
      sha256: ref.sha256,
      changeNote: changeNote || undefined,
      actingUserId,
    });
    return { versionId, version: nextVersion, provider: ref.provider };
  }

  if (isDemoMode()) {
    const versionId = await createDemoVersion({
      societyId,
      documentId,
      fileName: file.name,
      mimeType: file.type,
      fileSizeBytes: file.size,
      changeNote: changeNote || undefined,
      actingUserId,
    });
    return { versionId, version: nextVersion, provider: "demo" };
  }

  const { version, presigned } = await beginUpload({
    societyId,
    documentId,
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
    actingUserId,
  });
  if (presigned.provider === "rustfs") {
    const res = await fetch(presigned.url, {
      method: "PUT",
      headers: presigned.headers ?? (file.type ? { "Content-Type": file.type } : {}),
      body: file,
    });
    if (!res.ok) throw new Error(`RustFS upload failed (${res.status})`);
  }

  const versionId = await recordUploadedVersion({
    societyId,
    documentId,
    version,
    storageProvider: presigned.provider,
    storageKey: presigned.key,
    fileName: file.name,
    mimeType: file.type,
    fileSizeBytes: file.size,
    changeNote: changeNote || undefined,
    actingUserId,
  });
  return { versionId, version, provider: presigned.provider };
}
