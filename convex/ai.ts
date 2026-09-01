"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { extract, modelId } from "./lib/llm";
import { assertNotPaused, rateLimiter } from "./lib/limits";

/** Health check for the LLM endpoint: `convex run ai:ping`. */
export const ping = internalAction({
  args: { text: v.optional(v.string()) },
  handler: async (ctx, { text }) => {
    assertNotPaused();
    await rateLimiter.limit(ctx, "globalLlm", { throws: true });
    const started = Date.now();
    const out = await extract(
      z.object({ sentiment: z.enum(["positive", "neutral", "negative"]), words: z.number() }),
      `Classify the sentiment and count the words: "${text ?? "We can do the fence for $3,200, two weeks out."}"`,
      { maxTokens: 200 },
    );
    await ctx.runMutation(internal.usage.bump, { provider: "llm" });
    return { model: modelId(), ms: Date.now() - started, out };
  },
});
