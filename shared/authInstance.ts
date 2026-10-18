/**
 * How the sign-in page names this instance and who people ask for help.
 * Display-only deployment settings: both are optional, and a value that
 * isn't usable is left out rather than failing the sign-in page.
 */
export type AuthInstanceDetails = {
  /** e.g. "DDC North". Shown above the sign-in card instead of the domain label. */
  instanceName?: string;
  /** e.g. "it@ddcnorth.com". The sign-in help line links to it. */
  supportEmail?: string;
};

const MAX_INSTANCE_NAME_LENGTH = 80;
const EMAIL = /^[^\s@<>()",;:]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i;

export function authInstanceDetails(env: Record<string, string | undefined>): AuthInstanceDetails {
  const instanceName = env.SOCIETYER_AUTH_INSTANCE_NAME?.replace(/\s+/g, " ").trim();
  const supportEmail = env.SOCIETYER_AUTH_SUPPORT_EMAIL?.trim();
  return {
    ...(instanceName && instanceName.length <= MAX_INSTANCE_NAME_LENGTH ? { instanceName } : {}),
    ...(supportEmail && EMAIL.test(supportEmail) ? { supportEmail: supportEmail.toLowerCase() } : {}),
  };
}
