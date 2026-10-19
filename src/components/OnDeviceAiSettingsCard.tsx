/**
 * Settings → On-device AI. Chooses the model server this computer uses for
 * minutes drafts, the assistant and AI intake in the local and desktop
 * runtimes, whether the assistant may look up records (and propose changes
 * for approval), and (in its own section) the speech-to-text server behind
 * "Transcribe on this device". Everything here is stored on this device only (see
 * src/lib/localAi/config.ts); nothing is written to the workspace.
 *
 * The public demo shows the card disabled: it never contacts a network service.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Field } from "./ui";
import { Select } from "./Select";
import { Toggle } from "./Controls";
import { useToast } from "./Toast";
import { isStaticDemoRuntime } from "../lib/staticRuntime";
import { DEVICE_AI_PRESETS, deviceAiKeyRequired, effectiveBaseUrl, presetInfo, type DeviceAiPreset } from "../lib/localAi/models";
import { saveDeviceAiConfig, storeDeviceAiKey, type DeviceAiConfig, type DeviceAiFeature, type DeviceAssistantToolSettings, type DeviceSpeechConfig } from "../lib/localAi/config";
import { SPEECH_TO_TEXT_KINDS, speechKindInfo, type SpeechToTextKind } from "../../shared/ai/speechRequest";
import { testSpeechToText, type SpeechTestResult } from "../lib/localAi/transcription";
import { ApiKeyField, ChunkSizeField, ConnectionNotice, FeatureToggles, SpeechNotice } from "./OnDeviceAiFields";
import { checkDeviceAiBaseUrl } from "../../shared/ai/endpointPolicy";
import { deviceAiClient, type ConnectionTestResult } from "../lib/localAi/client";
import { useDeviceAi, useDeviceToolSupport } from "../lib/localAi/useDeviceAi";
import { rememberDeviceToolSupport } from "../lib/localAi/toolSupport";
import { AssistantToolToggles, ToolSupportNotice, type ToolProbe } from "./OnDeviceAiToolSettings";
import { getDesktopBridge } from "../lib/desktopBridge";

type Form = {
  enabled: boolean;
  preset: DeviceAiPreset;
  baseUrl: string;
  model: string;
  features: Record<DeviceAiFeature, boolean>;
  assistantTools: DeviceAssistantToolSettings;
  minutesChunkChars: number;
};

function formFrom(config: DeviceAiConfig): Form {
  return {
    enabled: config.kind !== "none",
    preset: config.preset,
    baseUrl: config.baseUrl,
    model: config.model,
    features: { ...config.features },
    assistantTools: { ...config.assistantTools },
    minutesChunkChars: config.minutesChunkChars,
  };
}

function configFrom(form: Form, previous: DeviceAiConfig): DeviceAiConfig {
  const info = presetInfo(form.preset);
  return {
    ...previous,
    kind: form.enabled ? info.kind : "none",
    preset: form.preset,
    baseUrl: effectiveBaseUrl(info.kind, form.baseUrl),
    model: form.model.trim(),
    features: { ...form.features },
    assistantTools: { lookUpRecords: form.assistantTools.lookUpRecords, proposeChanges: form.assistantTools.lookUpRecords && form.assistantTools.proposeChanges },
    minutesChunkChars: form.minutesChunkChars,
  };
}

/** Record lookups need a model that calls tools: check with one short request and remember the answer. */
async function probeAssistantTools(saved: DeviceAiConfig, model: string): Promise<ToolProbe | null> {
  if (!model || !saved.features.assistant || !saved.assistantTools.lookUpRecords) return null;
  const probe = await deviceAiClient({ model }).probeToolCalling();
  if (probe.outcome !== "failed") rememberDeviceToolSupport({ baseUrl: saved.baseUrl, model }, probe.outcome === "supported" ? "supported" : "unsupported");
  return { ...probe, model };
}

export function OnDeviceAiSettingsCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const demo = isStaticDemoRuntime();
  const device = useDeviceAi();
  const desktop = Boolean(getDesktopBridge());
  const cardRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<Form>(() => formFrom(device.config));
  const [dirty, setDirty] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [toolProbe, setToolProbe] = useState<ToolProbe | null>(null);
  const toolSupport = useDeviceToolSupport(device.config);

  // Settings arrive asynchronously in the desktop app; adopt them until edited.
  useEffect(() => {
    if (!dirty) setForm(formFrom(device.config));
  }, [device.config, dirty]);

  useEffect(() => {
    if (searchParams.get("section") === "on-device-ai") cardRef.current?.scrollIntoView({ block: "start" });
  }, [searchParams]);

  const info = presetInfo(form.preset);
  const address = effectiveBaseUrl(info.kind, form.baseUrl);
  const addressCheck = useMemo(() => checkDeviceAiBaseUrl(address), [address]);
  const keyRequired = deviceAiKeyRequired(info.kind, address);
  const disabled = demo || saving || testing;

  const change = (patch: Partial<Form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
    setResult(null);
    setToolProbe(null);
  };

  const choosePreset = (preset: DeviceAiPreset) => {
    const next = presetInfo(preset);
    change({ preset, baseUrl: next.baseUrl || form.baseUrl, model: preset === form.preset ? form.model : "" });
    setModels([]);
  };

  const persist = async () => {
    const saved = await saveDeviceAiConfig(configFrom(form, device.config));
    if (apiKey.trim()) {
      await storeDeviceAiKey(apiKey);
      setApiKey("");
    }
    setDirty(false);
    return saved;
  };

  const save = async () => {
    if (demo) return;
    if (form.enabled && !addressCheck.ok) {
      toast.error(t("onDeviceAi.invalidAddress", "Check the server address"), addressCheck.message);
      return;
    }
    setSaving(true);
    try {
      await persist();
      toast.success(t("onDeviceAi.saved", "On-device AI settings saved"), t("onDeviceAi.savedHint", "Stored on this device only."));
    } catch (error) {
      toast.error(t("onDeviceAi.saveFailed", "Couldn't save on-device AI settings"), error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  // Saves first: the desktop app's main process tests the saved address.
  const test = async () => {
    if (demo) return;
    if (!addressCheck.ok) {
      setResult({ ok: false, message: addressCheck.message });
      return;
    }
    setTesting(true);
    setResult(null);
    setToolProbe(null);
    try {
      const saved = await persist();
      const outcome = await deviceAiClient().testConnection();
      const model = saved.model || (outcome.ok ? outcome.models[0] ?? "" : "");
      if (outcome.ok) {
        setModels(outcome.models);
        // No model chosen yet: take the server's first one, so drafting works straight away.
        if (!saved.model && outcome.models[0]) await saveDeviceAiConfig({ ...saved, model: outcome.models[0] });
      }
      setResult(outcome);
      if (outcome.ok) setToolProbe(await probeAssistantTools(saved, model));
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : t("onDeviceAi.testFailed", "The connection test failed.") });
    } finally {
      setTesting(false);
    }
  };

  const forgetKey = async () => {
    await storeDeviceAiKey("");
    toast.success(t("onDeviceAi.keyForgotten", "Stored key removed"));
  };

  return (
    <div ref={cardRef} id="on-device-ai" className="card" style={{ marginBottom: 16 }}>
      <CardHead demo={demo} ready={device.ready} off={device.config.kind === "none"} />
      <div className="card__body col" style={{ gap: 16 }}>
        {demo && (
          <div className="notice notice--info" role="status">
            {t("onDeviceAi.demoNotice", "The demo never contacts a network service, so on-device AI is turned off here. Open a local workspace or the desktop app to connect Ollama, LM Studio or llama.cpp.")}
          </div>
        )}
        <Toggle
          checked={form.enabled}
          disabled={disabled}
          onChange={(enabled) => change({ enabled })}
          label={t("onDeviceAi.enable", "Use an on-device model")}
          hint={t("onDeviceAi.enableHint", "Server workspaces use the workspace AI provider instead.")}
        />
        <ModelServerFields
          form={form}
          models={models}
          addressError={form.enabled && !addressCheck.ok ? addressCheck.message : undefined}
          disabled={disabled}
          onPreset={choosePreset}
          onChange={change}
        />
        <ApiKeyField value={apiKey} onChange={setApiKey} required={keyRequired} stored={device.keyStored} desktop={desktop} disabled={disabled} />
        <FeatureToggles features={form.features} disabled={disabled} onChange={(features) => change({ features })} />
        <AssistantToolToggles
          value={form.assistantTools}
          disabled={disabled || !form.features.assistant}
          onChange={(assistantTools) => change({ assistantTools })}
        />
        <ChunkSizeField value={form.minutesChunkChars} disabled={disabled} onChange={(minutesChunkChars) => change({ minutesChunkChars })} />
        {result && <ConnectionNotice result={result} showCorsHint={!desktop} />}
        {form.features.assistant && form.assistantTools.lookUpRecords && (
          <ToolSupportNotice probe={toolProbe} support={dirty ? "unknown" : toolSupport} model={form.model} />
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn--accent" disabled={disabled || !dirty && !apiKey.trim()} onClick={() => void save()}>
            {saving ? t("onDeviceAi.saving", "Saving…") : t("onDeviceAi.save", "Save")}
          </button>
          <button type="button" className="btn" disabled={disabled || !form.enabled} onClick={() => void test()}>
            {testing ? t("onDeviceAi.testing", "Testing…") : t("onDeviceAi.test", "Test connection")}
          </button>
          {device.keyStored && !demo && (
            <button type="button" className="btn" disabled={disabled} onClick={() => void forgetKey()}>
              {t("onDeviceAi.forgetKey", "Forget stored key")}
            </button>
          )}
        </div>
        <SpeechToTextSection config={device.config} keyStored={device.speechKeyStored} demo={demo} desktop={desktop} />
      </div>
    </div>
  );
}

/** The model server: which one, its address, and the model to use. */
function ModelServerFields({
  form,
  models,
  addressError,
  disabled,
  onPreset,
  onChange,
}: {
  form: Form;
  /** The server's models, once Test connection has listed them. */
  models: readonly string[];
  addressError?: string;
  disabled: boolean;
  onPreset: (preset: DeviceAiPreset) => void;
  onChange: (patch: Partial<Form>) => void;
}) {
  const { t } = useTranslation();
  const modelListId = `${useId()}-models`;
  const info = presetInfo(form.preset);
  return (
    <>
      <Field label={t("onDeviceAi.server", "Model server")}>
        <Select
          value={form.preset}
          disabled={disabled}
          onChange={(value) => onPreset(value as DeviceAiPreset)}
          options={DEVICE_AI_PRESETS.map((entry) => ({ value: entry.preset, label: entry.label }))}
        />
      </Field>
      <Field
        label={t("onDeviceAi.address", "Server address")}
        hint={info.fixedBaseUrl
          ? t("onDeviceAi.addressFixed", "Fixed for this provider.")
          : info.baseUrl
            ? t("onDeviceAi.addressHint", "Prefilled with the usual address. Change it if your server uses another port.")
            : t("onDeviceAi.addressOther", "The server's OpenAI-compatible address, usually ending in /v1.")}
        error={addressError}
      >
        <input
          className="input"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={info.fixedBaseUrl ? info.baseUrl : form.baseUrl}
          disabled={disabled || info.fixedBaseUrl}
          placeholder="http://127.0.0.1:11434/v1"
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
      </Field>
      <p className="muted" style={{ margin: 0 }}>
        {t("onDeviceAi.privacy", "Requests go only to the address above. With a local server, meeting data stays on this computer.")}{" "}
        {t("onDeviceAi.notSynced", "These settings stay on this device and are not part of the workspace or its exports.")}
      </p>
      <Field label={t("onDeviceAi.model", "Model")} hint={models.length ? t("onDeviceAi.modelPick", "Pick one of the server's models or type a name.") : t("onDeviceAi.modelHint", "Test the connection to list the server's models, or type a name such as llama3.1:8b.")}>
        <input className="input" list={modelListId} autoComplete="off" spellCheck={false} value={form.model} disabled={disabled} onChange={(event) => onChange({ model: event.target.value })} />
      </Field>
      <datalist id={modelListId}>
        {models.map((model) => <option key={model} value={model} />)}
      </datalist>
    </>
  );
}

type SpeechForm = DeviceSpeechConfig;

/**
 * Speech-to-text: its own server, address, model and key, saved separately
 * from the chat model settings above.
 */
function SpeechToTextSection({ config, keyStored, demo, desktop }: { config: DeviceAiConfig; keyStored: boolean; demo: boolean; desktop: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ids = useId();
  const [form, setForm] = useState<SpeechForm>(() => ({ ...config.speechToText }));
  const [dirty, setDirty] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<SpeechTestResult | null>(null);

  useEffect(() => {
    if (!dirty) setForm({ ...config.speechToText });
  }, [config.speechToText, dirty]);

  const enabled = form.kind !== "none";
  const info = enabled ? speechKindInfo(form.kind as SpeechToTextKind) : null;
  const address = form.baseUrl.trim().replace(/\/+$/, "");
  const addressCheck = useMemo(() => checkDeviceAiBaseUrl(address), [address]);
  const keyRequired = enabled && deviceAiKeyRequired("openai-compatible", address);
  const disabled = demo || saving || testing;

  const change = (patch: Partial<SpeechForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
    setResult(null);
  };

  const chooseKind = (kind: SpeechForm["kind"]) => {
    if (kind === "none") return change({ kind });
    // Keep a typed address; replace an empty one or the previous kind's default.
    const previousDefault = form.kind === "none" ? "" : speechKindInfo(form.kind).baseUrl;
    const keepAddress = form.baseUrl.trim() && form.baseUrl.trim() !== previousDefault;
    change({ kind, baseUrl: keepAddress ? form.baseUrl : speechKindInfo(kind).baseUrl });
  };

  const persist = async () => {
    await saveDeviceAiConfig({ ...config, speechToText: { kind: form.kind, baseUrl: address, model: form.model.trim() } });
    if (apiKey.trim()) {
      await storeDeviceAiKey(apiKey, "speech");
      setApiKey("");
    }
    setDirty(false);
  };

  const save = async () => {
    if (demo) return;
    if (enabled && !addressCheck.ok) {
      toast.error(t("onDeviceAi.invalidAddress", "Check the server address"), addressCheck.message);
      return;
    }
    setSaving(true);
    try {
      await persist();
      toast.success(t("onDeviceAi.speechSaved", "Speech-to-text settings saved"), t("onDeviceAi.savedHint", "Stored on this device only."));
    } catch (error) {
      toast.error(t("onDeviceAi.saveFailed", "Couldn't save on-device AI settings"), error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  // Saves first: the desktop app's main process sends the saved settings.
  const test = async () => {
    if (demo || !enabled) return;
    if (!addressCheck.ok) {
      setResult({ ok: false, message: addressCheck.message });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      await persist();
      setResult(await testSpeechToText());
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : t("onDeviceAi.testFailed", "The connection test failed.") });
    } finally {
      setTesting(false);
    }
  };

  const forgetKey = async () => {
    await storeDeviceAiKey("", "speech");
    toast.success(t("onDeviceAi.keyForgotten", "Stored key removed"));
  };

  const modelHint =
    form.kind === "whisper-cpp"
      ? t("onDeviceAi.speechModelWhisperCpp", "Not used: whisper.cpp transcribes with the model it was started with.")
      : form.kind === "whisperx"
        ? t("onDeviceAi.speechModelWhisperX", "If your server needs one, for example large-v3.")
        : t("onDeviceAi.speechModelOpenAi", "Most servers need one, for example Systran/faster-whisper-small (speaches) or whisper-1.");

  return (
    <section className="col" style={{ gap: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }} aria-labelledby={`${ids}-speech`}>
      <div className="col" style={{ gap: 4 }}>
        <h3 id={`${ids}-speech`} style={{ margin: 0, fontSize: "var(--fs-md)" }}>{t("onDeviceAi.speechTitle", "Speech-to-text")}</h3>
        <p className="muted" style={{ margin: 0 }}>
          {t("onDeviceAi.speechIntro", "Transcribe meeting recordings on this computer from the Transcript tab. This uses its own server, separate from the chat model.")}
        </p>
      </div>
      <Field label={t("onDeviceAi.speechServer", "Speech-to-text server")}>
        <Select
          value={form.kind}
          disabled={disabled}
          onChange={(value) => chooseKind(value as SpeechForm["kind"])}
          options={[
            { value: "none", label: t("onDeviceAi.speechOff", "Off") },
            ...SPEECH_TO_TEXT_KINDS.map((entry) => ({ value: entry.kind, label: entry.label })),
          ]}
        />
      </Field>
      {info && (
        <>
          <Field
            label={t("onDeviceAi.address", "Server address")}
            hint={info.kind === "whisper-cpp"
              ? t("onDeviceAi.speechAddressWhisperCpp", "The server root; requests go to /inference.")
              : t("onDeviceAi.speechAddressOpenAi", "The OpenAI-compatible address, usually ending in /v1; requests go to /audio/transcriptions.")}
            error={!addressCheck.ok ? addressCheck.message : undefined}
          >
            <input
              className="input"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={form.baseUrl}
              disabled={disabled}
              placeholder={info.baseUrl}
              onChange={(event) => change({ baseUrl: event.target.value })}
            />
          </Field>
          <Field label={t("onDeviceAi.model", "Model")} hint={modelHint}>
            <input className="input" autoComplete="off" spellCheck={false} value={form.model} disabled={disabled} onChange={(event) => change({ model: event.target.value })} />
          </Field>
          <ApiKeyField value={apiKey} onChange={setApiKey} required={keyRequired} stored={keyStored} desktop={desktop} disabled={disabled} />
          <p className="muted" style={{ margin: 0 }}>
            {t("onDeviceAi.speechPrivacy", "Recordings are sent only to this address. With a server on this computer, audio never leaves it.")}{" "}
            {desktop
              ? t("onDeviceAi.speechDesktop", "If ffmpeg is installed, the desktop app first converts recordings to 16 kHz mono audio and sends long ones in 10-minute parts.")
              : t("onDeviceAi.speechBrowser", "This browser sends the recording file as it is.")}
          </p>
        </>
      )}
      {result && <SpeechNotice result={result} showCorsHint={!desktop} />}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn--accent" disabled={disabled || (!dirty && !apiKey.trim())} onClick={() => void save()}>
          {saving ? t("onDeviceAi.saving", "Saving…") : t("onDeviceAi.speechSave", "Save speech-to-text")}
        </button>
        <button type="button" className="btn" disabled={disabled || !enabled} onClick={() => void test()}>
          {testing ? t("onDeviceAi.testing", "Testing…") : t("onDeviceAi.speechTest", "Test speech-to-text")}
        </button>
        {keyStored && !demo && (
          <button type="button" className="btn" disabled={disabled} onClick={() => void forgetKey()}>
            {t("onDeviceAi.forgetKey", "Forget stored key")}
          </button>
        )}
      </div>
    </section>
  );
}

function CardHead({ demo, ready, off }: { demo: boolean; ready: boolean; off: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="card__head">
      <h2 className="card__title">{t("onDeviceAi.title", "On-device AI")}</h2>
      <span className="card__subtitle">{t("onDeviceAi.subtitle", "Use model servers on this computer for minutes drafts, the assistant, AI intake and transcription.")}</span>
      <StatusBadge demo={demo} ready={ready} off={off} />
    </div>
  );
}

function StatusBadge({ demo, ready, off }: { demo: boolean; ready: boolean; off: boolean }) {
  const { t } = useTranslation();
  if (demo) return <Badge tone="neutral">{t("onDeviceAi.statusDemo", "Not available in the demo")}</Badge>;
  if (ready) return <Badge tone="success">{t("onDeviceAi.statusReady", "Ready")}</Badge>;
  if (off) return <Badge tone="neutral">{t("onDeviceAi.statusOff", "Off")}</Badge>;
  return <Badge tone="warn">{t("onDeviceAi.statusIncomplete", "Needs setup")}</Badge>;
}
