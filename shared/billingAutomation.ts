/** Calendar scheduling is shared by hosted cron and local workspaces. */
export type BillingCadence = "daily" | "weekly" | "monthly";
export type BillingAutomationKind = "recurring_invoice" | "invoice_reminder" | "report";
export function validateBillingTimezone(zone: string): string {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { throw new Error("Choose a valid IANA timezone, such as America/Vancouver."); }
  return zone;
}
function localParts(at: number, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function billingLocalDate(at: string, zone: string) { return localParts(Date.parse(at), validateBillingTimezone(zone)).slice(0, 10); }
/** Resolve gaps to the next valid wall time; repeated wall times run only once. */
export function billingWallTime(date: string, time: string, zone: string): string {
  validateBillingTimezone(zone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Choose a valid start date and local delivery time.");
  const target = `${date}T${time}`, nominal = Date.parse(`${target}:00Z`);
  let guess = nominal;
  for (let i = 0; i < 4; i++) { const delta = Date.parse(`${localParts(guess, zone)}:00Z`) - nominal; if (!delta) break; guess -= delta; }
  let next: number | undefined;
  // Covers the one-hour DST transitions and the half-hour transition in Lord Howe.
  for (let delta = -180; delta <= 180; delta++) {
    const candidate = guess + delta * 60_000, local = localParts(candidate, zone);
    if (local === target) return new Date(candidate).toISOString();
    if (local.slice(0, 10) === date && local > target && (next === undefined || candidate < next)) next = candidate;
  }
  if (next !== undefined) return new Date(next).toISOString();
  throw new Error("This local calendar date does not exist in the selected timezone.");
}
export function nextBillingDate(date: string, cadence: BillingCadence, anchorDay = Number(date.slice(8, 10))): string {
  const value = new Date(`${date}T12:00:00Z`);
  if (cadence === "monthly") { value.setUTCDate(1); value.setUTCMonth(value.getUTCMonth() + 1); const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate(); value.setUTCDate(Math.min(anchorDay, last)); }
  else value.setUTCDate(value.getUTCDate() + (cadence === "weekly" ? 7 : 1));
  return value.toISOString().slice(0, 10);
}
export function cleanBillingEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}
export function cleanBillingRecipients(values: unknown): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 20) throw new Error("Choose between 1 and 20 recipients.");
  return [...new Set(values.map(cleanBillingEmail))];
}
export function billingRetryAt(at: string, attempt: number): string { return new Date(Date.parse(at) + Math.min(120, 2 ** Math.max(1, attempt)) * 60_000).toISOString(); }
export function automationError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 1500); }
