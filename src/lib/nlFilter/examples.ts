import { FIELD_TYPES } from "../../platform/record-engine/types";
import type { NlContext, NlField } from "./types";
import { defaultAmountField, defaultDateField, isOptionField } from "./fields";

/**
 * Three or four example prompts built from the table's own columns
 * ("Amount over $1,000", "Date this fiscal year", "Status is Active").
 * Every example parses cleanly (scripts/check-nl-filter.ts holds them to it).
 */
export function exampleQueries(fields: NlField[], context: Pick<NlContext, "fiscalYearEnd">, limit = 4): string[] {
  const examples: string[] = [];
  const amount = defaultAmountField(fields);
  if (amount) examples.push(`${amount.label} over $1,000`);
  const date = defaultDateField(fields);
  if (date) {
    if (/due|deadline/i.test(`${date.name} ${date.label}`)) examples.push(`${date.label} this month`);
    else if (context.fiscalYearEnd) examples.push(`${date.label} this fiscal year`);
    else examples.push(`${date.label} last 30 days`);
  }
  const selects = fields.filter((field) => field.type === FIELD_TYPES.SELECT && isOptionField(field));
  const status = selects.find((field) => /status|state|stage/i.test(`${field.name} ${field.label}`)) ?? selects[0];
  if (status) examples.push(`${status.label} is ${status.options![0].label.replace(/\s*\(.*?\)\s*/g, "")}`);
  const second = selects.find((field) => field !== status && field.isVisible !== false);
  if (second && examples.length < limit) examples.push(`${second.options![second.options!.length - 1].label.replace(/\s*\(.*?\)\s*/g, "")} ${second.label.toLowerCase()}`);
  const boolean = fields.find((field) => field.type === FIELD_TYPES.BOOLEAN && field.isVisible !== false);
  if (boolean && examples.length < limit) examples.push(`Not ${boolean.label.toLowerCase()}`);
  const emptyable = fields.find((field) => field.type === FIELD_TYPES.TEXT && /categor|assignee|owner|notes|email/i.test(`${field.name} ${field.label}`));
  if (emptyable && examples.length < limit) examples.push(`Without ${emptyable.label.toLowerCase()}`);
  if (amount && date && examples.length < limit) examples.push(`${amount.label} between $500 and $2,000 last month`);
  return examples.slice(0, limit);
}
