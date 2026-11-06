import { UserButton, useClerk } from "@clerk/react";

export default function ClerkAccountButton({ securityAction = false }: { securityAction?: boolean }) {
  const clerk = useClerk();
  return securityAction
    ? <button className="btn" type="button" onClick={() => clerk.openUserProfile()}>Manage account security</button>
    : <UserButton showName />;
}
