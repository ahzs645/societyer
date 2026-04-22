import { ConvexError, v } from "convex/values";

export const serviceTokenValidator = v.optional(v.string());

const textEncoder = new TextEncoder();

function env(name: string): string | undefined {
  try {
    return (globalThis as any)?.process?.env?.[name];
  } catch {
    return undefined;
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function constantTimeStringEqual(left: string, right: string) {
  if (!left || !right) return false;
  const [leftHash, rightHash] = await Promise.all([
    sha256Hex(left),
    sha256Hex(right),
  ]);
  let diff = 0;
  for (let i = 0; i < leftHash.length; i += 1) {
    diff |= leftHash.charCodeAt(i) ^ rightHash.charCodeAt(i);
  }
  return left.length === right.length && diff === 0;
}

function configuredToken(names: string[], label: string) {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  throw new ConvexError({
    code: "SERVICE_TOKEN_MISSING",
    message: `${label} service token is not configured.`,
  });
}

async function assertServiceToken(
  provided: string | undefined,
  names: string[],
  label: string,
) {
  const expected = configuredToken(names, label);
  if (!(await constantTimeStringEqual(provided ?? "", expected))) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `${label} service token is invalid.`,
    });
  }
}

export async function assertMaintenanceToken(provided: string | undefined) {
  await assertServiceToken(
    provided,
    ["SOCIETYER_MAINTENANCE_TOKEN", "CONVEX_INSTANCE_SECRET"],
    "Maintenance",
  );
}

export async function assertApiPlatformServiceToken(provided: string | undefined) {
  await assertServiceToken(
    provided,
    ["SOCIETYER_API_PLATFORM_TOKEN", "CONVEX_INSTANCE_SECRET"],
    "API platform",
  );
}
