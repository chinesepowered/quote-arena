"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE, rateLimiter } from "./lib/limits";
import { aiDraft, templateRfq } from "./lib/quoteAi";
import { APP_NAME } from "./lib/app";

/**
 * Outbound email for a job: the RFQ blast, answers to contractor questions,
 * the 48h nudge, and the courtesy note when a winner is picked. Every send goes
 * through internal.mailActions.send, which applies DEMO_RECIPIENT_OVERRIDE,
 * records the message for thread routing and meters usage.
 *
 * Replies are sent as new messages carrying the [QA-xxxx] case code rather than
 * via AgentMail's reply(), so the demo-safety override always applies.
 */

const SIGNATURE = `\n\n— sent via ${APP_NAME}, which collects and compares quotes for the homeowner. Reply to this email and keep the subject line so your answer reaches them.`;

function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const linked = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917;white-space:pre-wrap">${linked}</div>`;
}

async function draftRfq(ctx: ActionCtx, job: {
  title: string;
  trade: string;
  description: string;
  city: string;
  region: string;
  timing: string;
  budgetBand?: string;
  photos: { url: string }[];
}): Promise<{ text: string; model: string }> {
  const fallback = templateRfq(job);
  const prompt =
    `Write a short, friendly request-for-quote email from a homeowner to a local ${job.trade.toLowerCase()} contractor. ` +
    `Plain text, no subject line, no placeholders, no markdown. Under 180 words. ` +
    `Ask them to reply with: a price (range is fine), how long the work takes, earliest start, and what is and isn't included. ` +
    `Say they can ask questions by replying.\n\n` +
    `Job title: ${job.title}\nTrade: ${job.trade}\nLocation: ${job.city}, ${job.region}\nDetails: ${job.description}\n` +
    `Timing: ${job.timing}\n${job.budgetBand ? `Budget: ${job.budgetBand}\n` : ""}` +
    (job.photos.length ? `Photo links to include verbatim, one per line:\n${job.photos.map((p) => p.url).join("\n")}\n` : "");
  const res = await aiDraft(ctx, prompt, { system: "You write concise, warm, practical emails for homeowners.", maxTokens: 600 });
  if (res.ok && res.data.length > 80) return { text: res.data, model: res.model };
  return { text: fallback, model: "template" };
}

export const send = internalAction({
  args: { jobId: v.id("jobs"), contractorIds: v.array(v.id("contractors")) },
  handler: async (ctx, { jobId, contractorIds }) => {
    const job = await ctx.runQuery(internal.jobs.getInternal, { jobId });
    const revert = (contractorId: Id<"contractors">, error: string) =>
      ctx.runMutation(internal.contractors.setRfqError, { contractorId, error });

    try {
      assertNotPaused();
    } catch (e) {
      for (const id of contractorIds) await revert(id, String(e instanceof Error ? e.message : e));
      return;
    }

    // One draft for the whole batch (LLM, falling back to a template).
    const body = await draftRfq(ctx, job);
    const subject = `Quote request: ${job.title} in ${job.city}`;
    const text = body.text + SIGNATURE;

    for (const contractorId of contractorIds) {
      const c = await ctx.runQuery(internal.contractors.getInternal, { contractorId });
      if (!c || !c.email || c.rfqStatus !== "queued") continue;
      try {
        await rateLimiter.limit(ctx, "globalSend", { throws: true });
        const res = await ctx.runAction(internal.mailActions.send, {
          to: c.email,
          subject,
          text,
          html: textToHtml(text),
          caseCode: job.caseCode,
          targetId: String(job._id),
        });
        await ctx.runMutation(internal.contractors.setRfq, {
          contractorId,
          rfqStatus: "sent",
          sentMessageId: res.messageId,
          sentAt: Date.now(),
        });
        await ctx.runMutation(internal.messages.record, {
          jobId,
          contractorId,
          direction: "out",
          messageId: res.messageId,
          subject: `[${job.caseCode}] ${subject}`,
          extractedText: text,
          fullText: text,
          classification: "other",
          summary: `RFQ sent${res.redirected ? " (redirected by demo override)" : ""} · draft: ${body.model}`,
          aiState: "ok",
        });
        // Thread id for routing arrives on the recorded mailMessages row.
        await ctx.runMutation(internal.contractors.adoptThread, { contractorId, messageId: res.messageId });
      } catch (e) {
        const msg = isRateLimitError(e) ? QUOTA_MESSAGE : String(e instanceof Error ? e.message : e).slice(0, 200);
        console.error("RFQ send failed:", msg);
        await revert(contractorId, msg);
      }
    }
    await ctx.runMutation(internal.jobs.setStatus, { jobId, status: job.status === "decided" ? "decided" : "collecting" });
  },
});

