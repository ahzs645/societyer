import { createPortal } from "react-dom";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ListChecks } from "lucide-react";
import { speakerName } from "../../../../shared/transcriptModel";
import { Drawer } from "../../../components/ui";
import type { TranscriptSegment, TranscriptSpeaker } from "./timedTranscript";
import { formatTranscriptTime } from "./activeIndex";
import { isUnnamedSpeaker } from "./transcriptLinks";
import { SpeakerActions } from "./SpeakerActions";
import { SpeakerRow } from "./SpeakerRow";
import { MergedLabels, SpeakerAssignment, SpeakerCombine } from "./SpeakerControls";
import { speakerStats, type SpeakerStat } from "./speakerSuggestions";
import { speakerPalette } from "./speakerTurns";

export type Attendee = {
  name: string;
  personId?: string;
  roleTitle?: string;
  status?: string;
  /** Where the candidate came from ("Attended", "Committee"…); labels long lists. */
  group?: string;
};
export type AssignSpeaker = (label: string, name?: string, personId?: string) => Promise<void>;
/** Combine one or more raw labels into a displayed speaker (undoable). */
export type MergeSpeakers = (from: readonly string[], to: string) => Promise<void>;
export type UnmergeSpeaker = (label: string) => Promise<void>;

export const SpeakerPanel = memo(function SpeakerPanel({
  segments,
  speakers,
  labels,
  attendees,
  canWrite,
  hasMedia,
  onAssign,
  onMerge,
  onUnmerge,
  onReview,
  onJump,
  onPlaySample,
  focusRequest,
}: {
  /** Raw segments: their labels are resolved here so combined labels can nest. */
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  labels: readonly string[];
  attendees: readonly Attendee[];
  canWrite: boolean;
  hasMedia: boolean;
  onAssign: AssignSpeaker;
  onMerge: MergeSpeakers;
  onUnmerge: UnmergeSpeaker;
  /** Opens the Review speakers step (meeting editors). */
  onReview?: () => void;
  onJump: (index: number) => void;
  onPlaySample: (index: number) => void;
  focusRequest: { label: string; revision: number };
}) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const panel = useSpeakerFocus(focusRequest, setOpenLabel, setShowMerge);
  const openMerge = (label: string) => {
    setOpenLabel(label);
    setShowMerge(true);
  };
  const {
    resolved: stats,
    raw: rawStats,
    mergedUnder,
  } = useMemo(() => speakerStats(segments, speakers), [segments, speakers]);
  const palette = useMemo(() => speakerPalette(segments), [segments]);
  const total = [...stats.values()].reduce((sum, row) => sum + row.time, 0);
  const toName = labels.filter((label) => isUnnamedSpeaker(label, speakerName(label, speakers))).length;
  const active = openLabel ? stats.get(openLabel) : undefined;
  const close = () => setOpenLabel(null);
  return (
    <>
      <SpeakerChips
        labels={labels}
        speakers={speakers}
        onOpen={(label) => {
          setOpenLabel(label);
          setShowMerge(false);
        }}
        onReview={onReview}
        palette={palette}
      />
      <aside ref={panel} className="transcript-speakers card" aria-label="Speakers">
        <div className="transcript-speakers__head">
          <h3>
            Speakers{" "}
            <span className="transcript-muted">
              {labels.length} · {toName} to name
            </span>
          </h3>
          {onReview && (
            <button type="button" className="btn-action" aria-haspopup="dialog" onClick={onReview}>
              <ListChecks size={15} aria-hidden="true" />
              Review speakers
            </button>
          )}
        </div>
        {labels.map((label) => {
          const row = stats.get(label);
          return row ? (
            <SpeakerRow
              key={label}
              label={label}
              index={palette.indexOf(label)}
              row={row}
              segments={segments}
              speakers={speakers}
              labels={labels}
              attendees={attendees}
              total={total}
              canWrite={canWrite}
              hasMedia={hasMedia}
              onAssign={onAssign}
              onJump={onJump}
              onPlaySample={onPlaySample}
              onOpenMerge={openMerge}
              merged={mergedUnder.get(label) ?? []}
              rawStats={rawStats}
              onUnmerge={onUnmerge}
            />
          ) : null;
        })}
      </aside>
      {createPortal(
        <Drawer
          open={Boolean(openLabel && active)}
          onClose={close}
          title={openLabel ? `Who is ${speakerName(openLabel, speakers)}?` : "Speaker"}
          className="transcript-speaker-drawer"
        >
          {openLabel && active && (
            <SpeakerSheetBody
              label={openLabel}
              active={active}
              total={total}
              segments={segments}
              speakers={speakers}
              labels={labels}
              attendees={attendees}
              canWrite={canWrite}
              hasMedia={hasMedia}
              showMerge={showMerge}
              setShowMerge={setShowMerge}
              stats={stats}
              rawStats={rawStats}
              merged={mergedUnder.get(openLabel) ?? []}
              palette={palette}
              onClose={close}
              onAssign={onAssign}
              onMerge={onMerge}
              onUnmerge={onUnmerge}
              onJump={onJump}
              onPlaySample={onPlaySample}
              onOpenMerge={openMerge}
            />
          )}
        </Drawer>,
        document.body,
      )}
    </>
  );
});

