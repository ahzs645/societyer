import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Badge } from "./ui";

/** Reports the effective session broker; cloud-storage consent is a separate boundary. */
export function IdentitySessionSettingsCard() {
  const auth = useAuth();
  const signedIn = auth.mode !== "none" && auth.sessionStatus === "authenticated";
  const brokerName = auth.mode === "clerk" ? "Clerk" : auth.mode === "better-auth" ? "Better Auth" : "No sign-in (trusted workspace)";
  return <div className="card">
    <div className="card__head">
      <h2 className="card__title">Authentication &amp; session</h2>
      <Badge tone={signedIn ? "success" : "neutral"}>{auth.mode !== "none" ? auth.sessionStatus : "Local trust"}</Badge>
    </div>
    <div className="card__body col" style={{ gap: 12 }}>
      <div><strong>Current broker: {brokerName}</strong></div>
      <p className="muted">{auth.mode !== "none"
        ? "The broker issues the app session. Backend identity verification and active workspace membership are separate checks."
        : "This workspace uses the existing local or operator-managed trust boundary. Anyone with access to this app and its local data can access the workspace."}</p>
      {auth.mode !== "none" && <div className="settings-list">
        <div className="settings-row"><span>App session</span><strong>{auth.sessionStatus}</strong></div>
        <div className="settings-row"><span>Backend identity verification</span><strong>{auth.convexAuthStatus}</strong></div>
        <div className="settings-row"><span>Workspace membership</span><strong>{auth.membershipStatus ?? "Not checked"}</strong></div>

      </div>}
      <div className="notice">Microsoft Graph document permissions require separate delegated or app-only consent and resource access. A Societyer session does not establish storage consent or registry filing authority.</div>
      <p className="muted">Session duration, signing keys, issuer and audience are managed by the deployed authentication service. Changing a storage policy does not change the sign-in broker.</p>
      {auth.mode === "clerk" && <p className="muted">Manage your account profile from the Clerk account menu. Better Auth serves only as the gateway machine signer in this mode; it does not create a second user session.</p>}
      <details>
        <summary>Additional identity provider options</summary>
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          <div><Badge tone="neutral">Review required</Badge> Clerk migration: immutable account mapping and provider linking policy evidence</div>
          <div><Badge tone="neutral">Available in Better Auth mode</Badge> Tenant-restricted Microsoft Entra sign-in, configured by the operator</div>
          <div><Badge tone="neutral">Planned</Badge> SAML / OIDC federation and SCIM provisioning</div>
          <p className="muted">Tenant membership, guests, session-level enterprise restrictions, MFA, account linking and directory lifecycle require reviewed deployment evidence. An optional Microsoft button does not enforce SSO for a workspace.</p>
        </div>
      </details>
      <Link to="/app/settings/api-keys" className="btn-action" style={{ alignSelf: "flex-start" }}>Manage API access tokens</Link>
      {auth.mode !== "none" && !signedIn && <button className="btn" type="button" onClick={auth.retryAuthentication}>Retry identity verification</button>}
    </div>
  </div>;
}
