"use node";

import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { draft, extract, modelId } from "./llm";
import { assertNotPaused, isRateLimitError, QUOTA_MESSAGE, rateLimiter } from "./limits";

/**
 * Quote Arena's AI layer. Every call goes through `tryExtract`/`tryDraft`,
 * which race the LLM against a soft timeout and report failure instead of
 * throwing, so a slow or dead endpoint degrades to the heuristic fallbacks
 * below and the product keeps moving. Stored artifacts record which path
 * produced them (`model` = the model id, or "heuristic").
 */

export const HEURISTIC = "heuristic";

function softTimeoutMs() {
  const n = Number(process.env.LLM_SOFT_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`LLM soft timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; error: string };

export async function tryExtract<T>(
  schema: z.ZodType<T>,
  prompt: string,
  opts: { system?: string; maxTokens?: number } = {},
): Promise<AiResult<T>> {
  try {
    const data = await withTimeout(extract(schema, prompt, opts), softTimeoutMs());
    return { ok: true, data, model: modelId() };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) };
  }
}

export async function tryDraft(prompt: string, opts: { system?: string; maxTokens?: number } = {}): Promise<AiResult<string>> {
  try {
    const data = await withTimeout(draft(prompt, opts), softTimeoutMs());
    if (!data.trim()) return { ok: false, error: "empty draft" };
    return { ok: true, data: data.trim(), model: modelId() };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) };
  }
}

/**
 * The one entry point product actions use for structured extraction. Applies,
 * in order: the pause switch, the circuit breaker, global rate limits, usage
 * metering, the soft timeout, and records the outcome for the breaker.
 */
export async function aiExtract<T>(
  ctx: ActionCtx,
  schema: z.ZodType<T>,
  prompt: string,
  opts: { system?: string; maxTokens?: number; userKey?: string } = {},
): Promise<AiResult<T>> {
  const gate = await aiGate(ctx, opts.userKey);
  if (gate) return gate;
  const res = await tryExtract(schema, prompt, opts);
  await ctx.runMutation(internal.aiHealth.record, { ok: res.ok, error: res.ok ? undefined : res.error });
  return res;
}

/** Same gates as aiExtract, for free-text drafting. */
export async function aiDraft(
  ctx: ActionCtx,
  prompt: string,
  opts: { system?: string; maxTokens?: number; userKey?: string } = {},
): Promise<AiResult<string>> {
  const gate = await aiGate(ctx, opts.userKey);
  if (gate) return gate;
  const res = await tryDraft(prompt, opts);
  await ctx.runMutation(internal.aiHealth.record, { ok: res.ok, error: res.ok ? undefined : res.error });
  return res;
}

async function aiGate(ctx: ActionCtx, userKey?: string): Promise<{ ok: false; error: string } | null> {
  try {
    assertNotPaused();
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
  if (!(await ctx.runQuery(internal.aiHealth.shouldTry, {}))) {
    return { ok: false, error: "LLM circuit open (recent failures); skipped" };
  }
  try {
    await rateLimiter.limit(ctx, "globalBurst", { throws: true });
    await rateLimiter.limit(ctx, "globalLlm", { throws: true });
    if (userKey) await rateLimiter.limit(ctx, "userLlm", { key: userKey, throws: true });
  } catch (e) {
    return { ok: false, error: isRateLimitError(e) ? QUOTA_MESSAGE : String(e) };
  }
  await ctx.runMutation(internal.usage.bump, { provider: "llm" });
  return null;
}

// ───────────────────────── schemas ─────────────────────────

export const QuoteSchema = z.object({
  priceLow: z.number().nullable().describe("Lowest price quoted, numeric, null if not stated"),
  priceHigh: z.number().nullable().describe("Highest price quoted; equal to priceLow for a single figure"),
  currency: z.string().describe("ISO code, e.g. CAD or USD; guess from context, default CAD"),
  timelineDays: z.number().nullable().describe("How many days the work takes once started, null if not stated"),
  startEarliest: z.string().nullable().describe("Earliest start, as written (e.g. 'next week', '2 weeks out'), null if not stated"),
  includes: z.array(z.string()).describe("Items explicitly included"),
  excludes: z.array(z.string()).describe("Items explicitly excluded or extra"),
  notes: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const InboundAnalysisSchema = z.object({
  classification: z.enum(["quote", "question", "decline", "auto_reply", "other"]),
  summary: z.string().describe("One sentence, plain English, for the homeowner"),
  quote: QuoteSchema.nullable().describe("Filled only when the email contains a price"),
  questions: z.array(z.string()).describe("Every clarifying question the contractor asked, verbatim-ish"),
});
export type InboundAnalysis = z.infer<typeof InboundAnalysisSchema>;

export const ContractorBatchSchema = z.object({
  contractors: z.array(
    z.object({
      sourceIndex: z.number().int(),
      isDirectory: z.boolean().describe("True for review sites, marketplaces, listicles, government pages"),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      website: z.string().nullable(),
      services: z.array(z.string()),
      serviceArea: z.string().nullable(),
      ratingSnippet: z.string().nullable().describe("A short review/rating phrase if present"),
    }),
  ),
});

export const AnswersSchema = z.object({
  answers: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      grounded: z.boolean().describe("True only if the job facts fully answer it"),
    }),
  ),
});

// ───────────────────────── heuristics (LLM unavailable) ─────────────────────────

const MONEY_RE = /(?:\$|CAD|USD|C\$|US\$)\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?/gi;

function toNumber(s: string, k?: string) {
  const n = Number(s.replace(/,/g, ""));
  return k ? n * 1000 : n;
}

export function heuristicQuote(text: string): z.infer<typeof QuoteSchema> | null {
  const prices: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) prices.push(toNumber(m[1], m[2]));
  // "$3,200-3,600" / "3200 to 3600": pick up the bare second number after a dash/to.
  const range = text.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d{3,6})\s?(?:-|–|—|to)\s?\$?\s?(\d{1,3}(?:,\d{3})+|\d{3,6})/);
  if (range) prices.push(toNumber(range[1]), toNumber(range[2]));
  // Bare "4k" / "3.5k" with no currency symbol.
  for (const m of text.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d)?)k\b/gi)) prices.push(Number(m[1]) * 1000);
  const real = prices.filter((p) => p >= 50 && p < 10_000_000);
  if (!real.length) return null;

  // Duration of the work ("takes 2 days", "finish in 3 days") — not lead time ("2 weeks out").
  const timeline =
    text.match(
      /(?:takes?|taking|done|complete[ds]?|finish(?:ed)?|wrap(?:ped)? up|need)\s+(?:about|around|roughly|in|us)?\s*(?:about|around|roughly|in)?\s*(\d+(?:\.\d+)?)\s*(day|week|month)s?\b/i,
    ) ??
    text.match(/(\d+(?:\.\d+)?)\s*(day|week|month)s?(?:\s+(?:of work|on site|job|build|install))\b/i) ??
    text.match(/(\d+(?:\.\d+)?)\s*(day|week|month)s?\b(?!\s*(?:out|from now|away|lead|wait|notice|booked))/i);
  let timelineDays: number | null = null;
  if (timeline) {
    const n = Number(timeline[1]);
    const unit = timeline[2].toLowerCase();
    timelineDays = unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
  }
  const startM =
    text.match(/\b(next week|this week|tomorrow|next month|(?:\d+|a|two|three)\s+weeks?\s+out|start(?:ing)?\s+[^.,;\n]{2,30})/i);
  const clip = (s: string) =>
    s.split(/,?\s*(?:but\s+)?(?:excludes?|excluding|not including|does ?n[o']t include|extra for)\b/i)[0].trim();
  const includes = [...text.matchAll(/\b(?:includes?|including|incl\.)\s+([^.;\n]{3,80})/gi)]
    .map((m) => clip(m[1]))
    .filter(Boolean);
  const excludes = [
    ...text.matchAll(/\b(?:excludes?|excluding|not including|doesn'?t include|does not include|extra for)\s+([^.;\n]{3,80})/gi),
  ].map((m) => m[1].trim());
  const cur = /USD|US\$/i.test(text) ? "USD" : /£/.test(text) ? "GBP" : /€/.test(text) ? "EUR" : "CAD";
  return {
    priceLow: Math.min(...real),
    priceHigh: Math.max(...real),
    currency: cur,
    timelineDays,
    startEarliest: startM ? startM[1].split(/\s+(?:and|then|,)\s+/)[0].trim() : null,
    includes,
    excludes,
    notes: null,
    confidence: 0.45,
  };
}

export function heuristicQuestions(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") && s.length > 8 && s.length < 240)
    .slice(0, 5);
}

export function heuristicAnalysis(text: string): InboundAnalysis {
  const lower = text.toLowerCase();
  if (/auto-?reply|automatic reply|out of (the )?office|autoresponder/.test(lower)) {
    return { classification: "auto_reply", summary: "Automatic reply.", quote: null, questions: [] };
  }
  const quote = heuristicQuote(text);
  const questions = heuristicQuestions(text);
  if (quote) {
    return {
      classification: "quote",
      summary: `Quoted ${quote.currency} ${quote.priceLow}${quote.priceHigh !== quote.priceLow ? `–${quote.priceHigh}` : ""}${
        quote.timelineDays ? `, about ${quote.timelineDays} days` : ""
      }.`,
      quote,
      questions,
    };
  }
  if (/unfortunately|not able to|can'?t take|cannot take|decline|booked (up|solid)|don'?t (service|cover)|outside (of )?our (service )?area|no longer/.test(lower)) {
    return { classification: "decline", summary: "Declined the job.", quote: null, questions: [] };
  }
  if (questions.length) {
    return { classification: "question", summary: `Asked: ${questions[0]}`, quote: null, questions };
  }
  return { classification: "other", summary: text.slice(0, 120), quote: null, questions: [] };
}

export function heuristicAnswer(question: string, job: { title: string; description: string; timing: string; city: string; trade: string; budgetBand?: string }) {
  return {
    answer:
      `Thanks for asking. Here is everything I know about the job:\n\n` +
      `${job.title} (${job.trade}) in ${job.city}. ${job.description}\n\n` +
      `Timing: ${job.timing}.${job.budgetBand ? ` Budget band: ${job.budgetBand}.` : ""}\n\n` +
      `If that doesn't cover "${question.trim()}", let me know and I'll check and get back to you.`,
    grounded: false,
  };
}

const DIRECTORY_HOSTS = [
  "yelp.", "homestars.", "houzz.", "angi.", "angieslist.", "thumbtack.", "yellowpages.", "bbb.org", "facebook.", "instagram.",
  "linkedin.", "google.", "nextdoor.", "reddit.", "wikipedia.", "trustedpros.", "homeadvisor.", "porch.com", "bark.com",
  "kijiji.", "craigslist.", "indeed.", "glassdoor.", "youtube.", "pinterest.", "tiktok.", "x.com", "twitter.", "amazon.",
  "homedepot.", "lowes.", "rona.", "canadiantire.", "411.ca", "cylex", "n49.", "threebestrated.", "expertise.com", "yell.com",
  "checkatrade.", "mybuilder.", "ratedpeople.", "bing.", "yahoo.", "quora.", "medium.", "forbes.", "gov", "city.",
];

export function looksLikeDirectory(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DIRECTORY_HOSTS.some((d) => host.includes(d));
  } catch {
    return true;
  }
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

export function findEmail(markdown: string): string | undefined {
  const all = [...markdown.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
  const good = all.filter(
    (e) => !/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/.test(e) && !/noreply|no-reply|example\.|sentry|wixpress|godaddy|squarespace/.test(e),
  );
  return good[0];
}

const TRADE_WORDS =
  "roofing|roofers?|fencing|fences?|plumbing|plumbers?|electric(?:al)?|painting|painters?|landscaping|landscapes?|construction|contracting|contractors?|renovations?|reno|builders?|building|siding|homes?|exteriors?|interiors?|services?|group|inc|ltd|co|solutions|works|decks?|windows|doors|hvac|heating|cooling|flooring|floors|kitchens?|baths?|bathrooms?|masonry|concrete|paving|handyman|maintenance|restoration|cedar|wood|steel|iron|pro|pros";
const DOMAIN_SPLIT_RE = new RegExp(`^(.{3,}?)(${TRADE_WORDS})$`, "i");

/** "reuterroofing" → "Reuter Roofing"; "yrs-roofing" → "Yrs Roofing"; unknown shapes stay as-is. */
export function prettyDomainName(hostLabel: string): string {
  const cleaned = hostLabel.replace(/[-_]+/g, " ").trim();
  const cap = (w: string) => (w.length <= 3 && !/[aeiou]/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1));
  if (cleaned.includes(" ")) return cleaned.split(/\s+/).map(cap).join(" ");
  const m = cleaned.match(DOMAIN_SPLIT_RE);
  if (m) return `${cap(m[1])} ${cap(m[2])}`;
  return cap(cleaned);
}

/** Listicle / roundup titles are directories, not a contractor's own page. */
export function looksLikeListicle(title?: string): boolean {
  return /^(?:the\s+)?(?:\d+\s+)?(?:best|top)\b|\bnear (?:me|you)\b|\bdirectory\b|\breviews?\s+(?:of|for)\b/i.test(title ?? "");
}

export function heuristicContractor(
  hit: { url: string; title?: string; description?: string; markdown?: string },
  opts: { city?: string } = {},
) {
  const md = hit.markdown ?? "";
  const segments = (hit.title ?? "")
    .split(/\s[|\-–—•:]\s/)
    .map((s) => s.trim())
    .filter(Boolean);
  let domainName = "Contractor";
  try {
    domainName = prettyDomainName(new URL(hit.url).hostname.replace(/^www\./, "").split(".")[0]);
  } catch {
    /* keep default */
  }
  // SEO titles ("Fence Contractor Waterloo | Star Fencing") often lead with a
  // generic phrase or a place name; prefer a short brand-like segment, else the domain.
  const generic =
    /^(?:best|top|local|affordable|professional|home)?\s*(?:[a-z]+\s+){0,2}(?:contractors?|company|companies|services?|installation|repair|repairs|experts?|pros?|quotes?|estimates?)\b/i;
  const city = opts.city?.toLowerCase();
  const placey = (seg: string) => (city ? seg.toLowerCase().includes(city) : false) || /\b(?:ontario|canada|usa|region|area|county)\b/i.test(seg);
  const brand = segments.find((seg) => seg.split(/\s+/).length <= 4 && !generic.test(seg) && !placey(seg));
  const name = brand ?? domainName;
  const phone = md.match(PHONE_RE)?.[0];
  const email = findEmail(md) ?? findEmail(hit.description ?? "");
  let website: string | undefined;
  try {
    website = new URL(hit.url).origin;
  } catch {
    website = undefined;
  }
  return {
    name: name.slice(0, 80),
    email,
    phone,
    website,
    services: [] as string[],
    serviceArea: undefined as string | undefined,
    ratingSnippet: undefined as string | undefined,
    isDirectory: looksLikeListicle(hit.title),
  };
}

/** Plain-text RFQ used when the LLM cannot draft one. Reads well on its own. */
export function templateRfq(job: {
  title: string;
  trade: string;
  description: string;
  city: string;
  region: string;
  timing: string;
  budgetBand?: string;
  photos: { url: string }[];
}) {
  const lines = [
    `Hello,`,
    ``,
    `I'm looking for a quote for a ${job.trade.toLowerCase()} job in ${job.city}, ${job.region} and found your company online.`,
    ``,
    `The job: ${job.title}`,
    job.description,
    ``,
    `Timing: ${job.timing}${job.budgetBand ? `\nBudget: ${job.budgetBand}` : ""}`,
  ];
  if (job.photos.length) {
    lines.push(``, `Photos:`);
    job.photos.forEach((p, i) => lines.push(`  ${i + 1}. ${p.url}`));
  }
  lines.push(
    ``,
    `Could you reply with a price (a range is fine), roughly how long the work takes, your earliest start, and what is and isn't included? Just reply to this email and keep the subject line.`,
    ``,
    `If you have questions about the site, ask away.`,
    ``,
    `Thank you!`,
  );
  return lines.join("\n");
}
