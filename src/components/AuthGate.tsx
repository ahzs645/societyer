import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.mode === "better-auth" && auth.isPending) {
    return <div className="page">Authorizing…</div>;
  }

  if (auth.mode === "better-auth" && !auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
