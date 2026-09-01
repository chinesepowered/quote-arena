import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { loadEditableJob, loadJob } from "./lib/access";

/**
 * Clarifying questions contractors ask ("Is the ground level?"). The AI drafts
 * an answer from the job facts only; the homeowner approves it (or autoReply
 * sends it straight away).
 */

export const forJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await loadJob(ctx, jobId);
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    const out = await Promise.all(
      rows.map(async (q) => ({
        ...q,
        contractorName: (await ctx.db.get(q.contractorId))?.name ?? "Unknown",
      })),
    );
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const pendingCount = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await loadJob(ctx, jobId);
    const rows = await ctx.db
      .query("questions")
      .withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "pending_approval"))
      .collect();
    return rows.length;
  },
});

/** Approve (optionally edited) and send the answer as a reply in the thread. */
export const approve = mutation({
  args: { questionId: v.id("questions"), answer: v.optional(v.string()) },
  handler: async (ctx, { questionId, answer }) => {
    const q = await ctx.db.get(questionId);
    if (!q) throw new Error("Not found");
    await loadEditableJob(ctx, q.jobId);
    if (q.status !== "pending_approval") return;
    const finalAnswer = (answer ?? q.proposedAnswer).trim();
    if (!finalAnswer) throw new Error("Answer is empty");
    await ctx.db.patch(questionId, { proposedAnswer: finalAnswer });
    await ctx.scheduler.runAfter(0, internal.rfq.sendAnswer, { questionId });
  },
});

export const dismiss = mutation({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get(questionId);
    if (!q) return;
    await loadEditableJob(ctx, q.jobId);
    await ctx.db.patch(questionId, { status: "dismissed" });
  },
});

export const create = internalMutation({
  args: {
    jobId: v.id("jobs"),
    contractorId: v.id("contractors"),
    messageId: v.id("messages"),
    question: v.string(),
    proposedAnswer: v.string(),
    grounded: v.boolean(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("questions", { ...args, status: "pending_approval", createdAt: Date.now() });
  },
});

export const getInternal = internalQuery({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => await ctx.db.get(questionId),
});

export const markSent = internalMutation({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    await ctx.db.patch(questionId, { status: "sent", sentAt: Date.now() });
  },
});
