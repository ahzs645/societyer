import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Badge } from "./ui";

/** Reports the effective session broker; cloud-storage consent is a separate boundary. */
export function IdentitySessionSettingsCard() {
  const auth = useAuth();
  const signedIn = auth.mode === "better-auth" && auth.sessionStatus === "authenticated";
  const expiresAt = auth.session?.session.expiresAt;
  return <div className="card">
    <div className="card__head">
      <h2 className="card__title">Authentication &amp; session</h2>
      <Badge tone={signedIn ? "success" : "neutral"}>{auth.mode === "better-auth" ? auth.sessionStatus : "Local trust"}</Badge>
    </div>
    <div className="card__body col" style={{ gap: 12 }}>
      <div><strong>Current broker: {auth.mode === "better-auth" ? "Better Auth" : "No sign-in (trusted workspace)"}</strong></div>
      <p className="muted">{auth.mode === "better-auth"
        ? "The broker issues the app session. Backend identity verification and active workspace membership are separate checks."
        : "This workspace uses the existing local or operator-managed trust boundary. Anyone with access to this app and its local data can access the workspace."}</p>
      {auth.mode === "better-auth" && <div className="settings-list">
        <div className="settings-row"><span>App session</span><strong>{auth.sessionStatus}</strong></div>
        <div className="settings-row"><span>Backend identity verification</span><strong>{auth.convexAuthStatus}</strong></div>
        <div className="settings-row"><span>Workspace membership</span><strong>{auth.membershipStatus ?? "Not checked"}</strong></div>
        {expiresAt && <div className="settings-row"><span>Session expiry</span><time dateTime={new Date(expiresAt).toISOString()}>{new Date(expiresAt).toLocaleString()}</time></div>}
      </div>}
      <div className="notice">Microsoft Graph document permissions require separate delegated or app-only consent and resource access. A Societyer session does not establish storage consent or registry filing authority.</div>
      <p className="muted">Session duration, signing keys, issuer and audience are managed by the deployed authentication service. Changing a storage policy does not change the sign-in broker.</p>
      <details>
        <summary>Additional identity provider options</summary>
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          <div><Badge tone="neutral">Planned</Badge> Clerk broker migration</div>
          <div><Badge tone="neutral">Planned</Badge> Enterprise Microsoft Entra / Google Workspace sign-in</div>
          <div><Badge tone="neutral">Planned</Badge> SAML / OIDC federation and SCIM provisioning</div>
          <p className="muted">These require an implemented adapter and reviewed tenant, guest, claim, account-linking and dependency-upgrade behavior before activation.</p>
        </div>
      </details>
      <Link to="/app/settings/api-keys" className="btn-action" style={{ alignSelf: "flex-start" }}>Manage API access tokens</Link>
      {auth.mode === "better-auth" && !signedIn && <button className="btn" type="button" onClick={auth.retryAuthentication}>Retry identity verification</button>}
    </div>
  </div>;
}
