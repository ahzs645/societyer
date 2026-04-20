const DEFAULT_WAVE_GRAPHQL_ENDPOINT = "https://gql.waveapps.com/graphql/public";

const WAVE_ENV_VARS = [
  {
    name: "WAVE_ACCESS_TOKEN",
    required: true,
    secret: true,
    purpose: "Wave GraphQL bearer token",
  },
  {
    name: "WAVE_BUSINESS_ID",
    required: true,
    secret: false,
    purpose: "Business selected for live sync",
  },
  {
    name: "WAVE_CLIENT_ID",
    required: false,
    secret: true,
    purpose: "OAuth connect link client id; value is never returned in diagnostics",
  },
  {
    name: "WAVE_CLIENT_SECRET",
    required: false,
    secret: true,
    purpose: "OAuth connect client secret; value is never returned in diagnostics",
  },
  {
    name: "WAVE_GRAPHQL_ENDPOINT",
    required: false,
    secret: false,
    purpose: "GraphQL endpoint override",
  },
] as const;

const WAVE_REDACTION_ENV_NAMES = [
  "WAVE_ACCESS_TOKEN",
  "WAVE_REFRESH_TOKEN",
  "WAVE_CLIENT_ID",
  "WAVE_CLIENT_SECRET",
  "WAVE_BUSINESS_ID",
  "WAVE_GRAPHQL_ENDPOINT",
] as const;

const SENSITIVE_DIAGNOSTIC_KEYS = new Set([
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "clientid",
  "client_id",
  "clientsecret",
  "client_secret",
  "authorization",
  "auth",
  "bearer",
  "secret",
  "token",
]);

export type WaveEnvStatus = {
  name: string;
  required: boolean;
  secret: boolean;
  purpose: string;
  present: boolean;
};

export function waveEnv(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

export function waveGraphQLEndpoint() {
  return waveEnv("WAVE_GRAPHQL_ENDPOINT") ?? DEFAULT_WAVE_GRAPHQL_ENDPOINT;
}

export function waveEnvironmentStatus(): WaveEnvStatus[] {
  return WAVE_ENV_VARS.map((row) => ({
    ...row,
    present: Boolean(waveEnv(row.name)?.trim()),
  }));
}

export function redactWaveDiagnostic(input: unknown, extraValues: Array<string | undefined> = []): string {
  let text = input instanceof Error
    ? input.message
    : typeof input === "string"
    ? input
    : stringifyDiagnostic(input);

  const configuredValues = WAVE_REDACTION_ENV_NAMES
    .map((name) => waveEnv(name))
    .concat(extraValues)
    .filter((value): value is string => typeof value === "string" && value.length >= 4)
    .sort((a, b) => b.length - a.length);

  for (const value of configuredValues) {
    text = text.split(value).join("[redacted]");
  }

  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(Authorization\s*:\s*)[^\s,;")]+/gi, "$1[redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|code)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|api[_-]?key|token|secret|code)["']?\s*[:=]\s*["']?)([^"',}\s;]+)/gi, "$1[redacted]")
    .replace(/\bwave_[A-Za-z0-9._~-]{4,}\b/g, "wave_[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]");

  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

export function redactWaveDiagnosticPayload<T>(input: T): T {
  return redactValue(input, 0) as T;
}

function stringifyDiagnostic(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function redactValue(input: unknown, depth: number): unknown {
  if (depth > 12) return "[redacted]";
  if (typeof input === "string") return redactWaveDiagnostic(input);
  if (input == null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((value) => redactValue(value, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = isSensitiveDiagnosticKey(key)
      ? "[redacted]"
      : redactValue(value, depth + 1);
  }
  return out;
}

function isSensitiveDiagnosticKey(key: string) {
  const normalized = key.replace(/[^a-z0-9_]/gi, "").toLowerCase();
  return SENSITIVE_DIAGNOSTIC_KEYS.has(normalized);
}
