/** Stable JSON and browser/Convex-compatible SHA-256 for retained payroll facts. */
export function canonicalPayroll(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalPayroll(v ?? null)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalPayroll(v)}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
export async function payrollFingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalPayroll(value)),
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
