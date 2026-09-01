import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Per-user isolation for the product tables (default runtime, no SDK imports).
 *
 * Rules:
 *  - A job's owner and its members may read and drive it.
 *  - Anyone who knows the unguessable slug may read it (shareable board).
 *  - The seeded demo arena has no owner: any signed-in visitor may drive it, so
 *    judges can play with a populated leaderboard the moment they open the URL.
 */
export async function viewer(ctx: QueryCtx | MutationCtx) {
  return await getAuthUserId(ctx);
}

export async function isMember(ctx: QueryCtx | MutationCtx, jobId: Id<"jobs">, userId: Id<"users">) {
  const row = await ctx.db
    .query("jobMembers")
    .withIndex("by_job_user", (q) => q.eq("jobId", jobId).eq("userId", userId))
    .unique();
  return Boolean(row);
}

export async function canEdit(ctx: QueryCtx | MutationCtx, job: Doc<"jobs">, userId: Id<"users"> | null) {
  if (!userId) return false;
  if (job.isDemo && !job.ownerId) return true;
  if (job.ownerId === userId) return true;
  return await isMember(ctx, job._id, userId);
}

/** Load a job the caller may read, or throw. Reading only needs the id or slug. */
export async function loadJob(ctx: QueryCtx | MutationCtx, jobId: Id<"jobs">) {
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("Job not found");
  return job;
}

/** Load a job the caller may drive (send, select, decide), or throw. */
export async function loadEditableJob(ctx: QueryCtx | MutationCtx, jobId: Id<"jobs">) {
  const userId = await viewer(ctx);
  if (!userId) throw new Error("Sign in required");
  const job = await loadJob(ctx, jobId);
  if (!(await canEdit(ctx, job, userId))) throw new Error("You do not have access to this job");
  return { job, userId };
}

export function slugify(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base || "job"}-${rand}`;
}
