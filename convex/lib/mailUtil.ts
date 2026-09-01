/**
 * Pure email helpers — no SDK imports, so these are safe to use from queries
 * and mutations in Convex's default runtime.
 */

/** Unguessable per-case code, e.g. BCN-7F3K. Used to route replies. */
export function newCaseCode(prefix: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${s}`;
}

const CODE_RE = /\[([A-Z]{2,5}-[A-Z0-9]{4})\]/;

/** Pull a caseCode out of a subject line, if present. */
export function caseCodeFromSubject(subject: string | undefined): string | null {
  const m = subject?.match(CODE_RE);
  return m ? m[1] : null;
}

/**
 * A subject reduced to its bare topic, so an inbound "Re: [AFT-7F3K] Notice of
 * death…" can be matched against the outbound "[to: x@y] [AFT-7F3K] Notice of
 * death…" that started it. Used only as a fallback when the thread id is
 * missing.
 */
export function normalizeSubject(subject: string | undefined): string {
  return (subject ?? "")
    .replace(/\[to:[^\]]*\]/gi, "")
    .replace(/\[[A-Z]{2,5}-[A-Z0-9]{4}\]/g, "")
    .replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Never log or display a full address. */
export function redactEmail(address: string | undefined): string {
  if (!address) return "unknown";
  const at = address.lastIndexOf("@");
  return at > 0 ? `***${address.slice(at)}` : "***";
}

/** Bare address out of "Name <a@b.c>". */
export function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).toLowerCase().trim();
}
