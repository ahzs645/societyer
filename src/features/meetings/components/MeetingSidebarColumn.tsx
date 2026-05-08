import { FileDown, FileText, Printer } from "lucide-react";
import { EyeOff } from "lucide-react";
import { Badge, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline, LegalGuideTrackList } from "../../../components/LegalGuide";
import {
  MINUTES_EXPORT_STYLES,
  type MinutesExportStyleId,
} from "../../../lib/exportWord";
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
  exportPublicMinutes,
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
  exportPublicMinutes: () => void;
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
              <Detail label="Location">{meeting.location ?? "—"}</Detail>
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
                      <select
                        className="input"
                        value={minutesExportStyle}
                        onChange={(event) => setMinutesExportStyle(event.target.value as MinutesExportStyleId)}
                      >
                        {MINUTES_EXPORT_STYLES.map((style) => (
                          <option key={style.id} value={style.id}>
                            {style.label}
                          </option>
                        ))}
                      </select>
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
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <button className="btn-action btn-action--primary" onClick={exportToWord} disabled={!minutes}>
                        <FileDown size={12} /> Export Word
                      </button>
                      <button className="btn-action" onClick={exportToPdf} disabled={!minutes}>
                        <Printer size={12} /> Print / PDF
                      </button>
                      <button className="btn-action" onClick={exportPublicMinutes} disabled={!minutes}>
                        <EyeOff size={12} /> Public copy
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
            hasMinutes={!!minutes}
            setTranscriptEdit={setTranscriptEdit}
            setAudioFile={setAudioFile}
            onImportVtt={importTranscriptVtt}
            onSaveTranscript={saveTranscriptEditText}
            onUploadAudioAndRun={uploadAudioAndRun}
          />
          )}

          {meeting.type === "AGM" && show("agm") && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">AGM checklist</h2></div>
              <div className="card__body">
                <Check ok={!!meeting.noticeSentAt}>Notice sent 14–60 days in advance</Check>
                <Check ok={meeting.status === "Held"}>Meeting held</Check>
                <Check ok={!!minutes}>Minutes recorded</Check>
                <Check ok={!!minutes?.approvedAt}>Minutes approved at next meeting</Check>
                <Check ok={false}>Annual report filed within 30 days</Check>
              </div>
            </div>
          )}
        </div>
  );
}
