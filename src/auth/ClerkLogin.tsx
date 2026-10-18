import { SignIn, SignUp } from "@clerk/react";
import { useSearchParams } from "react-router-dom";

export default function ClerkLogin({ redirect }: { redirect: string }) {
  // `?mode=sign-up` is the one source of truth, so this switch and the links
  // inside Clerk's own widget (which go to signInUrl / signUpUrl) agree.
  const [params, setParams] = useSearchParams();
  const signUp = params.get("mode") === "sign-up";
  const loginUrl = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}login`;
  const redirectUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}${redirect}`;
  const switchMode = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (signUp) next.delete("mode");
      else next.set("mode", "sign-up");
      return next;
    }, { replace: true });
  return (
    <div className="auth__clerk">
      {signUp ? (
        <SignUp routing="hash" signInUrl={`${loginUrl}?redirect=${encodeURIComponent(redirect)}`} forceRedirectUrl={redirectUrl} />
      ) : (
        <SignIn routing="hash" signUpUrl={`${loginUrl}?mode=sign-up&redirect=${encodeURIComponent(redirect)}`} forceRedirectUrl={redirectUrl} />
      )}
      <p className="auth__after">
        {signUp ? "Already have an account?" : "New here?"}{" "}
        <button className="auth__link" type="button" onClick={switchMode}>
          {signUp ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}
