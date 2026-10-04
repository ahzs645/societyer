import { SignIn, SignUp } from "@clerk/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export default function ClerkLogin({ redirect }: { redirect: string }) {
  const [params] = useSearchParams();
  const mode = params.get("mode");
  const [signUp, setSignUp] = useState(mode === "sign-up");
  useEffect(() => setSignUp(mode === "sign-up"), [mode]);
  const loginUrl = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}login`;
  const redirectUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${redirect}`;
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 16 }}>
      {signUp ? (
        <SignUp routing="hash" signInUrl={`${loginUrl}?redirect=${encodeURIComponent(redirect)}`} forceRedirectUrl={redirectUrl} />
      ) : (
        <SignIn routing="hash" signUpUrl={`${loginUrl}?mode=sign-up&redirect=${encodeURIComponent(redirect)}`} forceRedirectUrl={redirectUrl} />
      )}
      <button className="landing__btn landing__btn--ghost" type="button" onClick={() => setSignUp((value) => !value)}>
        {signUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
      </button>
    </div>
  );
}
