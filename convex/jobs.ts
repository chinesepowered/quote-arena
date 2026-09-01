import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { CASE_PREFIX } from "./lib/app";
import { newCaseCode } from "./lib/mailUtil";
import { canEdit, loadEditableJob, loadJob, slugify, viewer } from "./lib/access";
import { rateLimiter } from "./lib/limits";

/**
 * Jobs: the arena root object. Default runtime — no SDK imports here.
 */

const TRADES = [
  "Fencing",
  "Roofing",
  "Plumbing",
  "Electrical",
  "Painting",
  "Landscaping",
  "Bathroom renovation",
  "Kitchen renovation",
  "Flooring",
  "HVAC",
  "Windows & doors",
  "General handyman",
];

export const trades = query({
  args: {},
  handler: async () => TRADES,
});

async function withPhotos(ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } }, job: Doc<"jobs">) {
  const photos = await Promise.all(
    job.photoIds.map(async (id) => ({ id, url: await ctx.storage.getUrl(id) })),
  );
  return { ...job, photos: photos.filter((p) => p.url) as { id: Id<"_storage">; url: string }[] };
}

/** Upload URL for job photos (Convex file storage). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await viewer(ctx);
    if (!userId) throw new Error("Sign in required");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Create a job and kick off contractor discovery in the background. */
export const create = mutation({
  args: {
    trade: v.string(),
    title: v.string(),
    description: v.string(),
    photoIds: v.array(v.id("_storage")),
    city: v.string(),
    region: v.string(),
    timing: v.string(),
    budgetBand: v.optional(v.string()),
    /** Skip Firecrawl discovery (the user will add contractors by hand). */
    skipSourcing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await viewer(ctx);
    if (!userId) throw new Error("Sign in required");
    await rateLimiter.limit(ctx, "createCase", { key: userId, throws: true });

    // Unique case code for email routing.
    let caseCode = newCaseCode(CASE_PREFIX);
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("jobs")
        .withIndex("by_caseCode", (q) => q.eq("caseCode", caseCode))
        .unique();
      if (!clash) break;
      caseCode = newCaseCode(CASE_PREFIX);
    }

    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      ownerId: userId,
      slug: slugify(args.title),
      trade: args.trade,
      title: args.title.trim(),
      description: args.description.trim(),
      photoIds: args.photoIds,
      city: args.city.trim(),
      region: args.region.trim(),
      timing: args.timing,
      budgetBand: args.budgetBand,
      caseCode,
      status: args.skipSourcing ? "collecting" : "sourcing",
      autoReply: false,
      sourcing: {
        state: args.skipSourcing ? "idle" : "running",
        note: args.skipSourcing ? undefined : "Searching the web for local contractors…",
        updatedAt: now,
      },
      createdAt: now,
    });
    await ctx.db.insert("jobMembers", { jobId, userId });

    if (!args.skipSourcing) {
      await ctx.scheduler.runAfter(0, internal.sourcing.discover, { jobId });
    }
    const job = await ctx.db.get(jobId);
    return { jobId, slug: job!.slug };
  },
});

/** The arena, by slug. Readable by anyone with the link; `canEdit` says who may drive it. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!job) return null;
    const userId = await viewer(ctx);
    const editable = await canEdit(ctx, job, userId);
    const withP = await withPhotos(ctx, job);
    return { ...withP, canEdit: editable, isOwner: job.ownerId === userId };
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const userId = await viewer(ctx);
    const editable = await canEdit(ctx, job, userId);
    const withP = await withPhotos(ctx, job);
    return { ...withP, canEdit: editable, isOwner: job.ownerId === userId };
  },
});

/** Jobs I own or was invited to, newest first, with a few live counters. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await viewer(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("jobMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const ids = new Set<string>(memberships.map((m) => m.jobId));
    const owned = await ctx.db
      .query("jobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const j of owned) ids.add(j._id);
    const jobs = (await Promise.all([...ids].map((id) => ctx.db.get(id as Id<"jobs">)))).filter(
      (j): j is Doc<"jobs"> => Boolean(j),
    );
    const out = await Promise.all(
      jobs.map(async (job) => {
        const contractors = await ctx.db
          .query("contractors")
          .withIndex("by_job", (q) => q.eq("jobId", job._id))
          .collect();
        const quotes = await ctx.db
          .query("quotes")
          .withIndex("by_job_active", (q) => q.eq("jobId", job._id).eq("supersededBy", undefined))
          .collect();
        return {
          _id: job._id,
          slug: job.slug,
          title: job.title,
          trade: job.trade,
          city: job.city,
          status: job.status,
          createdAt: job.createdAt,
          found: contractors.length,
          contacted: contractors.filter((c) => ["sent", "delivered", "replied", "declined"].includes(c.rfqStatus)).length,
          quotes: quotes.length,
        };
      }),
    );
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** The seeded demo arena, so the home page can link to a populated board. */
export const demo = query({
  args: {},
  handler: async (ctx) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_demo", (q) => q.eq("isDemo", true))
      .first();
    if (!job) return null;
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_job_active", (q) => q.eq("jobId", job._id).eq("supersededBy", undefined))
      .collect();
    const contractors = await ctx.db
      .query("contractors")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .collect();
    return { _id: job._id, slug: job.slug, title: job.title, trade: job.trade, city: job.city, quotes: quotes.length, found: contractors.length };
  },
});

