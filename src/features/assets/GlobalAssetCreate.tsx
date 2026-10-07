/**
 * Global quick-create asset modal. Listens for the `quickaction:add-asset`
 * window event and opens a centered popup that persists straight to the asset
 * register — same pattern as GlobalTaskCreate.
 *
 * Mounted once in Layout so the command palette's "Add asset" command (and any
 * other caller) can pop this from anywhere in the app.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useSociety } from "../../hooks/useSociety";
import { isModuleEnabled } from "../../lib/modules";
const AssetCreateModal = lazy(() => import("./AssetCreateModal").then((module) => ({ default: module.AssetCreateModal })));
import type { AssetFormInitialValues } from "./AssetFormFields";

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
  const { can } = usePermissions();
  // A disabled Asset register cannot be written through the quick-create popup.
  const canCreate = can("financials:write") && (!society || isModuleEnabled(society, "assets"));
  const [open, setOpen] = useState(false);
  const [initialValues, setInitialValues] = useState<AssetFormInitialValues | undefined>();

  useEffect(() => {
    const handler = (event: Event) => {
      if (!canCreate) return;
      setInitialValues((event as CustomEvent<AssetCreateEventDetail>).detail?.initialValues);
      setOpen(true);
    };
    window.addEventListener(OPEN_ASSET_CREATE_EVENT, handler as EventListener);
    return () => window.removeEventListener(OPEN_ASSET_CREATE_EVENT, handler as EventListener);
  }, [canCreate]);

  if (!society || !open || !canCreate) return null;

  return (
    <Suspense fallback={<div role="status" aria-live="polite">Loading form…</div>}>
    <AssetCreateModal
      key={society._id}
      open={open}
      onClose={() => {
        setOpen(false);
        setInitialValues(undefined);
      }}
      societyId={society._id}
      initialValues={initialValues}
    />
    </Suspense>
  );
}
