import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertDevelopmentMail } from "../shared/developmentMailConfiguration";
import { allowedAuthEmailDomains, authEmailAllowed } from "../shared/authEmailPolicy";

export const capture = internalMutation({
  args: { to: v.string(), subject: v.string(), text: v.string(), tag: v.union(v.literal("auth-verify-email"), v.literal("auth-reset-password")) },
  returns: v.id("developmentAuthEmails"),
  handler: async (ctx, args) => {
    assertDevelopmentMail(process.env);
    if (!authEmailAllowed(args.to, allowedAuthEmailDomains(process.env))) throw new Error("Test mail recipient is outside the configured email domain.");
    if (args.text.length > 16_000 || args.subject.length > 256) throw new Error("Development mail is too large.");
    const createdAtMs = Date.now();
    const id = await ctx.db.insert("developmentAuthEmails", { ...args, createdAtMs, expiresAtMs: createdAtMs + 3600_000 });
    await ctx.scheduler.runAfter(3600_000, internal.developmentMail.expire, { id });
    return id;
  },
});

export const inbox = internalQuery({
  args: { nowMs: v.number() },
  returns: v.array(v.object({ id: v.id("developmentAuthEmails"), to: v.string(), subject: v.string(), text: v.string(), createdAtMs: v.number(), expiresAtMs: v.number() })),
  handler: async (ctx, { nowMs }) => {
    assertDevelopmentMail(process.env);
    const messages = await ctx.db.query("developmentAuthEmails").withIndex("by_createdAtMs").order("desc").take(30);
    return messages.filter(mail => mail.expiresAtMs > nowMs).map(({ _id, to, subject, text, createdAtMs, expiresAtMs }) => ({ id: _id, to, subject, text, createdAtMs, expiresAtMs }));
  },
});

export const expire = internalMutation({
  args: { id: v.id("developmentAuthEmails") }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const mail = await ctx.db.get(id);
    if (mail && mail.expiresAtMs <= Date.now()) await ctx.db.delete(id);
    return null;
  },
});
