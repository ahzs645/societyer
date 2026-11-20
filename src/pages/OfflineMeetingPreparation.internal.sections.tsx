import type { FormEvent } from "react";
import { Badge, Banner, EmptyState, Field } from "../components/ui";
import type { Snapshot } from "../../shared/offline/meetingProtocol";

/** A meeting prepared on this device, as the page reads it from local storage. */
export type DraftRow = { id: string; body: string; revision: number; discussion: string; approved: boolean };
export type CachedFile = { id: string; meeting_uuid: string; descriptor: string; content: string; state: string; origin: string };
export type SnapshotFile = Snapshot["files"][number];
/** Minutes typed here but not yet saved, with the revision they started from. */
export type MinutesDraft = { text: string; baseRevision: number };

function fileName(file: CachedFile): string {
  return JSON.parse(file.descriptor).name;
}

/** The new-meeting form: saved on this device and synced when connected. */
export function PrepareMeetingCard({ formKey, locked, canAttach, onSubmit }: {
  formKey: string | undefined;
  locked: boolean;
  canAttach: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="card" aria-labelledby="offline-meeting-prepare-title">
      <div className="card__head">
        <h2 className="card__title" id="offline-meeting-prepare-title">Prepare a meeting</h2>
      </div>
      <form key={formKey} className="card__body offline-meeting-form" onSubmit={onSubmit}>
        <fieldset disabled={locked}>
          <Field label="Meeting title">
            <input className="input" name="title" required maxLength={200} />
          </Field>
          <Field label="Date and time">
            <input className="input" name="scheduledAt" type="datetime-local" required />
          </Field>
          <Field label="Agenda item">
            <input className="input" name="agenda" required maxLength={200} />
          </Field>
          <Field label="Preparation notes">
            <textarea className="input" name="notes" maxLength={20000} rows={3} />
          </Field>
          {canAttach && (
            <Field label="Attachment (up to 1 MB)">
              <input name="attachment" type="file" />
            </Field>
          )}
          <div>
            <button className="btn btn--accent" type="submit" disabled={locked}>Save on this device</button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

/** One prepared meeting: its sync state, its minutes and its attachment. */
export function PreparedMeetingItem({
  row,
  needsReview,
  waiting,
  attachment,
  draft,
  editable,
  locked,
  attachmentLocked,
  onDraftChange,
  onUseSynced,
  onSaveMinutes,
  onSendAttachment,
}: {
  row: DraftRow;
  needsReview: boolean;
  waiting: boolean;
  /** The attachment authored with this meeting on this device. */
  attachment: CachedFile | undefined;
  draft: MinutesDraft | undefined;
  editable: boolean;
  locked: boolean;
  attachmentLocked: boolean;
  onDraftChange: (text: string) => void;
  onUseSynced: () => void;
  onSaveMinutes: (event: FormEvent<HTMLFormElement>) => void;
  onSendAttachment: () => void;
}) {
  const meeting = JSON.parse(row.body) as { title?: string; notes?: string };
  return (
    <li className="offline-meeting-item">
      <div className="offline-meeting-item__head">
        <h3 className="offline-meeting-item__title">{meeting.title}</h3>
        {needsReview
          ? <Badge tone="warn">Needs review</Badge>
          : waiting
            ? <Badge tone="info">Waiting to sync</Badge>
            : <Badge tone="success">Synced preparation</Badge>}
      </div>
      {meeting.notes && <p className="muted">{meeting.notes}</p>}
      {needsReview && <p className="muted">Export recovery to reconcile these edits.</p>}
      {editable ? (
        <form className="offline-meeting-item__form" onSubmit={onSaveMinutes}>
          <Field label="Minutes discussion">
            <textarea
              className="input"
              disabled={locked}
              rows={3}
              maxLength={20000}
              value={draft?.text ?? row.discussion}
              onChange={(event) => onDraftChange(event.target.value)}
            />
          </Field>
          {draft && draft.baseRevision !== row.revision && (
            <Banner tone="warn" title="Newer minutes are available">
              Export recovery to keep your draft, then{" "}
              <button className="btn btn--sm" type="button" onClick={onUseSynced}>Use synced minutes</button>
            </Banner>
          )}
          <div>
            <button className="btn" type="submit" disabled={locked}>Save minutes on this device</button>
          </div>
        </form>
      ) : (
        row.discussion && <p className="offline-meeting-item__minutes">{row.discussion}</p>
      )}
      {attachment && (
        <div className="offline-meeting-item__attachment">
          <span>{fileName(attachment)}</span>
          {attachment.state === "available"
            ? <Badge tone="success">Attachment sent</Badge>
            : <Badge tone="info">Attachment waiting to send</Badge>}
          <button className="btn btn--sm" type="button" disabled={attachmentLocked} onClick={onSendAttachment}>
            Send attachment
          </button>
        </div>
      )}
    </li>
  );
}

/** Attachments already saved on this device, downloadable offline. */
export function SavedAttachmentsCard({ files, locked, onDownload }: {
  files: CachedFile[];
  locked: boolean;
  onDownload: (file: CachedFile) => void;
}) {
  return (
    <section className="card" aria-labelledby="offline-meeting-saved-title">
      <div className="card__head">
        <h2 className="card__title" id="offline-meeting-saved-title">Attachments on this device</h2>
        <Badge>{files.length}</Badge>
      </div>
      <ul className="offline-meeting-list">
        {files.map((file) => (
          <li key={file.id} className="offline-meeting-file">
            <button className="btn btn--sm" type="button" disabled={locked} onClick={() => onDownload(file)}>
              Download saved {fileName(file)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Attachments on the synced meetings, which can be verified and saved on this device. */
export function AvailableAttachmentsCard({ files, isReplicated, locked, onSave }: {
  files: { snapshot: Snapshot; file: SnapshotFile }[];
  isReplicated: (file: SnapshotFile) => boolean;
  locked: boolean;
  onSave: (snapshot: Snapshot, file: SnapshotFile) => void;
}) {
  return (
    <section className="card" aria-labelledby="offline-meeting-available-title">
      <div className="card__head">
        <h2 className="card__title" id="offline-meeting-available-title">Available attachments</h2>
        <Badge>{files.length}</Badge>
      </div>
      {files.length ? (
        <ul className="offline-meeting-list">
          {files.map(({ snapshot, file }) => {
            const replicated = isReplicated(file);
            return (
              <li key={file.uuid} className="offline-meeting-file">
                <div className="offline-meeting-file__name">
                  <span>{file.name}</span>
                  {!replicated && <span className="muted">Waiting for attachment access to sync.</span>}
                </div>
                <button className="btn btn--sm" type="button" disabled={locked || !replicated} onClick={() => onSave(snapshot, file)}>
                  Save attachment on this device
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="card__body">
          <EmptyState size="sm" title="No attachments available" description="Attachments on the meetings you prepare appear here once they sync." />
        </div>
      )}
    </section>
  );
}
