import { createPortal } from "react-dom";
import { useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { speakerName } from "../../../../shared/transcriptModel";
import { Drawer } from "../../../components/ui";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import { isUnnamedSpeaker } from "./transcriptLinks";
import { MergedLabels, SameSpeakerSelect, SpeakerAssignment, SpeakerSwatch } from "./SpeakerControls";
import {
  combineGroups,
  speakerStats,
  speakerSuggestions,
  type SpeakerStat,
  type SpeakerSuggestion,
} from "./speakerSuggestions";
import type { AssignSpeaker, Attendee, MergeSpeakers, UnmergeSpeaker } from "./SpeakerPanel";
import { speakerPalette } from "./speakerTurns";

type ReviewActions = {
  onAssign: AssignSpeaker;
  onMerge: MergeSpeakers;
  onUnmerge: UnmergeSpeaker;
  onPlaySample: (index: number) => void;
};

/**
 * Review speakers: one calm list of every detected speaker, opened after a
 * timed import (and from the speaker panel). Each row names a voice or
 * combines it into another; suggestions apply in one click.
 */
export function SpeakerReview({
  open,
  onClose,
  segments,
  speakers,
  labels,
  attendees,
  hasMedia,
  ...actions
}: {
  open: boolean;
  onClose: () => void;
  /** Raw segments; labels are resolved here so combined labels nest. */
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  /** Displayed (resolved) labels in order of first appearance. */
  labels: readonly string[];
  attendees: readonly Attendee[];
  hasMedia: boolean;
} & ReviewActions) {
  const list = useRef<HTMLOListElement>(null);
  const [busy, setBusy] = useState(false);
  const stats = useMemo(() => speakerStats(segments, speakers), [segments, speakers]);
  const palette = useMemo(() => speakerPalette(segments), [segments]);
  const suggestions = useMemo(
    () =>
      speakerSuggestions({
        labels,
        speakers,
        attendees,
        talkTime: new Map([...stats.resolved].map(([label, row]) => [label, row.time])),
      }),
    [labels, speakers, attendees, stats],
  );
  const toName = labels.filter((label) => isUnnamedSpeaker(label, speakerName(label, speakers))).length;
  // A combined row folds into its target; keep keyboard focus on that row.
  const focusRow = (label: string) =>
    requestAnimationFrame(() =>
      [...(list.current?.querySelectorAll<HTMLElement>("[data-review-row]") ?? [])]
        .find((row) => row.dataset.reviewRow === label)
        ?.focus(),
    );
  async function apply(items: readonly SpeakerSuggestion[]) {
    setBusy(true);
    try {
      for (const group of combineGroups(items)) await actions.onMerge(group.from, group.into);
      for (const item of items) {
        if (item.kind === "assign") await actions.onAssign(item.label, item.name, item.personId);
      }
      const last = items.at(-1);
      if (last) focusRow(last.kind === "combine" ? last.into : last.label);
    } catch {
      /* The workspace displays mutation errors. */
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <Drawer
      open={open}
      onClose={onClose}
      title="Review speakers"
      className="transcript-speaker-drawer transcript-review"
      footer={
        <div className="transcript-review__footer">
          <button type="button" className="btn-action" onClick={onClose}>
            Skip for now
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <p className="transcript-review__intro">
        {labels.length} {labels.length === 1 ? "speaker" : "speakers"}
        {toName > 0 ? ` · ${toName} to name` : ""}. Name each voice, and combine labels that are the same
        person. Combining can be undone.
      </p>
      {suggestions.length > 0 && (
        <div className="transcript-review__suggest">
          <span>
            {suggestions.length} {suggestions.length === 1 ? "suggestion" : "suggestions"}
          </span>
          <button
            type="button"
            className="btn-action"
            disabled={busy}
            onClick={() => void apply(suggestions)}
          >
            Apply all suggestions
          </button>
        </div>
      )}
      <ol ref={list} className="transcript-review__list" aria-label="Detected speakers">
        {labels.map((label) => {
          const row = stats.resolved.get(label);
          return row ? (
            <ReviewRow
              key={label}
              label={label}
              index={palette.indexOf(label)}
              row={row}
              segments={segments}
              speakers={speakers}
              labels={labels}
              attendees={attendees}
              hasMedia={hasMedia}
              merged={stats.mergedUnder.get(label) ?? []}
              rawStats={stats.raw}
              suggestions={suggestions.filter((item) => item.label === label)}
              busy={busy}
              onApply={(item) => void apply([item])}
              onMerged={focusRow}
              {...actions}
            />
          ) : null;
        })}
      </ol>
    </Drawer>,
    document.body,
  );
}

function ReviewRow({
  label,
  index,
  row,
  segments,
  speakers,
  labels,
  attendees,
  hasMedia,
  merged,
  rawStats,
  suggestions,
  busy,
  onApply,
  onMerged,
  onAssign,
  onMerge,
  onUnmerge,
  onPlaySample,
}: {
  label: string;
  index: number;
  row: SpeakerStat;
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  labels: readonly string[];
  attendees: readonly Attendee[];
  hasMedia: boolean;
  merged: readonly string[];
  rawStats: ReadonlyMap<string, SpeakerStat>;
  suggestions: readonly SpeakerSuggestion[];
  busy: boolean;
  onApply: (item: SpeakerSuggestion) => void;
  onMerged: (target: string) => void;
} & ReviewActions) {
  const name = speakerName(label, speakers);
  const unnamed = isUnnamedSpeaker(label, name);
  const sample = row.sample ?? row.first;
  const quote = segments[sample]?.text ?? "";
  return (
    <li className="transcript-review__row" data-review-row={label} tabIndex={-1}>
      <div className="transcript-review__head">
        <span className={`transcript-speaker-name${unnamed ? " is-unnamed" : ""}`}>
          <SpeakerSwatch index={index} />
          <span className="transcript-speaker-name__label">{name}</span>
          {name !== label && <span className="transcript-muted">{label}</span>}
        </span>
        <span className="transcript-review__meta">
          {formatTranscriptTime(row.time)} · {row.count} {row.count === 1 ? "line" : "lines"}
        </span>
      </div>
      <p className="transcript-speaker__quote">
        “{quote.length > 140 ? `${quote.slice(0, 139).trimEnd()}…` : quote}”
      </p>
      {hasMedia && (
        <button
          type="button"
          className="btn-action transcript-review__play"
          onClick={() => onPlaySample(sample)}
        >
          <Play size={14} aria-hidden="true" />
          Play sample
        </button>
      )}
      <div className="transcript-review__controls">
        <SpeakerAssignment label={label} speakers={speakers} attendees={attendees} onAssign={onAssign} />
        {labels.length > 1 && (
          <SameSpeakerSelect
            label={label}
            labels={labels}
            speakers={speakers}
            onMerge={onMerge}
            onMerged={onMerged}
          />
        )}
      </div>
      {suggestions.map((item) => (
        <div className="transcript-suggestion" key={item.id}>
          <span>
            <span className="transcript-suggestion__tag">Suggested</span>{" "}
            {item.kind === "assign" ? item.name : `same person as ${speakerName(item.into, speakers)}`}
            <span className="transcript-muted"> · {item.reason}</span>
          </span>
          <button
            type="button"
            className="btn-action"
            disabled={busy}
            aria-label={
              item.kind === "assign"
                ? `Apply suggestion: ${label} is ${item.name}`
                : `Apply suggestion: combine ${label} into ${item.into}`
            }
            onClick={() => onApply(item)}
          >
            Apply
          </button>
        </div>
      ))}
      <MergedLabels name={name} labels={merged} stats={rawStats} canWrite onUnmerge={onUnmerge} />
    </li>
  );
}
