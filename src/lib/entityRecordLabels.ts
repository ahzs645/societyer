import { hasApplicablePrivacyLaw } from "../../shared/privacyRuleProfiles";
/**
 * Entity-aware record-table labels, applied at render time.
 *
 * Record-table object and field labels are stored metadata
 * (convex/recordTableMetadataDefinitions.ts) seeded once per workspace with
 * BC society wording: "Member proposals", "Membership / right class",
 * "PIPA training", "AGM". The stored rows are not rewritten; instead the
 * record-table hook passes the hydrated metadata through
 * `applyEntityRecordLabels`, which swaps a label only while it still equals the
 * seeded default, so a label someone renamed is left alone. Empty states such
 * as "No member proposals yet" derive from the object label and follow it.
 */
import type { LegalEntityLike } from "../../shared/organizationDomain";
import { organizationVocabulary, type OrganizationVocabulary } from "./organizationVocabulary";

type Relabel = { from: string; to: string };
type ObjectRule = {
  singular?: Relabel;
  plural?: Relabel;
  /** Field name → label relabel. */
  fields?: Record<string, Relabel>;
  /** Field name → option value → option label relabel. */
  options?: Record<string, Record<string, Relabel>>;
};

function rulesFor(vocab: OrganizationVocabulary, organization?: LegalEntityLike | null): Record<string, ObjectRule> {
  const rules: Record<string, ObjectRule> = {};
  const add = (name: string, rule: ObjectRule) => {
    const current = rules[name] ?? {};
    rules[name] = {
      ...current,
      ...rule,
      fields: { ...current.fields, ...rule.fields },
      options: { ...current.options, ...rule.options },
    };
  };
  if (!vocab.isSociety) {
    const meetingTypeOptions = {
      AGM: { from: "AGM", to: vocab.annualMeetingTitle },
      SGM: { from: "SGM", to: "Special meeting" },
    };
    add("meeting", { options: { type: meetingTypeOptions } });
    add("meetingTemplate", { options: { meetingType: meetingTypeOptions } });
    add("roleHolder", {
      options: { directorTerm: { until_the_next_annual_general_meeting: { from: "Until the next AGM", to: `Until the next ${vocab.annualMeeting}` } } },
    });
  }
  if (vocab.isCorporation) {
    add("memberProposal", {
      singular: { from: "Member proposal", to: "Shareholder proposal" },
      plural: { from: "Member proposals", to: "Shareholder proposals" },
    });
    add("roleHolder", { fields: { membershipClassName: { from: "Membership / right class", to: "Share / right class" } } });
  }
  // Only assessed BC PIPA handling gets a BC-law label.
  if (!hasApplicablePrivacyLaw(organization, "bc_pipa")) {
    add("pipaTraining", {
      singular: { from: "PIPA training record", to: "Privacy training record" },
      plural: { from: "PIPA training", to: "Privacy training" },
    });
  }
  return rules;
}

function relabel(value: string, rule?: Relabel): string {
  return rule && value === rule.from ? rule.to : value;
}

type FieldLike = { name: string; label: string; config?: Record<string, any> };

function relabelField<F extends FieldLike>(field: F, rule: ObjectRule): F {
  const fieldRule = rule.fields?.[field.name];
  const optionRules = rule.options?.[field.name];
  if (!fieldRule && !optionRules) return field;
  const options = Array.isArray(field.config?.options) && optionRules
    ? field.config!.options.map((option: any) => {
        const optionRule = optionRules[String(option?.value)];
        return optionRule && option?.label === optionRule.from ? { ...option, label: optionRule.to } : option;
      })
    : undefined;
  return {
    ...field,
    label: relabel(field.label, fieldRule),
    ...(options ? { config: { ...field.config, options } } : {}),
  };
}

type ObjectLike<F extends FieldLike> = { nameSingular: string; labelSingular: string; labelPlural: string; fields: F[] };
type ViewLike<F extends FieldLike> = { columns: Array<{ field: F }> };

/** Object metadata with labels worded for this organization. */
export function applyEntityObjectLabels<F extends FieldLike, O extends ObjectLike<F>>(
  objectMetadata: O | null,
  organization?: LegalEntityLike | null,
): O | null {
  if (!objectMetadata || !organization) return objectMetadata;
  const rule = rulesFor(organizationVocabulary(organization), organization)[objectMetadata.nameSingular];
  if (!rule) return objectMetadata;
  return {
    ...objectMetadata,
    labelSingular: relabel(objectMetadata.labelSingular, rule.singular),
    labelPlural: relabel(objectMetadata.labelPlural, rule.plural),
    fields: objectMetadata.fields.map((field) => relabelField(field, rule)),
  };
}

/** View columns (which carry their own field copies) worded for this organization. */
export function applyEntityViewLabels<F extends FieldLike, V extends ViewLike<F>>(
  nameSingular: string,
  view: V | null,
  organization?: LegalEntityLike | null,
): V | null {
  if (!view || !organization) return view;
  const rule = rulesFor(organizationVocabulary(organization), organization)[nameSingular];
  if (!rule) return view;
  return { ...view, columns: view.columns.map((column) => ({ ...column, field: relabelField(column.field, rule) })) };
}
