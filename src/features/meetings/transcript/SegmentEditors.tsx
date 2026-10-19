/** The inline editors under a transcript line: its text, its speaker, and a minutes link. */
import { useState } from "react";
import { speakerName } from "../../../../shared/transcriptModel";
import { linkTargetMenuLabel, type MinutesLinkTarget } from "./transcriptLinks";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import type { LinkMinutesItem } from "./useMinutesLinks";

export type UpdateSegment = (index: number, patch: { text?: string; speaker?: string }) => Promise<void>;

export function SegmentTextEditor({
  index,
  text,
  onUpdate,
  onDone,
}: {
  index: number;
  text: string;
  onUpdate: UpdateSegment;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await onUpdate(index, { text: draft });
      onDone();
    } catch {
      // The workspace displays the mutation error; keep the draft available to retry.
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
        Edit segment text
        <textarea
          autoFocus
          value={draft}
          maxLength={20_000}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button className="btn-action" disabled={busy || !draft.trim()}>
        Save
      </button>
      <button type="button" className="btn-action" onClick={onDone} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}

export function SegmentSpeakerEditor({
  index,
  label,
  labels,
  speakers,
  onUpdate,
  onDone,
}: {
  index: number;
  label: string;
  labels: readonly string[];
  speakers: readonly TranscriptSpeaker[];
  onUpdate: UpdateSegment;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(label);
  const [busy, setBusy] = useState(false);
  async function save() {
    // `label` is the displayed (resolved) speaker; re-applying it must not
    // relabel a line whose raw label is combined into it.
    if (draft.trim() === label) {
      onDone();
      return;
    }
    setBusy(true);
    try {
      await onUpdate(index, { speaker: draft.trim() });
      onDone();
    } catch {
      // The workspace displays the mutation error; keep the draft available to retry.
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
        This segment →
        <select
          aria-label="Existing speaker label"
          value={labels.includes(draft) ? draft : "new"}
          onChange={(event) => setDraft(event.target.value === "new" ? "" : event.target.value)}
        >
          {labels.map((value) => (
            <option key={value} value={value}>
              {speakerName(value, speakers)} ({value})
            </option>
          ))}
          <option value="new">New label…</option>
        </select>
      </label>
      <input
        autoFocus
        aria-label="Speaker label for this segment"
        maxLength={200}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button className="btn-action" disabled={busy || !draft.trim()}>
        Apply
      </button>
      <button type="button" className="btn-action" disabled={busy} onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

export function SegmentLinkEditor({
  segment,
  targets,
  onLink,
  onDone,
}: {
  segment: TranscriptSegment;
  targets: readonly MinutesLinkTarget[];
  onLink: LinkMinutesItem;
  onDone: () => void;
}) {
  const [key, setKey] = useState(targets[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const target = targets.find((candidate) => candidate.key === key);
  async function save() {
    if (!target) return;
    setBusy(true);
    try {
      await onLink(target, { startSec: segment.startSec, endSec: segment.endSec });
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
        Link {formatTranscriptTime(segment.startSec)}–{formatTranscriptTime(segment.endSec)} to
        <select autoFocus value={key} onChange={(event) => setKey(event.target.value)}>
          {targets.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {linkTargetMenuLabel(candidate)}
              {candidate.ref ? ` (now ${formatTranscriptTime(candidate.ref.startSec)})` : ""}
            </option>
          ))}
        </select>
      </label>
      <button className="btn-action" disabled={busy || !target}>
        Link
      </button>
      <button type="button" className="btn-action" disabled={busy} onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}
