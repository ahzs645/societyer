/** Leave is persisted in whole minutes. Decimal hours are accepted only when exact. */
export function parseVacationHours(value: string, label: string): number {
  const raw = value.trim();
  let result: bigint;
  const clock = /^(\d+):([0-5]\d)$/.exec(raw);
  if (clock) result = BigInt(clock[1]) * 60n + BigInt(clock[2]);
  else {
    const decimal = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
    if (!decimal)
      throw new Error(
        `${label}: enter nonnegative hours as H:MM or a decimal, such as 7:30 or 7.5.`,
      );
    const fraction = decimal[2] ?? "",
      denominator = 10n ** BigInt(fraction.length);
    const numerator =
      (BigInt(decimal[1]) * denominator + BigInt(fraction || "0")) * 60n;
    if (numerator % denominator)
      throw new Error(
        `${label}: use whole minutes; enter 1:20 for one hour and twenty minutes.`,
      );
    result = numerator / denominator;
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${label}: hours exceed the supported range.`);
  return Number(result);
}
export function vacationHoursInput(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0)
    throw new Error("Vacation input must contain nonnegative whole minutes.");
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}
export function vacationHoursLabel(minutes: number): string {
  if (!Number.isSafeInteger(minutes)) return "Unknown";
  const absolute = Math.abs(minutes),
    hours = Math.floor(absolute / 60),
    remainder = absolute % 60;
  return `${minutes < 0 ? "−" : ""}${hours} h${remainder ? ` ${remainder} min` : ""}`;
}
export function vacationTimeCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | undefined | null>>,
): string {
  const cell = (value: string | number | undefined | null) => {
    let text = String(value ?? "");
    if (
      typeof value === "string" &&
      (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
    )
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`;
}
