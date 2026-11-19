import { lazy, Suspense, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { RecordIncorporationDrawer, type RecordIncorporationPrefill } from "./RecordIncorporationDrawer";
import type { RegistryImportApplied } from "./registryImport/RegistryImportDrawer";
import { unsavedProfileTabs } from "./tabFields";
import type { OrganizationDetail, OrganizationRecord, ProfileDocument, ProfileForm } from "./types";

// The parser and the review screens load the first time the import opens.
const RegistryImportDrawer = lazy(() => import("./registryImport/RegistryImportDrawer").then((module) => ({ default: module.RegistryImportDrawer })));

/**
 * The profile's "Import from registry documents" and "Record incorporation"
 * drawers. Both write the organization directly, so afterwards the page's
 * form reloads from the saved organization once it reflects the change;
 * otherwise the stale (preparing) form could be saved back over it.
 */
export function useRegistryDrawers({ society, form, setForm, detail, documents, canEdit }: {
  society: OrganizationRecord | null | undefined;
  form: ProfileForm | null;
  setForm: Dispatch<SetStateAction<ProfileForm | null>>;
  detail: OrganizationDetail | undefined;
  documents: readonly ProfileDocument[] | undefined;
  canEdit: boolean;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importLoaded, setImportLoaded] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordPrefill, setRecordPrefill] = useState<RecordIncorporationPrefill | undefined>();
  const importOpenedAt = useRef<number | null>(null);
  const latestSociety = useRef(society);
  latestSociety.current = society;
  const reseedWhen = useRef<((saved: OrganizationRecord) => boolean) | null>(null);

  const reseedFormWhen = (ready: (saved: OrganizationRecord) => boolean) => {
    const current = latestSociety.current;
    if (current && ready(current)) {
      reseedWhen.current = null;
      setForm({ ...current });
    } else {
      reseedWhen.current = ready;
    }
  };
  useEffect(() => {
    const ready = reseedWhen.current;
    if (!society || !ready || !ready(society)) return;
    reseedWhen.current = null;
    setForm({ ...society });
  }, [society, setForm]);

  const openImport = () => {
    importOpenedAt.current = latestSociety.current?.updatedAt ?? null;
    setImportLoaded(true);
    setImportOpen(true);
  };
  const openRecordIncorporation = (prefill?: RecordIncorporationPrefill) => {
    setRecordPrefill(prefill);
    setRecordOpen(true);
  };
  const onImportApplied = (applied: RegistryImportApplied) => {
    const before = importOpenedAt.current;
    if (applied.changedSociety) reseedFormWhen((saved) => saved.updatedAt !== before);
    if (applied.recordIncorporation) openRecordIncorporation(applied.recordIncorporation);
  };

  const unsavedChanges = unsavedProfileTabs(form, society).size > 0;
  const element = society ? (
    <>
      {importLoaded && (
        <Suspense fallback={null}>
          <RegistryImportDrawer
            open={importOpen}
            onClose={() => setImportOpen(false)}
            society={society}
            detail={detail}
            documents={documents}
            canEdit={canEdit}
            unsavedChanges={unsavedChanges}
            onApplied={onImportApplied}
          />
        </Suspense>
      )}
      <RecordIncorporationDrawer
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        society={society}
        detail={detail}
        documents={documents}
        canEdit={canEdit}
        prefill={recordPrefill}
        unsavedChanges={unsavedChanges}
        onRecorded={() => reseedFormWhen((saved) => saved.formationStatus === "incorporated")}
      />
    </>
  ) : null;

  return { openImport, openRecordIncorporation, element };
}
