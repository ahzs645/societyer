import { lazy, Suspense } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

const ClerkAccountButton = lazy(() => import("./ClerkAccountButton"));

export function WorkspaceMfaActions() {
  const auth = useAuth();
  const navigate = useNavigate();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {auth.mode === "clerk"
        ? <Suspense fallback={null}><ClerkAccountButton securityAction /></Suspense>
        : <Link className="btn" to="/account/security">Manage account security</Link>}
      <button className="btn" type="button" onClick={async () => {
        await auth.signOut();
        navigate("/login", { replace: true });
      }}>Sign in again</button>
    </div>
  );
}
