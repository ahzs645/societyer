import { Field } from "./ui";

export type StructuredAddressValue = {
  street?: string;
  unit?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
};

const PROVINCE_STATE_OPTIONS = [
  "Alberta",
  "British Columbia",
  "Manitoba",
  "New Brunswick",
  "Newfoundland and Labrador",
  "Northwest Territories",
  "Nova Scotia",
  "Nunavut",
  "Ontario",
  "Prince Edward Island",
  "Quebec",
  "Saskatchewan",
  "Yukon",
  "Alabama",
  "Alaska",
  "Arizona",
  "California",
  "Colorado",
  "Florida",
  "New York",
  "Oregon",
  "Texas",
  "Washington",
];

export function StructuredAddressFields({
  value,
  onChange,
  provinceLabel = "Province / state",
  postalLabel = "Postal code / ZIP",
}: {
  value: StructuredAddressValue;
  onChange: (value: StructuredAddressValue) => void;
  provinceLabel?: string;
  postalLabel?: string;
}) {
  const street = splitStreet(value.street);
  const provinceState = cleanPart(value.provinceState);
  const hasCustomProvinceState = provinceState && !PROVINCE_STATE_OPTIONS.includes(provinceState);
  const set = (patch: Partial<StructuredAddressValue>) => onChange({ ...value, ...patch });
  const setStreetPart = (patch: Partial<{ streetNumber: string; streetName: string }>) => {
    const next = { ...street, ...patch };
    set({ street: [next.streetNumber, next.streetName].map(cleanPart).filter(Boolean).join(" ") });
  };

  return (
    <div className="structured-address-fields">
      <div className="structured-address-fields__street-row">
        <Field label="Street #">
          <input
            className="input"
            value={street.streetNumber}
            onChange={(event) => setStreetPart({ streetNumber: event.target.value })}
          />
        </Field>
        <Field label="Street name">
          <input
            className="input"
            value={street.streetName}
            onChange={(event) => setStreetPart({ streetName: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Unit, suite, floor, apt">
        <input className="input" value={value.unit ?? ""} onChange={(event) => set({ unit: event.target.value })} />
      </Field>
      <Field label="City / town">
        <input className="input" value={value.city ?? ""} onChange={(event) => set({ city: event.target.value })} />
      </Field>
      <div className="structured-address-fields__region-row">
        <Field label={provinceLabel}>
          <select
            className="input"
            value={provinceState}
            onChange={(event) => set({ provinceState: event.target.value })}
          >
            <option value="">Select province/state</option>
            {hasCustomProvinceState && <option value={provinceState}>{provinceState}</option>}
            {PROVINCE_STATE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
        <Field label={postalLabel}>
          <input className="input" value={value.postalCode ?? ""} onChange={(event) => set({ postalCode: event.target.value })} />
        </Field>
      </div>
      <Field label="Country">
        <input className="input" value={value.country ?? ""} onChange={(event) => set({ country: event.target.value })} />
      </Field>
    </div>
  );
}

export function StructuredAddressTextFields({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <StructuredAddressFields
      value={parseAddressText(value)}
      onChange={(next) => onChange(formatAddressText(next))}
    />
  );
}

export function formatAddressText(value: StructuredAddressValue) {
  const line1 = [value.unit, value.street].map(cleanPart).filter(Boolean).join(", ");
  const line2 = [value.city, value.provinceState, value.postalCode].map(cleanPart).filter(Boolean).join(", ");
  return [line1, line2, value.country].map(cleanPart).filter(Boolean).join("\n");
}

export function splitStreet(value?: string) {
  const text = cleanPart(value);
  const match = text.match(/^([0-9]+[A-Za-z]?(?:-[0-9]+[A-Za-z]?)?)\s+(.+)$/);
  if (!match) return { streetNumber: "", streetName: text };
  return { streetNumber: match[1], streetName: match[2] };
}

function parseAddressText(value?: string): StructuredAddressValue {
  const lines = String(value ?? "").split(/\n+/).map(cleanPart).filter(Boolean);
  const [firstLine = "", regionLine = "", country = ""] = lines;
  const firstParts = firstLine.split(",").map(cleanPart).filter(Boolean);
  const street = firstParts.pop() ?? "";
  const unit = firstParts.join(", ");
  const regionParts = regionLine.split(",").map(cleanPart).filter(Boolean);
  return {
    street,
    unit,
    city: regionParts[0] ?? "",
    provinceState: regionParts[1] ?? "",
    postalCode: regionParts.slice(2).join(", "),
    country,
  };
}

function cleanPart(value: unknown) {
  return String(value ?? "").trim();
}
