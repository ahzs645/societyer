/**
 * Global quick-create meeting popup. Listens for the
 * `quickaction:create-meeting` window event and opens the same meeting form the
 * Meetings page uses, presented as a centered dialog — same pattern as
 * GlobalTaskCreate / GlobalAssetCreate.
 *
 * Mounted once in Layout so the command palette's "Create meeting" command (and
 * any other caller) can pop this from anywhere in the app.
 */
import { useEffect, useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { MeetingCreateModal } from "../features/meetings/components/MeetingCreateModal";

export const OPEN_MEETING_CREATE_EVENT = "quickaction:create-meeting";

export function openGlobalMeetingCreate() {
  window.dispatchEvent(new Event(OPEN_MEETING_CREATE_EVENT));
}

export function GlobalMeetingCreate() {
  const society = useSociety();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_MEETING_CREATE_EVENT, handler);
    return () => window.removeEventListener(OPEN_MEETING_CREATE_EVENT, handler);
  }, []);

  if (!society) return null;

  return (
    <MeetingCreateModal
      open={open}
      onClose={() => setOpen(false)}
      societyId={society._id}
    />
  );
}
