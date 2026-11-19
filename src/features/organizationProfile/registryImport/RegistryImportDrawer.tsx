import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Banner, Drawer } from "../../../components/ui";
import { useToast } from "../../../components/Toast";
import { useAuth } from "../../../auth/AuthProvider";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { usePermissions } from "../../../hooks/usePermissions";
import { isLocalDataRuntime } from "../../../lib/staticRuntime";
import { defaultRegistryImportSelection, type RegistryImportSelection } from "../../../../shared/registryDocuments";
import type { RecordIncorporationPrefill } from "../RecordIncorporationDrawer";
import type { OrganizationDetail, OrganizationRecord, ProfileDocument } from "../types";
import { addChosenFiles, ChooseFiles, type ChosenFile } from "./ChooseFiles";
import { buildImportFiles, buildProposal, currentSnapshot, importChangedSociety, importDocumentRows, importSummary, incorporationPrefill, type DirectorRegisterRow, type ImportFile } from "./importModel";
import { readRegistryFiles } from "./readRegistryFiles";
import { ReviewStep } from "./ReviewStep";
import { useApplyRegistryImport } from "./useApplyRegistryImport";

type Stage = "choose" | "reading" | "review" | "applying";

export type RegistryImportApplied = {
  /** The society record changed: the page reloads its form. */
  changedSociety: boolean;
  /** Set when a certificate was found for an organization still awaiting it. */
  recordIncorporation?: RecordIncorporationPrefill;
};

/**
 * "Import from registry documents": choose PDFs and .eml files, read them on
 * this device, review the proposal against the profile, then upload the chosen
 * files and apply the reviewed values in one call.
 */
export function RegistryImportDrawer({ open, onClose, society, detail, documents, canEdit, unsavedChanges, onApplied }: {
  open: boolean;
  onClose: () => void;
  society: OrganizationRecord;
  detail: OrganizationDetail | undefined;
  documents: readonly ProfileDocument[] | undefined;
  canEdit: boolean;
  unsavedChanges: boolean;
  onApplied: (applied: RegistryImportApplied) => void;
}) {
  const toast = useToast();
  const auth = useAuth();
  const currentUser = useCurrentUser();
  const { loaded, can, role } = usePermissions();
  const directorsReadable = loaded && can("directors:read");
  const directors = useQuery(api.directors.list, open && directorsReadable ? { societyId: society._id } : "skip") as DirectorRegisterRow[] | undefined;
  const apply = useApplyRegistryImport(society._id);
  const [stage, setStage] = useState<Stage>("choose");
  const [chosen, setChosen] = useState<ChosenFile[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [selection, setSelection] = useState<RegistryImportSelection>({ selected: {} });
  const [upload, setUpload] = useState<Record<string, boolean>>({});
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [step, setStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canStoreKey = role === "Owner" || role === "Admin";
  const userName = auth.session?.user.name?.trim() || currentUser?.displayName?.trim() || "";

  const snapshot = useMemo(() => currentSnapshot(society, detail, directors), [society, detail, directors]);
  const proposal = useMemo(() => (files.length ? buildProposal(files, snapshot) : undefined), [files, snapshot]);
  const rows = useMemo(() => (proposal ? importDocumentRows(proposal, files, documents) : []), [proposal, files, documents]);

  // A fresh start each time the drawer opens.
  useEffect(() => {
    if (!open) return;
    setStage("choose");
    setChosen([]);
    setSkipped([]);
    setFiles([]);
    setSelection({ selected: {} });
    setUpload({});
    setUploaded({});
    setError(null);
  }, [open]);

  const read = async () => {
    setError(null);
    setStage("reading");
    try {
      const texts = await readRegistryFiles(chosen, (done, total) => setStep(`Reading ${Math.min(done + 1, total)} of ${total}…`));
      const parsedFiles = buildImportFiles(chosen, texts);
      const first = buildProposal(parsedFiles, snapshot);
      setFiles(parsedFiles);
      setSelection({ ...defaultRegistryImportSelection(first), portalAccessName: userName });
      setUpload(Object.fromEntries(importDocumentRows(first, parsedFiles, documents).map((row) => [row.file.id, row.defaultUpload])));
      setUploaded({});
      setStage("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage("choose");
    }
  };

  const applyReviewed = async () => {
    if (!proposal || !canEdit) return;
    setError(null);
    setStage("applying");
    try {
      const outcome = await apply({
        proposal, selection, rows, upload, uploaded, canStoreKey,
        onUploaded: (fileId, documentId) => setUploaded((current) => ({ ...current, [fileId]: documentId })),
        onStep: setStep,
      });
      toast.success("Registry documents imported", importSummary(outcome.result, outcome.uploadedCount));
      const awaiting = society.formationStatus === "preparing" || society.formationStatus === "submitted";
      const prefill = awaiting ? incorporationPrefill(proposal, selection, outcome.idsByFingerprint) : undefined;
      onApplied({ changedSociety: importChangedSociety(outcome.result), ...(prefill ? { recordIncorporation: prefill } : {}) });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage("review");
    }
  };

  const busy = stage === "reading" || stage === "applying";
  const changeCount = proposal
    ? proposal.groups.flatMap((group) => group.fields).filter((field) => field.target.scope !== "info" && selection.selected[field.id]).length
      + proposal.secrets.filter((secret) => canStoreKey && selection.selected[secret.id]).length
    : 0;
  const uploadCount = rows.filter((row) => upload[row.file.id]).length;

  const footer = stage === "choose" || stage === "reading" ? (
    <>
      <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="btn btn--accent" type="button" disabled={!chosen.length || busy} onClick={() => { void read(); }}>
        {stage === "reading" ? step || "Reading…" : "Read documents"}
      </button>
    </>
  ) : (
    <>
      <button className="btn" type="button" onClick={() => { setStage("choose"); setError(null); }} disabled={busy}>Back</button>
      <button className="btn btn--accent" type="button" disabled={!canEdit || busy || (!changeCount && !uploadCount)} onClick={() => { void applyReviewed(); }}>
        {stage === "applying" ? step || "Applying…" : `Apply${changeCount ? ` ${changeCount} ${changeCount === 1 ? "change" : "changes"}` : ""}${uploadCount ? `${changeCount ? " and" : ""} upload ${uploadCount}` : ""}`}
      </button>
    </>
  );

  return (
    <Drawer open={open} onClose={busy ? () => undefined : onClose} title="Import from registry documents" size="wide" footer={footer} className="registry-import">
      {error && <Banner tone="danger" title={stage === "choose" ? "Could not read the documents" : "Not imported"}>{error}</Banner>}
      {unsavedChanges && stage !== "choose" && (
        <Banner tone="warn">The profile has unsaved changes. Applying the import reloads the profile and discards them.</Banner>
      )}
      {(stage === "choose" || stage === "reading") && (
        <ChooseFiles
          files={chosen}
          skipped={skipped}
          onAdd={(incoming) => {
            const next = addChosenFiles(chosen, incoming);
            setChosen(next.files);
            setSkipped(next.skipped);
          }}
          onRemove={(id) => setChosen((current) => current.filter((entry) => entry.id !== id))}
        />
      )}
      {(stage === "review" || stage === "applying") && proposal && (
        <ReviewStep
          proposal={proposal}
          selection={selection}
          onSelection={setSelection}
          rows={rows}
          upload={upload}
          onUpload={(fileId, checked) => setUpload((current) => ({ ...current, [fileId]: checked }))}
          directors={directors}
          directorsReadable={directorsReadable}
          canStoreKey={canStoreKey}
          localRuntime={isLocalDataRuntime()}
        />
      )}
    </Drawer>
  );
}
