// Shared canonical reader for a meeting's agenda. The relational
// `agendas` + `agendaItems` store is the single source of truth for a
// meeting's agenda; this helper joins them and returns ordered entries.

export type AgendaEntry = { title: string; depth: 0 | 1 };

/**
 * Read a meeting's agenda items, ordered, joined via the first agenda for the
 * meeting (by_meeting) and its items (by_agenda ordered by `order`). Returns the
 * raw agendaItems docs so callers can read additional fields (type, presenter,
 * details, motionText, etc.). Falls back to an empty array when no agenda
 * exists for the meeting.
 */
export async function readMeetingAgendaItems(ctx: any, meetingId: any): Promise<any[]> {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q: any) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a: any, b: any) => a.createdAtISO.localeCompare(b.createdAtISO));
  const agenda = agendas[0];
  if (!agenda) return [];
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q: any) => q.eq("agendaId", agenda._id))
    .collect();
  items.sort((a: any, b: any) => a.order - b.order);
  return items;
}

/**
 * Canonical `{ title, depth }[]` reader for a meeting's agenda. This is the
 * interchange shape that used to be serialized into `meetings.agendaJson`.
 */
export async function readMeetingAgendaEntries(ctx: any, meetingId: any): Promise<AgendaEntry[]> {
  const items = await readMeetingAgendaItems(ctx, meetingId);
  return items
    .map((item: any) => ({
      title: String(item.title ?? "").trim(),
      depth: item.depth === 1 ? (1 as const) : (0 as const),
    }))
    .filter((entry: AgendaEntry) => entry.title);
}
