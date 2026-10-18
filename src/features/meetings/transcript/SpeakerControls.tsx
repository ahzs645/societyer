import { Fragment, useState } from "react";
import { speakerName } from "../../../../shared/transcriptModel";
import type { TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import type { SpeakerStat } from "./speakerSuggestions";
import type { AssignSpeaker, Attendee, MergeSpeakers, UnmergeSpeaker } from "./SpeakerPanel";
import { showCandidateGroups } from "./speakerCandidates";

/** Attendees with their list index, split into labelled groups when the list is long. */
function attendeeGroups(attendees: readonly Attendee[]) {
  const indexed = attendees.map((attendee, index) => ({ attendee, index }));
  if (!showCandidateGroups(attendees)) return [{ label: "", rows: indexed }];
  const groups: Array<{ label: string; rows: typeof indexed }> = [];
  for (const row of indexed) {
    const label = row.attendee.group ?? "Other";
    const group = groups.find((entry) => entry.label === label);
    if (group) group.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function SpeakerAssignment({
  label,
  speakers,
  attendees,
  onAssign,
  onAssigned,
  expanded = false,
}: {
  label: string;
  speakers: readonly TranscriptSpeaker[];
  attendees: readonly Attendee[];
  onAssign: AssignSpeaker;
  /** Called after a successful assignment, e.g. to close the mobile sheet. */
  onAssigned?: () => void;
  expanded?: boolean;
}) {
  const [other, setOther] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const assigned = speakers.find((speaker) => speaker.label === label);
  const value = attendees.findIndex(
    (attendee) => attendee.name === assigned?.name && attendee.personId === assigned?.personId,
  );
  async function assign(nextName?: string, personId?: string) {
    setBusy(true);
    try {
      await onAssign(label, nextName, personId);
      setOther(false);
      onAssigned?.();
    } catch {
      /* The workspace displays mutation errors. */
    } finally {
      setBusy(false);
    }
  }
  const chooseOther = () => {
    setOther(true);
    setName(assigned?.name ?? "");
  };
  const groups = attendeeGroups(attendees);
  return (
    <div className={`transcript-assignment${!assigned?.name ? " is-unnamed" : ""}`}>
      {expanded ? (
        <div className="transcript-attendees" role="group" aria-label={`Assign ${label} to an attendee`}>
          {groups.map((group) => (
            <Fragment key={group.label || "all"}>
              {group.label && <span className="transcript-attendees__group-label">{group.label}</span>}
              {group.rows.map(({ attendee, index }) => (
                <button
                  type="button"
                  className="btn-action"
                  key={`${attendee.name}-${index}`}
                  disabled={busy}
                  aria-pressed={value === index}
                  onClick={() => void assign(attendee.name, attendee.personId)}
                >
                  <strong>{attendee.name}</strong>
                  {(attendee.roleTitle || attendee.status) && (
                    <small>
                      {[attendee.roleTitle, attendee.status?.replaceAll("_", " ")].filter(Boolean).join(" · ")}
                    </small>
                  )}
                </button>
              ))}
            </Fragment>
          ))}
          <button type="button" className="btn-action" disabled={busy} onClick={chooseOther}>
            Someone else…
          </button>
        </div>
      ) : (
        <select
          aria-label={`Assign ${label}`}
          disabled={busy}
          value={other ? "other" : value >= 0 ? String(value) : assigned?.name ? "assigned" : ""}
          onChange={(event) => {
            const choice = event.target.value;
            if (choice === "other") {
              chooseOther();
              return;
            }
            const attendee = attendees[Number(choice)];
            void assign(
              choice === "" ? undefined : attendee?.name,
              choice === "" ? undefined : attendee?.personId,
            );
          }}
        >
          <option value="">Assign to attendee…</option>
          {value < 0 && assigned?.name && <option value="assigned">{assigned.name}</option>}
          {groups.map((group) => {
            const options = group.rows.map(({ attendee, index }) => (
              <option value={index} key={`${attendee.name}-${index}`}>
                {attendee.name}
              </option>
            ));
            return group.label ? (
              <optgroup key={group.label} label={group.label}>
                {options}
              </optgroup>
            ) : (
              options
            );
          })}
          <option value="other">Someone else…</option>
        </select>
      )}
      {other && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void assign(name.trim());
          }}
        >
          <input
            aria-label={`Other name for ${label}`}
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="btn-action" disabled={busy || !name.trim()}>
            Apply
          </button>
        </form>
      )}
    </div>
  );
}

