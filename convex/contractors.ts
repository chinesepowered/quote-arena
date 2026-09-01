import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { rfqStatus } from "./schema";
import { loadEditableJob, loadJob } from "./lib/access";
import { bareAddress } from "./lib/mailUtil";
import { rateLimiter } from "./lib/limits";

/** Hard cap on how many contractors one job may email (free-tier protection). */
export const MAX_RECIPIENTS = 8;

export const list = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await loadJob(ctx, jobId);
    const rows = await ctx.db
      .query("contractors")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Add a contractor you already know (or yourself, for the demo). */
export const addManual = mutation({
  args: {
    jobId: v.id("jobs"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { job } = await loadEditableJob(ctx, args.jobId);
    const email = args.email?.trim() ? bareAddress(args.email) : undefined;
    return await ctx.db.insert("contractors", {
      jobId: job._id,
      name: args.name.trim(),
      email,
      phone: args.phone?.trim() || undefined,
      website: args.website?.trim() || undefined,
      services: [job.trade],
      manual: true,
      selected: Boolean(email),
      rfqStatus: "none",
      createdAt: Date.now(),
    });
  },
});

export const setEmail = mutation({
  args: { contractorId: v.id("contractors"), email: v.string() },
  handler: async (ctx, { contractorId, email }) => {
    const c = await ctx.db.get(contractorId);
    if (!c) throw new Error("Not found");
    await loadEditableJob(ctx, c.jobId);
    await ctx.db.patch(contractorId, { email: bareAddress(email), selected: true });
  },
});

export const setSelected = mutation({
  args: { contractorId: v.id("contractors"), selected: v.boolean() },
  handler: async (ctx, { contractorId, selected }) => {
    const c = await ctx.db.get(contractorId);
    if (!c) throw new Error("Not found");
    await loadEditableJob(ctx, c.jobId);
    await ctx.db.patch(contractorId, { selected });
  },
});

export const remove = mutation({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, { contractorId }) => {
    const c = await ctx.db.get(contractorId);
    if (!c) return;
    await loadEditableJob(ctx, c.jobId);
    if (c.rfqStatus !== "none") throw new Error("Already contacted; cannot remove");
    await ctx.db.delete(contractorId);
  },
});

/**
 * Send the RFQ to every selected, not-yet-contacted contractor with an email.
 * Marks them `queued` immediately (so the UI reacts) and schedules the send.
 */
export const sendRequests = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const { job, userId } = await loadEditableJob(ctx, jobId);
    const all = await ctx.db
      .query("contractors")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .collect();
    const contacted = all.filter((c) => c.rfqStatus !== "none").length;
    const targets = all.filter((c) => c.selected && c.email && c.rfqStatus === "none");
    if (!targets.length) return { queued: 0 };
    if (contacted + targets.length > MAX_RECIPIENTS) {
      throw new Error(`A job may contact at most ${MAX_RECIPIENTS} contractors.`);
    }
    await rateLimiter.limit(ctx, "userSend", { key: userId, throws: true });
    for (const c of targets) await ctx.db.patch(c._id, { rfqStatus: "queued" });
    await ctx.scheduler.runAfter(0, internal.rfq.send, { jobId: job._id, contractorIds: targets.map((c) => c._id) });
    return { queued: targets.length };
  },
});

// ───────────────────────── internal ─────────────────────────

export const getInternal = internalQuery({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, { contractorId }) => await ctx.db.get(contractorId),
});

export const listInternal = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) =>
    await ctx.db
      .query("contractors")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect(),
});

/** Insert a contractor found by Firecrawl, de-duplicated by website/email/name. */
export const upsertFromCrawl = internalMutation({
  args: {
    jobId: v.id("jobs"),
    name: v.string(),
    website: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    services: v.array(v.string()),
    serviceArea: v.optional(v.string()),
    ratingSnippet: v.optional(v.string()),
    sourceUrl: v.string(),
    sourceTitle: v.optional(v.string()),
    rawExcerpt: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contractors")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const host = (u?: string) => {
      try {
        return u ? new URL(u).hostname.replace(/^www\./, "") : "";
      } catch {
        return "";
      }
    };
    const dupe = existing.find(
      (c) =>
        (args.email && c.email === args.email) ||
        (host(args.website) && host(c.website) === host(args.website)) ||
        c.name.toLowerCase() === args.name.toLowerCase(),
    );
    if (dupe) {
      // Fill in blanks only; never overwrite a user's manual edits.
      await ctx.db.patch(dupe._id, {
        email: dupe.email ?? args.email,
        phone: dupe.phone ?? args.phone,
        website: dupe.website ?? args.website,
        serviceArea: dupe.serviceArea ?? args.serviceArea,
        ratingSnippet: dupe.ratingSnippet ?? args.ratingSnippet,
      });
      return { id: dupe._id, inserted: false };
    }
    const id = await ctx.db.insert("contractors", {
      ...args,
      email: args.email ? bareAddress(args.email) : undefined,
      fetchedAt: Date.now(),
      manual: false,
      selected: Boolean(args.email),
      rfqStatus: "none",
      createdAt: Date.now(),
    });
    return { id, inserted: true };
  },
});

