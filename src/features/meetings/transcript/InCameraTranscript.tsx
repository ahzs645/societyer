import { useState } from "react";
import { Lock } from "lucide-react";
import type { TranscriptRef } from "../../../../shared/transcriptModel";
import type { MenuSection } from "../../../components/Menu";
import type { TranscriptSegment } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import type { InCameraChoice, InCameraMark, MarkInCamera } from "./useInCameraMarks";

/*
 * In-camera sessions in the transcript (decision A2): the "Mark as in-camera…"
 * editor for one line, and the dividers where a marked session starts and ends.
 */

/** Marked in-camera sessions: dividers in the transcript, and "Mark as in-camera…" for editors. */
export type InCameraProps = {
  marks: readonly InCameraMark[];
  choices: readonly InCameraChoice[];
  canMark: boolean;
  onMark: MarkInCamera;
  onClear: (sessionTitle: string) => void;
};

const NEW_SESSION = "__new__";

/** "Mark as in-camera…" for one line: pick a session (or a new one); the line's range is added to it. */
export function SegmentInCameraEditor({
  segment,
  choices,
  onMark,
  onDone,
}: {
  segment: TranscriptSegment;
  choices: readonly InCameraChoice[];
  onMark: MarkInCamera;
  onDone: () => void;
}) {
  const [choice, setChoice] = useState(choices[0]?.title ?? NEW_SESSION);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await onMark(choice === NEW_SESSION ? null : choice, { startSec: segment.startSec, endSec: segment.endSec });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="transcript-inline-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label>
        Mark {formatTranscriptTime(segment.startSec)}–{formatTranscriptTime(segment.endSec)} as
        <select autoFocus value={choice} onChange={(event) => setChoice(event.target.value)}>
          {choices.map((candidate) => (
            <option key={candidate.title} value={candidate.title}>
              {candidate.title}
              {candidate.startSec !== undefined ? ` (now ${formatTranscriptTime(candidate.startSec)}–${formatTranscriptTime(candidate.endSec ?? candidate.startSec)})` : ""}
            </option>
          ))}
          <option value={NEW_SESSION}>New in-camera session</option>
        </select>
      </label>
      <button className="btn-action" disabled={busy}>
        Mark
      </button>
      <button type="button" className="btn-action" disabled={busy} onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

// "In camera", "In-camera", "In‑camera" (any dash or space, or none), any case.
const IN_CAMERA_PREFIX = /^in[\s\-\u2010-\u2015]*camera\b/i;

/** The divider's label: "In camera: <title>", unless the title already says so. */
export function inCameraDividerLabel(title: string): string {
  const trimmed = title.trim();
  return IN_CAMERA_PREFIX.test(trimmed) ? trimmed : `In camera: ${trimmed}`;
}

/** Where a marked in-camera session starts or ends in the transcript (editors only). */
export function InCameraDivider({ mark, edge, onClear }: { mark: InCameraMark; edge: "start" | "end"; onClear?: (title: string) => void }) {
  const range = `${formatTranscriptTime(mark.startSec)}–${formatTranscriptTime(mark.endSec)}`;
  return (
    <div className={`transcript-incamera-divider is-${edge}`}>
      <span className="transcript-incamera-divider__label">
        {edge === "start" ? (
          <>
            <Lock size={12} aria-hidden="true" />
            {inCameraDividerLabel(mark.title)} · {range}
          </>
        ) : (
          <>End of {mark.title}</>
        )}
      </span>
      {edge === "start" && onClear && (
        <button
          type="button"
          className="transcript-incamera-divider__action"
          aria-label={`Clear the recording range of ${mark.title}`}
          onClick={() => onClear(mark.title)}
        >
          Clear
        </button>
      )}
    </div>
  );
}

/** The dividers between two turns: the end of one marked session and the start of the next. */
export function InCameraBoundary({
  marks,
  previous,
  current,
  onClear,
}: {
  marks: readonly InCameraMark[];
  previous: number;
  current: number;
  onClear?: (title: string) => void;
}) {
  if (previous === current) return null;
  return (
    <>
      {previous >= 0 && <InCameraDivider mark={marks[previous]} edge="end" />}
      {current >= 0 && <InCameraDivider mark={marks[current]} edge="start" onClear={onClear} />}
    </>
  );
}

/** The selection toolbar's "Mark as in-camera…" menu: existing sessions, then a new one. */
export function inCameraMenuSections(
  inCamera: Pick<InCameraProps, "choices" | "onMark">,
  beforeMark: () => void,
  range: TranscriptRef,
): MenuSection[] {
  const mark = (title: string | null) => () => {
    beforeMark();
    void inCamera.onMark(title, range);
  };
  return [
    ...(inCamera.choices.length
      ? [{
          id: "sessions",
          label: "In-camera sessions",
          items: inCamera.choices.map((choice) => ({
            id: `session-${choice.title}`,
            label: choice.title,
            hint: choice.startSec !== undefined ? formatTranscriptTime(choice.startSec) : undefined,
            onSelect: mark(choice.title),
          })),
        }]
      : []),
    { id: "new", items: [{ id: "new-session", label: "New in-camera session", onSelect: mark(null) }] },
  ];
}

/** Under the player, while some in-camera session isn't marked: what that means for other readers. */
export function InCameraNote({ canMark }: { canMark: boolean }) {
  return (
    <p className="transcript-muted transcript-incamera-note">
      {canMark
        ? "Mark each in-camera session in the recording (select its lines, then Mark as in-camera…). Until every session is marked, connectors and public copies get no transcript."
        : "Until every in-camera session is marked in the recording, connectors and public copies get no transcript."}
    </p>
  );
}
