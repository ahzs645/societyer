/**
 * Global quick-create asset modal. Listens for the `quickaction:add-asset`
 * window event and opens a centered popup that persists straight to the asset
 * register — same pattern as GlobalTaskCreate.
 *
 * Mounted once in Layout so the command palette's "Add asset" command (and any
 * other caller) can pop this from anywhere in the app.
 */
import { useEffect, useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { AssetCreateModal } from "../features/assets/AssetCreateModal";
import type { AssetFormInitialValues } from "../features/assets/AssetFormFields";

export const OPEN_ASSET_CREATE_EVENT = "quickaction:add-asset";

type AssetCreateEventDetail = {
  initialValues?: AssetFormInitialValues;
};

export function openGlobalAssetCreate(initialValues?: AssetFormInitialValues) {
  window.dispatchEvent(new CustomEvent<AssetCreateEventDetail>(OPEN_ASSET_CREATE_EVENT, {
    detail: { initialValues },
  }));
}

export function GlobalAssetCreate() {
  const society = useSociety();
  const [open, setOpen] = useState(false);
  const [initialValues, setInitialValues] = useState<AssetFormInitialValues | undefined>();

  useEffect(() => {
    const handler = (event: Event) => {
      setInitialValues((event as CustomEvent<AssetCreateEventDetail>).detail?.initialValues);
      setOpen(true);
    };
    window.addEventListener(OPEN_ASSET_CREATE_EVENT, handler as EventListener);
    return () => window.removeEventListener(OPEN_ASSET_CREATE_EVENT, handler as EventListener);
  }, []);

  if (!society) return null;

  return (
    <AssetCreateModal
      open={open}
      onClose={() => {
        setOpen(false);
        setInitialValues(undefined);
      }}
      societyId={society._id}
      initialValues={initialValues}
    />
  );
}
