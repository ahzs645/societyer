/**
 * Global quick-create commitment popup. Listens for the
 * `quickaction:add-commitment` window event and opens the same commitment form
 * the Commitments page uses, presented as a centered dialog — same pattern as
 * GlobalTaskCreate / GlobalMeetingCreate.
 *
 * Mounted once in Layout so the command palette's "Add commitment" command (and
 * any other caller) can pop this from anywhere in the app.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useSociety } from "../../hooks/useSociety";
const CommitmentCreateModal = lazy(() => import("./CommitmentCreateModal").then((module) => ({ default: module.CommitmentCreateModal })));

export const OPEN_COMMITMENT_CREATE_EVENT = "quickaction:add-commitment";

export function openGlobalCommitmentCreate() {
  window.dispatchEvent(new Event(OPEN_COMMITMENT_CREATE_EVENT));
}

export function GlobalCommitmentCreate() {
  const society = useSociety();
  const { can } = usePermissions();
  const canCreate = can("commitments:write");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => { if (canCreate) setOpen(true); };
    window.addEventListener(OPEN_COMMITMENT_CREATE_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMMITMENT_CREATE_EVENT, handler);
  }, [canCreate]);

  if (!society || !open || !canCreate) return null;

  return (
    <Suspense fallback={<div role="status" aria-live="polite">Loading form…</div>}>
    <CommitmentCreateModal
      key={society._id}
      open={open}
      onClose={() => setOpen(false)}
      societyId={society._id}
    />
    </Suspense>
  );
}
