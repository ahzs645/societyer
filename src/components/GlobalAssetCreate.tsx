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

export const OPEN_ASSET_CREATE_EVENT = "quickaction:add-asset";

export function openGlobalAssetCreate() {
  window.dispatchEvent(new Event(OPEN_ASSET_CREATE_EVENT));
}

export function GlobalAssetCreate() {
  const society = useSociety();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_ASSET_CREATE_EVENT, handler);
    return () => window.removeEventListener(OPEN_ASSET_CREATE_EVENT, handler);
  }, []);

  if (!society) return null;

  return (
    <AssetCreateModal
      open={open}
      onClose={() => setOpen(false)}
      societyId={society._id}
    />
  );
}
