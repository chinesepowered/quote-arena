import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Id } from "../../convex/_generated/dataModel";
import type { Breakdown } from "../../convex/lib/ranking";
import { ago, days, money, pct, priceRange } from "../lib/format";
import { Button, Pill, Tooltip } from "./ui";

export type BoardQuote = {
  _id: Id<"quotes">;
  contractorId: Id<"contractors">;
  contractorName: string;
  rank: number | null;
  revision: number;
  priceLow?: number;
  priceHigh?: number;
  currency: string;
  timelineDays?: number;
  startEarliest?: string;
  includes: string[];
  excludes: string[];
  notes?: string;
  confidence: number;
  model: string;
  createdAt: number;
  breakdown: Breakdown;
};

type Props = {
  quotes: BoardQuote[];
  formula: string;
  budgetBand?: string;
  canEdit: boolean;
  winnerId?: Id<"contractors">;
  decided: boolean;
  compareIds: Id<"quotes">[];
  onToggleCompare: (id: Id<"quotes">) => void;
  onReply: (contractorId: Id<"contractors">) => void;
  onPickWinner: (contractorId: Id<"contractors">) => void;
};

function parseBand(band?: string): [number, number] | null {
  if (!band) return null;
  const nums = [...band.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, "")));
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  return null;
}

const RANK_STYLES: Record<number, string> = {
  1: "bg-gradient-to-br from-amber-300 via-yellow-400 to-orange-500 text-stone-950 shadow-lg shadow-amber-500/40 ring-amber-200",
  2: "bg-gradient-to-br from-slate-200 via-slate-300 to-slate-400 text-slate-900 shadow-md shadow-slate-400/30 ring-slate-100",
  3: "bg-gradient-to-br from-orange-200 via-amber-600 to-amber-800 text-white shadow-md shadow-amber-800/30 ring-amber-200",
};

export function Leaderboard(p: Props) {
  const { quotes } = p;

  // Remember previous ranks so cards can announce how far they moved.
  const prevRanks = useRef<Map<string, number | null>>(new Map());
  const prevQuoteIds = useRef<Map<string, string>>(new Map());
  const [moves, setMoves] = useState<Record<string, { delta: number; fresh: boolean; updated: boolean }>>({});
  const [banner, setBanner] = useState<{ name: string; key: number } | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const next: typeof moves = {};
    let newLeader: string | null = null;
    for (const q of quotes) {
      const key = String(q.contractorId);
      const prev = prevRanks.current.get(key);
      const prevQuote = prevQuoteIds.current.get(key);
      const fresh = !prevRanks.current.has(key);
      const updated = !fresh && prevQuote !== String(q._id);
      const delta = prev != null && q.rank != null ? prev - q.rank : 0;
      if ((fresh || updated || delta !== 0) && !firstRender.current) next[key] = { delta, fresh, updated };
      if (q.rank === 1 && prev !== 1 && !firstRender.current && (fresh || updated || delta > 0)) newLeader = q.contractorName;
    }
    prevRanks.current = new Map(quotes.map((q) => [String(q.contractorId), q.rank]));
    prevQuoteIds.current = new Map(quotes.map((q) => [String(q.contractorId), String(q._id)]));
    firstRender.current = false;
    if (Object.keys(next).length) {
      setMoves(next);
      const t = setTimeout(() => setMoves({}), 4000);
      if (newLeader) setBanner({ name: newLeader, key: Date.now() });
      return () => clearTimeout(t);
    }
  }, [quotes]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  // Shared price scale for the bars.
  const scale = useMemo(() => {
    const band = parseBand(p.budgetBand);
    const vals: number[] = [];
    for (const q of quotes) {
      if (q.priceLow != null) vals.push(q.priceLow);
      if (q.priceHigh != null) vals.push(q.priceHigh);
    }
    if (band) vals.push(band[0], band[1]);
    if (!vals.length) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.12, max * 0.05, 100);
    return { min: Math.max(0, min - pad), max: max + pad, band };
  }, [quotes, p.budgetBand]);

  return (
    <div className="relative">
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.key}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none absolute inset-x-0 -top-3 z-20 mx-auto w-fit rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-sm font-semibold text-stone-950 shadow-lg shadow-amber-500/40"
          >
            New best quote · {banner.name} takes #1
          </motion.div>
        )}
      </AnimatePresence>

      {quotes.length === 0 ? (
        <EmptyBoard canEdit={p.canEdit} />
      ) : (
        <LayoutGroup>
          <motion.ol layout className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {quotes.map((q) => (
                <QuoteCard
                  key={String(q.contractorId)}
                  q={q}
                  scale={scale}
                  move={moves[String(q.contractorId)]}
                  formula={p.formula}
                  canEdit={p.canEdit}
                  isWinner={p.winnerId === q.contractorId}
                  dimmed={p.decided && p.winnerId !== q.contractorId}
                  compared={p.compareIds.includes(q._id)}
                  compareFull={p.compareIds.length >= 3}
                  onToggleCompare={() => p.onToggleCompare(q._id)}
                  onReply={() => p.onReply(q.contractorId)}
                  onPickWinner={() => p.onPickWinner(q.contractorId)}
                />
              ))}
            </AnimatePresence>
          </motion.ol>
        </LayoutGroup>
      )}
    </div>
  );
}

