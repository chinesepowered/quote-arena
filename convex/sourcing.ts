"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { excerpt, map, scrape, search, type SearchHit } from "./lib/firecrawl";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE, rateLimiter } from "./lib/limits";
import {
  ContractorBatchSchema,
  findEmail,
  HEURISTIC,
  heuristicContractor,
  looksLikeDirectory,
  aiExtract,
} from "./lib/quoteAi";

/**
 * Firecrawl discovery: search the web for local contractors, read their pages,
 * and turn each into a contractor row with a source link. Runs in the
 * background after a job is created; the UI watches rows appear live.
 *
 * Budget: 2 searches (limit 5 each, ~2 credits) + at most 3 contact-page
 * scrapes per run, all with a 24h cache window.
 *
 * Every crawl goes through the gateway in lib/firecrawl.ts, which serves a
 * stored result when it has one and refuses to spend when the shared credit
 * pool is near its reserve. A refusal is not an error: whatever contractors
 * are already on the board stay there, we simply stop adding more and say so.
 */

const SEARCH_LIMIT = 5;
const MAX_CONTACT_SCRAPES = 3;

/** Shown when the credit guard stops a live search. Honest, not alarming. */
const BUDGET_NOTE =
  "Showing saved results — live contractor search is paused to protect the shared crawl budget.";

