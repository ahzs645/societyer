import { type ComponentType } from "react";
import { FIELD_TYPES, type FieldType, type FieldMetadata } from "../../types";

import { TextFieldDisplay } from "./display/TextFieldDisplay";
import { NumberFieldDisplay } from "./display/NumberFieldDisplay";
import { CurrencyFieldDisplay } from "./display/CurrencyFieldDisplay";
import { BooleanFieldDisplay } from "./display/BooleanFieldDisplay";
import { DateFieldDisplay } from "./display/DateFieldDisplay";
import { SelectFieldDisplay } from "./display/SelectFieldDisplay";
import { MultiSelectFieldDisplay } from "./display/MultiSelectFieldDisplay";
import { EmailFieldDisplay } from "./display/EmailFieldDisplay";
import { PhoneFieldDisplay } from "./display/PhoneFieldDisplay";
import { LinkFieldDisplay } from "./display/LinkFieldDisplay";
import { RelationFieldDisplay } from "./display/RelationFieldDisplay";
import { RatingFieldDisplay } from "./display/RatingFieldDisplay";
import { ArrayFieldDisplay } from "./display/ArrayFieldDisplay";
import { UuidFieldDisplay } from "./display/UuidFieldDisplay";

export type FieldDisplayProps = {
  value: unknown;
  record: any;
  field: FieldMetadata;
};

type DisplayComponent = ComponentType<FieldDisplayProps>;

/**
 * Field-type → renderer registry. Extensible — new types just need to
 * add a key here (and to FIELD_TYPES) to show up everywhere.
 */
const DISPLAY_BY_TYPE: Record<FieldType, DisplayComponent> = {
  [FIELD_TYPES.TEXT]: TextFieldDisplay,
  [FIELD_TYPES.NUMBER]: NumberFieldDisplay,
  [FIELD_TYPES.CURRENCY]: CurrencyFieldDisplay,
  [FIELD_TYPES.BOOLEAN]: BooleanFieldDisplay,
  [FIELD_TYPES.DATE]: DateFieldDisplay,
  [FIELD_TYPES.DATE_TIME]: DateFieldDisplay,
  [FIELD_TYPES.SELECT]: SelectFieldDisplay,
  [FIELD_TYPES.MULTI_SELECT]: MultiSelectFieldDisplay,
  [FIELD_TYPES.EMAIL]: EmailFieldDisplay,
  [FIELD_TYPES.PHONE]: PhoneFieldDisplay,
  [FIELD_TYPES.LINK]: LinkFieldDisplay,
  [FIELD_TYPES.RELATION]: RelationFieldDisplay,
  [FIELD_TYPES.RATING]: RatingFieldDisplay,
  [FIELD_TYPES.UUID]: UuidFieldDisplay,
  [FIELD_TYPES.ARRAY]: ArrayFieldDisplay,
};

export function FieldDisplay(props: FieldDisplayProps) {
  const Component = DISPLAY_BY_TYPE[props.field.fieldType] ?? TextFieldDisplay;
  return <Component {...props} />;
}
