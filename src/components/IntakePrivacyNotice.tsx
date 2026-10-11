import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { legalCopyForOrganization } from "../lib/legalCopy";
import type { LegalEntityLike } from "../../shared/organizationDomain";

/**
 * Personal-information notice for public intake forms. A one-line summary is
 * always visible (the notice is given at the point of collection); the full
 * text — the society's own wording when it has set one in its public
 * transparency settings, otherwise the reviewed default — expands on demand.
 */
export function IntakePrivacyNotice({
  societyName,
  customNotice,
  publicSlug,
  privacyOfficerName,
  contactEmail,
  organization,
}: {
  societyName: string;
  /** Entity identity, so the default notice uses the right noun (society / corporation). */
  organization?: LegalEntityLike | null;
  customNotice?: string | null;
  publicSlug?: string;
  privacyOfficerName?: string | null;
  contactEmail?: string | null;
}) {
  const notice = legalCopyForOrganization(organization ?? { name: societyName }).intakeNotice;
  const body = customNotice?.trim() || notice.body;
  return (
    <details className="intake-notice">
      <summary>
        <ShieldCheck size={14} aria-hidden="true" />
        <span>
          <strong>{notice.title}.</strong> {societyName} uses these details only to review this request.
        </span>
        <span className="intake-notice__more">Learn more</span>
      </summary>
      <div className="intake-notice__body">
        <p>{body}</p>
        {(privacyOfficerName || contactEmail) && (
          <p>
            Questions about your information:{" "}
            {privacyOfficerName && <>{privacyOfficerName}{contactEmail ? ", " : ""}</>}
            {contactEmail && <a href={`mailto:${contactEmail}`}>{contactEmail}</a>}.
          </p>
        )}
        {publicSlug && (
          <p>
            Published privacy records appear in the <Link to={`/public/${publicSlug}`}>public center</Link>.
          </p>
        )}
      </div>
    </details>
  );
}
