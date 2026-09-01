/**
 * The leaderboard formula. Pure and shared by the server query and the UI
 * tooltip, so what the user reads is exactly what ranks the cards.
 *
 *   effective cost = price midpoint
 *                  × (1 + 1% per day of timeline)         "waiting costs 1%/day"
 *                  × (1 + 3% per field the quote left out) "vague quotes get a small penalty"
 *
 * Lower effective cost ranks higher. Quotes with no price at all cannot be
 * ranked and sit at the bottom, flagged "needs a price".
 */

export const ASSUMED_TIMELINE_DAYS = 21;
export const TIMELINE_RATE = 0.01;
export const MISSING_RATE = 0.03;

export type Rankable = {
  priceLow?: number | null;
  priceHigh?: number | null;
  timelineDays?: number | null;
  startEarliest?: string | null;
  includes: string[];
  confidence: number;
};

export type Breakdown = {
  priceMid: number | null;
  timelineDays: number | null;
  timelineFactor: number;
  missing: string[];
  missingFactor: number;
  score: number | null;
};

export function priceMid(q: Rankable): number | null {
  const lo = q.priceLow ?? null;
  const hi = q.priceHigh ?? null;
  if (lo != null && hi != null) return (lo + hi) / 2;
  if (lo != null) return lo;
  if (hi != null) return hi;
  return null;
}

export function missingFields(q: Rankable): string[] {
  const m: string[] = [];
  if (q.priceLow == null && q.priceHigh == null) m.push("price");
  if (q.timelineDays == null) m.push("timeline");
  if (!q.startEarliest) m.push("start date");
  if (!q.includes?.length) m.push("what's included");
  return m;
}

export function breakdown(q: Rankable): Breakdown {
  const mid = priceMid(q);
  const days = q.timelineDays ?? null;
  const timelineFactor = 1 + TIMELINE_RATE * (days ?? ASSUMED_TIMELINE_DAYS);
  const missing = missingFields(q);
  const missingFactor = 1 + MISSING_RATE * missing.length;
  const score = mid == null ? null : Math.round(mid * timelineFactor * missingFactor);
  return { priceMid: mid, timelineDays: days, timelineFactor, missingFactor, missing, score };
}

/** Sort comparator: ranked by score ascending, unpriced last, ties by confidence. */
export function compareRank(a: Rankable, b: Rankable): number {
  const sa = breakdown(a).score;
  const sb = breakdown(b).score;
  if (sa == null && sb == null) return b.confidence - a.confidence;
  if (sa == null) return 1;
  if (sb == null) return -1;
  if (sa !== sb) return sa - sb;
  return b.confidence - a.confidence;
}

export const FORMULA_TEXT =
  `effective cost = price midpoint × (1 + ${TIMELINE_RATE * 100}% per day of timeline) × (1 + ${MISSING_RATE * 100}% per unstated field). ` +
  `Unstated timeline assumes ${ASSUMED_TIMELINE_DAYS} days. Lower is better; quotes without a price are unranked.`;
