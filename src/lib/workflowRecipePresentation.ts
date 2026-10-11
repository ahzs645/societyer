import type { LegalEntityLike } from "../../shared/organizationDomain";
import { organizationVocabulary } from "./organizationVocabulary";

/**
 * Workflow recipe wording by entity.
 *
 * The recipe catalog (convex/workflowRecipeData.ts, served by
 * `workflows:listCatalog` on every runtime) was written for BC societies: "AGM
 * prep", "Create society profile", a Societies Online filing bot. This adapts
 * the labels at render time so a corporation sees annual-meeting wording, and
 * hides recipes that only work under the BC Societies Act. Recipe keys and
 * stored workflows are unchanged.
 */

/** Recipes that run a Societies Act process (Societies Online annual report). */
const BC_SOCIETY_ONLY_RECIPES = new Set(["annual_report_filing"]);

type CatalogRecipe = { key: string; label?: string; description?: string; steps?: string[]; [key: string]: unknown };

/** True when the recipe can be offered to this organization. */
export function recipeAppliesToOrganization(recipeKey: string, organization?: LegalEntityLike | null): boolean {
  if (!BC_SOCIETY_ONLY_RECIPES.has(recipeKey)) return true;
  return organizationVocabulary(organization).societyLaw;
}

function replaceAgm(text: string, annualMeeting: string): string {
  const title = `${annualMeeting.charAt(0).toUpperCase()}${annualMeeting.slice(1)}`;
  return text
    .replace(/^AGM\b/, title)
    .replace(/\bAGM prep\b/g, `${title} prep`)
    .replace(/\ban AGM\b/g, `an ${annualMeeting}`)
    .replace(/\bAGM\b/g, annualMeeting);
}

/** Label, description and step names worded for this organization. */
export function presentRecipe<T extends CatalogRecipe>(recipe: T, organization?: LegalEntityLike | null): T {
  const vocab = organizationVocabulary(organization);
  if (vocab.isSociety) return recipe;
  const meeting = vocab.annualMeeting;
  const steps = recipe.steps?.map((step) =>
    replaceAgm(step, meeting)
      .replace("Create society profile", `Create ${vocab.organizationNoun} profile`)
      .replace("Optionally verify BC Registry access", vocab.bcHome ? "Optionally verify BC Registry access" : "Optionally verify registry access")
      .replace("Collect active members and director roster", vocab.isCorporation ? "Collect shareholder and director rosters" : "Collect member and director rosters")
      .replace("Draft agenda from bylaw-required items", `Draft agenda from items the ${vocab.governingDocuments} require`),
  );
  return {
    ...recipe,
    ...(recipe.label ? { label: replaceAgm(recipe.label, meeting) } : {}),
    ...(recipe.description
      ? { description: replaceAgm(recipe.description, meeting).replace("Starts a new society workspace", "Starts a new workspace") }
      : {}),
    ...(steps ? { steps } : {}),
  };
}

/** The catalog an organization can create workflows from, worded for it. */
export function catalogForOrganization<T extends CatalogRecipe>(catalog: readonly T[] | undefined, organization?: LegalEntityLike | null): T[] | undefined {
  if (!catalog) return catalog;
  return catalog
    .filter((recipe) => recipeAppliesToOrganization(recipe.key, organization))
    .map((recipe) => presentRecipe(recipe, organization));
}
