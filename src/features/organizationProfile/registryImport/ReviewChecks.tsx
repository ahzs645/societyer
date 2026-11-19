import { Link } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { formatDate } from "../../../lib/format";
import type { RegistryImportProposal, RegistryImportSelection, RegistryProposalSecret } from "../../../../shared/registryDocuments";
import { directorMismatches, sourceText, type DirectorRegisterRow, type DirectorMismatch } from "./importModel";

const MISMATCH_TEXT: Record<DirectorMismatch["issue"], string> = {
  not_in_register: "not in the directors register",
  residency_differs: "resident Canadian status differs from the register",
  residency_unconfirmed: "resident Canadian status not confirmed in the register",
};

/** A corporation key: masked, with "Store in Access custody". The value is read only when the import is applied. */
function SecretRow({ secret, selection, onChange, canStore, localRuntime }: {
  secret: RegistryProposalSecret;
  selection: RegistryImportSelection;
  onChange: (selection: RegistryImportSelection) => void;
  canStore: boolean;
  localRuntime: boolean;
}) {
  return (
    <li className="registry-import__field">
      <div className="registry-import__field-head">
        <KeyRound size={14} aria-hidden />
        <span className="registry-import__field-label">{secret.label}</span>
        <span className="mono" aria-label="Hidden value">{secret.masked}</span>
      </div>
      <Checkbox
        checked={Boolean(selection.selected[secret.id]) && canStore}
        disabled={!canStore}
        onChange={(checked) => onChange({ ...selection, selected: { ...selection.selected, [secret.id]: checked } })}
        label="Store in Access custody"
        hint={!canStore
          ? "Only Admins and Owners can store the corporation key."
          : localRuntime
            ? "This device records a reference only: Access custody notes that the key is on the information sheet, not the key itself."
            : "Encrypted in Access custody. Only Admins and Owners can store or reveal it."}
      />
      {secret.hasCurrent && <div className="muted registry-import__source">A key is already linked in Access custody. Storing this one replaces its value.</div>}
      <div className="muted registry-import__source">From {sourceText(secret.sources)}</div>
    </li>
  );
}

/** Corporation key, ISC, first directors and fees: shown for review; only the key can be applied. */
export function ReviewChecks({ proposal, selection, onChange, directors, directorsReadable, canStoreKey, localRuntime }: {
  proposal: RegistryImportProposal;
  selection: RegistryImportSelection;
  onChange: (selection: RegistryImportSelection) => void;
  directors: readonly DirectorRegisterRow[] | undefined;
  directorsReadable: boolean;
  canStoreKey: boolean;
  localRuntime: boolean;
}) {
  const check = proposal.directorsCheck;
  const mismatches = check && directors ? directorMismatches(check, directors) : [];
  const variances = check?.nameVariances.filter((variance) => variance.subject === "director") ?? [];
  return (
    <>
      {proposal.secrets.length > 0 && (
        <section className="registry-import__section" aria-labelledby="registry-secrets">
          <h3 className="registry-import__section-title" id="registry-secrets">Corporation key</h3>
          <ul className="registry-import__fields">
            {proposal.secrets.map((secret) => <SecretRow key={secret.id} secret={secret} selection={selection} onChange={onChange} canStore={canStoreKey} localRuntime={localRuntime} />)}
          </ul>
        </section>
      )}

      {check && (
        <section className="registry-import__section" aria-labelledby="registry-directors">
          <div className="registry-import__section-head">
            <h3 className="registry-import__section-title" id="registry-directors">First directors</h3>
            <Badge tone={check.meetsResidencyRule ? "success" : "warn"}>{check.residentCount} of {check.total} resident Canadian</Badge>
          </div>
          <p className="registry-import__note">{check.note} Directors are compared only; this import never changes the directors register.</p>
          <ul className="registry-import__plain-list">
            {check.directors.map((director) => (
              <li key={director.name}>{director.name}{director.residentCanadian === undefined ? "" : director.residentCanadian ? " · resident Canadian" : " · not resident Canadian"}</li>
            ))}
          </ul>
          {variances.map((variance) => (
            <p key={`${variance.preferred}-${variance.other}`} className="registry-import__note registry-import__note--warn">
              The filed copy uses the full legal name, “{variance.preferred}” ({variance.preferredSource.title}). {variance.otherSource.title} has “{variance.other}”.
            </p>
          ))}
          {!directorsReadable ? <p className="muted registry-import__note">You can't read the directors register, so it isn't compared.</p>
            : directors === undefined ? <p className="muted registry-import__note">Comparing with the directors register…</p>
            : mismatches.length ? (
              <div className="registry-import__note registry-import__note--warn">
                <ul className="registry-import__plain-list">
                  {mismatches.map((item) => <li key={`${item.name}-${item.issue}`}>{item.name}: {MISMATCH_TEXT[item.issue]}</li>)}
                </ul>
                <Link to="/app/directors">Review the directors register</Link>
              </div>
            ) : <p className="registry-import__note">The directors register matches.</p>}
        </section>
      )}

      {proposal.isc && (
        <section className="registry-import__section" aria-labelledby="registry-isc">
          <h3 className="registry-import__section-title" id="registry-isc">Individuals with significant control</h3>
          <p className="registry-import__note">
            {proposal.isc.count} {proposal.isc.count === 1 ? "individual" : "individuals"}: {proposal.isc.names.join(", ")}
            {proposal.isc.receivedDate ? `. Filed ${formatDate(proposal.isc.receivedDate)}.` : "."}
          </p>
          <p className="muted registry-import__note">
            Dates of birth, addresses and tax residence are not imported. Keep them in the <Link to={proposal.isc.registerPath}>significant individuals register</Link>.
          </p>
        </section>
      )}

      {proposal.fees.length > 0 && (
        <section className="registry-import__section" aria-labelledby="registry-fees">
          <h3 className="registry-import__section-title" id="registry-fees">Fees paid</h3>
          <ul className="registry-import__plain-list">
            {proposal.fees.map((fee, index) => (
              <li key={`${fee.transactionId ?? fee.invoiceNumber ?? fee.reference ?? index}`}>
                {fee.payee}: ${fee.amount} {fee.currency}{fee.date ? ` on ${formatDate(fee.date)}` : ""}<span className="muted"> · {fee.description}</span>
              </li>
            ))}
          </ul>
          <p className="muted registry-import__note">For your records only. The import doesn't add them to the books.</p>
        </section>
      )}
    </>
  );
}