function EmptyBoard({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="grid place-items-center rounded-2xl border-2 border-dashed border-stone-200 bg-white/60 px-6 py-16 text-center">
      <div className="relative mb-4 size-14">
        <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/50" />
        <span className="relative grid size-14 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 font-display text-2xl font-bold text-stone-950 shadow-lg shadow-amber-500/40">
          1
        </span>
      </div>
      <p className="font-display text-lg font-semibold text-stone-800">No quotes on the board yet</p>
      <p className="mt-1 max-w-sm text-sm text-stone-500">
        Send requests, then watch this space. Every reply becomes a normalized card and the board reorders live.
        {canEdit && " Use “Reply as a contractor” in the right panel to try it now."}
      </p>
    </div>
  );
}

function QuoteCard({
  q,
  scale,
  move,
  formula,
  canEdit,
  isWinner,
  dimmed,
  compared,
  compareFull,
  onToggleCompare,
  onReply,
  onPickWinner,
}: {
  q: BoardQuote;
  scale: { min: number; max: number; band: [number, number] | null } | null;
  move?: { delta: number; fresh: boolean; updated: boolean };
  formula: string;
  canEdit: boolean;
  isWinner: boolean;
  dimmed: boolean;
  compared: boolean;
  compareFull: boolean;
  onToggleCompare: () => void;
  onReply: () => void;
  onPickWinner: () => void;
}) {
  const b = q.breakdown;
  const top = q.rank === 1;
  const flash = move && (move.fresh || move.updated || move.delta > 0);
  const heuristic = q.model === "heuristic";

  return (
    <motion.li
      layout
      layoutId={`quote-${q.contractorId}`}
      initial={{ opacity: 0, y: -28, scale: 0.97 }}
      animate={{ opacity: dimmed ? 0.55 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}
      className={`group relative overflow-hidden rounded-2xl bg-white ring-1 transition-shadow ${
        isWinner
          ? "ring-2 ring-emerald-400 shadow-xl shadow-emerald-500/20"
          : top
            ? "ring-amber-300 shadow-xl shadow-amber-500/15"
            : "ring-stone-200 shadow-sm hover:shadow-md"
      } ${compared ? "outline outline-2 outline-offset-2 outline-sky-400" : ""}`}
    >
      {flash && (
        <motion.span
          initial={{ opacity: 0.9 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 2.2, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-amber-200/70 via-yellow-100/40 to-transparent"
        />
      )}
      {top && !isWinner && <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-300 via-yellow-400 to-orange-500" />}
      {isWinner && (
        <span className="absolute right-0 top-0 rounded-bl-xl bg-emerald-500 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
          Winner
        </span>
      )}

      <div className="flex gap-4 p-4 sm:p-5">
        {/* Rank */}
        <div className="flex w-14 shrink-0 flex-col items-center gap-2">
          <motion.div
            key={q.rank ?? "u"}
            initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className={`grid size-14 place-items-center rounded-2xl font-display text-2xl font-extrabold ring-2 ${
              q.rank == null ? "bg-amber-50 text-amber-700 ring-amber-200" : (RANK_STYLES[q.rank] ?? "bg-stone-100 text-stone-700 ring-stone-100")
            }`}
          >
            {q.rank ?? "?"}
          </motion.div>
          <AnimatePresence>
            {move && move.delta !== 0 && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${move.delta > 0 ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
              >
                {move.delta > 0 ? `▲${move.delta}` : `▼${-move.delta}`}
              </motion.span>
            )}
            {move && move.fresh && move.delta === 0 && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                NEW
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate font-display text-lg font-semibold tracking-tight text-stone-900">{q.contractorName}</h3>
                {q.revision > 1 && (
                  <Pill tone="violet" title="This contractor revised their quote; the older one was superseded">
                    rev {q.revision}
                  </Pill>
                )}
                {move?.updated && (
                  <Pill tone="amber">updated</Pill>
                )}
              </div>
              <p className="mt-0.5 text-xs text-stone-500">
                {ago(q.createdAt)} ·{" "}
                <Tooltip
                  content={
                    heuristic
                      ? "The AI model was unavailable when this reply arrived, so the numbers were pattern-matched from the email text. Check them against the thread."
                      : `Extracted by ${q.model}. Confidence is the model's own estimate that every field is right.`
                  }
                >
                  <span className={`cursor-help underline decoration-dotted ${heuristic ? "text-amber-700" : ""}`}>
                    {heuristic ? "pattern-matched" : "AI-extracted"} · {pct(q.confidence)} confident
                  </span>
                </Tooltip>
              </p>
            </div>

            <Tooltip wide content={<Formula b={b} currency={q.currency} formula={formula} />}>
              <div className="cursor-help rounded-xl bg-stone-50 px-3 py-1.5 text-right ring-1 ring-stone-200">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Effective cost ⓘ</div>
                <div className="font-display text-base font-bold tabular-nums text-stone-900">{b.score == null ? "unranked" : money(b.score, q.currency)}</div>
              </div>
            </Tooltip>
          </div>

          {/* Price + bar */}
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className={`font-display text-3xl font-extrabold tabular-nums tracking-tight ${q.priceLow == null && q.priceHigh == null ? "text-amber-700" : "text-stone-900"}`}>
                {priceRange(q.priceLow, q.priceHigh, q.currency)}
              </div>
              <div className="text-xs text-stone-500">{q.currency}{q.priceLow != null && q.priceHigh != null && q.priceLow !== q.priceHigh ? ` · midpoint ${money(b.priceMid, q.currency)}` : ""}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone={q.timelineDays == null ? "amber" : "blue"} dashed={q.timelineDays == null} title="How long the work takes once started">
                ⏱ {days(q.timelineDays)}
              </Pill>
              <Pill tone={q.startEarliest ? "blue" : "amber"} dashed={!q.startEarliest} title="Earliest start">
                📅 {q.startEarliest ?? "Start not stated"}
              </Pill>
            </div>
          </div>
          {scale && <PriceBar low={q.priceLow} high={q.priceHigh} scale={scale} top={top} />}

          {/* Includes / excludes / missing */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ChipGroup label="Includes" tone="green" items={q.includes} empty="Not stated" />
            <ChipGroup label="Excludes" tone="red" items={q.excludes} empty="Nothing listed" />
          </div>
          {b.missing.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Not stated:</span>
              {b.missing.map((m) => (
                <Pill key={m} tone="amber" dashed>
                  {m}
                </Pill>
              ))}
            </div>
          )}
          {q.notes && <p className="mt-2 text-xs italic text-stone-500">“{q.notes}”</p>}

          {/* Footer */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
            <Confidence value={q.confidence} />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={onReply}>
                Thread
              </Button>
              <Button variant={compared ? "primary" : "secondary"} size="sm" onClick={onToggleCompare} disabled={!compared && compareFull} title={!compared && compareFull ? "Compare up to 3" : ""}>
                {compared ? "✓ Comparing" : "Compare"}
              </Button>
              {canEdit && !isWinner && (
                <Button variant={top ? "gold" : "secondary"} size="sm" onClick={onPickWinner}>
                  Pick winner
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function Formula({ b, currency, formula }: { b: Breakdown; currency: string; formula: string }) {
  return (
    <div className="space-y-1.5">
      <div className="font-semibold text-white">How this rank is computed</div>
      <p className="text-stone-300">{formula}</p>
      {b.score != null ? (
        <div className="mt-1 rounded-md bg-stone-800 p-2 font-mono text-[11px] leading-relaxed text-amber-200">
          {money(b.priceMid, currency)} × {b.timelineFactor.toFixed(2)}
          <span className="text-stone-400"> (timeline {b.timelineDays ?? "21 assumed"} d)</span>
          <br />× {b.missingFactor.toFixed(2)}
          <span className="text-stone-400"> ({b.missing.length} unstated: {b.missing.join(", ") || "none"})</span>
          <br />= <b className="text-white">{money(b.score, currency)}</b>
        </div>
      ) : (
        <p className="text-amber-200">No price yet, so this quote cannot be ranked.</p>
      )}
    </div>
  );
}

function PriceBar({ low, high, scale, top }: { low?: number; high?: number; scale: { min: number; max: number; band: [number, number] | null }; top: boolean }) {
  const span = scale.max - scale.min || 1;
  const x = (v: number) => `${Math.min(100, Math.max(0, ((v - scale.min) / span) * 100))}%`;
  const lo = low ?? high;
  const hi = high ?? low;
  return (
    <div className="mt-2">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-stone-100 ring-1 ring-inset ring-stone-200">
        {scale.band && (
          <div
            className="absolute inset-y-0 bg-emerald-100/80"
            style={{ left: x(scale.band[0]), width: `calc(${x(scale.band[1])} - ${x(scale.band[0])})` }}
            title="Your budget band"
          />
        )}
        {lo != null && hi != null && (
          <motion.div
            layout
            initial={false}
            animate={{ left: x(lo), width: hi === lo ? 6 : `calc(${x(hi)} - ${x(lo)})` }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={`absolute inset-y-0 rounded-full ${top ? "bg-gradient-to-r from-amber-400 to-orange-500" : "bg-stone-700"}`}
            style={{ minWidth: 6 }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-stone-400">
        <span>{money(scale.min)}</span>
        {scale.band && <span className="text-emerald-700">budget {money(scale.band[0])}–{money(scale.band[1]).replace(/^[^\d]*/, "")}</span>}
        <span>{money(scale.max)}</span>
      </div>
    </div>
  );
}

function ChipGroup({ label, tone, items, empty }: { label: string; tone: "green" | "red"; items: string[]; empty: string }) {
  return (
    <div className="min-w-0">
      <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${tone === "green" ? "text-emerald-700" : "text-rose-700"}`}>{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.length ? (
          items.map((it, i) => (
            <Pill key={i} tone={tone} title={it}>
              {tone === "green" ? "✓" : "✕"} {it}
            </Pill>
          ))
        ) : (
          <Pill tone={tone === "green" ? "amber" : "stone"} dashed={tone === "green"}>
            {empty}
          </Pill>
        )}
      </div>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const tone = value >= 0.8 ? "bg-emerald-500" : value >= 0.6 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2 text-[11px] text-stone-500" title="Extraction confidence">
      <span>confidence</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-stone-200">
        <motion.span initial={{ width: 0 }} animate={{ width: pct(value) }} className={`block h-full rounded-full ${tone}`} />
      </span>
      <span className="tabular-nums">{pct(value)}</span>
    </div>
  );
}
