import { Play, X } from "lucide-react";
import type { AttachedSharePointRecording } from "./useAttachedSharePointRecording";
import { WAVEFORM_FILE_LIMIT } from "./waveform";

/** Decimal MB (KB under 1 MB), matching Meeting source files. */
export function formatRecordingSize(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function AttachedRecordingsPanel({
  id,
  attached,
}: {
  id: string;
  attached: AttachedSharePointRecording;
}) {
  const { recordings, listing, download, message, error, play, cancel } = attached;
  return (
    <div id={id} className="transcript-attached" role="region" aria-label="Attached recordings">
      <p className="transcript-muted">
        Recordings attached under Meeting source files. Playing one downloads it from private meeting storage
        into this browser; nothing is saved to the device.
      </p>
      {listing && !recordings && (
        <p className="transcript-muted" role="status">
          Loading attached recordings…
        </p>
      )}
      {error && (
        <p role="alert" className="transcript-error">
          {error}
        </p>
      )}
      {recordings && !recordings.length && (
        <p className="transcript-muted">
          No recordings are attached to this meeting yet. Attach one under Meeting source files on the
          Overview tab.
        </p>
      )}
      {recordings && recordings.length > 0 && (
        <ul className="transcript-attached__list">
          {recordings.map((source) => {
            const active = download?.id === source.id ? download : null;
            const percent = active ? Math.floor((100 * active.received) / active.total) : 0;
            return (
              <li key={source.id} className="transcript-attached__item">
                <div className="transcript-attached__meta">
                  <strong>{source.fileName}</strong>
                  <span className="transcript-muted">{formatRecordingSize(source.size)}</span>
                  {source.size > WAVEFORM_FILE_LIMIT && (
                    <span className="transcript-attached__warning">
                      Over 200 MB: playback holds the whole file in memory and the waveform is skipped.
                    </span>
                  )}
                </div>
                {active ? (
                  <div className="transcript-attached__progress">
                    <progress
                      max={active.total}
                      value={active.received}
                      aria-label={`Downloading ${source.fileName}`}
                    />
                    <span className="transcript-muted">
                      {percent}% · {formatRecordingSize(active.received)} of{" "}
                      {formatRecordingSize(active.total)}
                    </span>
                    <button type="button" className="btn-action" onClick={cancel}>
                      <X size={15} aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-action"
                    disabled={Boolean(download)}
                    aria-label={`Download and play ${source.fileName}, ${formatRecordingSize(source.size)}`}
                    onClick={() => void play(source)}
                  >
                    <Play size={15} aria-hidden="true" />
                    Download and play
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message && (
        <p role="status" className="transcript-muted">
          {message}
        </p>
      )}
    </div>
  );
}
