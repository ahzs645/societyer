import { Badge } from "../../../components/ui";
import { formatDateTime } from "../../../lib/format";

export function WaveHealthPanel({ result }: { result: any }) {
  const envRows = result.env ?? [];
  const steps = result.steps ?? [];
  const checkedAt = result.checkedAtISO ? formatDateTime(result.checkedAtISO) : "just now";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Wave connection health</h2>
        <Badge tone={healthTone(result.status)}>
          {healthLabel(result.status)}
        </Badge>
        <span className="card__subtitle">
          {checkedAt} · {result.mode === "live" ? "live" : "not configured"} · secrets redacted
        </span>
      </div>
      <div
        className="card__body"
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Expected environment</div>
          <div style={{ display: "grid", gap: 8 }}>
            {envRows.map((row: any) => (
              <div key={row.name} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <code className="mono">{row.name}</code>
                  <Badge tone={row.present ? "success" : row.required ? "danger" : "neutral"}>
                    {row.present ? "present" : "missing"}
                  </Badge>
                  {row.required && <Badge tone="warn">required</Badge>}
                  {row.secret && <Badge tone="info">secret</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{redactCredentialText(row.purpose)}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Probe result</div>
          {result.business && (
            <div style={{ marginBottom: 10 }}>
              <strong>{redactCredentialText(result.business.name ?? "Selected business")}</strong>
              {result.business.currencyCode && <span className="muted"> · {redactCredentialText(result.business.currencyCode)}</span>}
              <div className="muted" style={{ fontSize: 12 }}>Business source: {businessSourceLabel(result.business.source)}</div>
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {steps.map((step: any) => (
              <div key={step.id} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={healthTone(step.status)}>{healthLabel(step.status)}</Badge>
                  <strong>{step.label}</strong>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{redactCredentialText(step.message)}</div>
                {step.detail && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(step.detail).map(([key, value]) => (
                      <span key={key} className="cell-tag">{redactCredentialText(key)}: {formatWaveHealthDetail(value)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function redactWaveHealthResult(result: any) {
  return {
    ...result,
    business: result?.business
      ? {
          ...result.business,
          name: result.business.name ? redactCredentialText(result.business.name) : result.business.name,
          currencyCode: result.business.currencyCode ? redactCredentialText(result.business.currencyCode) : result.business.currencyCode,
        }
      : result?.business,
    steps: (result?.steps ?? []).map((step: any) => ({
      ...step,
      label: redactCredentialText(step.label),
      message: redactCredentialText(step.message),
      detail: step.detail ? redactWaveHealthDetail(step.detail) : step.detail,
    })),
  };
}

function redactWaveHealthDetail(detail: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      redactCredentialText(key),
      typeof value === "string" ? redactCredentialText(value) : value,
    ]),
  );
}

function formatWaveHealthDetail(value: unknown) {
  return typeof value === "string" ? redactCredentialText(value) : String(value);
}

function redactCredentialText(value: unknown) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(Authorization\s*:\s*)[^\s,;")]+/gi, "$1[redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|code)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|api[_-]?key|token|secret|code)["']?\s*[:=]\s*["']?)([^"',}\s;]+)/gi, "$1[redacted]")
    .replace(/\bwave_[A-Za-z0-9._~-]{4,}\b/g, "wave_[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]");
}

function healthTone(status?: string): "success" | "warn" | "danger" | "neutral" {
  if (status === "pass") return "success";
  if (status === "warn") return "warn";
  if (status === "fail") return "danger";
  return "neutral";
}

function healthLabel(status?: string) {
  if (status === "pass") return "pass";
  if (status === "warn") return "warning";
  if (status === "fail") return "fail";
  return "skipped";
}

function businessSourceLabel(source?: string) {
  if (source === "env") return "WAVE_BUSINESS_ID";
  if (source === "argument") return "connection";
  if (source === "firstAccessible") return "first accessible business";
  return "unknown";
}