export const discover = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.runQuery(internal.jobs.getInternal, { jobId });
    const setSourcing = (s: { state: "running" | "done" | "error"; note?: string; queries?: string[]; found?: number }) =>
      ctx.runMutation(internal.jobs.setSourcing, { jobId, ...s });

    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "globalBurst", { throws: true });
      await rateLimiter.limit(ctx, "globalCrawl", { throws: true });
      await rateLimiter.limit(ctx, "userCrawl", { key: job.ownerId ?? "demo", throws: true });
    } catch (e) {
      const note = isRateLimitError(e) ? QUOTA_MESSAGE : String(e instanceof Error ? e.message : e);
      await setSourcing({ state: "error", note });
      return;
    }

    const where = `${job.city}${job.region ? ", " + job.region : ""}`;
    const queries = [`${job.trade} contractor ${where}`, `${job.trade} company ${where} contact`];
    await setSourcing({ state: "running", note: `Searching the web: "${queries[0]}"…`, queries, found: 0 });

    // 1. Search (both variants), de-duplicated by host, directories dropped.
    const hits: SearchHit[] = [];
    const seen = new Set<string>();
    /** True once the credit guard has refused a live crawl this run. */
    let budgetPaused = false;
    for (const q of queries) {
      try {
        const res = await search(ctx, q, SEARCH_LIMIT);
        if (res.reason === "budget") budgetPaused = true;
        // Only meter what we actually spent; a stored result is free.
        if (!res.cached) await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
        for (const h of res.data ?? []) {
          if (!h.url) continue;
          let host = "";
          try {
            host = new URL(h.url).hostname.replace(/^www\./, "");
          } catch {
            continue;
          }
          if (seen.has(host) || looksLikeDirectory(h.url)) continue;
          seen.add(host);
          hits.push(h);
        }
        await setSourcing({ state: "running", note: `Read ${hits.length} contractor pages, extracting details…` });
        // Nothing stored and nothing affordable: stop early rather than burn
        // the second query on the same refusal.
        if (res.reason === "budget" && !res.data) break;
      } catch (e) {
        console.error("firecrawl search failed", String(e));
      }
    }

    if (!hits.length) {
      await setSourcing({
        state: "done",
        note: budgetPaused ? BUDGET_NOTE : "No contractor sites found. Add one by hand.",
        found: 0,
      });
      return;
    }

    // 2. Extract contact/service details. One LLM call for the whole batch;
    //    falls back to regex extraction if the model is slow or unavailable.
    type Extracted = ReturnType<typeof heuristicContractor> & { isDirectory: boolean; model: string };
    const extracted = new Map<number, Extracted>();
    let llmOk = false;
    {
      const prompt =
        `Job: ${job.trade} in ${where}.\n` +
        `Below are ${hits.length} web pages found by searching for local contractors. For EACH page (by sourceIndex), ` +
        `extract the business. Mark isDirectory=true for review sites, marketplaces, listicles, news or government pages ` +
        `that are not a single contractor's own site. Use null for anything not present; never invent an email.\n\n` +
        hits
          .map(
            (h, i) =>
              `### sourceIndex ${i}\nURL: ${h.url}\nTitle: ${h.title ?? ""}\nDescription: ${h.description ?? ""}\n` +
              `Content:\n${excerpt(h.markdown ?? "", 1800)}`,
          )
          .join("\n\n");
      const res = await aiExtract(ctx, ContractorBatchSchema, prompt, {
        system: "You extract structured business contact data from web pages. Be precise and conservative.",
        maxTokens: 2000,
        userKey: job.ownerId ?? undefined,
      });
      if (res.ok) {
        llmOk = true;
        for (const c of res.data.contractors) {
          const hit = hits[c.sourceIndex];
          if (!hit) continue;
          const fallback = heuristicContractor(hit, { city: job.city });
          extracted.set(c.sourceIndex, {
            name: c.name || fallback.name,
            email: c.email ?? fallback.email,
            phone: c.phone ?? fallback.phone,
            website: c.website ?? fallback.website,
            services: c.services,
            serviceArea: c.serviceArea ?? undefined,
            ratingSnippet: c.ratingSnippet ?? undefined,
            isDirectory: c.isDirectory || fallback.isDirectory,
            model: res.model,
          });
        }
      } else {
        console.warn("contractor extraction fell back to heuristics:", res.error);
      }
    }
    hits.forEach((h, i) => {
      if (!extracted.has(i)) extracted.set(i, { ...heuristicContractor(h, { city: job.city }), model: HEURISTIC });
    });

    // 3. Write rows as we go so the list fills in live.
    let found = 0;
    const needEmail: { id: Id<"contractors">; website: string }[] = [];
    for (const [i, c] of extracted) {
      if (c.isDirectory) continue;
      const hit = hits[i];
      const { id, inserted } = await ctx.runMutation(internal.contractors.upsertFromCrawl, {
        jobId,
        name: c.name,
        website: c.website ?? undefined,
        email: c.email ?? undefined,
        phone: c.phone ?? undefined,
        services: c.services.length ? c.services : [job.trade],
        serviceArea: c.serviceArea,
        ratingSnippet: c.ratingSnippet,
        sourceUrl: hit.url,
        sourceTitle: hit.title,
        rawExcerpt: excerpt(hit.markdown ?? hit.description ?? "", 1200),
        model: c.model,
      });
      if (inserted) found++;
      if (!c.email && c.website) needEmail.push({ id, website: c.website });
      await setSourcing({ state: "running", found, note: `Found ${found} contractor${found === 1 ? "" : "s"}…` });
    }

    // 4. Contact-page pass for sites whose homepage had no email (capped).
    //    Purely additive: a refusal here just leaves the row without an email.
    let scrapes = 0;
    for (const { id, website } of needEmail) {
      if (scrapes >= MAX_CONTACT_SCRAPES) break;
      try {
        const mapped = await map(ctx, website, 25);
        if (mapped.reason === "budget") budgetPaused = true;
        if (!mapped.cached) await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
        if (!mapped.data) {
          if (mapped.reason === "budget") break;
          continue;
        }
        const contact = mapped.data.find((l) => /contact|about|get-in-touch|quote|estimate/i.test(l));
        if (!contact) continue;
        scrapes++;
        const page = await scrape(ctx, contact);
        if (page.reason === "budget") budgetPaused = true;
        if (!page.cached) await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
        if (!page.data) {
          if (page.reason === "budget") break;
          continue;
        }
        const email = findEmail(page.data.markdown);
        if (email) {
          await ctx.runMutation(internal.contractors.patchContact, { contractorId: id, email, contactUrl: contact });
        }
      } catch (e) {
        console.warn("contact scrape failed", String(e));
      }
    }

    await setSourcing({
      state: "done",
      found,
      note:
        `Found ${found} contractor${found === 1 ? "" : "s"} from ${hits.length} pages` +
        `${llmOk ? "" : " (AI extraction unavailable, used pattern matching)"}.` +
        `${budgetPaused ? ` ${BUDGET_NOTE}` : ""}`,
    });
  },
});

/**
 * Ops probe: exercise the crawl gateway directly, bypassing the per-call token,
 * so the credit guard and the stored-result fallback can be checked on a live
 * deployment without touching product state.
 */
export const budgetProbe = internalAction({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<{ hasData: boolean; cached: boolean; stale: boolean; reason?: string }> => {
    const r = await scrape(ctx, url);
    return { hasData: Boolean(r.data), cached: r.cached, stale: r.stale, reason: r.reason };
  },
});
