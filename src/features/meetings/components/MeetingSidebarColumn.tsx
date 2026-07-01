import { Link } from "react-router-dom";
import { Eye, EyeOff, FileDown, FileText, Printer } from "lucide-react";
import { Badge, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline, LegalGuideTrackList } from "../../../components/LegalGuide";
import {
  MINUTES_EXPORT_STYLES,
  type MinutesExportStyleId,
} from "../lib/minutesExportStyles";
import { formatDate, formatDateTime } from "../../../lib/format";
import { resolveJurisdictionCode } from "../../../lib/jurisdictionGuideTracks";
import {
  Check,
  Detail,
  SourceDocumentRow,
  gapStatusLabel,
  gapStatusTone,
  sourceLabelForExternalId,
} from "./MeetingDetailSupport";
import { MeetingTranscriptCard } from "./MeetingTranscriptCard";
import { hasStartedMinutesDraft } from "../lib/meetingDetailHelpers";

export function MeetingSidebarColumn({
  meeting,
  minutes,
  society,
  visiblePanels = ["details", "export", "quorum", "sources", "transcript", "agm"],
  selectedMinutesExportStyle,
  minutesExportStyle,
  setMinutesExportStyle,
  includeTranscriptInExport,
  setIncludeTranscriptInExport,
  includeActionItemsInExport,
  setIncludeActionItemsInExport,
  includeDiscussionSummaryInExport,
  setIncludeDiscussionSummaryInExport,
  includeApprovalInExport,
  setIncludeApprovalInExport,
  includeSignaturesInExport,
  setIncludeSignaturesInExport,
  includePlaceholdersInExport,
  setIncludePlaceholdersInExport,
  exportToWord,
  exportToPdf,
  printMinutes,
  publicCopyMode,
  setPublicCopyMode,
  minutesExportGaps,
  showExportGaps = false,
  exportControlsReadOnly = false,
  quorumSnapshot,
  quorumLegalGuides,
  legalGuideDateISO,
  linkedSourceCount,
  sourceDocuments,
  minutesSourceExternalIds,
  vttInputRef,
  audioInputRef,
  transcriptOnFile,
  transcriptProvider,
  transcriptionJob,
  transcriptStatusTone,
  transcriptEdit,
  savingTranscript,
  pipelineBusy,
  audioFile,
  importNote,
  setTranscriptEdit,
  setAudioFile,
  importTranscriptVtt,
  saveTranscriptEditText,
  uploadAudioAndRun,
  draftFromTranscript,
  draftingFromTranscript = false,
}: {
  meeting: any;
  minutes: any;
  society: any;
  visiblePanels?: Array<"details" | "export" | "quorum" | "sources" | "transcript" | "agm">;
  selectedMinutesExportStyle: any;
  minutesExportStyle: MinutesExportStyleId;
  setMinutesExportStyle: (value: MinutesExportStyleId) => void;
  includeTranscriptInExport: boolean;
  setIncludeTranscriptInExport: (value: boolean) => void;
  includeActionItemsInExport: boolean;
  setIncludeActionItemsInExport: (value: boolean) => void;
  includeDiscussionSummaryInExport: boolean;
  setIncludeDiscussionSummaryInExport: (value: boolean) => void;
  includeApprovalInExport: boolean;
  setIncludeApprovalInExport: (value: boolean) => void;
  includeSignaturesInExport: boolean;
  setIncludeSignaturesInExport: (value: boolean) => void;
  includePlaceholdersInExport: boolean;
  setIncludePlaceholdersInExport: (value: boolean) => void;
  exportToWord: () => void;
  exportToPdf: () => void;
  printMinutes: () => void;
  publicCopyMode: boolean;
  setPublicCopyMode: (value: boolean) => void;
  minutesExportGaps: any[];
  showExportGaps?: boolean;
  /**
   * When true, disables every export control except the style picker. Used on
   * the overview tab so the panel reads as a checklist of what the report
   * would include without doubling as an export-action surface — that lives
   * on the dedicated Export tab.
   */
  exportControlsReadOnly?: boolean;
  quorumSnapshot: any;
  quorumLegalGuides: any[];
  legalGuideDateISO: string;
  linkedSourceCount: number;
  sourceDocuments: any[] | undefined;
  minutesSourceExternalIds: string[];
  vttInputRef: any;
  audioInputRef: any;
  transcriptOnFile: string;
  transcriptProvider: string | null;
  transcriptionJob: any;
  transcriptStatusTone: "success" | "danger" | "warn";
  transcriptEdit: string | null;
  savingTranscript: boolean;
  pipelineBusy: boolean;
  audioFile: File | null;
  importNote: string | null;
  setTranscriptEdit: (value: string | null) => void;
  setAudioFile: (value: File | null) => void;
  importTranscriptVtt: (file: File) => Promise<void>;
  saveTranscriptEditText: () => Promise<void>;
  uploadAudioAndRun: (draftMinutes: boolean) => Promise<void> | void;
  /** Optional — passing it enables the "Draft from transcript" button. */
  draftFromTranscript?: () => Promise<void> | void;
  draftingFromTranscript?: boolean;
}) {
  const show = (panel: NonNullable<typeof visiblePanels>[number]) => visiblePanels.includes(panel);
  return (
        <div className="col" style={{ gap: 16 }}>
          {show("details") && (
          <div className="card">
            <div className="card__head"><h2 className="card__title">Meeting details</h2></div>
            <div className="card__body col">
              <Detail label="Type"><Badge tone={meeting.type === "AGM" ? "accent" : "info"}>{meeting.type}</Badge></Detail>
              <Detail label="Scheduled">{formatDateTime(meeting.scheduledAt)}</Detail>
              <Detail label="Location">
                <span className="meeting-detail-location-value">{meeting.location ?? "—"}</span>
              </Detail>
              <Detail label="Electronic">{meeting.electronic ? "Yes" : "No"}</Detail>
              <Detail label="Notice sent">{meeting.noticeSentAt ?? "—"}</Detail>
              <Detail label="Quorum required">{quorumSnapshot.required ?? meeting.quorumRequired ?? "—"}</Detail>
              <Detail label="Quorum rule">{quorumSnapshot.label || meeting.quorumSourceLabel || "—"}</Detail>
              <Detail label="Legal guide">
                <LegalGuideInline rules={quorumLegalGuides} />
              </Detail>
            </div>
          </div>
          )}

          {show("export") && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">
                  {exportControlsReadOnly ? "Export readiness" : "Minutes export"}
                </h2>
                <span className="card__subtitle">{selectedMinutesExportStyle.source}</span>
              </div>
              <div className="card__body col" style={{ gap: 12 }}>
                {!exportControlsReadOnly && (
                  <>
                    <Field label="Style">
                      <Select
                        value={minutesExportStyle}
                        onChange={(value) => setMinutesExportStyle(value as MinutesExportStyleId)}
                        options={MINUTES_EXPORT_STYLES.map((style) => ({
                          value: style.id,
                          label: style.label,
                        }))}
                      />
                    </Field>
                    <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
                      {selectedMinutesExportStyle.tone}
                    </p>
                    <div className="col" style={{ gap: 6 }}>
                      <Checkbox
                        checked={includeActionItemsInExport}
                        onChange={setIncludeActionItemsInExport}
                        label="Include action items"
                      />
                      <Checkbox
                        checked={includeDiscussionSummaryInExport}
                        onChange={setIncludeDiscussionSummaryInExport}
                        label="Include discussion summary"
                      />
                      <Checkbox
                        checked={includeApprovalInExport}
                        onChange={setIncludeApprovalInExport}
                        label="Include approval block"
                      />
                      <Checkbox
                        checked={includeSignaturesInExport}
                        onChange={setIncludeSignaturesInExport}
                        label="Include signature lines"
                      />
                      <Checkbox
                        checked={includePlaceholdersInExport}
                        onChange={setIncludePlaceholdersInExport}
                        label="Show not-recorded placeholders"
                      />
                      <Checkbox
                        checked={includeTranscriptInExport}
                        onChange={setIncludeTranscriptInExport}
                        label="Include transcript"
                      />
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={publicCopyMode}
                      disabled={!minutes}
                      className={`public-copy-toggle${publicCopyMode ? " is-private" : " is-public"}`}
                      onClick={() => setPublicCopyMode(!publicCopyMode)}
                      title={publicCopyMode
                        ? "Word and PDF exports will redact PII and strip sections flagged hidden. Click to switch back to the full minutes."
                        : "Word and PDF exports include the full minutes. Click to switch to the redacted Public copy."}
                    >
                      <span className="public-copy-toggle__icon" aria-hidden>
                        <Eye size={14} className="public-copy-toggle__eye is-on" />
                        <EyeOff size={14} className="public-copy-toggle__eye is-off" />
                      </span>
                      <span className="public-copy-toggle__text">
                        {publicCopyMode ? "Exporting Public copy" : "Exporting full minutes"}
                      </span>
                    </button>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <button className="btn-action btn-action--primary" onClick={exportToWord} disabled={!minutes}>
                        <FileDown size={12} /> Export Word
                      </button>
                      <button className="btn-action" onClick={exportToPdf} disabled={!minutes}>
                        <FileDown size={12} /> Download PDF
                      </button>
                      <button className="btn-action" onClick={printMinutes} disabled={!minutes}>
                        <Printer size={12} /> Print
                      </button>
                    </div>
                  </>
                )}
                {showExportGaps && (
                  <div className="minutes-export-gaps">
                    {minutesExportGaps.map((gap) => (
                      <div key={`${gap.status}-${gap.label}`} className="minutes-export-gap">
                        <div className="row" style={{ gap: 6, justifyContent: "space-between", alignItems: "flex-start" }}>
                          <strong>{gap.label}</strong>
                          <Badge tone={gapStatusTone(gap.status)}>{gapStatusLabel(gap.status)}</Badge>
                        </div>
                        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{gap.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {quorumLegalGuides.length > 0 && show("quorum") && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Quorum guide tracks</h2>
                <span className="card__subtitle">{formatDate(legalGuideDateISO)}</span>
              </div>
              <div className="card__body">
                <LegalGuideTrackList
                  rules={quorumLegalGuides}
                  jurisdictionCode={resolveJurisdictionCode(society)}
                  dateISO={legalGuideDateISO}
                />
              </div>
            </div>
          )}

          {minutes && show("sources") && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Source documents</h2>
                <span className="card__subtitle">
                  {linkedSourceCount ? `${linkedSourceCount} linked` : "None linked"}
                </span>
              </div>
              <div className="card__body source-document-list">
                {(sourceDocuments ?? []).map((document: any) => (
                  <SourceDocumentRow
                    key={document._id}
                    document={document}
                    societyId={meeting.societyId}
                  />
                ))}
                {(sourceDocuments ?? []).length === 0 && minutesSourceExternalIds.map((externalId) => (
                  <div key={externalId} className="source-document source-document--placeholder">
                    <FileText className="source-document__icon" size={14} />
                    <div className="source-document__main">
                      <div className="source-document__title">{sourceLabelForExternalId(externalId)}</div>
                      <div className="source-document__meta">
                        <Badge tone={externalId.startsWith("paperless:") ? "info" : "neutral"}>Source reference</Badge>
                        <Badge tone="warn">No local copy</Badge>
                      </div>
                    </div>
                  </div>
                ))}
                {(sourceDocuments ?? []).length === 0 && minutesSourceExternalIds.length === 0 && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    Link source documents by importing or backfilling the meeting-minute source records.
                  </div>
                )}
              </div>
            </div>
          )}

          {show("transcript") && (
          <MeetingTranscriptCard
            vttInputRef={vttInputRef}
            audioInputRef={audioInputRef}
            transcriptOnFile={transcriptOnFile}
            transcriptProvider={transcriptProvider}
            transcriptionJob={transcriptionJob}
            transcriptStatusTone={transcriptStatusTone}
            transcriptEdit={transcriptEdit}
            savingTranscript={savingTranscript}
            pipelineBusy={pipelineBusy}
            audioFile={audioFile}
            importNote={importNote}
            hasMinutes={hasStartedMinutesDraft(minutes)}
            draftingFromTranscript={draftingFromTranscript}
            setTranscriptEdit={setTranscriptEdit}
            setAudioFile={setAudioFile}
            onImportVtt={importTranscriptVtt}
            onSaveTranscript={saveTranscriptEditText}
            onUploadAudioAndRun={uploadAudioAndRun}
            onDraftFromTranscript={draftFromTranscript}
          />
          )}

          {meeting.type === "AGM" && show("agm") && (
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">AGM checklist</h2>
                <Link className="card__subtitle" to={`/app/meetings/${meeting._id}/agm`}>
                  Open AGM workflow
                </Link>
              </div>
              <div className="card__body">
                {/*
                  This is a quick, at-a-glance summary only — it reads a few raw
                  meeting/minutes fields, not the AGM run's step state. The AGM
                  workflow page (linked above) tracks step-by-step completion and
                  is the authoritative source; always defer to it over this card
                  when the two disagree.
                */}
                <Check ok={!!meeting.noticeSentAt}>Notice sent 14–60 days in advance</Check>
                <Check ok={meeting.status === "Held"}>Meeting held</Check>
                <Check ok={!!minutes}>Minutes recorded</Check>
                <Check ok={!!minutes?.approvedAt}>Minutes approved at next meeting</Check>
                <Check ok={false}>Annual report filed within 30 days</Check>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
                  See the <Link to={`/app/meetings/${meeting._id}/agm`}>AGM workflow</Link> for the authoritative,
                  step-by-step status of this meeting.
                </div>
              </div>
            </div>
          )}
        </div>
  );
}
