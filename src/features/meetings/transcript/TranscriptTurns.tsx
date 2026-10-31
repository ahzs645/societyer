import { Fragment, memo, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { Menu } from "../../../components/Menu";
import {
  isUnnamedSpeaker,
  transcriptLink,
  transcriptQuote,
  truncateLabel,
  type MinutesLinkTarget,
} from "./transcriptLinks";
import { speakerName } from "../../../../shared/transcriptModel";
import { speakerTurnsByMark } from "./speakerTurns";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import type { LinkMinutesItem } from "./useMinutesLinks";
import { InCameraBoundary, InCameraDivider, SegmentInCameraEditor, type InCameraProps } from "./InCameraTranscript";
export type { InCameraProps } from "./InCameraTranscript";
import { SegmentLinkEditor, SegmentSpeakerEditor, SegmentTextEditor, type UpdateSegment } from "./SegmentEditors";
export type { UpdateSegment } from "./SegmentEditors";

export type TranscriptMatch = { segment: number; start: number; end: number };
function marked(text: string, matches: readonly TranscriptMatch[], offset = 0) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = Math.max(0, match.start - offset);
    const end = Math.min(text.length, match.end - offset);
    if (end <= start) continue;
    parts.push(
      text.slice(cursor, start),
      <mark key={`${offset}-${start}`} data-match-start={match.start}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

function SegmentText({ segment, hits }: { segment: TranscriptSegment; hits: readonly TranscriptMatch[] }) {
  let offset = 0;
  const words = segment.words;
  if (!words?.length) return <>{marked(segment.text, hits)}</>;
  return (
    <>
      {words.map((word, wordIndex) => {
        const found = segment.text.indexOf(word.text, offset);
        const start = found >= 0 ? found : offset;
        const prefix = segment.text.slice(offset, start);
        offset = start + word.text.length;
        return (
          <span key={wordIndex}>
            {marked(prefix, hits, start - prefix.length)}
            <span data-word={wordIndex} data-start={word.startSec} data-end={word.endSec}>
              {marked(word.text, hits, start)}
            </span>
            {wordIndex === words.length - 1 ? marked(segment.text.slice(offset), hits, offset) : ""}
          </span>
        );
      })}
    </>
  );
}

/** "Motion 1" / "Action" at the end of the line a minutes item was linked to. */
function SegmentCitations({ targets }: { targets: readonly MinutesLinkTarget[] }) {
  return (
    <>
      {targets.map((target) =>
        target.ref ? (
          <button
            key={target.key}
            type="button"
            className={`transcript-cite is-${target.kind === "motion" ? "motion" : "action"}`}
            data-seek={target.ref.startSec}
            aria-label={`${target.label} at ${formatTranscriptTime(target.ref.startSec)}: ${truncateLabel(target.summary, 80)}. Play from here`}
          >
            {target.label}
          </button>
        ) : null,
      )}
    </>
  );
}

function SegmentActions({
  segment,
  name,
  index,
  canWrite,
  canLink,
  canMarkInCamera,
  onEdit,
  onRelabel,
  onLinkStart,
  onMarkStart,
  onCopy,
}: {
  segment: TranscriptSegment;
  name: string;
  index: number;
  canWrite: boolean;
  canLink: boolean;
  canMarkInCamera: boolean;
  onEdit: (index: number) => void;
  onRelabel: (index: number) => void;
  onLinkStart: (index: number) => void;
  onMarkStart: (index: number) => void;
  onCopy: (text: string) => void;
}) {
  const location = useLocation();
  return (
    <Menu
      label={`Segment actions at ${formatTranscriptTime(segment.startSec)}`}
      align="right"
      minWidth={230}
      trigger={
        <button
          type="button"
          className="btn-action transcript-icon"
          aria-label={`Segment actions at ${formatTranscriptTime(segment.startSec)}`}
        >
          <MoreHorizontal size={17} />
        </button>
      }
      sections={[
        {
          id: "segment",
          items: [
            ...(canWrite
              ? [
                  { id: "edit", label: "Edit text", onSelect: () => onEdit(index) },
                  {
                    id: "speaker",
                    label: "Change speaker for this line",
                    onSelect: () => onRelabel(index),
                  },
                ]
              : []),
            ...(canLink
              ? [{ id: "link-minutes", label: "Link to motion/action…", onSelect: () => onLinkStart(index) }]
              : []),
            ...(canMarkInCamera
              ? [{ id: "in-camera", label: "Mark as in-camera…", onSelect: () => onMarkStart(index) }]
              : []),
            {
              id: "quote",
              label: "Copy quote with timestamp",
              onSelect: () => onCopy(transcriptQuote(segment.text, name, segment.startSec)),
            },
            {
              id: "link",
              label: "Copy link to this moment",
              onSelect: () => onCopy(transcriptLink(segment.startSec, segment.endSec, location)),
            },
          ],
        },
      ]}
    />
  );
}

export type MinutesLinkProps = {
  /** Minutes items this user may link; empty hides the linking actions. */
  linkTargets: readonly MinutesLinkTarget[];
  /** Segment index → linked items cited at the end of that line. */
  citations: ReadonlyMap<number, readonly MinutesLinkTarget[]>;
  onLink: LinkMinutesItem;
};

/** A turn's start time; the transcript's click handler seeks to `data-seek`. */
function TurnTimestamp({ startSec }: { startSec: number }) {
  return (
    <button type="button" className="transcript-time" data-seek={startSec}>
      {formatTranscriptTime(startSec)}
    </button>
  );
}

/** The speaker chip (for editors, a button that opens speaker assignment) and the inline start time. */
function TurnHeader({
  label,
  speakers,
  palette,
  canWrite,
  startSec,
}: {
  label: string;
  speakers: readonly TranscriptSpeaker[];
  palette: readonly string[];
  canWrite: boolean;
  startSec: number;
}) {
  const name = speakerName(label, speakers);
  const unnamed = isUnnamedSpeaker(label, name);
  const chipClass = `transcript-speaker-name transcript-color-${(Math.max(0, palette.indexOf(label)) % 8) + 1}${unnamed ? " is-unnamed" : ""}`;
  const chip = (
    <>
      <span className="transcript-swatch" />
      <span className="transcript-speaker-name__label">{name}</span>
      {unnamed && <span className="transcript-speaker-name__hint">Name speaker</span>}
    </>
  );
  return (
    <header>
      {canWrite ? (
        <button
          type="button"
          data-speaker-label={label}
          className={chipClass}
          aria-label={`Open speaker assignment for ${name}`}
        >
          {chip}
        </button>
      ) : (
        <span className={chipClass}>{chip}</span>
      )}
      <span className="transcript-turn__inline-time"><TurnTimestamp startSec={startSec} /></span>
    </header>
  );
}

/** Clock ticks and editor drafts do not re-render the document. */
export const TranscriptTurns = memo(function TranscriptTurns({
  segments,
  speakers,
  labels,
  palette,
  matches,
  canWrite,
  editIndex,
  relabelIndex,
  onUpdate,
  onDone,
  onEdit,
  onRelabel,
  onCopy,
  linkTargets,
  citations,
  onLink,
  inCamera,
}: {
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  labels: readonly string[];
  palette: readonly string[];
  matches: readonly TranscriptMatch[];
  canWrite: boolean;
  editIndex: number | null;
  relabelIndex: number | null;
  onUpdate: UpdateSegment;
  onDone: () => void;
  onEdit: (index: number) => void;
  onRelabel: (index: number) => void;
  onCopy: (text: string) => void;
  inCamera: InCameraProps;
} & MinutesLinkProps) {
  const [linkIndex, setLinkIndex] = useState<number | null>(null);
  const [markIndex, setMarkIndex] = useState<number | null>(null);
  // `segments` are display segments, so combined labels share one turn; turns
  // also break where a marked in-camera range starts or ends.
  const { marks } = inCamera;
  const turns = useMemo(() => speakerTurnsByMark(segments, marks), [segments, marks]);
  const bySegment = useMemo(() => {
    const map = new Map<number, TranscriptMatch[]>();
    for (const match of matches) {
      const list = map.get(match.segment) ?? [];
      list.push(match);
      map.set(match.segment, list);
    }
    return map;
  }, [matches]);
  return (
    <>
      {turns.map((turn, turnIndex) => {
        const previousMark = turnIndex > 0 ? turns[turnIndex - 1].mark : -1;
        const lastTurn = turnIndex === turns.length - 1;
        const startSec = segments[turn.indexes[0]].startSec;
        const onClear = inCamera.canMark ? inCamera.onClear : undefined;
        return (
          <Fragment key={turn.indexes[0]}>
          <InCameraBoundary marks={marks} previous={previousMark} current={turn.mark} onClear={onClear} />
          <article className={`transcript-turn${turn.mark >= 0 ? " is-in-camera" : ""}`}>
            <div className="transcript-turn__gutter"><TurnTimestamp startSec={startSec} /></div>
            <div className="transcript-turn__main">
              <TurnHeader label={turn.label} speakers={speakers} palette={palette} canWrite={canWrite} startSec={startSec} />
              {turn.indexes.map((index) => {
                const segment = segments[index];
                return (
                  <div className="transcript-segment-row" key={index}>
                    <span
                      className="transcript-segment"
                      data-segment={index}
                      data-start={segment.startSec}
                      data-end={segment.endSec}
                    >
                      <SegmentText segment={segment} hits={bySegment.get(index) ?? []} />
                    </span>
                    <SegmentCitations targets={citations.get(index) ?? []} />
                    <span className="transcript-segment-tools">
                      <SegmentActions
                        segment={segment}
                        name={speakerName(segment.speaker, speakers)}
                        index={index}
                        canWrite={canWrite}
                        canLink={linkTargets.length > 0}
                        canMarkInCamera={inCamera.canMark}
                        onEdit={onEdit}
                        onRelabel={onRelabel}
                        onLinkStart={setLinkIndex}
                        onMarkStart={setMarkIndex}
                        onCopy={onCopy}
                      />
                    </span>
                    {editIndex === index && (
                      <SegmentTextEditor
                        index={index}
                        text={segment.text}
                        onUpdate={onUpdate}
                        onDone={onDone}
                      />
                    )}
                    {relabelIndex === index && (
                      <SegmentSpeakerEditor
                        index={index}
                        label={segment.speaker}
                        labels={labels}
                        speakers={speakers}
                        onUpdate={onUpdate}
                        onDone={onDone}
                      />
                    )}
                    {linkIndex === index && linkTargets.length > 0 && (
                      <SegmentLinkEditor
                        segment={segment}
                        targets={linkTargets}
                        onLink={onLink}
                        onDone={() => setLinkIndex(null)}
                      />
                    )}
                    {markIndex === index && inCamera.canMark && (
                      <SegmentInCameraEditor
                        segment={segment}
                        choices={inCamera.choices}
                        onMark={inCamera.onMark}
                        onDone={() => setMarkIndex(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </article>
          {lastTurn && turn.mark >= 0 && <InCameraDivider mark={marks[turn.mark]} edge="end" />}
          </Fragment>
        );
      })}
    </>
  );
});
