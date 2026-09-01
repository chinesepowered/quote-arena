import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { loadJob } from "./lib/access";
import { breakdown, compareRank, FORMULA_TEXT } from "./lib/ranking";

/**
 * Quotes: one row per contractor reply that contained pricing. A newer quote
 * from the same contractor supersedes the older one; the leaderboard shows only
 * active quotes, ranked by the transparent formula in lib/ranking.ts.
 */

export const leaderboard = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    await loadJob(ctx, jobId);
    const active = await ctx.db
      .query("quotes")
      .withIndex("by_job_active", (q) => q.eq("jobId", jobId).eq("supersededBy", undefined))
      .collect();
    const rows = await Promise.all(
      active.map(async (q) => {
        const contractor = await ctx.db.get(q.contractorId);
        const history = await ctx.db
          .query("quotes")
          .withIndex("by_contractor", (x) => x.eq("contractorId", q.contractorId))
          .collect();
        return {
          ...q,
          contractorName: contractor?.name ?? "Unknown",
          contractorEmail: contractor?.email,
          revision: history.length,
          breakdown: breakdown(q),
        };
      }),
    );
    rows.sort(compareRank);
    return {
      formula: FORMULA_TEXT,
      quotes: rows.map((r, i) => ({ ...r, rank: r.breakdown.score == null ? null : i + 1 })),
    };
  },
});

/** Full quote history for a contractor (superseded ones too), for the drawer. */
export const history = query({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, { contractorId }) => {
    const c = await ctx.db.get(contractorId);
    if (!c) return [];
    await loadJob(ctx, c.jobId);
    const rows = await ctx.db
      .query("quotes")
      .withIndex("by_contractor", (q) => q.eq("contractorId", contractorId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Insert a quote and supersede any earlier active quote from the same contractor. */
export const insert = internalMutation({
  args: {
    jobId: v.id("jobs"),
    contractorId: v.id("contractors"),
    messageId: v.id("messages"),
    priceLow: v.optional(v.number()),
    priceHigh: v.optional(v.number()),
    currency: v.string(),
    timelineDays: v.optional(v.number()),
    startEarliest: v.optional(v.string()),
    includes: v.array(v.string()),
    excludes: v.array(v.string()),
    notes: v.optional(v.string()),
    confidence: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("quotes", { ...args, createdAt: Date.now() });
    const older = await ctx.db
      .query("quotes")
      .withIndex("by_contractor", (q) => q.eq("contractorId", args.contractorId))
      .collect();
    for (const q of older) {
      if (q._id !== id && !q.supersededBy) await ctx.db.patch(q._id, { supersededBy: id });
    }
    await ctx.db.patch(args.contractorId, { rfqStatus: "replied", repliedAt: Date.now() });
    const job = await ctx.db.get(args.jobId);
    if (job && job.status === "sourcing") await ctx.db.patch(job._id, { status: "collecting" });
    return id;
  },
});
