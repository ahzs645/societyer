/** Which sign-in options /login offers. Pure, so the Microsoft-only rules stay testable. */

const LINK_PATHS = new Set(["/account/link", "/account/link/confirm"]);

/** "Link an existing account": the second login (`?linkAccount=1`) or the fresh re-sign-in of the first. */
export function isAccountLinkSignIn(linkAccountParam: string | null, safeRedirect: string): boolean {
  if (linkAccountParam === "1") return true;
  try {
    return LINK_PATHS.has(new URL(safeRedirect, "https://societyer.invalid").pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

export type SignInOptions = {
  /** Microsoft is the expected way in: sign-in mode only, no sign-up/reset switch. */
  microsoftRequired: boolean;
  /** The email and password form is shown. */
  password: boolean;
  /** The form is shown only so a password login can be linked on a Microsoft-only domain. */
  passwordForLinking: boolean;
};

export function signInOptions(input: {
  domainRequiresMicrosoft: boolean;
  /** `authCapabilities.microsoft.required`; undefined while capabilities load. Absent `microsoft` means false. */
  deploymentRequiresMicrosoft: boolean | undefined;
  linking: boolean;
}): SignInOptions {
  const microsoftRequired = input.deploymentRequiresMicrosoft === true || input.domainRequiresMicrosoft;
  // A deployment that requires Microsoft refuses /sign-in/email outright, so
  // the form is offered only once capabilities say password sign-in works.
  const passwordForLinking = input.domainRequiresMicrosoft && input.linking && input.deploymentRequiresMicrosoft === false;
  return { microsoftRequired, password: !microsoftRequired || passwordForLinking, passwordForLinking };
}
