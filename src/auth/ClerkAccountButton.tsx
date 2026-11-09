import { useEffect } from "react";
import { UserButton, useClerk } from "@clerk/react";

export default function ClerkAccountButton({ securityAction = false }: { securityAction?: boolean }) {
  const clerk = useClerk();
  return securityAction
    ? <button className="btn" type="button" onClick={() => clerk.openUserProfile()}>Manage account security</button>
    : <UserButton showName />;
}

/**
 * Hands Clerk's profile dialog to a caller outside the Clerk chunk (the
 * sidebar account menu), which can't call `useClerk` itself.
 */
export function ClerkProfileOpener({ onReady }: { onReady: (open: (() => void) | null) => void }) {
  const clerk = useClerk();
  useEffect(() => {
    onReady(() => clerk.openUserProfile());
    return () => onReady(null);
  }, [clerk, onReady]);
  return null;
}