export const setRfq = internalMutation({
  args: {
    contractorId: v.id("contractors"),
    rfqStatus,
    sentMessageId: v.optional(v.string()),
    sentThreadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
  },
  handler: async (ctx, { contractorId, ...patch }) => {
    const c = await ctx.db.get(contractorId);
    if (!c) return;
    // Never downgrade a reply back to "sent" because of a late delivery event.
    if (["replied", "declined"].includes(c.rfqStatus) && ["sent", "delivered", "bounced"].includes(patch.rfqStatus)) {
      return;
    }
    await ctx.db.patch(contractorId, patch);
  },
});

/** A send failed: put the contractor back to "none" and say why. */
export const setRfqError = internalMutation({
  args: { contractorId: v.id("contractors"), error: v.string() },
  handler: async (ctx, { contractorId, error }) => {
    const c = await ctx.db.get(contractorId);
    if (!c || c.rfqStatus !== "queued") return;
    await ctx.db.patch(contractorId, { rfqStatus: "none", lastError: error });
  },
});

/** Copy the AgentMail thread id of the sent RFQ onto the contractor for reply routing. */
export const adoptThread = internalMutation({
  args: { contractorId: v.id("contractors"), messageId: v.string() },
  handler: async (ctx, { contractorId, messageId }) => {
    const mail = await ctx.db
      .query("mailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique();
    if (mail?.threadId) await ctx.db.patch(contractorId, { sentThreadId: mail.threadId, lastError: undefined });
    else await ctx.db.patch(contractorId, { lastError: undefined });
  },
});

/** Fill in an email found on a contact page (never overwrites an existing one). */
export const patchContact = internalMutation({
  args: { contractorId: v.id("contractors"), email: v.string(), contactUrl: v.optional(v.string()) },
  handler: async (ctx, { contractorId, email, contactUrl }) => {
    const c = await ctx.db.get(contractorId);
    if (!c || c.email) return;
    await ctx.db.patch(contractorId, {
      email: bareAddress(email),
      selected: true,
      sourceUrl: c.sourceUrl ?? contactUrl,
    });
  },
});

export const markNudged = internalMutation({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, { contractorId }) => {
    const c = await ctx.db.get(contractorId);
    if (!c) return;
    await ctx.db.patch(contractorId, { lastNudgeAt: Date.now(), nudgeCount: (c.nudgeCount ?? 0) + 1 });
  },
});

/** A reply arrived from an address we never emailed: add them as a contractor. */
export const createFromReply = internalMutation({
  args: { jobId: v.id("jobs"), name: v.string(), email: v.string(), threadId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    return await ctx.db.insert("contractors", {
      jobId: args.jobId,
      name: args.name.slice(0, 80),
      email: bareAddress(args.email),
      services: [job.trade],
      manual: true,
      selected: true,
      rfqStatus: "replied",
      sentThreadId: args.threadId,
      repliedAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const setThread = internalMutation({
  args: { contractorId: v.id("contractors"), threadId: v.string() },
  handler: async (ctx, { contractorId, threadId }) => {
    await ctx.db.patch(contractorId, { sentThreadId: threadId });
  },
});

/** Find which contractor an inbound email belongs to: by thread, then sender. */
export const matchInbound = internalQuery({
  args: { jobId: v.id("jobs"), threadId: v.optional(v.string()), from: v.optional(v.string()) },
  handler: async (ctx, { jobId, threadId, from }) => {
    if (threadId) {
      const byThread = await ctx.db
        .query("contractors")
        .withIndex("by_thread", (q) => q.eq("sentThreadId", threadId))
        .first();
      if (byThread && byThread.jobId === jobId) return byThread;
    }
    if (from) {
      const addr = bareAddress(from);
      const all = await ctx.db
        .query("contractors")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      const bySender = all.find((c) => c.email === addr);
      if (bySender) return bySender;
    }
    return null;
  },
});
