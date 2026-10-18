import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../lib/convexApi";
import { Field } from "../../../components/ui";
import { useToast } from "../../../components/Toast";
import { PROCUREMENT_REVIEW_FOLDER_MAX_LENGTH, validateWorkspaceProcurementReviewFolder, workspaceProcurementReviewRoot } from "../../../../shared/procurementReview/paths";

/**
 * Which SharePoint folder this workspace reads. Settings editors choose it;
 * everyone else is told who can. Only the path is stored: the deployment's
 * SharePoint connection does the reading, so no credentials are asked for.
 */
export function FolderSetupCard({ societyId, folder, canConfigure, onSaved, onCancel }: {
  societyId: string;
  folder: string;
  canConfigure: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const setFolder = useMutation(api.procurementReview.setFolder);
  const toast = useToast();
  const workspaceRoot = workspaceProcurementReviewRoot(societyId);
  const [value, setValue] = useState(folder || workspaceRoot);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setValue(folder || workspaceRoot); setTouched(false); }, [folder, workspaceRoot]);

  let error: string | undefined;
  try { validateWorkspaceProcurementReviewFolder(societyId, value); } catch (caught) { error = caught instanceof Error ? caught.message : "Invalid folder path."; }

  const save = async () => {
    setTouched(true);
    if (error || !canConfigure) return;
    setSaving(true);
    try {
      await setFolder({ societyId, folder: value });
      toast.success("Snapshot folder saved", "Procurement review reads the snapshot published there.");
      onSaved?.();
    } catch (caught) {
      toast.error("Couldn't save the snapshot folder", caught instanceof Error ? caught.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card procurement-review__state">
      <div className="card__head">
        <h2 className="card__title">{folder ? "Change the snapshot folder" : "Choose the snapshot folder"}</h2>
      </div>
      <div className="card__body col">
        <p className="muted">
          Zoer publishes this workspace's procurement snapshot to a folder in the deployment's SharePoint document library.
          Societyer only reads that folder; changes are made in Zoer.
        </p>
        {canConfigure ? (
          <form className="procurement-review__folder-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <Field
              label="SharePoint folder path"
              hint={`Use ${workspaceRoot}, or a folder inside it. Publish to the same path from Zoer.`}
              error={touched ? error : undefined}
            >
              <input
                className="input"
                value={value}
                maxLength={PROCUREMENT_REVIEW_FOLDER_MAX_LENGTH}
                autoComplete="off"
                spellCheck={false}
                disabled={saving}
                onChange={(event) => setValue(event.target.value)}
                onBlur={() => setTouched(true)}
              />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <button type="submit" className="btn btn--accent" disabled={saving || (touched && Boolean(error))}>{saving ? "Saving…" : "Save folder"}</button>
              {onCancel && <button type="button" className="btn btn--ghost" disabled={saving} onClick={onCancel}>Cancel</button>}
            </div>
          </form>
        ) : (
          <div className="notice">An Owner or Admin chooses the SharePoint folder this workspace reads. Ask one of them to set up procurement review.</div>
        )}
      </div>
    </div>
  );
}
