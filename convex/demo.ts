import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { loadEditableJob } from "./lib/access";

/**
 * "Reply as a contractor" without a phone: pushes a synthetic inbound email
 * through exactly the same path a real AgentMail webhook uses
 * (mail.ingest → inbound.onInbound → quote/question rows), so the live
 * leaderboard reorder can be shown even before the webhook is wired up.
 */
export const simulateReply = mutation({
  args: { jobId: v.id("jobs"), contractorId: v.id("contractors"), text: v.string() },
  handler: async (ctx, { jobId, contractorId, text }) => {
    const { job } = await loadEditableJob(ctx, jobId);
    const c = await ctx.db.get(contractorId);
    if (!c || c.jobId !== job._id) throw new Error("Contractor not on this job");
    const from = c.email ?? `${c.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`;
    const stamp = Date.now();
    const messageId = `sim-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
    await ctx.runMutation(internal.mail.ingest, {
      messageId,
      threadId: c.sentThreadId ?? `sim-thread-${c._id}`,
      from: `${c.name} <${from}>`,
      to: [],
      subject: `Re: [${job.caseCode}] Quote request: ${job.title} in ${job.city}`,
      extractedText: text,
      fullText: text,
      receivedAt: stamp,
    });
    if (!c.sentThreadId) await ctx.db.patch(c._id, { sentThreadId: `sim-thread-${c._id}` });
    return messageId;
  },
});
