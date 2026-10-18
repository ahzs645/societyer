import { createPortal } from "react-dom";
import { memo, useEffect, useRef, useState } from "react";
import { Keyboard, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import type { TranscriptSegment } from "./timedTranscript";
import type { MediaClock } from "./useMediaClock";
import { ViewportPopover } from "../../../components/ViewportPopover";
import { Tooltip } from "../../../components/Tooltip";
import { useMediaQuery } from "../../../lib/useSheetDrag";
import { formatTranscriptTime } from "./activeIndex";
import { transcriptMarkers, truncateLabel, type MinutesLinkTarget } from "./transcriptLinks";
import type { InCameraMark } from "./useInCameraMarks";

const SpeakerLane = memo(function SpeakerLane({
  segments,
  labels,
  duration,
}: {
  segments: readonly TranscriptSegment[];
  labels: readonly string[];
  duration: number;
}) {
  return (
    <div className="transcript-speaker-lane" aria-hidden="true">
      {duration > 0 &&
        segments.map((segment, index) => (
          <span
            key={index}
            className={`transcript-color-${(labels.indexOf(segment.speaker) % 8) + 1}`}
            style={{
              left: `${(segment.startSec / duration) * 100}%`,
              width: `${(Math.max(0, segment.endSec - segment.startSec) / duration) * 100}%`,
            }}
          />
        ))}
    </div>
  );
});

/** Marked in-camera sessions as quiet hatched bands across the waveform and lane. */
const InCameraBands = memo(function InCameraBands({ marks, duration }: { marks: readonly InCameraMark[]; duration: number }) {
  if (!duration || !marks.length) return null;
  return (
    <>
      {marks.map((mark) => (
        <span
          key={mark.title}
          className="transcript-incamera-band"
          title={`In camera: ${mark.title}`}
          aria-hidden="true"
          style={{
            left: `${Math.min(100, (mark.startSec / duration) * 100)}%`,
            width: `${Math.max(0, (Math.min(mark.endSec, duration) - mark.startSec) / duration) * 100}%`,
          }}
        />
      ))}
    </>
  );
});

/** Linked motions and actions under the speaker lane; each seeks to its start. */
function MinutesMarkers({
  targets,
  duration,
  width,
  onSelect,
}: {
  targets: readonly MinutesLinkTarget[];
  duration: number;
  width: number;
  onSelect: (seconds: number) => void;
}) {
  // One row on touch screens, so the 40px hit areas of two rows never overlap.
  const coarse = useMediaQuery("(pointer: coarse)");
  const layout = transcriptMarkers({ targets, duration, width, maxRows: coarse ? 1 : 2 });
  if (!layout.markers.length) return null;
  return (
    <div
      className={`transcript-markers${layout.dots ? " is-dots" : ""}${layout.rows > 1 ? " has-two-rows" : ""}`}
      role="group"
      aria-label="Minutes items in the recording"
    >
      {layout.markers.map((marker) => {
        const time = formatTranscriptTime(marker.ref.startSec);
        const name = `${marker.label} at ${time}: ${truncateLabel(marker.summary, 80)}`;
        return (
          <Tooltip key={marker.key} content={name}>
            <button
              type="button"
              className={`transcript-marker is-${marker.kind === "motion" ? "motion" : "action"}${marker.row ? " is-second-row" : ""}`}
              style={{ left: marker.left }}
              aria-label={`${name}. Play from here`}
              onClick={() => onSelect(marker.ref.startSec)}
            >
              {!layout.dots && marker.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

type MediaPlayerBarProps = {
  clock: MediaClock;
  source: string;
  video: boolean;
  peaks: Float32Array | null;
  segments: readonly TranscriptSegment[];
  labels: readonly string[];
  transcriptDuration: number;
  /** Minutes items; the linked ones show as markers under the speaker lane. */
  markers: readonly MinutesLinkTarget[];
  onMarker: (seconds: number) => void;
  /** Marked in-camera sessions (decision A2), shown as bands on the scrubber. */
  inCameraMarks?: readonly InCameraMark[];
};

export function MediaPlayerBar({
  clock,
  source,
  video,
  peaks,
  segments,
  labels,
  transcriptDuration,
  markers,
  onMarker,
  inCameraMarks = [],
}: MediaPlayerBarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playedCanvas = useRef<HTMLCanvasElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const stuck = useStuck(player);
  const [width, setWidth] = useState(0);
  const [themeRevision, setThemeRevision] = useState(0);
  const duration = clock.duration || transcriptDuration;
  const fraction = duration ? Math.min(1, clock.currentTime / duration) : 0;
  useEffect(() => {
    const node = slider.current;
    if (!node) return;
    const resize = new ResizeObserver(() => setWidth(node.clientWidth));
    resize.observe(node);
    const themes = new MutationObserver(() => setThemeRevision((revision) => revision + 1));
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    themes.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => {
      resize.disconnect();
      themes.disconnect();
    };
  }, []);
  useEffect(() => {
    const base = canvas.current;
    const played = playedCanvas.current;
    if (!base || !played) return;
    const scale = window.devicePixelRatio || 1;
    const height = base.clientHeight;
    const style = getComputedStyle(base);
    const colors = [
      style.getPropertyValue("--text-tertiary").trim(),
      style.getPropertyValue("--accent").trim(),
    ];
    for (const [index, node] of [base, played].entries()) {
      node.width = Math.round(width * scale);
      node.height = Math.round(height * scale);
      const context = node.getContext("2d");
      if (!context || !peaks) continue;
      context.scale(scale, scale);
      context.fillStyle = colors[index];
      const bars = Math.floor(width / 3);
      for (let i = 0; i < bars; i++) {
        const barHeight = Math.max(2, peaks[Math.floor((i / bars) * peaks.length)] * (height - 6));
        context.beginPath();
        context.roundRect(i * 3, (height - barHeight) / 2, 2, barHeight, 1);
        context.fill();
      }
    }
  }, [peaks, width, themeRevision]);
  const seekAt = (clientX: number) => {
    const bounds = slider.current?.getBoundingClientRect();
    if (source && bounds?.width)
      clock.seek(Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * duration);
  };
  return (
    <div ref={player} className={`transcript-player card${stuck ? " is-stuck" : ""}`}>
      {source &&
        (video ? (
          <details className="transcript-video" open>
            <summary>Recording preview</summary>
            <video key={source} ref={clock.mediaRef} src={source} playsInline preload="metadata" />
          </details>
        ) : (
          <audio key={source} ref={clock.mediaRef} src={source} preload="metadata" hidden />
        ))}
      <PlaybackControls clock={clock} source={source} duration={duration} />
      <div
        ref={slider}
        className="transcript-scrubber"
        role="slider"
        tabIndex={source ? 0 : -1}
        aria-label="Recording position"
        aria-disabled={!source}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.min(clock.currentTime, duration)}
        aria-valuetext={`${formatTranscriptTime(clock.currentTime)} of ${formatTranscriptTime(duration)}${inCameraMarks.some((mark) => clock.currentTime >= mark.startSec && clock.currentTime < mark.endSec) ? ", in camera" : ""}`}
        onPointerDown={(event) => {
          if (!source) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          seekAt(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          const delta: Record<string, number> = {
            ArrowLeft: -5,
            ArrowDown: -5,
            ArrowRight: 5,
            ArrowUp: 5,
            PageUp: 30,
            PageDown: -30,
          };
          if (event.key in delta) {
            event.preventDefault();
            event.stopPropagation();
            clock.skip(delta[event.key]);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            clock.seek(event.key === "Home" ? 0 : duration);
          }
        }}
      >
        <div className="transcript-waveform">
          <canvas ref={canvas} aria-hidden="true" />
          <canvas
            ref={playedCanvas}
            className="transcript-waveform__played"
            style={{ clipPath: `inset(0 ${(1 - fraction) * 100}% 0 0)` }}
            aria-hidden="true"
          />
        </div>
        <SpeakerLane segments={segments} labels={labels} duration={duration} />
        <InCameraBands marks={inCameraMarks} duration={duration} />
        <span className="transcript-playhead" style={{ left: `${fraction * 100}%` }} aria-hidden="true" />
      </div>
      <MinutesMarkers targets={markers} duration={duration} width={width} onSelect={onMarker} />
      {clock.error && (
        <p role="alert" className="transcript-error">
          {clock.error}
        </p>
      )}
    </div>
  );
}

function PlaybackControls({
  clock,
  source,
  duration,
}: {
  clock: MediaClock;
  source: string;
  duration: number;
}) {
  const [rate, setRate] = useState(1);
  useEffect(() => {
    setRate(1);
  }, [source]);
  const shortcuts = useRef<HTMLButtonElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  return (
    <div className="transcript-player__controls">
      <button
        type="button"
        className="transcript-play"
        onClick={clock.toggle}
        disabled={!source}
        aria-label={clock.playing ? "Pause" : "Play"}
      >
        {clock.playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <span className="transcript-time transcript-player__time">
        <strong>{formatTranscriptTime(clock.currentTime)}</strong> / {formatTranscriptTime(duration)}
      </span>
      <div className="transcript-player__skip">
        <button
          type="button"
          className="btn-action transcript-icon"
          onClick={() => clock.skip(-10)}
          disabled={!source}
          aria-label="Back 10 seconds"
        >
          <RotateCcw size={18} />
        </button>
        <button
          type="button"
          className="btn-action transcript-icon"
          onClick={() => clock.skip(10)}
          disabled={!source}
          aria-label="Forward 10 seconds"
        >
          <RotateCw size={18} />
        </button>
      </div>
      <select
        className="transcript-rate"
        aria-label="Playback speed"
        value={rate}
        disabled={!source}
        onChange={(event) => {
          const next = Number(event.target.value);
          setRate(next);
          clock.setRate(next);
        }}
      >
        {[0.75, 1, 1.25, 1.5, 2].map((value) => (
          <option key={value} value={value}>
            {value}×
          </option>
        ))}
      </select>
      <button
        ref={shortcuts}
        type="button"
        className="btn-action transcript-shortcuts-trigger"
        aria-expanded={showShortcuts}
        aria-haspopup="dialog"
        onClick={() => setShowShortcuts((value) => !value)}
      >
        <Keyboard size={16} />
        Shortcuts
      </button>
      {createPortal(
        <ViewportPopover
          open={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          anchorRef={shortcuts}
          label="Transcript keyboard shortcuts"
          className="transcript-shortcuts"
        >
          <strong>Keyboard shortcuts</strong>
          <p>
            Focus inside this workspace: Space or K play/pause · J/L back/forward 10s · ←/→ back/forward 5s.
          </p>
          <p>
            On the scrubber: Page Up/Down ±30s · Home/End start/end. Search: Enter/Shift+Enter next/previous
            match.
          </p>
        </ViewportPopover>,
        document.body,
      )}
    </div>
  );
}

/** True while a sticky element is pinned to the top of its scroll container. */
function useStuck(target: React.RefObject<HTMLElement>) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const node = target.current;
    let scroller = node?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement;
    if (!node || !scroller) return;
    const container = scroller;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrollportTop = container.getBoundingClientRect().top + container.clientTop;
      const pinnedAt = scrollportTop + parseFloat(getComputedStyle(container).paddingTop);
      const top = node.getBoundingClientRect().top;
      const isStuck = top <= pinnedAt + 1 && container.scrollTop > 0;
      // The mask covers the strip between the scrollport's top edge and the pinned
      // player (the container's top padding, whatever the breakpoint sets it to).
      const mask = Math.max(0, Math.ceil(top - scrollportTop));
      if (isStuck) node.style.setProperty("--transcript-player-mask", `${mask}px`);
      setStuck(isStuck);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [target]);
  return stuck;
}
