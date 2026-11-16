/**
 * The notes skill's suggestions under the AI notes: who each transcript
 * speaker is (with the words that show it) and who took part. Nothing is
 * applied until someone chooses to: speakers through transcripts:assignSpeaker,
 * attendees onto the meeting's attendee list.
 */
import { useState } from "react";
import { Check, UserCheck, Users } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "@/components/Toast";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import type { Id } from "../../../../convex/_generated/dataModel";

export type SpeakerSuggestion = { label: string; name: string; personId?: string; evidence: string };
export type AttendeeSuggestion = { name: string; personId?: string };

type TranscriptSpeakers = { speakers?: Array<{ label: string; name?: string; personId?: string }> } | null | undefined;

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function NotesDraftSuggestions({
  societyId,
  meetingId,
  speakers,
  attendees,
  transcript,
  currentAttendees,
  canWrite,
  canNameSpeakers,
}: {
  societyId: Id<"societies">;
  meetingId: Id<"meetings">;
  speakers: SpeakerSuggestion[];
  attendees: AttendeeSuggestion[];
  transcript: TranscriptSpeakers;
  currentAttendees: string[];
  canWrite: boolean;
  /** Naming speakers changes the working transcript: minute-takers only (decision A1). */
  canNameSpeakers: boolean;
}) {
  const toast = useToast();
  const assignSpeaker = usePermissionedMutation(api.transcripts.assignSpeaker, canWrite && canNameSpeakers);
  const updateMeeting = usePermissionedMutation(api.meetings.update, canWrite);
  const [busy, setBusy] = useState(false);

  const named = new Map((transcript?.speakers ?? []).map((speaker) => [speaker.label, speaker]));
  const isApplied = (suggestion: SpeakerSuggestion) => {
    const current = named.get(suggestion.label);
    return Boolean(current && (suggestion.personId ? current.personId === suggestion.personId : current.name && nameKey(current.name) === nameKey(suggestion.name)));
  };
  const attending = new Set(currentAttendees.map(nameKey));
  const pendingSpeakers = speakers.filter((suggestion) => !isApplied(suggestion));
  const pendingAttendees = attendees.filter((attendee) => !attending.has(nameKey(attendee.name)));
  if (!speakers.length && !attendees.length) return null;

  const applySpeakers = async (list: SpeakerSuggestion[]) => {
    setBusy(true);
    try {
      for (const suggestion of list) {
        await assignSpeaker({
          societyId,
          meetingId,
          label: suggestion.label,
          name: suggestion.name,
          ...(suggestion.personId ? { personId: suggestion.personId as Id<"peopleDirectory"> } : {}),
        });
      }
      toast.success(list.length === 1 ? `${list[0].label} is now ${list[0].name}.` : `${list.length} speakers named.`);
    } catch (error) {
      toast.error("Could not name the speaker", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const addAttendees = async (list: AttendeeSuggestion[]) => {
    setBusy(true);
    try {
      await updateMeeting({ id: meetingId, patch: { attendeeIds: [...currentAttendees, ...list.map((attendee) => attendee.name)] } });
      toast.success(list.length === 1 ? `${list[0].name} added to attendees.` : `${list.length} attendees added.`);
    } catch (error) {
      toast.error("Could not update attendees", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notes-suggestions">
      {speakers.length > 0 && (
        <section className="notes-suggestions__group" aria-label="Who's speaking">
          <div className="notes-suggestions__head">
            <h3><UserCheck size={13} aria-hidden="true" /> Who's speaking</h3>
            {canWrite && canNameSpeakers && pendingSpeakers.length > 1 && (
              <button type="button" className="btn-action" disabled={busy} onClick={() => { void applySpeakers(pendingSpeakers); }}>
                Name all {pendingSpeakers.length}
              </button>
            )}
          </div>
          <ul>
            {speakers.map((suggestion) => {
              const applied = isApplied(suggestion);
              return (
                <li key={suggestion.label} className="notes-suggestions__item">
                  <div className="notes-suggestions__text">
                    <span><code>{suggestion.label}</code> → <strong>{suggestion.name}</strong>{suggestion.personId ? "" : " (not in People)"}</span>
                    <span className="muted">“{suggestion.evidence}”</span>
                  </div>
                  {applied ? (
                    <span className="notes-suggestions__done"><Check size={12} aria-hidden="true" /> Named</span>
                  ) : canWrite && canNameSpeakers ? (
                    <button type="button" className="btn-action" disabled={busy} onClick={() => { void applySpeakers([suggestion]); }}>
                      Name speaker
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {attendees.length > 0 && (
        <section className="notes-suggestions__group" aria-label="Took part">
          <div className="notes-suggestions__head">
            <h3><Users size={13} aria-hidden="true" /> Took part</h3>
            {canWrite && pendingAttendees.length > 0 && (
              <button type="button" className="btn-action" disabled={busy} onClick={() => { void addAttendees(pendingAttendees); }}>
                Add {pendingAttendees.length === 1 ? "to attendees" : `all ${pendingAttendees.length} to attendees`}
              </button>
            )}
          </div>
          <p className="notes-suggestions__people">
            {attendees.map((attendee, index) => (
              <span key={attendee.personId ?? attendee.name} className={attending.has(nameKey(attendee.name)) ? "is-listed" : undefined}>
                {attendee.name}{index < attendees.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * "People the AI knows": the roster the notes skill gets (meetings:notesSkillContext),
 * so people can see who it can assign work to and what it knows about them.
 * Loaded only when opened.
 */
export function SkillRosterDisclosure({ meetingId }: { meetingId: Id<"meetings"> }) {
  const [open, setOpen] = useState(false);
  const context = useQuery(api.meetings.notesSkillContext, open ? { id: meetingId } : "skip") as
    | { people: Array<{ id?: string; name: string; roles: string[]; attendee?: boolean }>; peopleOmitted?: number; goals: unknown[]; committees: unknown[]; speakers: unknown[] }
    | undefined;
  return (
    <details className="notes-roster" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>People the AI knows{context ? ` (${context.people.length})` : ""}</summary>
      {open && !context && <p className="muted">Loading…</p>}
      {context && (
        <>
          <p className="muted">
            The AI can assign action items to these people and recognise them in the transcript. It also knows {context.goals.length} open goal{context.goals.length === 1 ? "" : "s"} and {context.committees.length} committee{context.committees.length === 1 ? "" : "s"}. You only see, and the AI only gets, the registers you can read.
          </p>
          {context.people.length ? (
            <ul className="notes-roster__list">
              {context.people.map((person) => (
                <li key={person.id ?? person.name}>
                  <strong>{person.name}</strong>
                  {person.attendee && <span className="notes-roster__tag">attending</span>}
                  {!person.id && <span className="notes-roster__tag">not in People</span>}
                  {person.roles.length > 0 && <span className="muted"> · {person.roles.join("; ")}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No people yet. Add directors, staff, volunteers or members, or list attendees on the meeting.</p>
          )}
          {Boolean(context.peopleOmitted) && <p className="muted">{context.peopleOmitted} more aren't sent, to keep the request small; attendees and committee members come first.</p>}
        </>
      )}
    </details>
  );
}
