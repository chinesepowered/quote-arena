import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Demo arena: a fence job in Waterloo with contractors, two quotes on the
 * board, one pending question and one decline, so the leaderboard is alive the
 * moment a judge opens the URL. Idempotent: re-running replaces the demo job.
 *
 *   pnpm exec convex run seed:demo            (dev)
 *   pnpm exec convex run seed:demo --prod     (production)
 *
 * All contractor addresses are fictional `.example` domains; outbound mail is
 * redirected by DEMO_RECIPIENT_OVERRIDE anyway.
 */
/** Dev helper: put one contractor into "queued" so rfq.send can be exercised from the CLI. */
export const queueContractor = internalMutation({
  args: { contractorId: v.id("contractors") },
  handler: async (ctx, { contractorId }) => {
    await ctx.db.patch(contractorId, { rfqStatus: "queued", selected: true });
  },
});

export const demo = internalMutation({
  args: { slug: v.optional(v.string()) },
  handler: async (ctx, { slug }) => {
    const demoSlug = slug ?? "demo-back-fence";

    // Wipe a previous run.
    const old = await ctx.db
      .query("jobs")
      .withIndex("by_slug", (q) => q.eq("slug", demoSlug))
      .unique();
    if (old) {
      for (const table of ["contractors", "quotes", "messages", "questions", "jobMembers"] as const) {
        const rows = await ctx.db
          .query(table)
          .withIndex("by_job", (q) => q.eq("jobId", old._id))
          .collect();
        for (const r of rows) await ctx.db.delete(r._id);
      }
      await ctx.db.delete(old._id);
    }

    const now = Date.now();
    const h = 60 * 60 * 1000;
    const jobId = await ctx.db.insert("jobs", {
      slug: demoSlug,
      trade: "Fencing",
      title: "Replace 40 ft of fallen back fence",
      description:
        "A windstorm took down about 40 feet of 6 ft pressure-treated privacy fence along the back of the yard. " +
        "Posts snapped at ground level; the old panels and posts need to be removed and hauled away. " +
        "Ground is level lawn with clear access through a side gate (about 4 ft wide). Would like cedar or pressure-treated, 6 ft high, with one 4 ft gate. " +
        "No neighbour fence to tie into on the north side.",
      photoIds: [],
      city: "Waterloo",
      region: "ON",
      timing: "Within the next 4 weeks",
      budgetBand: "$2,500 – $4,500",
      caseCode: "QA-DEMO",
      status: "collecting",
      autoReply: false,
      isDemo: true,
      sourcing: {
        state: "done",
        note: "Found 5 contractors from 9 pages.",
        queries: ["Fencing contractor Waterloo, ON", "Fencing company Waterloo, ON contact"],
        found: 5,
        updatedAt: now - 20 * h,
      },
      createdAt: now - 26 * h,
    });

    const contractor = async (c: {
      name: string;
      email: string;
      phone?: string;
      website: string;
      services: string[];
      serviceArea?: string;
      ratingSnippet?: string;
      excerpt: string;
      rfqStatus: "sent" | "delivered" | "replied" | "declined";
      sentAgo: number;
      repliedAgo?: number;
    }) =>
      await ctx.db.insert("contractors", {
        jobId,
        name: c.name,
        email: c.email,
        phone: c.phone,
        website: c.website,
        services: c.services,
        serviceArea: c.serviceArea,
        ratingSnippet: c.ratingSnippet,
        sourceUrl: c.website,
        sourceTitle: `${c.name} — Fencing in Waterloo Region`,
        rawExcerpt: c.excerpt,
        fetchedAt: now - 25 * h,
        model: "seed",
        manual: false,
        selected: true,
        rfqStatus: c.rfqStatus,
        sentMessageId: `seed-out-${c.name.toLowerCase().replace(/\W+/g, "-")}`,
        sentThreadId: `seed-thread-${c.name.toLowerCase().replace(/\W+/g, "-")}`,
        sentAt: now - c.sentAgo,
        repliedAt: c.repliedAgo ? now - c.repliedAgo : undefined,
        createdAt: now - 25 * h,
      });

    const maple = await contractor({
      name: "Maple City Fencing",
      email: "quotes@maplecityfencing.example",
      phone: "(519) 555-0142",
      website: "https://maplecityfencing.example",
      services: ["Wood fencing", "Cedar fencing", "Gates", "Post replacement"],
      serviceArea: "Kitchener-Waterloo, Cambridge",
      ratingSnippet: "4.8 ★ · 120+ Google reviews",
      excerpt:
        "# Maple City Fencing\n\nFamily-owned fence builders serving Kitchener-Waterloo since 2009. Cedar and pressure-treated privacy fences, gates, and storm repairs. Free on-site estimates.\n\nCall (519) 555-0142 or email quotes@maplecityfencing.example",
      rfqStatus: "replied",
      sentAgo: 24 * h,
      repliedAgo: 19 * h,
    });
    const grand = await contractor({
      name: "Grand River Fence & Deck",
      email: "hello@grandriverfence.example",
      phone: "(519) 555-0177",
      website: "https://grandriverfence.example",
      services: ["Fencing", "Decks", "Pergolas"],
      serviceArea: "Waterloo Region",
      ratingSnippet: "HomeStars Best of 2025",
      excerpt:
        "# Grand River Fence & Deck\n\nCustom fences and decks across Waterloo Region. Fully insured, 5-year workmanship warranty. Request a quote online or email hello@grandriverfence.example.",
      rfqStatus: "replied",
      sentAgo: 24 * h,
      repliedAgo: 8 * h,
    });
    const tri = await contractor({
      name: "Tri-City Outdoor Works",
      email: "office@tricityoutdoor.example",
      website: "https://tricityoutdoor.example",
      services: ["Fencing", "Landscaping", "Sod"],
      serviceArea: "Kitchener, Waterloo, Cambridge, Guelph",
      excerpt:
        "# Tri-City Outdoor Works\n\nLandscaping, fencing and yard restoration. Book a site visit: office@tricityoutdoor.example.",
      rfqStatus: "replied",
      sentAgo: 24 * h,
      repliedAgo: 3 * h,
    });
    const northfield = await contractor({
      name: "Northfield Fence Co.",
      email: "info@northfieldfence.example",
      phone: "(226) 555-0199",
      website: "https://northfieldfence.example",
      services: ["Chain-link", "Wood fencing", "Commercial fencing"],
      serviceArea: "Waterloo, Woolwich",
      excerpt: "# Northfield Fence Co.\n\nResidential and commercial fencing since 1994. info@northfieldfence.example",
      rfqStatus: "declined",
      sentAgo: 24 * h,
      repliedAgo: 15 * h,
    });
    await contractor({
      name: "Lakeshore Cedar Works",
      email: "estimates@lakeshorecedar.example",
      website: "https://lakeshorecedar.example",
      services: ["Cedar fencing", "Privacy screens"],
      serviceArea: "Waterloo Region",
      ratingSnippet: "4.9 ★ · 40 reviews",
      excerpt: "# Lakeshore Cedar Works\n\nPremium western red cedar fences and privacy screens. estimates@lakeshorecedar.example",
      rfqStatus: "delivered",
      sentAgo: 24 * h,
    });

    const rfqText =
      "Hello,\n\nI'm looking for a quote for a fencing job in Waterloo, ON. A windstorm took down about 40 ft of 6 ft privacy fence; posts snapped at ground level and need removal. Level lawn, 4 ft side-gate access. Cedar or pressure-treated, 6 ft high, one 4 ft gate.\n\nTiming: within the next 4 weeks.\n\nCould you reply with a price (a range is fine), how long it takes, earliest start, and what is and isn't included?\n\nThank you!";

    const message = async (m: {
      contractorId: Id<"contractors">;
      direction: "in" | "out";
      text: string;
      classification: "quote" | "question" | "decline" | "other";
      summary: string;
      ago: number;
    }) =>
      await ctx.db.insert("messages", {
        jobId,
        contractorId: m.contractorId,
        direction: m.direction,
        messageId: `seed-${m.direction}-${m.contractorId}-${m.ago}`,
        threadId: `seed-thread-${m.contractorId}`,
        subject: `${m.direction === "in" ? "Re: " : ""}[QA-DEMO] Quote request: Replace 40 ft of fallen back fence in Waterloo`,
        extractedText: m.text,
        fullText: m.text,
        classification: m.classification,
        summary: m.summary,
        aiState: "ok",
        at: now - m.ago,
      });

    for (const id of [maple, grand, tri, northfield]) {
      await message({ contractorId: id, direction: "out", text: rfqText, classification: "other", summary: "RFQ sent", ago: 24 * h });
    }

    // Quote 1: Maple City — detailed, mid-price.
    const mapleMsg = await message({
      contractorId: maple,
      direction: "in",
      text:
        "Hi there,\n\nThanks for the photos — that's a straightforward rebuild. For 40 linear feet of 6' pressure-treated privacy fence with one 4' gate we'd be at $3,200–$3,600 plus HST. That includes tear-out and disposal of the old fence, new 4x4 posts set in concrete, and the gate hardware. Staining/sealing is not included but we can quote it separately.\n\nTakes about 2 days on site. We're booking about two weeks out right now.\n\nMike\nMaple City Fencing",
      classification: "quote",
      summary: "Quoted $3,200–$3,600 for PT fence with gate, removal included, staining excluded; 2 days, ~2 weeks out.",
      ago: 19 * h,
    });
    await ctx.db.insert("quotes", {
      jobId,
      contractorId: maple,
      messageId: mapleMsg,
      priceLow: 3200,
      priceHigh: 3600,
      currency: "CAD",
      timelineDays: 2,
      startEarliest: "about two weeks out",
      includes: ["Tear-out & disposal", "4x4 posts in concrete", "4 ft gate + hardware"],
      excludes: ["Staining / sealing", "HST"],
      notes: "Pressure-treated. Cedar available on request.",
      confidence: 0.92,
      model: "seed",
      createdAt: now - 19 * h,
    });

    // Quote 2: Grand River — premium cedar, slower, some things unstated.
    const grandMsg = await message({
      contractorId: grand,
      direction: "in",
      text:
        "Hello,\n\nWe can rebuild that section in western red cedar for $4,100 all in, including removal. We'd need about 3 days. Earliest we could start is the week of the 22nd.\n\nRegards,\nDana, Grand River Fence & Deck",
      classification: "quote",
      summary: "Quoted $4,100 all-in for cedar rebuild incl. removal; 3 days, starting week of the 22nd.",
      ago: 8 * h,
    });
    await ctx.db.insert("quotes", {
      jobId,
      contractorId: grand,
      messageId: grandMsg,
      priceLow: 4100,
      priceHigh: 4100,
      currency: "CAD",
      timelineDays: 3,
      startEarliest: "week of the 22nd",
      includes: ["Western red cedar", "Removal of old fence"],
      excludes: [],
      notes: "5-year workmanship warranty per their site.",
      confidence: 0.88,
      model: "seed",
      createdAt: now - 8 * h,
    });

    // Question from Tri-City, awaiting approval.
    const triMsg = await message({
      contractorId: tri,
      direction: "in",
      text: "Hi, happy to quote. Quick question before I price it: is the ground level along the run, and is there room to get a small skid-steer through the side gate? Thanks, Sam",
      classification: "question",
      summary: "Asked whether the ground is level and whether a skid-steer fits through the side gate.",
      ago: 3 * h,
    });
    await ctx.db.insert("questions", {
      jobId,
      contractorId: tri,
      messageId: triMsg,
      question: "Is the ground level along the run, and is there room to get a small skid-steer through the side gate?",
      proposedAnswer:
        "Yes — the run is level lawn the whole way. Access is through a side gate that's about 4 ft wide, so a small skid-steer may be tight; a mini/walk-behind unit or wheelbarrow access would definitely work. Happy to send a photo of the gate if that helps.",
      grounded: true,
      status: "pending_approval",
      model: "seed",
      createdAt: now - 3 * h,
    });

    // Decline from Northfield.
    await message({
      contractorId: northfield,
      direction: "in",
      text: "Thanks for reaching out. Unfortunately we're booked solid through the fall and can't take on new residential work right now. Best of luck with the project.",
      classification: "decline",
      summary: "Declined — booked through the fall.",
      ago: 15 * h,
    });

    return { jobId, slug: demoSlug };
  },
});
