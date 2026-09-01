export function money(n: number | null | undefined, currency = "CAD") {
  if (n == null) return "—";
  const sym = currency === "USD" ? "US$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  return `${sym}${Math.round(n).toLocaleString("en-CA")}`;
}

export function priceRange(low?: number | null, high?: number | null, currency = "CAD") {
  if (low == null && high == null) return "Not stated";
  if (low != null && high != null && low !== high) return `${money(low, currency)}–${money(high, currency).replace(/^[^\d]*/, "")}`;
  return money(low ?? high, currency);
}

export function days(n: number | null | undefined) {
  if (n == null) return "Not stated";
  if (n === 1) return "1 day";
  if (n < 14) return `${n} days`;
  const w = Math.round(n / 7);
  return `${w} week${w === 1 ? "" : "s"}`;
}

export function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function host(url?: string | null) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

/** Friendly copy for thrown Convex errors (quota, paused, access). */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rate ?limit|quota|too many/i.test(msg)) return "Demo quota reached — this app runs on free tiers. Please try again later.";
  if (/PAUSED/i.test(msg)) return "The demo is paused right now to protect free-tier quotas.";
  const m = msg.match(/Uncaught Error: ([^\n]+)/);
  return (m ? m[1] : msg).replace(/\s+at .*$/s, "").slice(0, 200);
}
