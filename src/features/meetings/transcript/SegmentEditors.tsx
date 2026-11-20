/** The inline editors under a transcript line: its text, its speaker, and a minutes link. */
import { useEffect, useId, useState } from "react";
import { speakerName } from "../../../../shared/transcriptModel";
import { Select } from "../../../components/Select";
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
        <Select
          aria-label="Existing speaker label"
          size="sm"
          value={labels.includes(draft) ? draft : "new"}
          onChange={(value) => {
            // Re-picking "New label…" keeps the label being typed.
            if (value === "new" && !labels.includes(draft)) return;
            setDraft(value === "new" ? "" : value);
          }}
          options={[
            ...labels.map((value) => ({ value, label: `${speakerName(value, speakers)} (${value})` })),
            { value: "new", label: "New label…" },
          ]}
        />
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
  const selectId = useId();
  useEffect(() => document.getElementById(selectId)?.focus(), [selectId]);
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
        <Select
          id={selectId}
          size="sm"
          value={key}
          onChange={setKey}
          options={targets.map((candidate) => ({
            value: candidate.key,
            label: `${linkTargetMenuLabel(candidate)}${candidate.ref ? ` (now ${formatTranscriptTime(candidate.ref.startSec)})` : ""}`,
          }))}
        />
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
