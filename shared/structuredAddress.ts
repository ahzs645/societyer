export type StructuredAddressValue = {
  street?: string; unit?: string; city?: string; provinceState?: string; postalCode?: string; country?: string;
};
const cleanPart = (value: unknown) => String(value ?? "").trim();
function trimEmptyEnd(parts: string[]) {
  while (parts.length && parts.at(-1) === "") parts.pop();
  return parts;
}

/** Three positional lines: unit/street, city/province/postal, country. */
export function formatAddressText(value: StructuredAddressValue) {
  const street = cleanPart(value.street), unit = cleanPart(value.unit);
  const line1 = unit ? `${unit}, ${street}` : street;
  const line2 = trimEmptyEnd([value.city, value.provinceState, value.postalCode].map(cleanPart)).join(", ");
  return trimEmptyEnd([line1, line2, cleanPart(value.country)]).join("\n");
}

/** Keep empty slots. Removing them silently moves country, province or unit. */
export function parseAddressText(value?: string): StructuredAddressValue {
  const [firstLine = "", regionLine = "", country = ""] = String(value ?? "").split(/\r?\n/).map(cleanPart);
  const firstParts = firstLine.split(",").map(cleanPart);
  const street = firstParts.pop() ?? "";
  const regionParts = regionLine.split(",").map(cleanPart);
  return { street, unit: firstParts.join(", "), city: regionParts[0] ?? "", provinceState: regionParts[1] ?? "", postalCode: regionParts.slice(2).join(", "), country };
}

export function normalizeAddressText(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  // Preserve leading and interior blank lines; trim whitespace inside each
  // line and only discard trailing blank lines.
  return trimEmptyEnd(value.split(/\r?\n/).map(cleanPart)).join("\n");
}

export function splitStreet(value?: string) {
  const text = cleanPart(value);
  if (/^[0-9]+[A-Za-z]?(?:-[0-9]+[A-Za-z]?)?$/.test(text)) return { streetNumber: text, streetName: "" };
  const match = text.match(/^([0-9]+[A-Za-z]?(?:-[0-9]+[A-Za-z]?)?)\s+(.+)$/);
  return match ? { streetNumber: match[1], streetName: match[2] } : { streetNumber: "", streetName: text };
}
