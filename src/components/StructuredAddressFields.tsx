import { Field } from "./ui";
import { Select } from "./Select";
import { useEffect, useRef, useState } from "react";

import { formatAddressText, parseAddressText, splitStreet, type StructuredAddressValue } from "../../shared/structuredAddress";
export { formatAddressText, parseAddressText, splitStreet } from "../../shared/structuredAddress";
export type { StructuredAddressValue } from "../../shared/structuredAddress";

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
          <Select
            value={provinceState}
            onChange={(next) => set({ provinceState: next })}
            options={[
              { value: "", label: "Select province/state" },
              ...(hasCustomProvinceState ? [{ value: provinceState, label: provinceState }] : []),
              ...PROVINCE_STATE_OPTIONS.map((option) => ({ value: option, label: option })),
            ]}
          />
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
  // Keep incomplete structured input intact while it is serialized into the
  // parent text field. Re-parsing after every keystroke loses a street number
  // entered before its street name and moves country/region-only fragments.
  const [draft, setDraft] = useState(() => parseAddressText(value));
  const emitted = useRef(value ?? "");
  useEffect(() => {
    const incoming = value ?? "";
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    setDraft(parseAddressText(incoming));
  }, [value]);
  return (
    <StructuredAddressFields
      value={draft}
      onChange={(next) => {
        setDraft(next);
        emitted.current = formatAddressText(next);
        onChange(emitted.current);
      }}
    />
  );
}

function cleanPart(value: unknown) {
  return String(value ?? "").trim();
}
