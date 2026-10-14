import type { Crumb } from "../../../components/Breadcrumbs";

/**
 * Breadcrumbs for a page that belongs to one meeting (AGM workflow, minutes
 * preview): "Meetings › <meeting> › <page>". The route-derived trail can't
 * name the meeting, so phones would otherwise go back to the list instead of
 * the meeting the page came from.
 */
export function meetingChildCrumbs(meeting: { _id: string; title?: string | null }, current: string): Crumb[] {
  return [
    { label: "Meetings", to: "/app/meetings" },
    { label: meeting.title || "Meeting", to: `/app/meetings/${meeting._id}` },
    { label: current },
  ];
}
