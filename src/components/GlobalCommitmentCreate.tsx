/**
 * Global quick-create commitment popup. Listens for the
 * `quickaction:add-commitment` window event and opens the same commitment form
 * the Commitments page uses, presented as a centered dialog — same pattern as
 * GlobalTaskCreate / GlobalMeetingCreate.
 *
 * Mounted once in Layout so the command palette's "Add commitment" command (and
 * any other caller) can pop this from anywhere in the app.
 */
import { useEffect, useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { CommitmentCreateModal } from "../features/commitments/CommitmentCreateModal";

export const OPEN_COMMITMENT_CREATE_EVENT = "quickaction:add-commitment";

export function openGlobalCommitmentCreate() {
  window.dispatchEvent(new Event(OPEN_COMMITMENT_CREATE_EVENT));
}

export function GlobalCommitmentCreate() {
  const society = useSociety();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_COMMITMENT_CREATE_EVENT, handler);
    return () => window.removeEventListener(OPEN_COMMITMENT_CREATE_EVENT, handler);
  }, []);

  if (!society) return null;

  return (
    <CommitmentCreateModal
      open={open}
      onClose={() => setOpen(false)}
      societyId={society._id}
    />
  );
}