/** Choose several labels that are really this speaker and combine them in one step. */
export function SpeakerCombine({
  label,
  labels,
  speakers,
  stats,
  palette,
  onMerge,
}: {
  label: string;
  labels: readonly string[];
  speakers: readonly TranscriptSpeaker[];
  stats: ReadonlyMap<string, SpeakerStat>;
  /** Raw labels in first-appearance order; colours index into it. */
  palette: readonly string[];
  onMerge: MergeSpeakers;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const name = speakerName(label, speakers);
  const others = labels.filter((other) => other !== label);
  async function combine() {
    setBusy(true);
    try {
      await onMerge(chosen, label);
      setChosen([]);
    } catch {
      /* The workspace displays mutation errors. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="transcript-combine" disabled={busy}>
      <legend>Same person as {name}</legend>
      <p className="transcript-muted">
        Choose the labels that are really {name}. You can unmerge them later.
      </p>
      {others.map((other) => {
        const otherName = speakerName(other, speakers);
        return (
          <label key={other} className="transcript-combine__option">
            <input
              type="checkbox"
              checked={chosen.includes(other)}
              onChange={(event) =>
                setChosen((previous) =>
                  event.target.checked ? [...previous, other] : previous.filter((value) => value !== other),
                )
              }
            />
            <SpeakerSwatch index={palette.indexOf(other)} />
            <span className="transcript-combine__name">
              {otherName}
              {otherName !== other && <small> ({other})</small>}
            </span>
            <small className="transcript-muted">{formatTranscriptTime(stats.get(other)?.time ?? 0)}</small>
          </label>
        );
      })}
      <button
        type="button"
        className="btn-action"
        disabled={busy || !chosen.length}
        onClick={() => void combine()}
      >
        {chosen.length
          ? `Combine ${chosen.length === 1 ? chosen[0] : `${chosen.length} speakers`} into ${name}`
          : `Combine into ${name}`}
      </button>
    </fieldset>
  );
}

/** "Same person as…": combine this label into another displayed speaker. */
export function SameSpeakerSelect({
  label,
  labels,
  speakers,
  onMerge,
  onMerged,
}: {
  label: string;
  labels: readonly string[];
  speakers: readonly TranscriptSpeaker[];
  onMerge: MergeSpeakers;
  onMerged?: (target: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function merge(to: string) {
    if (!to) return;
    setBusy(true);
    try {
      await onMerge([label], to);
      onMerged?.(to);
    } catch {
      /* The workspace displays mutation errors. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <select
      className="transcript-same-as"
      aria-label={`${speakerName(label, speakers)} is the same person as…`}
      value=""
      disabled={busy || labels.length < 2}
      onChange={(event) => void merge(event.target.value)}
    >
      <option value="">Same person as…</option>
      {labels
        .filter((target) => target !== label)
        .map((target) => {
          const targetName = speakerName(target, speakers);
          return (
            <option key={target} value={target}>
              {targetName === target ? target : `${targetName} (${target})`}
            </option>
          );
        })}
    </select>
  );
}

/** A speaker's colour dot; the colour class sits on the dot so names keep the body colour. */
export function SpeakerSwatch({ index }: { index: number }) {
  return (
    <span
      className={`transcript-swatch transcript-color-${(Math.max(0, index) % 8) + 1}`}
      aria-hidden="true"
    />
  );
}

/** Raw labels combined into a speaker, each with its own Unmerge. */
export function MergedLabels({
  name,
  labels,
  stats,
  canWrite,
  onUnmerge,
}: {
  name: string;
  labels: readonly string[];
  stats: ReadonlyMap<string, SpeakerStat>;
  canWrite: boolean;
  onUnmerge: UnmergeSpeaker;
}) {
  if (!labels.length) return null;
  return (
    <ul className="transcript-merged" aria-label={`Labels combined into ${name}`}>
      {labels.map((label) => (
        <li key={label}>
          <span>
            also <strong>{label}</strong>
            <span className="transcript-muted"> · {formatTranscriptTime(stats.get(label)?.time ?? 0)}</span>
          </span>
          {canWrite && (
            <button
              type="button"
              className="btn-action transcript-merged__undo"
              aria-label={`Unmerge ${label} from ${name}`}
              onClick={() => void onUnmerge(label).catch(() => undefined)}
            >
              Unmerge
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
