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
    secret: false,
    purpose: "OAuth connect link client id",
  },
  {
    name: "WAVE_GRAPHQL_ENDPOINT",
    required: false,
    secret: false,
    purpose: "GraphQL endpoint override",
  },
] as const;

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

  const configuredValues = WAVE_ENV_VARS
    .map((row) => waveEnv(row.name))
    .concat(extraValues)
    .filter((value): value is string => typeof value === "string" && value.length >= 4)
    .sort((a, b) => b.length - a.length);

  for (const value of configuredValues) {
    text = text.split(value).join("[redacted]");
  }

  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(Authorization\s*:\s*)[^\s,;")]+/gi, "$1[redacted]")
    .replace(/\b(access_token|refresh_token|client_secret|authorization|code)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/\bwave_[A-Za-z0-9._~-]{4,}\b/g, "wave_[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]");

  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

function stringifyDiagnostic(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}
