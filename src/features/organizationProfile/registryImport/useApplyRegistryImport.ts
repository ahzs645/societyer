import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { proposalToApplyArgs, withRegistryDocumentIds, type RegistryImportProposal, type RegistryImportSelection } from "../../../../shared/registryDocuments";
import type { ApplyRegistryImportResult } from "../../../../shared/functions/organizationDetails";
import { REGISTRY_IMPORT_TAG } from "../registryFacts";
import { useProfileDocumentUpload } from "../useProfileDocumentUpload";
import { documentIdsByFingerprint, type ImportDocumentRow } from "./importModel";

export type ApplyRegistryImportInput = {
  proposal: RegistryImportProposal;
  selection: RegistryImportSelection;
  rows: readonly ImportDocumentRow[];
  /** "Upload to Documents", by file id. */
  upload: Readonly<Record<string, boolean>>;
  /** Files already uploaded by an earlier attempt, by file id; they are not uploaded again. */
  uploaded: Readonly<Record<string, string>>;
  onUploaded: (fileId: string, documentId: string) => void;
  /** False drops the corporation key: only Admins and Owners can store it. */
  canStoreKey: boolean;
  onStep: (step: string) => void;
};

export type ApplyRegistryImportOutcome = {
  result: ApplyRegistryImportResult;
  uploadedCount: number;
  idsByFingerprint: Record<string, string>;
};

/**
 * Applies a reviewed import: upload the chosen files, map their fingerprints
 * to document ids, then one `organizationDetails.applyRegistryImport` call.
 * The corporation key is revealed only here, straight into the mutation's
 * arguments, and is masked out of any error message.
 */
export function useApplyRegistryImport(societyId: string) {
  const applyImport = useMutation(api.organizationDetails.applyRegistryImport);
  const upload = useProfileDocumentUpload(societyId);

  return async (input: ApplyRegistryImportInput): Promise<ApplyRegistryImportOutcome> => {
    const uploaded: Record<string, string> = { ...input.uploaded };
    const pending = input.rows.filter((row) => input.upload[row.file.id] && !uploaded[row.file.id]);
    for (const [index, row] of pending.entries()) {
      input.onStep(`Uploading ${index + 1} of ${pending.length}…`);
      const documentId = await upload(row.file.file, { title: row.entry.suggestedTitle, category: row.entry.suggestedCategory, tags: [REGISTRY_IMPORT_TAG] });
      uploaded[row.file.id] = documentId;
      input.onUploaded(row.file.id, documentId);
    }
    const uploadedCount = input.rows.filter((row) => input.upload[row.file.id] && uploaded[row.file.id]).length;
    const idsByFingerprint = documentIdsByFingerprint(input.rows, uploaded);

    input.onStep("Saving the profile…");
    const selection: RegistryImportSelection = input.canStoreKey
      ? input.selection
      : { ...input.selection, selected: { ...input.selection.selected, ...Object.fromEntries(input.proposal.secrets.map((secret) => [secret.id, false])) } };
    const secret = input.proposal.secrets.find((candidate) => selection.selected[candidate.id]);
    const keySources = secret ? [...new Set(secret.sources.flatMap((source) => idsByFingerprint[source.fingerprint] ? [idsByFingerprint[source.fingerprint]] : []))] : [];
    let keyValue: string | undefined;
    try {
      const args = withRegistryDocumentIds(proposalToApplyArgs(input.proposal, selection), idsByFingerprint);
      keyValue = args.corporationKey?.value;
      const corporationKey = args.corporationKey && keySources.length ? { ...args.corporationKey, sourceDocumentIds: keySources } : args.corporationKey;
      const result = await applyImport({ societyId, ...args, ...(corporationKey ? { corporationKey } : {}) }) as ApplyRegistryImportResult;
      return { result, uploadedCount, idsByFingerprint };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(keyValue ? message.split(keyValue).join("••••••••") : message);
    }
  };
}
