import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

/** Contractors emailed more than this long ago with no reply get one follow-up. */
export const NUDGE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Cron sweep (see crons.ts): find contractors still waiting after 48h and
 * schedule one nudge each. Max one follow-up per contractor, ever, and never
 * for a job that has already been decided.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - NUDGE_AFTER_MS;
    const openJobs = await ctx.db.query("jobs").collect();
    let scheduled = 0;
    for (const job of openJobs) {
      if (job.status === "decided") continue;
      for (const status of ["sent", "delivered"] as const) {
        const waiting = await ctx.db
          .query("contractors")
          .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("rfqStatus", status))
          .collect();
        for (const c of waiting) {
          if ((c.nudgeCount ?? 0) > 0 || !c.sentAt || c.sentAt > cutoff || !c.email) continue;
          await ctx.scheduler.runAfter(scheduled * 2000, internal.rfq.nudge, { contractorId: c._id });
          scheduled++;
          if (scheduled >= 10) return { scheduled }; // stay well inside the daily send cap
        }
      }
    }
    return { scheduled };
  },
});
