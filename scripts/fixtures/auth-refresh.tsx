/** Local-only React regression fixture. Fake client, synthetic memberships, no network or credentials. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { AuthenticatedProviderReady, useAuth } from "../../src/auth/AuthProvider";
let lookups = 0, mounts = 0;
const society = { _id: "fixture-workspace", name: "Synthetic workspace", isCharity: false, isMemberFunded: false, updatedAt: 0 };
const client = {
  setAuth: (_fetch: unknown, report: (ready: boolean) => void) => { queueMicrotask(() => report(true)); },
  clearAuth: () => {},
  query: async () => { lookups++; return { status: "bound", memberships: [{ society, userId: "fixture-user", role: "Owner", user: { _id: "fixture-user", societyId: society._id, displayName: "Synthetic", role: "Owner", status: "Active" } }] }; },
};
const token = async () => "synthetic-test-token";
function Content() { useEffect(() => { mounts++; }, []); return <p>Workspace is mounted</p>; }
function Probe() {
  const auth = useAuth();
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(timer); }, []);
  return <><p>Authenticated: {String(auth.isAuthenticated)}</p><p>Membership queries: {lookups}</p><p>Workspace mounts: {mounts}</p><p>Session: {auth.sessionStatus}</p>{auth.isAuthenticated && <Content />}</>;
}
function Harness() {
  const [session, setSession] = useState<any>({ user: { id: "account", name: "Synthetic", email: "synthetic@example.invalid" }, session: { id: "session-a" } });
  const [pending, setPending] = useState(false);
  return <><h1>Auth refresh regression fixture</h1><button onClick={() => { setPending(true); setSession((old: any) => ({ ...old, user: { ...old.user }, session: { ...old.session } })); }}>Refresh same session</button><button onClick={() => setPending(false)}>Finish refresh</button><button onClick={() => { setPending(false); setSession(null); }}>End session</button>
    <ConvexProvider client={client as any}><AuthenticatedProviderReady mode="convex" session={session} sessionPending={pending} getToken={token} providerSignOut={async () => setSession(null)}><Probe /></AuthenticatedProviderReady></ConvexProvider>
  </>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
