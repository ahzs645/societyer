/** Fields and notices shared by the on-device AI card's model and speech-to-text sections. */
import { useTranslation } from "react-i18next";
import { Field } from "./ui";
import { Toggle } from "./Controls";
import type { DeviceAiFeature } from "../lib/localAi/config";
import type { SpeechTestResult } from "../lib/localAi/transcription";
import type { ConnectionTestResult } from "../lib/localAi/client";
import { MAX_MINUTES_CHUNK_CHARS, MIN_MINUTES_CHUNK_CHARS } from "../../shared/ai/minutesDraftChunks";

export function SpeechNotice({ result, showCorsHint }: { result: SpeechTestResult; showCorsHint: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`notice ${result.ok ? "notice--success" : "notice--warn"}`} role="status" aria-live="polite">
      {result.ok ? (
        t("onDeviceAi.speechTestOk", { defaultValue: "Connected in {{ms}} ms. The server transcribed a one-second test recording.", ms: result.latencyMs })
      ) : (
        <>
          <strong>{result.message}</strong>
          {result.hint && showCorsHint && <div>{result.hint}</div>}
        </>
      )}
    </div>
  );
}

export function FeatureToggles({
  features,
  disabled,
  onChange,
}: {
  features: Record<DeviceAiFeature, boolean>;
  disabled: boolean;
  onChange: (features: Record<DeviceAiFeature, boolean>) => void;
}) {
  const { t } = useTranslation();
  const set = (feature: DeviceAiFeature) => (checked: boolean) => onChange({ ...features, [feature]: checked });
  return (
    <fieldset className="col" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
      <legend className="muted" style={{ marginBottom: 8 }}>{t("onDeviceAi.useFor", "Use the on-device model for")}</legend>
      <Toggle checked={features.minutes} disabled={disabled} onChange={set("minutes")} label={t("onDeviceAi.featureMinutes", "Drafting meeting minutes from transcripts")} />
      <Toggle checked={features.assistant} disabled={disabled} onChange={set("assistant")} label={t("onDeviceAi.featureAssistant", "The assistant chat and Ask AI table filters")} hint={t("onDeviceAi.featureAssistantHint", "The assistant works from what you paste or attach, unless record lookups are on below.")} />
      <Toggle checked={features.intake} disabled={disabled} onChange={set("intake")} label={t("onDeviceAi.featureIntake", "AI intake field extraction")} />
    </fieldset>
  );
}

/** The Test connection outcome. The CORS hint only applies to browser requests. */
export function ConnectionNotice({ result, showCorsHint }: { result: ConnectionTestResult; showCorsHint: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`notice ${result.ok ? "notice--success" : "notice--warn"}`} role="status" aria-live="polite">
      {result.ok ? (
        t("onDeviceAi.testOk", { defaultValue: "Connected in {{ms}} ms. The server offers {{models}} model(s).", ms: result.latencyMs, models: result.models.length })
      ) : (
        <>
          <strong>{result.message}</strong>
          {result.hint && showCorsHint && <div>{result.hint}</div>}
        </>
      )}
    </div>
  );
}

export function ApiKeyField({
  value,
  onChange,
  required,
  stored,
  desktop,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  stored: boolean;
  desktop: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const place = desktop
    ? t("onDeviceAi.keyPlaceDesktop", "the operating system keychain on this computer")
    : t("onDeviceAi.keyPlaceBrowser", "this browser tab only (cleared when the tab closes)");
  const hint = stored
    ? t("onDeviceAi.keyStored", { defaultValue: "A key is stored in {{place}}. Enter a new one to replace it.", place })
    : required
      ? t("onDeviceAi.keyRequiredHint", { defaultValue: "Kept in {{place}}; never saved to the workspace.", place })
      : t("onDeviceAi.keyLocalHint", { defaultValue: "Not needed for a server on this computer. If you set one, it is kept in {{place}}.", place });
  return (
    <Field label={required ? t("onDeviceAi.key", "API key") : t("onDeviceAi.keyOptional", "API key (optional)")} hint={hint}>
      <input className="input" type="password" autoComplete="off" value={value} disabled={disabled} placeholder={stored ? "•••••••• (stored)" : ""} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function ChunkSizeField({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  return (
    <Field
      label={t("onDeviceAi.chunk", "Transcript part size (characters)")}
      hint={t("onDeviceAi.chunkHint", "Longer transcripts are drafted in parts and combined, for models with small context windows. 8,000 suits a 4k-token model.")}
    >
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={MIN_MINUTES_CHUNK_CHARS}
        max={MAX_MINUTES_CHUNK_CHARS}
        step={1000}
        style={{ maxWidth: 200 }}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) || MIN_MINUTES_CHUNK_CHARS)}
      />
    </Field>
  );
}
