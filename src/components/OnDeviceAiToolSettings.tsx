/**
 * Settings → On-device AI: what the assistant may do with workspace records,
 * and whether the chosen model calls tools (from Test connection, or what
 * this device learned in the chat). See src/lib/localAi/assistantToolLoop.ts.
 */
import { useTranslation } from "react-i18next";
import { Toggle } from "./Controls";
import type { DeviceAssistantToolSettings } from "../lib/localAi/config";
import type { ToolProbeResult } from "../lib/localAi/client";
import type { DeviceToolSupport } from "../lib/localAi/toolSupport";

export type ToolProbe = ToolProbeResult & { model: string };

/**
 * What the on-device assistant may do with workspace records. Lookups are
 * read-only and run here as the signed-in person; proposals need approval.
 */
export function AssistantToolToggles({
  value,
  disabled,
  onChange,
}: {
  value: DeviceAssistantToolSettings;
  disabled: boolean;
  onChange: (value: DeviceAssistantToolSettings) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="col" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
      <legend className="muted" style={{ marginBottom: 8 }}>{t("onDeviceAi.toolsLegend", "The assistant and workspace records")}</legend>
      <Toggle
        checked={value.lookUpRecords}
        disabled={disabled}
        onChange={(lookUpRecords) => onChange({ lookUpRecords, proposeChanges: lookUpRecords && value.proposeChanges })}
        label={t("onDeviceAi.toolsLookUp", "Let the assistant look up workspace records")}
        hint={t("onDeviceAi.toolsLookUpHint", "Read-only: meetings, minutes, transcripts, documents, tasks, deadlines and commitments, limited to what you can see (in-camera content stays withheld as usual). Lookups run on this device; what the assistant reads is sent only to the model server above.")}
      />
      <Toggle
        checked={value.proposeChanges}
        disabled={disabled || !value.lookUpRecords}
        onChange={(proposeChanges) => onChange({ ...value, proposeChanges })}
        label={t("onDeviceAi.toolsPropose", "Allow the assistant to propose changes")}
        hint={t("onDeviceAi.toolsProposeHint", "It can propose new tasks. Nothing changes until you approve each proposal in the chat.")}
      />
    </fieldset>
  );
}

/** Whether the chosen model calls tools: from the last Test connection, or what this device learned. */
export function ToolSupportNotice({ probe, support, model }: { probe: ToolProbe | null; support: DeviceToolSupport; model: string }) {
  const { t } = useTranslation();
  const recommend = t("onDeviceAi.toolsModels", "Models that call tools well include Qwen 2.5 or Qwen 3 (7B and up), Llama 3.1 or 3.2, Mistral Small 3 and Mistral Nemo. With llama.cpp, start llama-server with --jinja.");
  const outcome = probe?.outcome ?? (support === "supported" ? "supported" : support === "unsupported" ? "unsupported" : null);
  const name = probe?.model || model || t("onDeviceAi.toolsThisModel", "This model");
  if (!outcome) {
    return <p className="muted" style={{ margin: 0 }}>{t("onDeviceAi.toolsUntested", "Test the connection to check that the model can look up records.")} {recommend}</p>;
  }
  if (outcome === "supported") {
    return <div className="notice notice--success" role="status" aria-live="polite">{t("onDeviceAi.toolsSupported", { defaultValue: "{{model}} looks up records with tools.", model: name })}</div>;
  }
  const message = probe?.outcome === "failed"
    ? t("onDeviceAi.toolsFailed", { defaultValue: "The tool test didn't finish: {{message}}", message: probe.message })
    : outcome === "rejected"
      ? t("onDeviceAi.toolsRejected", { defaultValue: "{{model}} doesn't accept tools on this server, so the assistant works from pasted text only.", model: name })
      : outcome === "ignored"
        ? t("onDeviceAi.toolsIgnored", { defaultValue: "{{model}} answered without calling the test tool, so the assistant works from pasted text only.", model: name })
        : t("onDeviceAi.toolsUnsupported", { defaultValue: "{{model}} doesn't call tools, so the assistant works from pasted text only.", model: name });
  return (
    <div className="notice notice--warn" role="status" aria-live="polite">
      <strong>{message}</strong>
      <div>{recommend}</div>
    </div>
  );
}
