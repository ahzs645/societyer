import { Banner } from "../../../components/ui";
import type { RegistryImportProposal, RegistryImportSelection } from "../../../../shared/registryDocuments";
import { DocumentsReview } from "./DocumentsReview";
import { ProposalFields } from "./ProposalFields";
import { ReviewChecks } from "./ReviewChecks";
import type { DirectorRegisterRow, ImportDocumentRow } from "./importModel";

/** Step 2: what the documents say, against the profile, with what to apply and what to upload. */
export function ReviewStep({ proposal, selection, onSelection, rows, upload, onUpload, directors, directorsReadable, canStoreKey, localRuntime }: {
  proposal: RegistryImportProposal;
  selection: RegistryImportSelection;
  onSelection: (selection: RegistryImportSelection) => void;
  rows: readonly ImportDocumentRow[];
  upload: Readonly<Record<string, boolean>>;
  onUpload: (fileId: string, checked: boolean) => void;
  directors: readonly DirectorRegisterRow[] | undefined;
  directorsReadable: boolean;
  canStoreKey: boolean;
  localRuntime: boolean;
}) {
  const recognised = rows.filter((row) => row.entry.kind !== "unknown").length;
  return (
    <div className="registry-import__review">
      <p className="muted org-drawer-intro">
        Read {rows.length} {rows.length === 1 ? "document" : "documents"}{recognised < rows.length ? `, ${recognised} recognised` : ""}.
        Checked values replace what the profile holds. Values already recorded, and values the documents disagree on, start unchecked.
      </p>
      {proposal.conflicts.length > 0 && (
        <Banner tone="warn" title="Check these first">
          <ul className="registry-import__plain-list">
            {proposal.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
          </ul>
        </Banner>
      )}
      {proposal.warnings.length > 0 && (
        <Banner tone="info" title="Notes from reading">
          <ul className="registry-import__plain-list">
            {proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </Banner>
      )}
      <ProposalFields proposal={proposal} selection={selection} onChange={onSelection} />
      <ReviewChecks
        proposal={proposal}
        selection={selection}
        onChange={onSelection}
        directors={directors}
        directorsReadable={directorsReadable}
        canStoreKey={canStoreKey}
        localRuntime={localRuntime}
      />
      <DocumentsReview rows={rows} upload={upload} onChange={onUpload} />
    </div>
  );
}
