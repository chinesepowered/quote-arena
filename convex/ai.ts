"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction } from "./_generated/server";
import { modelId } from "./lib/llm";
import { aiExtract } from "./lib/quoteAi";

/** Health check for the LLM endpoint: `convex run ai:ping`. */
export const ping = internalAction({
  args: { text: v.optional(v.string()) },
  handler: async (ctx, { text }) => {
    const started = Date.now();
    const out = await aiExtract(
      ctx,
      z.object({ sentiment: z.enum(["positive", "neutral", "negative"]), words: z.number() }),
      `Classify the sentiment and count the words: "${text ?? "We can do the fence for $3,200, two weeks out."}"`,
      { maxTokens: 200 },
    );
    return { model: modelId(), ms: Date.now() - started, out };
  },
});