/** The speaker sheet: sample, assignment, combined labels and Combine speakers. */
function SpeakerSheetBody({
  label,
  active,
  total,
  segments,
  speakers,
  labels,
  attendees,
  canWrite,
  hasMedia,
  showMerge,
  setShowMerge,
  stats,
  rawStats,
  merged,
  palette,
  onClose,
  onAssign,
  onMerge,
  onUnmerge,
  onJump,
  onPlaySample,
  onOpenMerge: openMerge,
}: {
  label: string;
  active: SpeakerStat;
  total: number;
  segments: readonly TranscriptSegment[];
  speakers: readonly TranscriptSpeaker[];
  labels: readonly string[];
  attendees: readonly Attendee[];
  canWrite: boolean;
  hasMedia: boolean;
  showMerge: boolean;
  setShowMerge: (update: (value: boolean) => boolean) => void;
  stats: ReadonlyMap<string, SpeakerStat>;
  rawStats: ReadonlyMap<string, SpeakerStat>;
  merged: readonly string[];
  palette: readonly string[];
  onClose: () => void;
  onAssign: AssignSpeaker;
  onMerge: MergeSpeakers;
  onUnmerge: UnmergeSpeaker;
  onJump: (index: number) => void;
  onPlaySample: (index: number) => void;
  onOpenMerge: (label: string) => void;
}) {
  return (
    <>
      <p className="transcript-speaker__quote">“{segments[active.sample ?? active.first].text}”</p>
      <div className="transcript-sample">
        <button
          type="button"
          className="btn-action"
          disabled={!hasMedia}
          onClick={() => onPlaySample(active.sample ?? active.first)}
        >
          Play sample
        </button>
        <span className="transcript-muted">
          {formatTranscriptTime(active.time)} · {total ? Math.round((active.time / total) * 100) : 0}%
        </span>
        <SpeakerActions
          label={label}
          speakers={speakers}
          first={active.first}
          sample={active.sample ?? active.first}
          canMerge={labels.length > 1}
          canWrite={canWrite}
          hasMedia={hasMedia}
          onAssign={onAssign}
          onJump={onJump}
          onPlaySample={onPlaySample}
          onOpenMerge={openMerge}
        />
      </div>
      <MergedLabels
        name={speakerName(label, speakers)}
        labels={merged}
        stats={rawStats}
        canWrite={canWrite}
        onUnmerge={onUnmerge}
      />
      {canWrite && (
        <>
          <SpeakerAssignment
            key={label}
            label={label}
            speakers={speakers}
            attendees={attendees}
            onAssign={onAssign}
            onAssigned={onClose}
            expanded
          />
          <button
            type="button"
            className="btn-action"
            aria-expanded={showMerge}
            onClick={() => setShowMerge((value) => !value)}
          >
            Combine speakers…
          </button>
          {showMerge && (
            <SpeakerCombine
              label={label}
              labels={labels}
              speakers={speakers}
              stats={stats}
              palette={palette}
              onMerge={onMerge}
            />
          )}
        </>
      )}
    </>
  );
}

function SpeakerChips({
  labels,
  speakers,
  onOpen,
  onReview,
  palette,
}: {
  labels: readonly string[];
  speakers: readonly TranscriptSpeaker[];
  onOpen: (label: string) => void;
  onReview?: () => void;
  palette: readonly string[];
}) {
  return (
    <div className="transcript-speaker-chips" aria-label="Speakers">
      {labels.map((label) => {
        const name = speakerName(label, speakers);
        const unnamed = isUnnamedSpeaker(label, name);
        return (
          <button
            type="button"
            className={`transcript-chip transcript-color-${(Math.max(0, palette.indexOf(label)) % 8) + 1}${unnamed ? " is-unnamed" : ""}`}
            key={label}
            aria-label={`Speaker controls for ${name}`}
            aria-haspopup="dialog"
            onClick={() => {
              onOpen(label);
            }}
          >
            <span className="transcript-swatch" />
            <span>{unnamed ? `${label} · name` : name.split(/\s+/)[0]}</span>
          </button>
        );
      })}
      {onReview && (
        <button
          type="button"
          className="transcript-chip transcript-chip--review"
          aria-haspopup="dialog"
          onClick={onReview}
        >
          <ListChecks size={14} aria-hidden="true" />
          <span>Review speakers</span>
        </button>
      )}
    </div>
  );
}

function useSpeakerFocus(
  request: { label: string; revision: number },
  openSpeaker: (label: string) => void,
  resetMerge: (value: boolean) => void,
) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!request.revision) return;
    if (!panel.current?.getClientRects().length) {
      openSpeaker(request.label);
      resetMerge(false);
      return;
    }
    const row = [...panel.current.querySelectorAll<HTMLElement>("[data-speaker-row]")].find(
      (node) => node.dataset.speakerRow === request.label,
    );
    row?.scrollIntoView({
      block: "nearest",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    row?.querySelector<HTMLSelectElement>(".transcript-assignment select")?.focus({ preventScroll: true });
  }, [request, openSpeaker, resetMerge]);
  return panel;
}
