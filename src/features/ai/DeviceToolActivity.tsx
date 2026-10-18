/**
 * What the on-device assistant did with tools, under its reply:
 * "Looked up: meetings (12) · transcript 0:00–5:00". Each chip opens the
 * arguments and a short preview of the result. Changes the person approved
 * show as "Changed: Created 1 task".
 */
import { useState } from "react";
import { AlertTriangle, Check, Loader2, Search } from "lucide-react";
import type { DeviceToolRecord } from "../../../shared/ai/deviceToolRecords";

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function ChipIcon({ record }: { record: DeviceToolRecord }) {
  if (record.status === "running") return <Loader2 size={11} className="spin" aria-hidden="true" />;
  if (record.status === "error" || record.status === "refused") return <AlertTriangle size={11} aria-hidden="true" />;
  if (record.status === "executed") return <Check size={11} aria-hidden="true" />;
  return <Search size={11} aria-hidden="true" />;
}

const STATUS_LABEL: Partial<Record<DeviceToolRecord["status"], string>> = {
  running: "looking up",
  error: "failed",
  refused: "not allowed",
};

function ChipGroup({ label, records }: { label: string; records: DeviceToolRecord[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = records.find((record) => record.id === openId);
  if (!records.length) return null;
  return (
    <div className="global-ai-tool-activity">
      <div className="global-ai-tool-activity__row">
        <span className="global-ai-tool-activity__label">{label}</span>
        {records.map((record) => {
          const status = STATUS_LABEL[record.status];
          return (
            <button
              key={record.id}
              type="button"
              className={`global-ai-tool-chip global-ai-tool-chip--${record.status}${record.id === openId ? " is-open" : ""}`}
              aria-expanded={record.id === openId}
              aria-label={`${record.summary}${status ? ` (${status})` : ""}. Show details`}
              disabled={record.status === "running"}
              onClick={() => setOpenId((current) => (current === record.id ? null : record.id))}
            >
              <ChipIcon record={record} />
              <span>{record.summary}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className="global-ai-toolcall__body global-ai-tool-activity__detail">
          <div className="global-ai-toolcall__label">
            <code>{open.name}</code>
          </div>
          {open.argsJson && (
            <div className="global-ai-toolcall__section">
              <div className="global-ai-toolcall__label">Arguments</div>
              <pre>{prettyJson(open.argsJson)}</pre>
            </div>
          )}
          {open.resultPreview && (
            <div className="global-ai-toolcall__section">
              <div className="global-ai-toolcall__label">{open.status === "complete" || open.status === "executed" ? "Result (shortened)" : "Error"}</div>
              <pre>{open.resultPreview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DeviceToolActivity({ records }: { records: readonly DeviceToolRecord[] }) {
  const lookups = records.filter((record) => record.kind === "read" || record.kind === "unknown" || record.status === "refused" || record.status === "error" || record.status === "running");
  const changes = records.filter((record) => record.status === "executed");
  return (
    <>
      <ChipGroup label="Looked up:" records={lookups} />
      <ChipGroup label="Changed:" records={changes} />
    </>
  );
}
