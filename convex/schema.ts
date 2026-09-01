import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Shared chassis tables. Product tables are defined alongside these.
 */

export const jobStatus = v.union(
  v.literal("draft"),
  v.literal("sourcing"),
  v.literal("collecting"),
  v.literal("decided"),
);

export const rfqStatus = v.union(
  v.literal("none"),
  v.literal("queued"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("replied"),
  v.literal("declined"),
);

export const classification = v.union(
  v.literal("quote"),
  v.literal("question"),
  v.literal("decline"),
  v.literal("auto_reply"),
  v.literal("other"),
);

export default defineSchema({
  ...authTables,

  /** Daily per-provider counters so free-tier burn is visible on /admin. */
  usage: defineTable({
    day: v.string(), // YYYY-MM-DD
    provider: v.string(), // firecrawl | agentmail | llm
    count: v.number(),
  }).index("by_day_provider", ["day", "provider"]),

  /** Singleton row: the app's one AgentMail inbox. */
  settings: defineTable({
    key: v.string(), // always "singleton"
    inboxId: v.string(),
    inboxAddress: v.string(),
  }).index("by_key", ["key"]),

  /**
   * Every email in or out. Inbound is routed to a case by, in order:
   * thread id, [CASE-CODE] in the subject, then a registered sender address.
   */
  mailMessages: defineTable({
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.array(v.string())),
    subject: v.string(),
    extractedText: v.optional(v.string()),
    fullText: v.optional(v.string()),
    caseCode: v.optional(v.string()),
    /** Product row this message belongs to, once routed. */
    targetId: v.optional(v.string()),
    routed: v.boolean(),
    classification: v.optional(v.string()),
    summary: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()), // sent | delivered | bounced
    at: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_threadId", ["threadId"])
    .index("by_caseCode", ["caseCode"])
    .index("by_target", ["targetId"])
    .index("by_routed", ["routed"]),

  /** Sender address to product row, for "forward your email here" flows. */
  senderRoutes: defineTable({
    email: v.string(),
    targetId: v.string(),
    ownerId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  // ───────────────────────── Quote Arena product tables ─────────────────────────

  /** A home-repair job the homeowner wants quotes for. One arena per job. */
  jobs: defineTable({
    /** Undefined only for the seeded demo arena, which any signed-in visitor may drive. */
    ownerId: v.optional(v.id("users")),
    slug: v.string(),
    trade: v.string(),
    title: v.string(),
    description: v.string(),
    photoIds: v.array(v.id("_storage")),
    city: v.string(),
    region: v.string(),
    timing: v.string(),
    budgetBand: v.optional(v.string()),
    /** Short unguessable code carried in every email subject, e.g. QA-7F3K. */
    caseCode: v.string(),
    status: jobStatus,
    autoReply: v.boolean(),
    isDemo: v.optional(v.boolean()),
    winnerContractorId: v.optional(v.id("contractors")),
    decidedAt: v.optional(v.number()),
    /** Firecrawl discovery progress, shown live in the status strip. */
    sourcing: v.optional(
      v.object({
        state: v.union(
          v.literal("idle"),
          v.literal("running"),
          v.literal("done"),
          v.literal("error"),
        ),
        note: v.optional(v.string()),
        queries: v.optional(v.array(v.string())),
        found: v.optional(v.number()),
        updatedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_slug", ["slug"])
    .index("by_caseCode", ["caseCode"])
    .index("by_demo", ["isDemo"]),

  /** Household members who can watch and drive a shared arena. */
  jobMembers: defineTable({
    jobId: v.id("jobs"),
    userId: v.id("users"),
  })
    .index("by_job", ["jobId"])
    .index("by_user", ["userId"])
    .index("by_job_user", ["jobId", "userId"]),

  /** A contractor found by Firecrawl (or added by hand) for one job. */
  contractors: defineTable({
    jobId: v.id("jobs"),
    name: v.string(),
    website: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    services: v.array(v.string()),
    serviceArea: v.optional(v.string()),
    ratingSnippet: v.optional(v.string()),
    /** Where Firecrawl found them, for the "how we found them" hover. */
    sourceUrl: v.optional(v.string()),
    sourceTitle: v.optional(v.string()),
    rawExcerpt: v.optional(v.string()),
    fetchedAt: v.optional(v.number()),
    /** Which model extracted the row, or "heuristic" when the LLM was unavailable. */
    model: v.optional(v.string()),
    manual: v.boolean(),
    selected: v.boolean(),
    rfqStatus,
    sentMessageId: v.optional(v.string()),
    sentThreadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    lastNudgeAt: v.optional(v.number()),
    nudgeCount: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    /** Why the last send failed, if it did (quota, bounce). */
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_status", ["jobId", "rfqStatus"])
    .index("by_thread", ["sentThreadId"]),

  /** A normalized quote extracted from one contractor reply. */
  quotes: defineTable({
    jobId: v.id("jobs"),
    contractorId: v.id("contractors"),
    /** The product message row this quote was extracted from. */
    messageId: v.id("messages"),
    priceLow: v.optional(v.number()),
    priceHigh: v.optional(v.number()),
    currency: v.string(),
    timelineDays: v.optional(v.number()),
    startEarliest: v.optional(v.string()),
    includes: v.array(v.string()),
    excludes: v.array(v.string()),
    notes: v.optional(v.string()),
    /** 0..1: how sure the extractor was that the fields are right. */
    confidence: v.number(),
    /** Model id that produced the extraction, or "heuristic". */
    model: v.string(),
    supersededBy: v.optional(v.id("quotes")),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_contractor", ["contractorId"])
    .index("by_job_active", ["jobId", "supersededBy"]),

  /** Product-level view of every email on a job, linked to a contractor. */
  messages: defineTable({
    jobId: v.id("jobs"),
    contractorId: v.optional(v.id("contractors")),
    mailMessageId: v.optional(v.id("mailMessages")),
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    subject: v.string(),
    extractedText: v.string(),
    fullText: v.string(),
    classification: v.optional(classification),
    summary: v.optional(v.string()),
    /** "ok" | "ai_unavailable" | "pending" so the UI can say why a card is missing. */
    aiState: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_contractor", ["contractorId"])
    .index("by_messageId", ["messageId"])
    .index("by_thread", ["threadId"]),

  /** A clarifying question a contractor asked, with the proposed answer. */
  questions: defineTable({
    jobId: v.id("jobs"),
    contractorId: v.id("contractors"),
    messageId: v.id("messages"),
    question: v.string(),
    proposedAnswer: v.string(),
    /** True when the answer was written from job facts only; false when it is a placeholder. */
    grounded: v.boolean(),
    status: v.union(
      v.literal("pending_approval"),
      v.literal("sent"),
      v.literal("dismissed"),
    ),
    model: v.string(),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_job_status", ["jobId", "status"])
    .index("by_job", ["jobId"])
    .index("by_contractor", ["contractorId"]),
});
