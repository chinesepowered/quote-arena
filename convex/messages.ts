import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { classification } from "./schema";
import { loadJob } from "./lib/access";
import { redactEmail } from "./lib/mailUtil";

/**
 * Product-level view of every email on a job, linked to a contractor, so the
 * thread drawer can subscribe per job/contractor without scanning mailMessages.
 */

export const forJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await loadJob(ctx, jobId);
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    return rows
      .sort((a, b) => a.at - b.at)
      .map((m) => ({
        _id: m._id,
        contractorId: m.contractorId,
        direction: m.direction,
        subject: m.subject,
        text: m.extractedText || m.fullText,
        classification: m.classification,
        summary: m.summary,
        aiState: m.aiState,
        at: m.at,
      }));
  },
});

export const getInternal = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => await ctx.db.get(messageId),
});

export const mailMessage = internalQuery({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }) => {
    const m = await ctx.db.get(mailMessageId);
    if (!m) return null;
    return { ...m, fromRedacted: redactEmail(m.from) };
  },
});

/** The app inbox, for self-loop detection in the inbound handler. */
export const settings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return row ? { inboxId: row.inboxId, inboxAddress: row.inboxAddress } : null;
  },
});

/** Late routing: attach an inbound mail to a job once the case code resolved. */
export const routeMail = internalMutation({
  args: { mailMessageId: v.id("mailMessages"), targetId: v.string(), caseCode: v.string() },
  handler: async (ctx, { mailMessageId, targetId, caseCode }) => {
    await ctx.db.patch(mailMessageId, { targetId, caseCode, routed: true });
  },
});

export const record = internalMutation({
  args: {
    jobId: v.id("jobs"),
    contractorId: v.optional(v.id("contractors")),
    mailMessageId: v.optional(v.id("mailMessages")),
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    subject: v.string(),
    extractedText: v.string(),
    fullText: v.string(),
    classification: v.optional(classification),
    summary: v.optional(v.string()),
    aiState: v.optional(v.string()),
    at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("messages", { ...args, at: args.at ?? Date.now() });
  },
});

export const classify = internalMutation({
  args: {
    messageId: v.id("messages"),
    classification: v.optional(classification),
    summary: v.optional(v.string()),
    aiState: v.string(),
  },
  handler: async (ctx, { messageId, ...patch }) => {
    const m = await ctx.db.get(messageId);
    if (!m) return;
    await ctx.db.patch(messageId, patch);
    if (m.mailMessageId) {
      await ctx.db.patch(m.mailMessageId, { classification: patch.classification, summary: patch.summary });
    }
  },
});