/** Join a shared board by its link (household members). */
export const join = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const userId = await viewer(ctx);
    if (!userId) throw new Error("Sign in required");
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!job) throw new Error("Job not found");
    const existing = await ctx.db
      .query("jobMembers")
      .withIndex("by_job_user", (q) => q.eq("jobId", job._id).eq("userId", userId))
      .unique();
    if (!existing) await ctx.db.insert("jobMembers", { jobId: job._id, userId });
    return job._id;
  },
});

export const setAutoReply = mutation({
  args: { jobId: v.id("jobs"), autoReply: v.boolean() },
  handler: async (ctx, { jobId, autoReply }) => {
    const { job } = await loadEditableJob(ctx, jobId);
    await ctx.db.patch(job._id, { autoReply });
  },
});

/** Pick a winner. Everyone else who quoted gets a polite courtesy email. */
export const decide = mutation({
  args: { jobId: v.id("jobs"), contractorId: v.id("contractors") },
  handler: async (ctx, { jobId, contractorId }) => {
    const { job } = await loadEditableJob(ctx, jobId);
    const winner = await ctx.db.get(contractorId);
    if (!winner || winner.jobId !== job._id) throw new Error("Contractor not on this job");
    await ctx.db.patch(job._id, { status: "decided", winnerContractorId: contractorId, decidedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.rfq.sendCourtesy, { jobId: job._id, winnerId: contractorId });
  },
});

/** Undo a decision (demo convenience; the courtesy emails are not recalled). */
export const reopen = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const { job } = await loadEditableJob(ctx, jobId);
    await ctx.db.patch(job._id, { status: "collecting", winnerContractorId: undefined, decidedAt: undefined });
  },
});

/** Re-run Firecrawl discovery for a job (rate limited per user in the action). */
export const rediscover = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const { job, userId } = await loadEditableJob(ctx, jobId);
    if (job.sourcing?.state === "running") return;
    await rateLimiter.limit(ctx, "userCrawl", { key: userId, throws: true });
    await ctx.db.patch(job._id, {
      status: job.status === "decided" ? job.status : "sourcing",
      sourcing: { state: "running", note: "Searching the web for local contractors…", updatedAt: Date.now() },
    });
    await ctx.scheduler.runAfter(0, internal.sourcing.discover, { jobId: job._id });
  },
});

// ───────────────────────── internal helpers used by actions ─────────────────────────

export const getInternal = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await loadJob(ctx, jobId);
    return await withPhotos(ctx, job);
  },
});

export const byCaseCode = internalQuery({
  args: { caseCode: v.string() },
  handler: async (ctx, { caseCode }) =>
    await ctx.db
      .query("jobs")
      .withIndex("by_caseCode", (q) => q.eq("caseCode", caseCode))
      .unique(),
});

export const setSourcing = internalMutation({
  args: {
    jobId: v.id("jobs"),
    state: v.union(v.literal("idle"), v.literal("running"), v.literal("done"), v.literal("error")),
    note: v.optional(v.string()),
    queries: v.optional(v.array(v.string())),
    found: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, ...s }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return;
    const status = s.state === "running" ? job.status : job.status === "sourcing" ? "collecting" : job.status;
    await ctx.db.patch(jobId, {
      status,
      sourcing: { ...(job.sourcing ?? {}), ...s, updatedAt: Date.now() },
    });
  },
});

export const setStatus = internalMutation({
  args: { jobId: v.id("jobs"), status: v.union(v.literal("draft"), v.literal("sourcing"), v.literal("collecting"), v.literal("decided")) },
  handler: async (ctx, { jobId, status }) => {
    await ctx.db.patch(jobId, { status });
  },
});
