/** Private, short-lived delivery outbox. Auth links never enter public application queries or logs. */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendEmail } from "./providers/email";

export const enqueue = internalMutation({
  args: { to: v.string(), subject: v.string(), text: v.string(), html: v.string(), tag: v.string() }, returns: v.id("authEmailOutbox"),
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("authEmailOutbox", { ...args, status: "queued", attempts: 0, createdAtMs: Date.now(), expiresAtMs: Date.now() + 60 * 60_000 });
    await ctx.scheduler.runAfter(0, internal.authEmails.deliver, { id });
    await ctx.scheduler.runAfter(60 * 60_000, internal.authEmails.expire, { id });
    return id;
  },
});

export const claim = internalMutation({
  args: { id: v.id("authEmailOutbox") }, returns: v.any(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "queued") return null;
    if (row.expiresAtMs <= Date.now()) { await ctx.db.patch(id, { status: "failed", text: undefined, html: undefined, error: "Link expired before email acceptance." }); return null; }
    const attempt = row.attempts + 1;
    await ctx.db.patch(id, { status: "sending", attempts: attempt, sendingAtMs: Date.now() });
    await ctx.scheduler.runAfter(180_000, internal.authEmails.recover, { id, attempt });
    return { ...row, attempts: attempt };
  },
});

export const finish = internalMutation({
  args: { id: v.id("authEmailOutbox"), attempt: v.number(), accepted: v.boolean(), provider: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, { id, attempt, accepted, provider }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "sending" || row.attempts !== attempt) return null;
    if (accepted) await ctx.db.patch(id, { status: "accepted", provider, acceptedAtMs: Date.now(), text: undefined, html: undefined });
    else if (row.attempts < 3 && row.expiresAtMs > Date.now()) {
      await ctx.db.patch(id, { status: "queued", sendingAtMs: undefined });
      await ctx.scheduler.runAfter(row.attempts * 30_000, internal.authEmails.deliver, { id });
    } else await ctx.db.patch(id, { status: "failed", text: undefined, html: undefined, error: "Email provider did not confirm acceptance." });
    return null;
  },
});

export const deliver = internalAction({
  args: { id: v.id("authEmailOutbox") }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.runMutation(internal.authEmails.claim, args);
    if (!row) return null;
    try {
      const sent = await sendEmail({ to: row.to, subject: row.subject, text: row.text, html: row.html, tag: row.tag });
      await ctx.runMutation(internal.authEmails.finish, { ...args, attempt: row.attempts, accepted: true, provider: sent.provider });
    } catch { await ctx.runMutation(internal.authEmails.finish, { ...args, attempt: row.attempts, accepted: false }); }
    return null;
  },
});

export const expire = internalMutation({
  args: { id: v.id("authEmailOutbox") }, returns: v.null(),
  handler: async (ctx, { id }) => { const row = await ctx.db.get(id); if (row && row.expiresAtMs <= Date.now()) await ctx.db.delete(id); return null; },
});

/** A terminated action cannot strand a verification email in "sending". */
export const recover = internalMutation({
  args: { id: v.id("authEmailOutbox"), attempt: v.number() }, returns: v.null(),
  handler: async (ctx, { id, attempt }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "sending" || row.attempts !== attempt) return null;
    if (row.attempts >= 3 || row.expiresAtMs <= Date.now()) {
      await ctx.db.patch(id, { status: "failed", text: undefined, html: undefined, error: "Email delivery timed out." });
    } else {
      await ctx.db.patch(id, { status: "queued", sendingAtMs: undefined });
      await ctx.scheduler.runAfter(0, internal.authEmails.deliver, { id });
    }
    return null;
  },
});

/** Operator diagnostic: delivery metadata only, never verification/reset links. */
export const recentStatus = internalQuery({
  args: { to: v.string() },
  returns: v.array(v.object({ id: v.id("authEmailOutbox"), status: v.string(), attempts: v.number(), createdAtMs: v.number(), acceptedAtMs: v.optional(v.number()), provider: v.optional(v.string()), error: v.optional(v.string()) })),
  handler: async (ctx, { to }) => (await ctx.db.query("authEmailOutbox").withIndex("by_recipient_createdAtMs", q => q.eq("to", to.trim().toLowerCase())).order("desc").take(20)).map(row => ({ id: row._id, status: row.status, attempts: row.attempts, createdAtMs: row.createdAtMs, ...(row.acceptedAtMs === undefined ? {} : { acceptedAtMs: row.acceptedAtMs }), ...(row.provider ? { provider: row.provider } : {}), ...(row.error ? { error: row.error } : {}) })),
});
