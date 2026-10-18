import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { sendEmail } from "./providers/email";
import { allowedAuthEmailDomains, authEmailAllowed } from "../shared/authEmailPolicy";

/** Deployment-operator probe. No public arbitrary-email endpoint is exposed. */
export const sendTest = internalAction({
  args: { to: v.string() },
  returns: v.object({ provider: v.string(), accepted: v.boolean(), id: v.string() }),
  handler: async (_ctx, { to }) => {
    if (!authEmailAllowed(to, allowedAuthEmailDomains(process.env))) throw new Error("Test recipient must satisfy this deployment's email-domain policy.");
    const sent = await sendEmail({
      to,
      subject: "Societyer email delivery test",
      text: "This is the requested Societyer email delivery test. It does not create an account or verify your address. Account verification will arrive separately when you sign up.",
      tag: "operator-delivery-test",
    });
    return { provider: sent.provider, accepted: sent.accepted, id: sent.id };
  },
});
