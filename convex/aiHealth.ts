import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/**
 * Circuit breaker for the LLM endpoint. Hosted providers sometimes hang; when
 * two calls in a row fail, product paths skip the model for a cool-down and
 * fall back to heuristics immediately instead of each waiting out a timeout.
 * One probe is allowed per cool-down, so a provider swap heals itself.
 */
export const COOLDOWN_MS = 10 * 60 * 1000;
export const TRIP_AFTER = 2;

async function row(ctx: { db: any }) {
  return await ctx.db
    .query("aiHealth")
    .withIndex("by_key", (q: any) => q.eq("key", "singleton"))
    .unique();
}

export const shouldTry = internalQuery({
  args: {},
  handler: async (ctx) => {
    const r = await row(ctx);
    if (!r) return true;
    if (r.consecutiveFailures < TRIP_AFTER) return true;
    return Date.now() - r.lastFailureAt > COOLDOWN_MS; // one probe per cool-down
  },
});

export const record = internalMutation({
  args: { ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, { ok, error }) => {
    const r = await row(ctx);
    const now = Date.now();
    if (!r) {
      await ctx.db.insert("aiHealth", {
        key: "singleton",
        consecutiveFailures: ok ? 0 : 1,
        lastFailureAt: ok ? 0 : now,
        lastSuccessAt: ok ? now : 0,
        lastError: ok ? undefined : error,
      });
      return;
    }
    await ctx.db.patch(r._id, {
      consecutiveFailures: ok ? 0 : r.consecutiveFailures + 1,
      lastFailureAt: ok ? r.lastFailureAt : now,
      lastSuccessAt: ok ? now : r.lastSuccessAt,
      lastError: ok ? undefined : error,
    });
  },
});

/** Public, for the Ops page and the "AI unavailable" hint in the arena. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const r = await row(ctx);
    if (!r) return { state: "unknown" as const, lastError: undefined as string | undefined };
    const tripped = r.consecutiveFailures >= TRIP_AFTER && Date.now() - r.lastFailureAt <= COOLDOWN_MS;
    return {
      state: tripped ? ("down" as const) : r.lastSuccessAt > r.lastFailureAt ? ("ok" as const) : ("degraded" as const),
      lastError: r.lastError,
      consecutiveFailures: r.consecutiveFailures,
      lastSuccessAt: r.lastSuccessAt || undefined,
      lastFailureAt: r.lastFailureAt || undefined,
    };
  },
});
