import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field, LockedField } from "../../components/ui";
import { usePermissions } from "../../hooks/usePermissions";
import { validateArticlesProvisions } from "../../../shared/entitySetup";
import { isPreparingIncorporation } from "../../../shared/organizationDomain";
import { DocumentSelect } from "./DocumentSelect";
import { shareClassLabel, type RightsClassRow } from "./OverviewRegisters";
import { hasText } from "./detailRows";
import type { OrganizationRecord, ProfileDocument, ProfileForm, SetProfileField } from "./types";

const AMENDMENT_REASON = "The articles change only by special resolution and articles of amendment filed with the registry. Edit only to fix a data-entry error.";

/** The director limits' validation message, or undefined when they are fine. */
export function articlesError(form: Pick<ProfileForm, "articlesMinDirectors" | "articlesMaxDirectors">): string | undefined {
  try {
    validateArticlesProvisions(form);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function numberValue(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Articles as filed (federal Form 1 or the BC equivalent): director limits,
 * share transfer and business restrictions, other provisions and the source
 * document. Authorized shares come from the rights ledger. Once incorporated,
 * a recorded value is locked: amending articles is a filing, not an edit.
 */
export function ArticlesCard({ society, form, set, documents }: {
  society: OrganizationRecord;
  form: ProfileForm;
  set: SetProfileField;
  documents: readonly ProfileDocument[];
}) {
  const savedPreparing = isPreparingIncorporation(society);
  const lockWhenSet = (value: unknown) => !savedPreparing && hasText(value);
  const error = articlesError(form);
  const { loaded, can } = usePermissions();
  const ledger = useQuery(api.legalOperations.rightsLedger, loaded && can("documents:read") ? { societyId: society._id } : "skip") as { classes?: RightsClassRow[] } | undefined;
  const classes = ledger?.classes?.filter((row) => row.status !== "inactive");
  const textArea = (key: "articlesShareTransferRestrictions" | "articlesBusinessRestrictions" | "articlesOtherProvisions", label: string, placeholder: string) => (
    <LockedField label={label} requireUnlock={lockWhenSet(society[key])} reason={AMENDMENT_REASON}>
      {(locked) => <textarea className="input" rows={3} disabled={locked} value={form[key] ?? ""} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} />}
    </LockedField>
  );
  return (
    <section className="card" id="articles" aria-labelledby="org-articles">
      <div className="card__head">
        <h2 className="card__title" id="org-articles">Articles</h2>
        <span className="muted org-profile-card-sub">As filed with the registry</span>
      </div>
      <div className="card__body">
        <div className="society-field-grid society-field-grid--mobile-pair">
          <LockedField label="Minimum directors" requireUnlock={lockWhenSet(society.articlesMinDirectors)} reason={AMENDMENT_REASON}>
            {(locked) => <input className="input" type="number" inputMode="numeric" min={1} step={1} disabled={locked} value={form.articlesMinDirectors ?? ""} onChange={(event) => set("articlesMinDirectors", numberValue(event.target.value))} />}
          </LockedField>
          <LockedField label="Maximum directors" requireUnlock={lockWhenSet(society.articlesMaxDirectors)} reason={AMENDMENT_REASON}>
            {(locked) => <input className="input" type="number" inputMode="numeric" min={1} step={1} disabled={locked} value={form.articlesMaxDirectors ?? ""} onChange={(event) => set("articlesMaxDirectors", numberValue(event.target.value))} />}
          </LockedField>
        </div>
        {error && <p className="field__error org-profile-field-error" role="alert">{error}</p>}
        <Field label="Authorized shares" hint="From the rights ledger, where share classes are set up.">
          <div className="org-profile-readonly">
            {classes === undefined
              ? <span className="muted">{ledger === undefined && loaded && can("documents:read") ? "Loading…" : "Not available"}</span>
              : classes.length ? classes.map(shareClassLabel).join("; ") : <span className="muted">No share classes set up</span>}
            {" · "}<Link to="/app/rights-ledger">Edit in the rights ledger</Link>
          </div>
        </Field>
        {textArea("articlesShareTransferRestrictions", "Share transfer restrictions", "None, or the restriction as written")}
        {textArea("articlesBusinessRestrictions", "Restrictions on the business", "None, or the restriction as written")}
        {textArea("articlesOtherProvisions", "Other provisions", "Other provisions, as written")}
        <LockedField label="Source document" requireUnlock={lockWhenSet(society.articlesSourceDocumentId)} reason={AMENDMENT_REASON} hint="The filed articles, or the certificate package that holds them.">
          {(locked) => (
            <DocumentSelect
              value={form.articlesSourceDocumentId}
              onChange={(value) => set("articlesSourceDocumentId", value)}
              documents={documents}
              preferredCategories={["ArticlesOfIncorporation", "CertificateOfIncorporation", "Filing"]}
              placeholder="Choose the filed articles"
              disabled={locked}
            />
          )}
        </LockedField>
      </div>
    </section>
  );
}
