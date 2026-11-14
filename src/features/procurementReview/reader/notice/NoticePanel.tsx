/**
 * A notice opens in the app's record side panel, as a meeting or a task does
 * from its list: the same shell (RecordPanelShell, in the inspector column,
 * resizable, a page sheet on phones that pulls down to close), the same
 * header with Minimise (to the shared dock chip), Full screen and Close, and a
 * footer with the main actions. The list stays beside it with the notice's
 * row marked.
 *
 * The header names the kind and where the notice sits in the list, with ↑
 * and ↓ to step through it (J and K too). The footer has Classify, where
 * there is a triage, "Open page", which shows the notice full screen in its
 * full-page layout (Exit full screen returns to the panel), and the buyer's
 * site (or BC Bid) as the primary action. Esc, × and pulling the sheet down
 * close it through routes.ts `closeNotice`, which steps back when the reader
 * opened the notice; focus returns to the row that opened it.
 *
 * The URL (`?notice=`) says which notice shows; this only draws it.
 * Minimised and full screen are the panel's own state (ProcurementReader
 * keeps it, so a buyer opened from a full-screen notice comes back to it).
 */
import { useMemo, useState } from "react";
import { Award, ExternalLink, FileText, Maximize2 } from "lucide-react";
import {
  RecordPanelActionBar,
  RecordPanelDock,
  RecordPanelShell,
  type RecordPanelStack,
} from "../../../../platform/record-engine/record-table/components/RecordTableSidePanelStack";
import { Tooltip } from "../../../../components/Tooltip";
import { describeNotice } from "../../lib/notice";
import { ClassifyButton, useNoticeTriage } from "../NoticeTriageBar";
import { NoticeLoading, NoticeMissing, NoticePage } from "../NoticePage";
import { NoticePanelContext } from "../routes";
import { useReaderSource } from "../source";
import { NoticeStepper, positionText, useNoticeNeighbours, useNoticeShortcuts } from "./NoticePager";

/** "the buyer's site", "BC Bid": where the notice was published. */
export const siteName = (source: string) => (source === "Buyer's website" ? "the buyer's site" : source);
/** The same for a button: "buyer's site". */
export const shortSiteName = (source: string) => (source === "Buyer's website" ? "buyer's site" : source);

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function NoticePanel({ recordKey, panel, onClose }: { recordKey: string; panel: RecordPanelStack; onClose: () => void }) {
  const source = useReaderSource();
  const record = source.useRecord(recordKey);
  const data = useMemo(() => (record ? parse(record.dataJson) : null), [record]);
  const model = useMemo(() => (record ? describeNotice(record.summary, data) : null), [record, data]);
  const neighbours = useNoticeNeighbours(recordKey);
  const control = useNoticeTriage(recordKey, model?.title ?? "");
  // Triage is for opportunities only.
  const triage = model?.kind === "opportunity" ? control : null;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useNoticeShortcuts({ root, enabled: !panel.minimised, neighbours, triage, announce: setAnnouncement });
  // What the panel shows opens further notices (related awards) as new history entries.
  const scope = useMemo(() => ({ inside: true, restore: () => panel.setMinimised(false) }), [panel]);

  // Focus goes back to the open notice's row in the list (marked there), where it is in sight;
  // otherwise the panel's own focus handling returns it to whatever opened the panel.
  const close = () => {
    const row = document.querySelector<HTMLElement>(".record-table__row--highlighted .record-table__identifier-button");
    if (row && !row.closest(".is-covered, [inert], [aria-hidden='true']")) row.focus({ preventScroll: true });
    onClose();
  };

  const title = record === undefined ? "Loading notice…" : model?.title ?? "Notice not found";
  if (panel.minimised) {
    return (
      <RecordPanelDock
        title={title}
        initial={title.trim().charAt(0).toUpperCase() || "N"}
        depth={1}
        onRestore={() => panel.setMinimised(false)}
        onClose={close}
      />
    );
  }

  const award = model?.kind === "award";
  const kindLabel = award ? "Award" : "Opportunity";
  const where = [neighbours ? positionText(neighbours) : "", model?.source ?? ""].filter(Boolean).join(" · ");
  const header = (
    <div className="record-side-panel__identity">
      <span className="record-side-panel__avatar" aria-hidden="true">
        {award ? <Award size={16} /> : <FileText size={16} />}
      </span>
      <span className="record-side-panel__identity-copy">
        {/* The dialog is named by this; the title says which notice it is. */}
        <strong>
          {kindLabel}
          {model && <span className="sr-only">: {model.title}</span>}
        </strong>
        {where && <small>{where}</small>}
      </span>
    </div>
  );

  const footer = model ? (
    <>
      <span className="procurement-notice-panel__footer-start">{triage && <ClassifyButton control={triage} />}</span>
      {!panel.fullscreen && (
        <Tooltip content="Show the notice full screen" placement="top">
          <button type="button" className="btn procurement-notice-panel__page" onClick={() => panel.setFullscreen(true)}>
            <Maximize2 size={14} aria-hidden="true" />
            <span className="procurement-notice-panel__page-label">Open page</span>
          </button>
        </Tooltip>
      )}
      {model.sourceUrl && (
        <a className="btn btn--accent record-side-panel__open procurement-notice-panel__open" href={model.sourceUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={14} aria-hidden="true" />
          <span className="procurement-notice-panel__open-label">Open on {shortSiteName(model.source)}</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </>
  ) : undefined;

  return (
    <RecordPanelShell
      className="procurement-notice-panel"
      onEscape={close}
      header={header}
      cardKey={recordKey}
      peekCount={0}
      fullscreen={panel.fullscreen}
      actions={
        <>
          {neighbours && <NoticeStepper neighbours={neighbours} />}
          <RecordPanelActionBar
            fullscreen={panel.fullscreen}
            onMinimise={() => panel.setMinimised(true)}
            onToggleFullscreen={() => panel.setFullscreen(!panel.fullscreen)}
            onClose={close}
            closeLabel="Close"
          />
        </>
      }
      footer={footer}
    >
      <NoticePanelContext.Provider value={scope}>
        {record === undefined ? (
          <NoticeLoading rootRef={setRoot} />
        ) : !record || !model ? (
          <NoticeMissing
            rootRef={setRoot}
            action={
              <button type="button" className="btn btn--accent" onClick={close}>
                Close
              </button>
            }
          />
        ) : (
          <NoticePage recordKey={recordKey} record={record} data={data} model={model} triage={triage} root={root} rootRef={setRoot} />
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </NoticePanelContext.Provider>
    </RecordPanelShell>
  );
}