/** Send an approved answer to a contractor's question. */
export const sendAnswer = internalAction({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const q = await ctx.runQuery(internal.questions.getInternal, { questionId });
    if (!q || q.status !== "pending_approval") return;
    const job = await ctx.runQuery(internal.jobs.getInternal, { jobId: q.jobId });
    const c = await ctx.runQuery(internal.contractors.getInternal, { contractorId: q.contractorId });
    if (!c?.email) return;
    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalSend", { throws: true });
      const text = `Hi ${c.name},\n\nYou asked: "${q.question}"\n\n${q.proposedAnswer}${SIGNATURE}`;
      const subject = `Re: Quote request: ${job.title} in ${job.city}`;
      const res = await ctx.runAction(internal.mailActions.send, {
        to: c.email,
        subject,
        text,
        html: textToHtml(text),
        caseCode: job.caseCode,
        targetId: String(job._id),
      });
      await ctx.runMutation(internal.questions.markSent, { questionId });
      await ctx.runMutation(internal.messages.record, {
        jobId: q.jobId,
        contractorId: q.contractorId,
        direction: "out",
        messageId: res.messageId,
        subject: `[${job.caseCode}] ${subject}`,
        extractedText: text,
        fullText: text,
        classification: "other",
        summary: "Answer sent",
        aiState: "ok",
      });
    } catch (e) {
      console.error("answer send failed:", isRateLimitError(e) ? QUOTA_MESSAGE : String(e));
    }
  },
});

/** One follow-up to a contractor who has not replied within 48h. */
export const nudge = internalAction({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, { contractorId }) => {
    const c = await ctx.runQuery(internal.contractors.getInternal, { contractorId });
    if (!c?.email || (c.nudgeCount ?? 0) > 0 || !["sent", "delivered"].includes(c.rfqStatus)) return;
    const job = await ctx.runQuery(internal.jobs.getInternal, { jobId: c.jobId });
    if (job.status === "decided") return;
    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalSend", { throws: true });
      const text =
        `Hi ${c.name},\n\nJust following up on my quote request for "${job.title}" in ${job.city} from a couple of days ago. ` +
        `If you're able to take it on, a rough price and timeline by reply would be great. If not, no problem at all — a quick "can't take it" helps me plan.\n\nThanks!${SIGNATURE}`;
      const subject = `Re: Quote request: ${job.title} in ${job.city}`;
      const res = await ctx.runAction(internal.mailActions.send, {
        to: c.email,
        subject,
        text,
        html: textToHtml(text),
        caseCode: job.caseCode,
        targetId: String(job._id),
      });
      await ctx.runMutation(internal.contractors.markNudged, { contractorId });
      await ctx.runMutation(internal.messages.record, {
        jobId: c.jobId,
        contractorId,
        direction: "out",
        messageId: res.messageId,
        subject: `[${job.caseCode}] ${subject}`,
        extractedText: text,
        fullText: text,
        classification: "other",
        summary: "48h follow-up sent",
        aiState: "ok",
      });
    } catch (e) {
      console.error("nudge failed:", isRateLimitError(e) ? QUOTA_MESSAGE : String(e));
    }
  },
});

/** Polite "we went another way" to everyone who quoted but did not win. */
export const sendCourtesy = internalAction({
  args: { jobId: v.id("jobs"), winnerId: v.id("contractors") },
  handler: async (ctx, { jobId, winnerId }) => {
    const job = await ctx.runQuery(internal.jobs.getInternal, { jobId });
    const all = await ctx.runQuery(internal.contractors.listInternal, { jobId });
    const losers = all.filter((c) => c._id !== winnerId && c.email && c.rfqStatus === "replied");
    for (const c of losers) {
      try {
        assertNotPaused();
        await rateLimiter.limit(ctx, "globalSend", { throws: true });
        const text =
          `Hi ${c.name},\n\nThank you for taking the time to quote on "${job.title}" in ${job.city}. ` +
          `I've decided to go with another contractor this time, but I appreciated your reply and will keep you in mind for future work.\n\nAll the best!${SIGNATURE}`;
        const subject = `Re: Quote request: ${job.title} in ${job.city}`;
        const res = await ctx.runAction(internal.mailActions.send, {
          to: c.email!,
          subject,
          text,
          html: textToHtml(text),
          caseCode: job.caseCode,
          targetId: String(job._id),
        });
        await ctx.runMutation(internal.messages.record, {
          jobId,
          contractorId: c._id,
          direction: "out",
          messageId: res.messageId,
          subject: `[${job.caseCode}] ${subject}`,
          extractedText: text,
          fullText: text,
          classification: "other",
          summary: "Courtesy note sent",
          aiState: "ok",
        });
      } catch (e) {
        console.error("courtesy send failed:", isRateLimitError(e) ? QUOTA_MESSAGE : String(e));
      }
    }
  },
});
